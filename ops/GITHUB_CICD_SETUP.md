# GitHub CI/CD Setup

Этот файл - пошаговая инструкция, как довести GitHub + сервер до состояния:

- `dev` -> автодеплой на staging
- `main` -> автодеплой на production
- логи деплоя видны в GitHub Actions
- при ошибке деплой падает красным
- на сервере используется ваш blue/green rollout

Инструкция написана так, чтобы по ней можно было пройтись как по checklist.

## Что уже есть в репозитории

В проект уже добавлены:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
- `.github/workflows/deploy-production.yml`
- `ops/deploy/bootstrap-ubuntu.sh`
- `ops/deploy/deploy-blue-green.sh`
- `ops/deploy/rollback-blue-green.sh`
- `ops/systemd/spider-viewer@.service`
- `ops/nginx/spider-viewer.conf`

То есть в GitHub Actions уже есть логика CI и деплоя. Осталось правильно настроить GitHub и сервер.

## Как это должно работать

### Development flow

1. Разработка идет в ветке `dev`.
2. Push в `dev` запускает:
   - CI (`lint`, `test`, `build`)
   - staging deploy workflow
3. GitHub Actions подключается к staging-серверу по SSH.
4. На staging-сервере выполняется `./ops/deploy/deploy-blue-green.sh`.

### Production flow

1. Ветка `main` - только для production.
2. Из `dev` в `main` изменения попадают через Pull Request.
3. Merge в `main` запускает:
   - CI (`lint`, `test`, `build`)
   - production deploy workflow
4. GitHub Actions подключается к production-серверу по SSH.
5. На production-сервере выполняется `./ops/deploy/deploy-blue-green.sh`.

## Часть 1. Подготовить ветки в GitHub

### Шаг 1. Убедиться, что есть две основные ветки

Нужны ветки:

- `dev`
- `main`

Если `dev` еще нет:

```bash
git checkout -b dev
git push -u origin dev
```

### Шаг 2. Настроить default branch

Обычно default branch удобнее оставить `main`.

Путь в GitHub:

- `Repository -> Settings -> General -> Default branch`

Проверьте, что там выбран `main`.

## Часть 2. Настроить protection rules

### Шаг 3. Защитить `main`

Рекомендуемая настройка:

- запрет прямых push в `main`
- merge только через PR
- требовать successful checks
- по желанию требовать review

Путь:

- `Repository -> Settings -> Branches -> Add branch protection rule`

Для `main` включить:

- `Require a pull request before merging`
- `Require approvals` - по вашему процессу
- `Require status checks to pass before merging`
- выбрать check `CI / verify`
- `Do not allow bypassing the above settings` - если хотите жестко

### Шаг 4. При желании защитить `dev`

Если хотите дисциплину и на dev, можно тоже включить PR-only.

Если `dev` нужен как более свободная интеграционная ветка, можно оставить прямые push.

## Часть 3. Подготовить staging и production серверы

Если staging и production - это разные серверы, настройка выполняется на каждом отдельно.

Если staging и production живут на одном сервере, это тоже можно сделать, но тогда лучше заранее договориться о:

- разных путях клона репозитория
- разных env-файлах
- разных nginx-конфигах/доменах

Самый простой и безопасный вариант: отдельный сервер под staging и отдельный под production.

### Шаг 5. Зайти на сервер под root

Например:

```bash
ssh root@your-server
```

### Шаг 6. Установить Node.js, Bun, nginx

Пример:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git rsync curl
curl -fsSL https://bun.sh/install | bash
```

Потом убедиться, что Bun доступен deploy-пользователю.

Проверить версии:

```bash
node -v
nginx -v
git --version
bun -v
```

### Шаг 7. Подготовить PostgreSQL и Redis

На сервере или на внешнем хосте должны быть доступны:

- PostgreSQL
- Redis

Для production у вас должны быть готовы реальные значения:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`

### Шаг 8. Клонировать репозиторий на сервер

Важно: GitHub Actions в текущей схеме не копирует код через rsync из runner-машины. Он подключается по SSH к серверу и запускает там `git pull`.

Поэтому репозиторий уже должен существовать на сервере.

Пример:

```bash
mkdir -p /var/www
cd /var/www
git clone git@github.com:YOUR_ORG/YOUR_REPO.git spider-viewer
cd spider-viewer
git checkout main
```

Для staging можно использовать другой путь, например:

```bash
/var/www/spider-viewer-staging
```

Для production:

```bash
/var/www/spider-viewer-production
```

### Шаг 9. Выполнить bootstrap скрипт

На сервере, внутри репозитория:

```bash
cd /var/www/spider-viewer-production
chmod +x ops/deploy/bootstrap-ubuntu.sh ops/deploy/deploy-blue-green.sh ops/deploy/rollback-blue-green.sh
./ops/deploy/bootstrap-ubuntu.sh
```

