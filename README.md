# My Trackers

Personal all-in-one tracking and productivity app.

This repository is currently at **Milestone 1: Supabase-backed trackers**.

## Stack

- Frontend: React 18, Vite, TypeScript strict, CSS
- Backend: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, psycopg 3
- Database: PostgreSQL 16 via Supabase

## Local Setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Start the app:

   ```bash
   docker compose up --build
   ```

3. Open:

   - Frontend: http://localhost:5173
   - API health: http://localhost:8000/health
   - API docs: http://localhost:8000/docs

## Commands

Backend:

```bash
cd backend
ruff check .
python -m pytest
alembic upgrade head
```

Frontend:

```bash
cd frontend
npm install
npm run lint
npm run typecheck
npm run build
```

With Docker:

```bash
docker compose run --rm api ruff check .
docker compose run --rm api pytest
docker compose run --rm frontend npm run typecheck
```

## Environment Variables

See [.env.example](.env.example) for all required local variables.

## Supabase Database

The app uses Supabase PostgreSQL. Username/password authentication is handled by the FastAPI backend, which stores account hashes and tracker data in Supabase.

1. In Supabase, create a project.

2. Open **Project Settings > Database > Connection string**.

3. Use the pooler connection string for app hosting. It usually looks like:

   ```text
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
   ```

4. Put that value in `.env`:

   ```bash
   DATABASE_URL="postgresql+psycopg://postgres.<project-ref>:<url-encoded-password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require"
   ```

   URL-encode special characters in the password before adding it to the connection string. For example, `@` becomes `%40`.

5. Run migrations from the backend environment:

   ```bash
   cd backend
   alembic upgrade head
   ```

The backend accepts both `postgresql://...` Supabase URLs and `postgresql+psycopg://...` local Docker URLs.

## Username Accounts

Users sign up once with a username and password, then sign in later with the same credentials. Passwords are stored as salted scrypt hashes; only the backend JWT secret is required for authentication.

## Backups

For Supabase, enable and review the project's automated database backups before launch. Document the retention window and test a restore before storing important personal data.
