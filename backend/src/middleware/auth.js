import jwt from 'jsonwebtoken';
import config from '../config.js';
import { getCanonicalRole, normalizeEmail } from '../security/adminPolicy.js';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization || '';

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: 'NO_TOKEN',
      message: 'Authorization token required',
    });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_FORMAT',
      message: 'Authorization format must be Bearer <token>',
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: getCanonicalRole(decoded.email),
      name: decoded.name,
    };
    return next();
  } catch (error) {
    const isExpired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      error: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      message: isExpired ? 'Access token expired' : 'Invalid token',
    });
  }
};

export const requireAdmin = (req, res, next) => {
  const userEmail = normalizeEmail(req.user?.email);
  const canonicalRole = getCanonicalRole(userEmail);

  if (!req.user || canonicalRole !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Administrator access required',
    });
  }

  req.user.role = 'admin';

  return next();
};
