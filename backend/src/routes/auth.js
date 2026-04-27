import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { query } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import {
  getAdminProfile,
  getCanonicalRole,
  isAdminEmail,
  isValidAdminCredentials,
  normalizeEmail,
} from '../security/adminPolicy.js';

const router = express.Router();

const buildStudentName = (email) => {
  const local = email.split('@')[0] || 'Student';
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  const raw = cleaned || 'Student';
  return raw.replace(/\b\w/g, (char) => char.toUpperCase());
};

const loginLimiter = createRateLimiter({
  windowMs: config.loginWindowMs,
  max: config.loginMaxAttempts,
  keySelector: (req) => `${req.ip}:${(req.body?.email || '').toLowerCase()}`,
});

const getRequestMeta = (req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const userAgent = (req.headers['user-agent'] || '').toString();
  return { ip, userAgent };
};

const writeAudit = async ({ userId = null, action, status, req, errorCode = null, metadata = null }) => {
  const { ip, userAgent } = getRequestMeta(req);
  await query(
    `
      INSERT INTO audit_logs (user_id, action, status, ip_address, user_agent, error_code, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [userId, action, status, ip || null, userAgent || null, errorCode, metadata ? JSON.stringify(metadata) : null]
  );
};

const signAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.full_name,
    },
    config.jwtSecret,
    { expiresIn: config.accessTokenExpiresIn }
  );
};

const generateRefreshToken = () => crypto.randomBytes(48).toString('hex');
const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

const toUserPayload = (row) => ({
  id: row.id,
  email: row.email,
  role: getCanonicalRole(row.email),
  name: row.full_name,
});

router.post('/register', loginLimiter, async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'Email and password are required',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'WEAK_PASSWORD',
        message: 'Password must be at least 6 characters',
      });
    }

    if (isAdminEmail(normalizedEmail)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Admin account cannot be created from this form',
      });
    }

    const existingResult = await query(
      `
        SELECT id
        FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1
      `,
      [normalizedEmail]
    );

    if (existingResult.rowCount > 0) {
      await writeAudit({
        action: 'REGISTER_FAILED',
        status: 'failed',
        req,
        errorCode: 'EMAIL_EXISTS',
        metadata: { emailAttempted: normalizedEmail },
      });

      return res.status(409).json({
        success: false,
        error: 'EMAIL_EXISTS',
        message: 'Email already exists',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const nameValue = String(fullName || '').trim() || buildStudentName(normalizedEmail);

    const createdUserResult = await query(
      `
        INSERT INTO users (email, password_hash, full_name, role)
        VALUES ($1, $2, $3, 'student')
        RETURNING id, email, full_name, role
      `,
      [normalizedEmail, passwordHash, nameValue]
    );

    const user = {
      ...createdUserResult.rows[0],
      role: getCanonicalRole(createdUserResult.rows[0].email),
    };

    const accessToken = signAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);
    const { ip, userAgent } = getRequestMeta(req);

    await query(
      `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [user.id, refreshTokenHash, expiresAt, ip || null, userAgent || null]
    );

    await writeAudit({
      userId: user.id,
      action: 'REGISTER_SUCCESS',
      status: 'success',
      req,
    });

    res.cookie('eduskill_rt', refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: config.accessTokenSeconds,
      user: toUserPayload(user),
      message: 'Account created successfully',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const adminProfile = getAdminProfile(normalizedEmail);
    const isAdmin = isAdminEmail(normalizedEmail);

    if (!normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'Email and password are required',
      });
    }

    const userResult = await query(
      `
        SELECT id, email, password_hash, full_name, role
        FROM users
        WHERE lower(email) = lower($1)
          AND is_active = true
        LIMIT 1
      `,
      [normalizedEmail]
    );

    if (isAdmin && !isValidAdminCredentials(normalizedEmail, password)) {
      await writeAudit({
        action: 'LOGIN_FAILED',
        status: 'failed',
        req,
        errorCode: 'INVALID_CREDENTIALS',
        metadata: { emailAttempted: normalizedEmail },
      });

      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    let user = userResult.rows[0] || null;

    if (isAdmin) {
      if (!user) {
        const generatedInternalPassword = crypto.randomBytes(48).toString('hex');
        const adminPasswordHash = await bcrypt.hash(generatedInternalPassword, 12);
        const createdAdmin = await query(
          `
            INSERT INTO users (email, password_hash, full_name, role)
            VALUES ($1, $2, $3, 'admin')
            RETURNING id, email, password_hash, full_name, role
          `,
          [normalizedEmail, adminPasswordHash, adminProfile?.fullName || buildStudentName(normalizedEmail)]
        );
        user = createdAdmin.rows[0];
      } else if (user.role !== 'admin') {
        const promoted = await query(
          `
            UPDATE users
            SET role = 'admin',
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, email, password_hash, full_name, role
          `,
          [user.id]
        );
        user = promoted.rows[0] || {
          ...user,
          role: 'admin',
        };
      }
    } else if (!user) {
      await writeAudit({
        action: 'LOGIN_FAILED',
        status: 'failed',
        req,
        errorCode: 'INVALID_CREDENTIALS',
        metadata: { emailAttempted: normalizedEmail },
      });

      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    } else {
      let passwordMatches = false;
      const storedPasswordHash = user.password_hash;

      if (isBcryptHash(storedPasswordHash)) {
        passwordMatches = await bcrypt.compare(password, storedPasswordHash);
      } else if (typeof storedPasswordHash === 'string' && storedPasswordHash.length > 0) {
        // Backward compatibility for legacy plain-text imports.
        passwordMatches = password === storedPasswordHash;
      }

      if (!passwordMatches) {
        await writeAudit({
          userId: user.id,
          action: 'LOGIN_FAILED',
          status: 'failed',
          req,
          errorCode: 'INVALID_CREDENTIALS',
          metadata: { emailAttempted: normalizedEmail },
        });

        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: 'Email or password is incorrect',
        });
      }

      if (!isBcryptHash(storedPasswordHash)) {
        const upgradedPasswordHash = await bcrypt.hash(password, 12);
        await query(
          `
            UPDATE users
            SET password_hash = $1,
                updated_at = NOW()
            WHERE id = $2
          `,
          [upgradedPasswordHash, user.id]
        );
      }

      if (user.role !== 'student') {
        const switched = await query(
          `
            UPDATE users
            SET role = 'student', updated_at = NOW()
            WHERE id = $1
            RETURNING role
          `,
          [user.id]
        );
        user = {
          ...user,
          role: switched.rows[0]?.role || 'student',
        };
      }
    }

    user = {
      ...user,
      role: getCanonicalRole(user.email),
    };

    if (!user) {
      await writeAudit({
        action: 'LOGIN_FAILED',
        status: 'failed',
        req,
        errorCode: 'INVALID_CREDENTIALS',
        metadata: { emailAttempted: normalizedEmail },
      });

      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);
    const { ip, userAgent } = getRequestMeta(req);

    await query(
      `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [user.id, refreshTokenHash, expiresAt, ip || null, userAgent || null]
    );

    await writeAudit({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      status: 'success',
      req,
    });

    res.cookie('eduskill_rt', refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: config.accessTokenSeconds,
      user: toUserPayload(user),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/verify', authenticateToken, async (req, res) => {
  return res.json({
    valid: true,
    user: req.user,
  });
});

router.post('/refresh', async (req, res, next) => {
  try {
    const bodyToken = req.body?.refreshToken;
    const cookieToken = req.cookies?.eduskill_rt;
    const refreshToken = bodyToken || cookieToken;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'refreshToken is required',
      });
    }

    const tokenHash = hashRefreshToken(refreshToken);

    const tokenResult = await query(
      `
        SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at,
               u.email, u.full_name, u.role
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        LIMIT 1
      `,
      [tokenHash]
    );

    if (tokenResult.rowCount === 0) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_INVALID',
        message: 'Refresh token is invalid',
      });
    }

    const tokenRow = tokenResult.rows[0];

    if (tokenRow.revoked_at || new Date(tokenRow.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_INVALID',
        message: 'Refresh token expired or revoked',
      });
    }

    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [tokenRow.id]);

    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);

    await query(
      `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
      `,
      [tokenRow.user_id, newRefreshTokenHash, expiresAt]
    );

    const canonicalRole = getCanonicalRole(tokenRow.email);

    const accessToken = signAccessToken({
      id: tokenRow.user_id,
      email: tokenRow.email,
      full_name: tokenRow.full_name,
      role: canonicalRole,
    });

    await writeAudit({
      userId: tokenRow.user_id,
      action: 'TOKEN_REFRESH',
      status: 'success',
      req,
    });

    res.cookie('eduskill_rt', newRefreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: config.accessTokenSeconds,
      user: {
        id: tokenRow.user_id,
        email: tokenRow.email,
        role: canonicalRole,
        name: tokenRow.full_name,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', authenticateToken, async (req, res, next) => {
  try {
    const bodyToken = req.body?.refreshToken;
    const cookieToken = req.cookies?.eduskill_rt;
    const refreshToken = bodyToken || cookieToken;

    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await query(
        `
          UPDATE refresh_tokens
          SET revoked_at = NOW()
          WHERE user_id = $1
            AND token_hash = $2
            AND revoked_at IS NULL
        `,
        [req.user.id, tokenHash]
      );
    } else {
      await query(
        `
          UPDATE refresh_tokens
          SET revoked_at = NOW()
          WHERE user_id = $1
            AND revoked_at IS NULL
        `,
        [req.user.id]
      );
    }

    await writeAudit({
      userId: req.user.id,
      action: 'LOGOUT',
      status: 'success',
      req,
    });

    res.clearCookie('eduskill_rt', {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
    });

    return res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
