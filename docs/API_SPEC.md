# API Spec (MVP)

## Auth

- `POST /api/auth/login`
- `GET /api/auth/verify`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

## Courses

- `GET /api/courses`
- `POST /api/courses`
- `PUT /api/courses/:id`
- `DELETE /api/courses/:id`

## Students

- `GET /api/students`
- `POST /api/students`
- `PUT /api/students/:id`
- `DELETE /api/students/:id`

## Assignments

- `GET /api/assignments`
- `POST /api/assignments`
- `PUT /api/assignments/:id`
- `DELETE /api/assignments/:id`

## Reports

- `GET /api/reports/summary`

## Quiz

- Public: `GET /api/quiz/:id/public`, `POST /api/quiz/:id/attempt`
- Teacher: `GET /api/quiz`, `POST /api/quiz`, `POST /api/quiz/:id/questions`, `POST /api/quiz/:id/publish`, `GET /api/quiz/:id/attempts`

## Kahoot

- Public:
  - `POST /api/kahoot/join`
  - `GET /api/kahoot/live/:pin/current-question`
  - `POST /api/kahoot/live/:pin/answer`
  - `GET /api/kahoot/leaderboard/:pin`
  - Legacy fallback: `POST /api/kahoot/answer`
- Teacher:
  - `GET /api/kahoot/sessions`
  - `POST /api/kahoot/sessions`
  - `POST /api/kahoot/sessions/:id/questions`
  - `GET /api/kahoot/sessions/:id/questions`
  - `POST /api/kahoot/sessions/:id/start`
  - `GET /api/kahoot/sessions/:id/current-question`
  - `POST /api/kahoot/sessions/:id/next-question`
  - `POST /api/kahoot/sessions/:id/finish`
  - `GET /api/kahoot/sessions/:id/leaderboard`

## Wordwall

- Public: `GET /api/wordwall/public/:setId`, `POST /api/wordwall/attempt/:setId`
- Teacher: `GET /api/wordwall/sets`, `POST /api/wordwall/sets`, `POST /api/wordwall/sets/:setId/items`, `GET /api/wordwall/sets/:setId`, `GET /api/wordwall/sets/:setId/attempts`
