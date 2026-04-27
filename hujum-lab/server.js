import express from 'express';
import pg from 'pg';
import crypto from 'crypto';

const HOST = process.env.HUJUM_HOST || '127.0.0.1';
const PORT = Number(process.env.HUJUM_PORT || 3002);
const DATABASE_URL =
  process.env.HUJUM_DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/hujum_lab';
const SESSION_TTL_MS = Number(process.env.HUJUM_SESSION_TTL_MS || 1000 * 60 * 60 * 8);

const app = express();
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const activeSessions = new Map();

const LAB_MODES = {
  'auth-bypass': {
    title: 'Authentication Bypass (SQLi)',
    description:
      'Oddiy login query string concatenation orqali quriladi va autentifikatsiyani aylanib otish xavfini korsatadi.',
  },
  'union-leak': {
    title: 'UNION Data Leakage (SQLi)',
    description:
      'Birlashtirilgan query natijasida kutilmagan jadval maʼlumotlari chiqib ketishi mumkinligini amalda korsatadi.',
  },
  'error-probing': {
    title: 'Error-Based Probing (SQLi)',
    description:
      'Notogri cast va sanitizatsiyasiz query DB xatolarini ochib berishi orqali tizim haqida malumot sizadi.',
  },
  'blind-boolean': {
    title: 'Blind Boolean Pattern (SQLi)',
    description:
      'Shartga bogliq query xulqi orqali malumotni bilvosita olish mumkinligini korsatadigan zaif naqsh.',
  },
};

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

function createSession(user) {
  const token = crypto.randomBytes(30).toString('hex');
  activeSessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  const session = activeSessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    activeSessions.delete(token);
    return null;
  }

  return session;
}

function extractSessionToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return String(req.headers['x-session-token'] || '').trim();
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (session.expiresAt <= now) {
      activeSessions.delete(token);
    }
  }
}, 1000 * 60 * 10).unref();

async function initLabDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lab_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_plain TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Keep startup resilient when the table already exists from an earlier lab version.
  await pool.query(`
    ALTER TABLE lab_users
    ADD COLUMN IF NOT EXISTS full_name TEXT
  `);
  await pool.query(`
    UPDATE lab_users
    SET full_name = COALESCE(NULLIF(full_name, ''), 'Lab User')
    WHERE full_name IS NULL OR full_name = ''
  `);
  await pool.query(`
    ALTER TABLE lab_users
    ALTER COLUMN full_name SET DEFAULT 'Lab User'
  `);
  await pool.query(`
    ALTER TABLE lab_users
    ALTER COLUMN full_name SET NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lab_findings (
      id SERIAL PRIMARY KEY,
      finding_key TEXT NOT NULL,
      finding_value TEXT NOT NULL,
      severity TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO lab_users (email, password_plain, full_name, role)
    VALUES
      ('admin@hujum.local', 'admin123', 'Laboratoriya Admin', 'admin'),
      ('student@hujum.local', 'student123', 'Ali Talaba', 'student')
    ON CONFLICT (email) DO NOTHING;
  `);

  const findingsCount = await pool.query('SELECT COUNT(*)::int AS count FROM lab_findings');
  if ((findingsCount.rows[0]?.count || 0) === 0) {
    await pool.query(`
      INSERT INTO lab_findings (finding_key, finding_value, severity)
      VALUES
        ('db.version', 'PostgreSQL 16.x', 'high'),
        ('table.users', 'lab_users table metadata sample', 'medium'),
        ('note', 'This lab contains intentionally vulnerable query patterns for research only', 'info')
    `);
  }
}

const buildQueryByMode = ({ mode, login, password }) => {
  if (mode === 'auth-bypass') {
    return `
      SELECT id, email, full_name, role
      FROM lab_users
      WHERE email = '${login}'
        AND password_plain = '${password}'
      LIMIT 1;
    `;
  }

  if (mode === 'union-leak') {
    return `
      SELECT id, email, full_name, role
      FROM lab_users
      WHERE email = '${login}'
        AND password_plain = '${password}'
      UNION
      SELECT id, finding_key AS email, finding_value AS full_name, severity AS role
      FROM lab_findings
      WHERE finding_key LIKE '%${login}%'
      LIMIT 20;
    `;
  }

  if (mode === 'error-probing') {
    return `
      SELECT id, email, full_name, role
      FROM lab_users
      WHERE email = '${login}'
        AND id = CAST('${password}' AS INTEGER)
      LIMIT 1;
    `;
  }

  return `
    SELECT id, email, full_name, role
    FROM lab_users
    WHERE email = '${login}'
      AND password_plain = '${password}'
      AND (
        CASE
          WHEN '${login}' LIKE '%admin%' THEN
            (SELECT COUNT(*) FROM generate_series(1, 600000)) > 0
          ELSE TRUE
        END
      )
    LIMIT 1;
  `;
};

app.get('/api/health', async (req, res) => {
  const db = await pool.query('SELECT NOW() AS now');
  return res.json({
    ok: true,
    service: 'hujum-lab',
    time: db.rows[0].now,
  });
});

app.get('/api/lab-modes', (req, res) => {
  return res.json({
    ok: true,
    modes: LAB_MODES,
  });
});

