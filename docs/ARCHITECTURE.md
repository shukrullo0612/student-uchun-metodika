# Architecture

## Overview

This project is a full-stack educational platform with:

- Static frontend pages (`index.html`, `dashboard.html`) for rapid UX iteration.
- REST backend API (`backend/src/server.js`) with Express.
- PostgreSQL persistence via Docker.

## Core Flow

1. User logs in from frontend.
2. Frontend calls `POST /api/auth/login`.
3. Backend validates credentials (bcrypt) and returns access + refresh tokens.
4. Dashboard fetches protected resources with bearer token.
5. If access token expires, frontend calls `POST /api/auth/refresh`.

## Main Domains

- Authentication: users, refresh_tokens, audit_logs.
- LMS Core: courses, students, assignments.
- Quiz: quizzes, quiz_questions, quiz_options, quiz_attempts.
- Kahoot-style: kahoot_sessions, kahoot_questions, kahoot_scores.
- Wordwall-style: wordwall_sets, wordwall_items, wordwall_attempts.

## Security Notes

- No plaintext passwords in DB.
- Login endpoint rate-limited.
- Audit logs captured for key auth events.
- Teacher-only role enforced in auth.
