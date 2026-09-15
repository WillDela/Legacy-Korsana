# Korsana

Korsana is an AI-powered marathon training app I built solo. You connect Strava, set a race goal, and it builds a coaching loop that actually adapts based on your real activity data instead of just handing you a static training plan and hoping it fits.

Live at [korsana.run](https://korsana.run).

## NOTE ##
Currently in the process of rebuilding Korsana after my internship with Datadog from scratch to create a more clean and consistent codebase with continued improvements planned to be made along the way

## Tech stack

| Layer | Tooling |
|---|---|
| Frontend | React 19 + Vite + TailwindCSS v4 + Framer Motion (JSX) |
| Backend | Go 1.24 + Gin |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth (JWT validated by backend middleware) |
| Cache | Redis (Upstash in prod, local Redis in dev) |
| AI | Google Gemini 2.0 Flash, with Claude as a fallback |
| Hosting | Frontend on Vercel, backend on DigitalOcean App Platform |

I went with Gemini as the primary model mainly for cost, but kept Claude wired in as a fallback rather than ripping it out entirely, since I didn't want a single provider outage to take the coaching loop down.

## Repo layout

```
backend/
  cmd/server/             API server entrypoint
  cmd/migrate/            Database migration runner
  internal/api/           Handlers + middleware
  internal/config/        Env-var loading and validation
  internal/database/      DB connection + migration files
  internal/services/      Business logic
  Dockerfile              Multi-target: server (default) and migrate
  docker-compose.yml      db + redis + migrate + api for local dev

frontend/
  src/pages/              Route components
  src/components/         UI primitives + feature components
  src/api/                Axios client + per-domain modules
  src/lib/                chartTheme, motion variants, workoutStatus

extras/                   Project context (CLAUDE.md, audit plan, etc.)
.github/workflows/        CI: backend, frontend, security
```

## Environment variables

The backend validates everything at startup and just refuses to boot if something required is missing — see `backend/internal/config/config.go` if you want to see exactly how strict it is.

**Backend (`backend/.env`)**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase pooler URL, session mode (port 5432) |
| `SUPABASE_URL` | yes | Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Settings → API → service_role. Keep secret |
| `STRAVA_CLIENT_ID` | yes | Strava API app |
| `STRAVA_CLIENT_SECRET` | yes | Strava API app |
| `GEMINI_API_KEY` | one of these | Gemini is the active provider |
| `CLAUDE_API_KEY` | one of these | Retained as fallback |
| `STRAVA_REDIRECT_URI` | optional | Defaults to `http://localhost:8080/api/strava/callback` |
| `FRONTEND_URL` | optional | Used in OAuth redirects and email links |
| `ALLOWED_ORIGINS` | optional | Comma-separated, each validated as an http/https URL |
| `REDIS_URL` | optional | Defaults to `redis://localhost:6379` |
| `PORT` | optional | Defaults to `8080` |
| `ENVIRONMENT` | optional | `development` or `production` |
| `SMTP_*` | optional | Leave blank to disable email notifications |

Full template with comments is in `backend/.env.example`.

**Frontend (`frontend/.env`)**

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | e.g. `https://api.korsana.run/api` |
| `VITE_SUPABASE_URL` | yes | Same project URL as backend |
| `VITE_SUPABASE_ANON_KEY` | yes | Settings → API → anon (public) key |

## First-time Supabase setup

1. Create a project at [app.supabase.com](https://app.supabase.com).
2. Grab the Project URL, anon key, and service_role key from Settings → API, and drop them into the right `.env` files.
3. Copy the **Connection pooler — Session mode** URI from Settings → Database into `DATABASE_URL`. Use port **5432**, not 6543 — `lib/pq` needs session-mode pooling for prepared statements to work.
4. Apply migration 013 manually. It touches the `auth` schema, and Supabase blocks the standard migration flow from doing that:
   - Open SQL Editor → New query
   - Paste in `backend/internal/database/migrations/manual/013_supabase_auth.sql`
   - Run it. This sets up the `auth.users` → `public.users` sync trigger.
5. Apply the rest of the migrations normally (see below).

## Local development

**Prerequisites:** Go 1.24+, Node.js 22 LTS, Docker Desktop (only needed for the compose option), and a Supabase project for auth/storage.

### Option A — docker-compose (whole stack, one command)

```bash
cd backend
cp .env.example .env       # fill in real values
docker compose up --build
```

This spins up Postgres, Redis, runs `cmd/migrate` once, then starts the API at `http://localhost:8080`. Health check: `curl http://localhost:8080/health`.

**Gotcha:** the local Postgres in compose doesn't have an `auth` schema, so any signup flow depending on migration 013 won't actually work against it. If you're testing something auth-related, point `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at a real Supabase sandbox project even while running against the local DB otherwise.

### Option B — direct (no Docker)

```bash
# Backend
cd backend
cp .env.example .env
go mod download
go run ./cmd/migrate       # apply pending migrations
go run ./cmd/server        # :8080

# Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `localhost:8080`.

## Database migrations

Migrations live in `backend/internal/database/migrations/` as `NNN_description.up.sql` files, embedded into the migrate binary at build time.

```bash
cd backend
go run ./cmd/migrate
```

The runner is idempotent, so running it again with nothing new to apply is just a no-op. Applied versions are tracked in `schema_migrations`.

**Adding a new one:**
1. Create `backend/internal/database/migrations/NNN_description.up.sql` with the next sequential number.
2. `go run ./cmd/migrate` locally to apply and confirm it works.
3. Commit — CI rebuilds the migrate binary with your new file baked in.

**Manual migrations:** anything in `backend/internal/database/migrations/manual/` isn't picked up by `cmd/migrate` since it touches the `auth` schema, which Supabase locks down from outside connections. Apply these by hand through the Supabase SQL editor — see `backend/internal/database/migrations/manual/README.md`.

**One-time production sync** (only relevant if you're switching an existing prod DB onto this migration runner): seed `schema_migrations` once via the Supabase SQL editor so the runner doesn't try to replay everything from scratch:

```sql
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version bigint  NOT NULL PRIMARY KEY,
    dirty   boolean NOT NULL
);
INSERT INTO public.schema_migrations (version, dirty)
VALUES (19, false) ON CONFLICT (version) DO NOTHING;
```

Swap `19` for whatever the highest already-applied migration actually is.

## Testing and lint

**Backend**
```bash
cd backend
go test ./...              # all tests
go test ./... -race        # race detector, same as CI
go vet ./...
gofmt -l .                 # non-zero exit if anything's unformatted
```

**Frontend**
```bash
cd frontend
npm run test               # vitest
npm run lint               # eslint
npm run build              # vite production build
```

Known issue: the frontend still has a backlog of about 289 unused-import lint errors left over from before I did the audit pass. CI runs lint as advisory (`continue-on-error`) for now — cleaning those up is its own dedicated PR I haven't gotten to yet.

## Pre-commit hooks (optional)

The repo has a `.pre-commit-config.yaml` with file hygiene checks, gitleaks, and a couple local Go hooks.

```bash
pip install prek           # or pipx install prek
prek install                # registers the git hook
prek run --all-files        # one-time check
```

CI runs the same checks (gitleaks, go vet, build, test) on every PR anyway, so this is genuinely optional — just nice if you want faster feedback before pushing.

## CI

Three workflows in `.github/workflows/`:

| Workflow | Triggers | What it runs |
|---|---|---|
| `backend.yml` | push/PR on `backend/**` | gofmt verify, go vet, build, race-test |
| `frontend.yml` | push/PR on `frontend/**` | npm ci, lint (advisory), build, test |
| `security.yml` | every push/PR + Mondays 06:00 UTC | gitleaks scan, zizmor workflow audit |

All actions are SHA-pinned with version comments, and workflows run with `contents: read` and `persist-credentials: false` on every checkout.

## Deployment

**Frontend (Vercel):** `korsana.run` is a Vercel project with the build directory set to `frontend/`. Auto-deploys on every push to `main`. Env vars live in the Vercel dashboard.

**Backend (DigitalOcean App Platform):** builds from `backend/Dockerfile` (the `server` target by default). Env vars go in DO App Platform → Settings → App-Level Environment Variables — every required variable in the table above has to be set or the startup validator refuses to boot the app.

## Backup and restore

**Backups:** Supabase takes daily automatic backups. Retention depends on your plan tier — check Database → Backups in the Supabase dashboard for the current window.

For anything higher-stakes, Point-in-Time Recovery (PITR) is available on the Supabase Pro plan, which lets you restore to any second within the retention window instead of just a daily snapshot.

**Restore:**
1. Open Database → Backups in the Supabase dashboard.
2. Pick a snapshot or PITR timestamp.
3. Click Restore. Supabase asks for confirmation — this replaces the current database in place, and there's no undo.
4. After restoring, verify:
   - `select count(*) from auth.users;` returns the expected user count
   - `select max(version) from public.schema_migrations;` returns the expected schema version
   - The migrate runner reports "Database already up to date" against the restored DB

**Drill cadence:** restore drills are the kind of thing that's easy to keep pushing off and impossible to do well in the middle of an actual incident, so I run one quarterly against a non-production Supabase project:
1. Restore yesterday's snapshot into a fresh project.
2. Point a local backend at the restored DB.
3. Confirm the app boots, signups work, and Strava sync still applies correctly.
4. Tear the project down.

If anything fails the drill, I treat it as a real incident and fix it before it becomes one for real.

## License

MIT

---

Built for the Miami Marathon 2026.