Если staging и production - разные серверы, делаете то же самое на каждом.

### Шаг 10. Заполнить env на сервере

Файл:

```bash
/etc/spider-viewer/spider-viewer.env
```

Пример:

```bash
DATABASE_URL=postgresql://app_user:strong_password@127.0.0.1:5432/spider_viewer
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=replace-with-a-long-random-secret
HOST=127.0.0.1
SHUTDOWN_TIMEOUT_MS=30000
HEALTHCHECK_REDIS_REQUIRED=false
```

Сгенерировать `JWT_SECRET`:

```bash
openssl rand -hex 64
```

### Шаг 11. Проверить первый ручной deploy

Это обязательно сделать до подключения GitHub Actions.

```bash
cd /var/www/spider-viewer-production
./ops/deploy/deploy-blue-green.sh
```

Проверить:

```bash
curl -fsS http://127.0.0.1/readyz
systemctl status spider-viewer@blue --no-pager
systemctl status spider-viewer@green --no-pager
systemctl status nginx --no-pager
```

Если ручной deploy не работает, GitHub Actions тоже не заработает.

## Часть 4. Подготовить deploy user на сервере

GitHub Actions не должен ходить на сервер под `root`.

Лучше завести отдельного пользователя, например `deploy`.

### Шаг 12. Создать пользователя

```bash
sudo adduser deploy
```

### Шаг 13. Дать доступ к репозиторию

Например:

```bash
sudo chown -R deploy:deploy /var/www/spider-viewer-production
```

Или для staging:

```bash
sudo chown -R deploy:deploy /var/www/spider-viewer-staging
```

### Шаг 14. Разрешить нужные sudo-команды

Открыть sudoers:

```bash
sudo visudo
```

Добавить строку примерно такого вида:

```text
deploy ALL=(root) NOPASSWD: /bin/systemctl, /usr/sbin/nginx, /bin/ln, /usr/bin/tee, /bin/mkdir, /bin/chown, /usr/bin/rsync, /usr/bin/env, /usr/bin/bash
```

Смысл в том, чтобы deploy user мог выполнить ваш rollout script без пароля.

### Шаг 15. Проверить, что deploy user реально может выполнять deploy script

```bash
sudo -iu deploy
cd /var/www/spider-viewer-production
./ops/deploy/deploy-blue-green.sh
```

Если здесь все работает - GitHub Actions сможет делать то же самое.

## Часть 5. Подготовить SSH ключ для GitHub Actions

Нужно сделать отдельный SSH key именно для GitHub deploy.

### Шаг 16. Сгенерировать ключ локально

На своей машине:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./github-actions-deploy-key
```

Получатся два файла:

- `github-actions-deploy-key`
- `github-actions-deploy-key.pub`

### Шаг 17. Добавить публичный ключ на сервер

Зайти на сервер и добавить содержимое `github-actions-deploy-key.pub` в:

```bash
~deploy/.ssh/authorized_keys
```

Пример:

```bash
sudo -iu deploy
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Шаг 18. Проверить SSH вход по ключу

Локально:

```bash
ssh -i ./github-actions-deploy-key deploy@YOUR_SERVER
```

Если логин не работает вручную, workflow не заработает.

## Часть 6. Настроить GitHub Environments

### Шаг 19. Создать environment `staging`

Путь:

- `Repository -> Settings -> Environments -> New environment`

Создать environment:

- `staging`

### Шаг 20. Создать environment `production`

Там же создать:

- `production`

### Шаг 21. Для production включить optional protection

Рекомендую хотя бы на первых этапах включить:

- `Required reviewers`

Тогда даже после merge в `main` job деплоя попросит подтверждение перед запуском в production.

Если нужен полностью автоматический деплой без ручного approve - это можно не включать.

## Часть 7. Добавить GitHub Secrets

В каждом environment нужно добавить свои secrets.

### Шаг 22. Секреты для `staging`

В environment `staging` добавить:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_PRIVATE_KEY`

Пример значений:

- `DEPLOY_HOST` -> `staging.example.com`
- `DEPLOY_PORT` -> `22`
- `DEPLOY_USER` -> `deploy`
- `DEPLOY_PATH` -> `/var/www/spider-viewer-staging`
- `DEPLOY_SSH_PRIVATE_KEY` -> содержимое файла `github-actions-deploy-key`

### Шаг 23. Секреты для `production`

В environment `production` добавить те же имена, но с production-значениями:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_PRIVATE_KEY`

Пример:

- `DEPLOY_HOST` -> `prod.example.com`
- `DEPLOY_PORT` -> `22`
- `DEPLOY_USER` -> `deploy`
- `DEPLOY_PATH` -> `/var/www/spider-viewer-production`
- `DEPLOY_SSH_PRIVATE_KEY` -> приватный ключ для production deploy

