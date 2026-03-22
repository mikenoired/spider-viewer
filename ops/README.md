# Production Deployment

## Goal

Ubuntu deployment with:

- Nginx in front
- two application slots (`blue` / `green`)
- systemd-managed runtime
- health checks
- zero-downtime switch between releases

## Layout on server

```text
/opt/spider-viewer/
  active-slot
  current -> /opt/spider-viewer/slots/green/current
  slots/
    blue/
      current -> /opt/spider-viewer/slots/blue/releases/<release-id>
      releases/<release-id>/
    green/
      current -> /opt/spider-viewer/slots/green/releases/<release-id>
```

## Bootstrap a new Ubuntu server

```bash
chmod +x ops/deploy/bootstrap-ubuntu.sh ops/deploy/deploy-blue-green.sh
./ops/deploy/bootstrap-ubuntu.sh
sudo nano /etc/spider-viewer/spider-viewer.env
```

Then install Bun and Node on the server if they are not already present.

Example for Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
curl -fsSL https://bun.sh/install | bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Check versions:

```bash
node -v
bun -v
nginx -v
```

## Required env

Minimal `/etc/spider-viewer/spider-viewer.env`:

```bash
DATABASE_URL=postgresql://app_user:strong_password@127.0.0.1:5432/spider_viewer
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=replace-with-a-long-random-secret
HOST=127.0.0.1
SHUTDOWN_TIMEOUT_MS=30000
HEALTHCHECK_REDIS_REQUIRED=false
DB_BACKUP_DIR=/opt/spider-viewer/backups/postgres
DB_BACKUP_RETENTION_DAYS=7
```

Generate a secret:

```bash
openssl rand -hex 64
```

## Server runbook

1. Clone the repository onto the Ubuntu server.
2. Run `./ops/deploy/bootstrap-ubuntu.sh`.
3. Fill `/etc/spider-viewer/spider-viewer.env`.
4. Make sure PostgreSQL and Redis are reachable from the server.
5. Run the first deploy with `./ops/deploy/deploy-blue-green.sh`.
6. Verify:
   - `curl -fsS http://127.0.0.1:3101/healthz || true`
   - `curl -fsS http://127.0.0.1:3102/healthz || true`
   - `curl -fsS http://127.0.0.1/readyz`
   - `systemctl status spider-viewer@blue --no-pager`
   - `systemctl status spider-viewer@green --no-pager`
   - `systemctl status spider-viewer-db-backup.timer --no-pager`
   - `systemctl status nginx --no-pager`

## GitHub Actions CI/CD

Recommended branch model:

- `dev` -> development branch, deploys to staging
- `main` -> production branch, deploys to production

Added workflows:

- `.github/workflows/ci.yml` - lint, test, build on PR and on push to `dev`/`main`
- `.github/workflows/deploy-staging.yml` - deploys `dev` to staging server
- `.github/workflows/deploy-production.yml` - deploys `main` to production server

Recommended GitHub setup:

1. Protect `main` and allow only PR merges.
2. Create GitHub Environments: `staging` and `production`.
3. Add the same secret names in each environment, but with different values.

Required environment secrets:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_PRIVATE_KEY`

Expected server state for GitHub deploys:

- the repository is already cloned on the server at `DEPLOY_PATH`
- the deploy user can run `git pull`
- the deploy user can run `sudo systemctl ...` and `sudo nginx -t` inside deploy scripts

Typical production flow:

1. Merge PR into `main`
2. GitHub Actions runs CI
3. GitHub Actions opens SSH session to the server
4. The server runs `git pull --ff-only origin main`
5. The server runs `./ops/deploy/deploy-blue-green.sh`
6. Full deploy logs appear in the GitHub Actions job log

Prepare the server deploy user, for example:

```bash
sudo adduser deploy
sudo usermod -aG spider deploy
sudo visudo
```

Then allow the deploy user to run only the commands needed for rollout, for example:

```text
deploy ALL=(root) NOPASSWD: /bin/systemctl, /usr/sbin/nginx, /bin/ln, /usr/bin/tee, /bin/mkdir, /bin/chown, /usr/bin/rsync, /usr/bin/env, /usr/bin/bash
```

Also add the GitHub Actions public SSH key to the deploy user's `~/.ssh/authorized_keys`.

## First deploy

```bash
./ops/deploy/deploy-blue-green.sh
```

The deploy script:

- copies the current repo into the inactive slot
- runs `bun install --frozen-lockfile`
- builds the project
- runs `bun run db:migrate`
- starts the inactive systemd service
- waits for `/readyz`
- atomically switches Nginx and the `current` symlink
- stops the old slot after traffic is moved

## Next deploys

For every update:

```bash
git pull
./ops/deploy/deploy-blue-green.sh
```

Traffic is moved only after the new slot becomes ready.

## Rollback

```bash
chmod +x ops/deploy/rollback-blue-green.sh
./ops/deploy/rollback-blue-green.sh
```

Rollback restarts the previous slot, waits for readiness, switches Nginx back, and stops the bad slot.

## Required services

- PostgreSQL
- Redis
- Nginx
- systemd
- Bun
- Node.js
- PostgreSQL client tools (`pg_dump`)

## Database backups

- Backups run every 30 minutes through `spider-viewer-db-backup.timer`.
- Dumps are written to `DB_BACKUP_DIR` in PostgreSQL custom format (`*.dump`).
- Files older than `DB_BACKUP_RETENTION_DAYS` are deleted automatically after each successful backup.

Useful commands:

```bash
systemctl status spider-viewer-db-backup.timer --no-pager
systemctl list-timers spider-viewer-db-backup.timer --all
systemctl start spider-viewer-db-backup.service
ls -lh /opt/spider-viewer/backups/postgres
```

Restore example:

```bash
pg_restore --clean --if-exists --dbname="postgresql://app_user:strong_password@127.0.0.1:5432/spider_viewer" /opt/spider-viewer/backups/postgres/spider-viewer-postgres-YYYYMMDDTHHMMSSZ.dump
```

## HTTPS

Production is configured for:

- `http://npp-spider.ru` -> `https://npp-spider.ru`
- `http://www.npp-spider.ru` -> `https://npp-spider.ru`
- `https://www.npp-spider.ru` -> `https://npp-spider.ru`
- `https://npp-spider.ru` -> application

Certificates are issued by Certbot for `npp-spider.ru` and `www.npp-spider.ru`.
HSTS is enabled in soft mode with `max-age=2592000` and without `includeSubDomains` or `preload`.

## Health endpoints

- `/healthz` - process is alive
- `/readyz` - app can reach PostgreSQL and, if configured, Redis

## Notes

- Static assets are served directly by Nginx from `/opt/spider-viewer/current/dist/client`.
- Dynamic requests are proxied to the active slot.
- `db:migrate` is safe here because you said production starts empty.
