# Deployment Notes

## Local parity first

Use Docker Postgres + Node API in development before deploying.

## Environment variables

Set these in production:

- `NODE_ENV=production`
- `PORT=3001`
- `DATABASE_URL=<managed_postgres_url>`
- `JWT_SECRET=<long-random-secret>`
- `ACCESS_TOKEN_EXPIRES_IN=15m`
- `REFRESH_TOKEN_DAYS=7`
- `ALLOWED_ORIGINS=<frontend-domain>`

## Suggested hosting

- Backend: Render/Railway/Fly.io
- Database: Managed PostgreSQL
- Frontend: static hosting (Netlify/Vercel/GitHub Pages with API domain configured)

## Security checklist before production

- Use HTTPS only.
- Rotate JWT secret and DB password.
- Restrict CORS to production domain.
- Enable DB backups.
- Review rate-limit thresholds.
