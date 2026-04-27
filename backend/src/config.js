import dotenv from 'dotenv';

dotenv.config();

const parseOrigins = (raw) => {
  if (!raw) {
    return [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://127.0.0.1:8000',
      'http://localhost:8000',
      'http://127.0.0.1:8080',
      'http://localhost:8080',
    ];
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseIntSafe = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseIntSafe(process.env.PORT, 3001),
  usePgMem:
    process.env.USE_PGMEM === 'true' ||
    (!process.env.DATABASE_URL && (process.env.NODE_ENV || 'development') !== 'production'),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/eduskill',
  jwtSecret:
    process.env.JWT_SECRET || 'change-this-in-production-long-random-secret',
  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
  accessTokenSeconds: parseIntSafe(process.env.ACCESS_TOKEN_SECONDS, 900),
  refreshTokenDays: parseIntSafe(process.env.REFRESH_TOKEN_DAYS, 7),
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  loginWindowMs: parseIntSafe(process.env.LOGIN_WINDOW_MS, 5 * 60 * 1000),
  loginMaxAttempts: parseIntSafe(process.env.LOGIN_MAX_ATTEMPTS, 7),
};

export default config;
