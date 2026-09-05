# Deployment

This document packages the investor Demo for a single VM with Docker Compose. It
does not provision a public cloud account, DNS, TLS certificate or billing
resource.

## Topology

- `web`: nginx serves only the consumer app at `/` and proxies `/api/` to the
  API service.
- `admin`: separate nginx service for the expert/admin console at `/admin/`.
  It also proxies `/api/` to the same API service.
- `api`: Fastify API, deterministic BaZi, image handling, expert knowledge,
  restricted DeepSeek Harness report generation and migrations.
- `db`: private PostgreSQL service with a named volume.
- Volumes: `postgres-data` for PostgreSQL, `uploads-data` for temporary image
  uploads, `wenzhen-evidence-data` for private WenZhen screenshot evidence, and
  `harness-home` for the isolated Harness profile.

The API image intentionally includes the local DeepSeek Harness source tree and
its installed workspace dependencies because the Demo invokes `pnpm dsh` from the
checked-out Harness repository. This is correct for a self-contained investor
Demo, but it makes the image larger. A later production hardening pass should
replace this with a pinned packaged Harness artifact.

WenZhen evidence files are content-addressed screenshots used to audit external
comparison fixtures. The repository stores only the detached manifest metadata
and relative evidence references; deployment must mount the evidence directory on
a persistent shared volume so API restarts or multiple API instances do not break
fixture traceability.

Report rows are mutable task-state records: the API may update status, payload
and timestamps while a report moves from queued to completed or failed. Immutable
version audit applies to chart versions, published knowledge versions, BaZi rule
profile versions and WenZhen verification fixtures; do not describe `reports` as
an immutable audit log.

## Configure

```sh
cp .env.example .env
```

Edit `.env` and set:

- `POSTGRES_PASSWORD`: long random URL-safe database password (letters, numbers,
  hyphen and underscore). Compose interpolates it into `DATABASE_URL`.
- `ADMIN_API_TOKEN`: long random server-side admin automation token.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: fixed admin console login for the Demo.
- `KNOWLEDGE_MCP_TOKEN`: long random internal reader token used only by the
  API-spawned knowledge MCP bridge.
- `DEEPSEEK_API_KEY`: runtime-only DeepSeek key.
- `APP_PORT`: host port for the consumer nginx service, defaults to `8080`.
- `APP_BIND_HOST`: bind address for the consumer service, defaults to `0.0.0.0`.
- `ADMIN_PORT`: host port for the separate admin nginx service, defaults to
  `8081`. Keep this port internal or otherwise protected in real deployments.
- `ADMIN_BIND_HOST`: bind address for the admin service, defaults to
  `127.0.0.1` so the admin console is not exposed publicly by default.

Never put real secrets in `.env.example` or any Vite client-side environment
variable. `ADMIN_API_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `KNOWLEDGE_MCP_TOKEN`, `DEEPSEEK_API_KEY` and
`DATABASE_URL` are server-only runtime settings. The committed `.gitignore`
excludes `.env` and `.data`.

PostgreSQL integration tests do not call DeepSeek. Use dummy values for unrelated
runtime variables in test-only shells, and reserve a real `DEEPSEEK_API_KEY` for
an environment that actually generates reports.

## Build

```sh
docker compose build
```

## Start

```sh
docker compose up -d
```

Open:

- User Demo: `http://127.0.0.1:${APP_PORT:-8080}/`
- Expert console: `http://127.0.0.1:${ADMIN_PORT:-8081}/admin/`
- API liveness through proxy: `http://127.0.0.1:${APP_PORT:-8080}/api/health`
- API readiness through proxy: `http://127.0.0.1:${APP_PORT:-8080}/api/ready`

## Health

```sh
docker compose ps
curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/api/health"
curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/api/ready"
curl -fsS "http://127.0.0.1:${ADMIN_PORT:-8081}/admin/"
```

`/health` only proves the API process is alive. `/ready` also checks required
persistence and should be used before an investor walkthrough.

## PostgreSQL Test Gate

Default `pnpm test` skips PostgreSQL integration tests when `TEST_DATABASE_URL`
is unset. The explicit gate fails fast without that variable:

```sh
pnpm test:postgres
```

With `TEST_DATABASE_URL` set, the gate runs only the PostgreSQL integration
tests for WenZhen fixtures, knowledge publication, and the chart persistence
test if that file exists:

```sh
TEST_DATABASE_URL='postgres://fengshui_test:password@127.0.0.1:5432/fengshui_test' \
DEEPSEEK_API_KEY=dummy \
pnpm test:postgres
```

Use a dedicated throwaway database. The tests create and drop uniquely named
schemas, but the target database must still be safe to mutate.

If local PostgreSQL tools are installed, the repository can start a temporary
single-use database and run the same gate:

```sh
pnpm test:postgres:local
```

The helper binds to `127.0.0.1:55433`, stops PostgreSQL when the command exits,
and keeps the temporary data directory so failed runs can inspect `server.log`.

For a fully isolated local database, run a temporary Compose project bound only
to localhost:

```sh
docker compose -p fengshui-pg-test -f - up -d --wait <<'YAML'
services:
  db:
    image: postgres:16-bookworm
    environment:
      POSTGRES_DB: fengshui_test
      POSTGRES_USER: fengshui_test
      POSTGRES_PASSWORD: dummy-postgres-password
    ports:
      - "127.0.0.1:55432:5432"
YAML

TEST_DATABASE_URL='postgres://fengshui_test:dummy-postgres-password@127.0.0.1:55432/fengshui_test' \
DEEPSEEK_API_KEY=dummy \
pnpm test:postgres

docker compose -p fengshui-pg-test -f - down -v <<'YAML'
services:
  db:
    image: postgres:16-bookworm
    environment:
      POSTGRES_DB: fengshui_test
      POSTGRES_USER: fengshui_test
      POSTGRES_PASSWORD: dummy-postgres-password
    ports:
      - "127.0.0.1:55432:5432"
YAML
```

## Logs

```sh
docker compose logs -f --tail=200 api
docker compose logs -f --tail=200 web
docker compose logs -f --tail=200 admin
docker compose logs -f --tail=200 db
```

## Backup

```sh
mkdir -p backups
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-fengshui}" "${POSTGRES_DB:-fengshui}" > "backups/fengshui-$(date +%Y%m%d-%H%M%S).sql"
```

Keep backups outside the Compose volumes and outside Git.

## Upgrade

```sh
docker compose build
docker compose up -d
curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/api/ready"
```

The API runs migrations at startup. Review new files under
`apps/api/migrations/` before an upgrade.

## Rollback

Use the previous Git checkout or release artifact, then rebuild and restart:

```sh
docker compose build
docker compose up -d
curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/api/ready"
```

If a migration is not backward-compatible, restore from the last PostgreSQL
backup before starting the older version.

## Stop

```sh
docker compose down
```

Do not run `docker compose down -v` unless you intentionally want to delete the
PostgreSQL database, temporary upload volume and isolated Harness home.

## Local Verification Limit

This repository can be statically checked without Docker, but a real production
smoke requires a Docker-compatible runtime. If `docker` is not installed, mark
the Compose smoke as blocked instead of passing it by inference.
