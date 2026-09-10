# Deploying the Korsana backend to Heroku

The backend runs as a single Docker container on Heroku's **container stack**.
`heroku.yml` (repo root) builds the web image from `backend/Dockerfile` and runs
database migrations from the `migrate` stage during each release.

Cost: Basic dyno ($7/mo) + Key-Value Store Mini ($3/mo) = $10/mo, covered by the
GitHub Student Developer Pack's $13/mo Heroku credit (24 months).

## One-time setup

Run from the repo root. Requires the Heroku CLI and `git`.

```sh
heroku login
heroku create korsana-api --stack container
```

### Add Redis (Key-Value Store)

```sh
heroku addons:create heroku-redis:mini --app korsana-api
```

This sets the `REDIS_URL` config var automatically (a `rediss://` URL — the
server disables TLS cert verification for it, see `cmd/server/main.go`).

### Set config vars

Fill in every value. `DATABASE_URL` and the Supabase keys come from the Supabase
dashboard (Settings -> Database, and Settings -> API).

```sh
heroku config:set --app korsana-api \
  ENVIRONMENT=production \
  DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require' \
  SUPABASE_URL='https://mrvxngihnyxxyeahapvt.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
  STRAVA_CLIENT_ID='<id>' \
  STRAVA_CLIENT_SECRET='<secret>' \
  STRAVA_REDIRECT_URI='https://api.korsana.run/api/strava/callback' \
  GEMINI_API_KEY='<key>' \
  FRONTEND_URL='https://korsana.run' \
  ALLOWED_ORIGINS='https://korsana.run'
```

Notes:

- **Use the Supabase Session pooler string** (host `...pooler.supabase.com`,
  port `5432`) for `DATABASE_URL`. It is IPv4-only-friendly (Heroku dynos have no
  IPv6) and works with `golang-migrate`'s advisory locks. The direct-connection
  string (`db.<ref>.supabase.co:5432`) is IPv6-only and will fail from Heroku.
- Set `CLAUDE_API_KEY` instead of `GEMINI_API_KEY` if the coach uses Claude —
  at least one of the two is required.
- SMTP vars are optional; leave unset to disable email notifications.

### Custom domain

```sh
heroku domains:add api.korsana.run --app korsana-api
```

This prints a DNS target like `xxxxx.herokudns.com`. At whatever manages DNS for
`korsana.run`, replace the old DigitalOcean `api` record with:

```
CNAME   api   xxxxx.herokudns.com
```

TLS is provisioned automatically on paid dynos. Verify with
`heroku certs:auto --app korsana-api`.

## Deploy

```sh
heroku git:remote --app korsana-api
git push heroku deploy/heroku-backend:main   # or: git push heroku main
```

The release phase runs `/app/migrate` (idempotent). Migration 013 (the Supabase
auth trigger) is applied manually in the Supabase SQL editor and is skipped by
the runner — it is already in place on the restored project.

Then move the dyno off the free-tier default:

```sh
heroku ps:type web=basic --app korsana-api
```

## Verify

```sh
curl https://api.korsana.run/health
heroku logs --tail --app korsana-api
```

Then log into https://korsana.run and test the Strava connect flow (exercises
Redis + the backend end to end).

## Redeploys

`git push heroku main`. Config changes: `heroku config:set ...` (triggers a
release). No frontend or Strava-dashboard changes are needed as long as the
`api.korsana.run` domain stays put.