Важно:

- можно использовать разные ключи для staging и production, это даже лучше
- в таком случае names secrets остаются теми же, просто значения будут разными в разных environments

## Часть 8. Проверить workflow на staging

### Шаг 24. Убедиться, что staging сервер смотрит на `dev`

На staging сервере:

```bash
cd /var/www/spider-viewer-staging
git remote -v
git branch
git checkout dev
```

### Шаг 25. Запушить тестовый commit в `dev`

```bash
git checkout dev
git commit --allow-empty -m "test staging deploy"
git push origin dev
```

### Шаг 26. Открыть GitHub Actions logs

Путь:

- `Repository -> Actions`

Должны отработать:

- `CI`
- `Deploy Staging`

Проверить, что в логах видно:

- SSH connection
- `git pull`
- запуск `./ops/deploy/deploy-blue-green.sh`
- readiness check

Если деплой упал, GitHub покажет stdout/stderr прямо в job log.

## Часть 9. Проверить workflow на production

### Шаг 27. Убедиться, что production сервер смотрит на `main`

На production сервере:

```bash
cd /var/www/spider-viewer-production
git checkout main
```

### Шаг 28. Сделать PR из `dev` в `main`

Рекомендуемый flow:

1. Создать Pull Request `dev -> main`
2. Дождаться зеленого `CI`
3. Merge PR

### Шаг 29. Проверить production deploy workflow

После merge в `main` должны отработать:

- `CI`
- `Deploy Production`

Если для environment `production` включен approval, workflow остановится и попросит approve.

## Часть 10. Что проверять, если не работает

### GitHub Actions не может подключиться по SSH

Проверить:

- верный `DEPLOY_HOST`
- верный `DEPLOY_PORT`
- верный `DEPLOY_USER`
- приватный ключ в `DEPLOY_SSH_PRIVATE_KEY`
- публичный ключ действительно лежит в `~deploy/.ssh/authorized_keys`
- у deploy user корректные права на `~/.ssh`

### GitHub подключается, но deploy script падает

Проверить на сервере вручную под deploy user:

```bash
sudo -iu deploy
cd /var/www/spider-viewer-production
./ops/deploy/deploy-blue-green.sh
```

Если вручную падает - это серверная проблема, не GitHub проблема.

### Ошибка `sudo: a password is required`

Значит, sudoers настроен не полностью.

Проверить строку в `visudo` и убедиться, что deploy user может без пароля выполнять нужные команды.

### `git pull` не работает на сервере

Проверить:

- deploy user имеет доступ к репозиторию
- на сервере настроен deploy key или доступ к GitHub
- репозиторий клонирован по SSH, если нужен приватный доступ

### Build проходит в GitHub, но падает на сервере

Проверить на сервере:

- установлен ли Bun
- установлен ли Node.js
- доступен ли `bun` в PATH для deploy user
- хватает ли памяти/диска

### Приложение задеплоилось, но сайт недоступен

Проверить:

```bash
curl -fsS http://127.0.0.1:3101/healthz || true
curl -fsS http://127.0.0.1:3102/healthz || true
curl -fsS http://127.0.0.1/readyz
sudo nginx -t
systemctl status nginx --no-pager
systemctl status spider-viewer@blue --no-pager
systemctl status spider-viewer@green --no-pager
```

## Часть 11. Что я рекомендую оставить как правила команды

Рекомендуемый минимальный процесс:

1. Все feature-ветки вливаются в `dev`
2. `dev` автоматически едет на staging
3. После проверки делается PR `dev -> main`
4. `main` автоматически едет в production
5. Если прод сломан - выполняется `./ops/deploy/rollback-blue-green.sh`

## Часть 12. Минимальный финальный checklist

Перед тем как считать настройку завершенной, должно выполняться все ниже:

- [ ] Есть ветки `dev` и `main`
- [ ] `main` защищена branch protection rule
- [ ] Созданы GitHub Environments `staging` и `production`
- [ ] В environment добавлены все secrets
- [ ] На сервере есть deploy user
- [ ] Deploy user умеет логиниться по SSH ключу
- [ ] Репозиторий уже клонирован на сервер
- [ ] Ручной запуск `./ops/deploy/deploy-blue-green.sh` работает
- [ ] Push в `dev` запускает staging deploy
- [ ] Merge в `main` запускает production deploy
- [ ] `rollback-blue-green.sh` работает вручную

## Если хотите еще надежнее

Следующие улучшения можно сделать потом:

- добавить отдельный staging домен
- добавить HTTPS через Let's Encrypt
- включить required approval только для production environment
- отправлять уведомления о deploy в Telegram/Slack
- добавить backup dump базы перед production deploy
- добавить smoke-check после деплоя по реальному URL
