# Local Setup

## Prerequisites

- Node.js 18+

## Quick Start (No PostgreSQL Needed)

1. Install backend dependencies.

```bash
npm run install:backend
```

1. Start API in in-memory DB mode.

```bash
npm run api:dev
```

API base URL: `http://localhost:3001/api`

1. Open frontend.

Open `index.html` with Live Server (recommended port `5500`).

## PostgreSQL Mode (Optional)

If you want persistent database, disable in-memory mode.

1. Copy `backend/.env.example` to `backend/.env`.
1. Set `USE_PGMEM=false`.
1. Start PostgreSQL (Docker Desktop or local service).
1. Run migrations and seed.

```bash
npm run db:up
npm run db:migrate
npm run db:seed
```

## Login Credentials

- `goibnazarovshukrullo@gmail.com` / `admin123`
- `dilraborustamova048@gmail.com` / `dilrabo6880`

## Troubleshooting

- If DB fails: `npm run db:down` then `npm run db:up`.
- If tables are missing: rerun migration and seed commands.
