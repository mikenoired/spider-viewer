# Deploy Production

Проект деплоится по SSH-ключу через GitHub Actions и запускается на сервере в Docker.

## Что уже подготовлено
- Workflow: `.github/workflows/deploy-production.yml`
- Production compose: `docker-compose.production.yml`
- Remote deploy script: `scripts/deploy/remote-deploy.sh`
- Docker image build: `Dockerfile`

## SSH-ключ для GitHub Actions
На локальной машине создан отдельный ключ:

- Private key: `~/.ssh/spider_viewer_actions`
- Public key: `~/.ssh/spider_viewer_actions.pub`

Публичный ключ уже добавлен на сервер `138.124.14.233` для пользователя `root`.

## Что нужно добавить в GitHub
### Secrets
- `SSH_PRIVATE_KEY`: содержимое файла `~/.ssh/spider_viewer_actions`
- `POSTGRES_PASSWORD`: пароль для production Postgres
- `JWT_SECRET`: production JWT secret

### Variables
- `DEPLOY_HOST`: `138.124.14.233`
- `DEPLOY_USER`: `root`
- `DEPLOY_PORT`: `22`
- `DEPLOY_PATH`: `/opt/spider-viewer`
- `APP_PORT`: `3000`
- `POSTGRES_DB`: `spider_viewer`
- `POSTGRES_USER`: `postgres`

## Как проходит деплой
1. GitHub Actions забирает код.
2. По SSH-ключу подключается к серверу.
3. Через `rsync` синхронизирует проект в `/opt/spider-viewer`.
4. Перезаписывает `.env.production` из GitHub Secrets/Vars.
5. Запускает `scripts/deploy/remote-deploy.sh`.
6. На сервере:
   - поднимаются `postgres` и `redis`
   - собирается контейнер приложения
   - выполняется `bun run db:push`
   - приложение стартует через `docker compose`

## Первый запуск
После первого деплоя, если нужны тестовые пользователи:

```bash
ssh -i ~/.ssh/spider_viewer_actions root@138.124.14.233
cd /opt/spider-viewer
docker compose --env-file .env.production -f docker-compose.production.yml run --rm app bun run db:seed:test-users
```

## Ручной деплой без GitHub Actions
```bash
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude 'dist/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.production' \
  -e "ssh -i ~/.ssh/spider_viewer_actions" \
  ./ root@138.124.14.233:/opt/spider-viewer/

ssh -i ~/.ssh/spider_viewer_actions root@138.124.14.233 \
  "cd /opt/spider-viewer && bash scripts/deploy/remote-deploy.sh"
```