app.post('/api/lms-login', async (req, res) => {
  const login = String(req.body?.login || '')
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || '');

  if (!login || !password) {
    return res.status(400).json({
      ok: false,
      authenticated: false,
      message: 'Login va parol majburiy.',
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT id, email, full_name, role
        FROM lab_users
        WHERE email = $1
          AND password_plain = $2
        LIMIT 1
      `,
      [login, password]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        ok: false,
        authenticated: false,
        message: 'Login yoki parol noto\'g\'ri.',
      });
    }

    const row = result.rows[0];
    const user = {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
    };
    const sessionToken = createSession(user);

    return res.json({
      ok: true,
      authenticated: true,
      message: 'Kirish muvaffaqiyatli.',
      sessionToken,
      expiresInMs: SESSION_TTL_MS,
      user,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      authenticated: false,
      message: 'Server xatoligi. Qayta urinib koring.',
      error: error.message,
    });
  }
});

app.get('/api/lms-session', (req, res) => {
  const token = extractSessionToken(req);
  if (!token) {
    return res.status(401).json({
      ok: false,
      message: 'Sessiya topilmadi.',
    });
  }

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({
      ok: false,
      message: 'Sessiya muddati tugagan yoki noto\'g\'ri.',
    });
  }

  return res.json({
    ok: true,
    user: session.user,
    expiresInMs: Math.max(0, session.expiresAt - Date.now()),
  });
});

app.post('/api/lms-logout', (req, res) => {
  const token = extractSessionToken(req);
  if (token) {
    activeSessions.delete(token);
  }

  return res.json({
    ok: true,
  });
});

app.post('/api/lms-login-vuln', async (req, res) => {
  const login = String(req.body?.login || '').trim();
  const password = String(req.body?.password || '');
  const mode = String(req.body?.mode || 'auth-bypass');

  if (!login || !password) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_FIELD',
      message: 'Login va parol majburiy.',
    });
  }

  if (!LAB_MODES[mode]) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_MODE',
      message: 'Noto\'gri laboratoriya rejimi.',
    });
  }

  // Controlled demo inputs for thesis presentations without exposing real attack payload recipes.
  const demoKey = login.toUpperCase();
  if (demoKey === 'DEMO_BYPASS') {
    const user = {
      id: 9001,
      email: 'demo.bypass@hujum.local',
      fullName: 'Demo Bypass User',
      role: 'student',
    };
    const sessionToken = createSession(user);

    return res.json({
      ok: true,
      mode,
      modeTitle: LAB_MODES[mode].title,
      modeDescription: LAB_MODES[mode].description,
      authenticated: true,
      message: 'Demo bypass holati ishga tushdi.',
      durationMs: 1,
      queryUsed: 'DEMO_SIMULATED_BYPASS_QUERY',
      rowCount: 1,
      rows: [user],
      sessionToken,
      user,
      demo: true,
    });
  }

  if (demoKey === 'DEMO_ERROR') {
    return res.status(500).json({
      ok: false,
      mode,
      error: 'SQL_ERROR',
      message: 'Demo SQL xatolik holati qaytarildi.',
      dbError: 'DEMO_SIMULATED_SQL_SYNTAX_ERROR',
      durationMs: 1,
      queryUsed: 'DEMO_SIMULATED_ERROR_QUERY',
      demo: true,
    });
  }

  const sql = buildQueryByMode({ mode, login, password });
  const startedAt = Date.now();

  try {
    const result = await pool.query(sql);
    const durationMs = Date.now() - startedAt;

    const authenticated = result.rowCount > 0;
    const message = authenticated
      ? 'Kirish muvaffaqiyatli (zaif query orqali).'
      : 'Kirish rad etildi yoki natija topilmadi.';

    let sessionToken = null;
    let user = null;
    if (authenticated && result.rows.length > 0) {
      const row = result.rows[0];
      user = {
        id: row.id || 0,
        email: row.email || row.finding_key || 'Unknown',
        fullName: row.full_name || row.finding_value || 'Lab User',
        role: row.role || row.severity || 'student',
      };
      sessionToken = createSession(user);
    }

    return res.json({
      ok: true,
      mode,
      modeTitle: LAB_MODES[mode].title,
      modeDescription: LAB_MODES[mode].description,
      authenticated,
      message,
      durationMs,
      queryUsed: sql,
      rowCount: result.rowCount,
      rows: result.rows,
      sessionToken,
      user
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return res.status(500).json({
      ok: false,
      mode,
      error: 'SQL_ERROR',
      message: 'SQL xatolik qaytdi. Bu error-based zaiflik tahlili uchun muhim signal.',
      dbError: error.message,
      durationMs,
      queryUsed: sql,
    });
  }
});

app.use((req, res) => {
  return res.status(404).json({
    ok: false,
    error: 'NOT_FOUND',
    message: 'Endpoint topilmadi',
  });
});

async function bootstrap() {
  await initLabDatabase();
  app.listen(PORT, HOST, () => {
    console.log(`[hujum-lab] listening on http://${HOST}:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('[hujum-lab] failed to start:', error.message);
  process.exit(1);
});
