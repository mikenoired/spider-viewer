# Production Deploy By SSH Key

Текущий production-деплой в проекте уже настроен через SSH-ключ и GitHub Actions.

Основной workflow:

- `.github/workflows/deploy-production.yml`

Текущий production-сервер:

- Host: `138.124.14.233`
- Repo path: `/var/www/spider-viewer`
- Branch: `main`

## Что уже сделано

- На локальной машине создан deploy-ключ:
  - `~/.ssh/spider_viewer_actions`
  - `~/.ssh/spider_viewer_actions.pub`
- Публичный ключ добавлен на production-сервер для пользователя `root`
- Вход по ключу проверен

## Что нужно добавить в GitHub

Путь:

- `Settings -> Environments -> production -> Secrets and variables`

Создать secrets:

- `DEPLOY_SSH_PRIVATE_KEY` - содержимое файла `~/.ssh/spider_viewer_actions`
- `DEPLOY_HOST` - `138.124.14.233`
- `DEPLOY_PORT` - `22`
- `DEPLOY_USER` - `root`
- `DEPLOY_PATH` - `/var/www/spider-viewer`

## Как проходит деплой

1. Push или merge в `main` запускает `.github/workflows/deploy-production.yml`.
2. Workflow выполняет `bun install`, `lint`, `test`, `build`.
3. GitHub Actions поднимает SSH-агент с `DEPLOY_SSH_PRIVATE_KEY`.
4. Workflow подключается к серверу.
5. На сервере выполняется:

```bash
cd /var/www/spider-viewer
git fetch origin main
git checkout main
git pull --ff-only origin main
./ops/deploy/deploy-blue-green.sh
```

## Как повторить это на новом сервере

1. Сгенерировать ключ:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/spider_viewer_actions -C "github-actions"
```

2. Установить публичный ключ на сервер:

```bash
ssh-copy-id -i ~/.ssh/spider_viewer_actions.pub root@SERVER_IP
```

3. Проверить вход:

```bash
ssh -i ~/.ssh/spider_viewer_actions root@SERVER_IP
```

4. Клонировать проект на сервер в нужный путь.
5. Проверить, что на сервере есть `bun`, `git`, `nginx`, `rsync`, PostgreSQL и Redis.
6. Выполнить первичную серверную настройку:

```bash
cd /var/www/spider-viewer
chmod +x ops/deploy/bootstrap-ubuntu.sh ops/deploy/deploy-blue-green.sh
./ops/deploy/bootstrap-ubuntu.sh
```

7. Заполнить `/etc/spider-viewer/spider-viewer.env`.
8. Сделать первый ручной деплой:

```bash
cd /var/www/spider-viewer
./ops/deploy/deploy-blue-green.sh
```

9. Добавить приватный ключ и параметры сервера в GitHub Secrets.
10. Запустить `Deploy Production` вручную или пушнуть изменения в `main`.
