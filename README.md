# Spider Viewer

Средство для просмотра активности выполнения прокладки кабелей в РОАЭС

## Режим разработки

```bash
bun install # Установка зависимостей
cp .env.example .env # Создание файла с секретными ключами
# Меняйте значение JWT_SECRET на новое, например через комманду `openssl rand -hex 64`
# Задайте AUTH_SUPERUSERS_JSON с тремя суперпользователями в .env
docker compose up -d # Запуск базы данных
bun run db:push # Встраивание имеющейся схемы в БД
bun run auth:seed:superusers # Создание/обновление 3 суперпользователей из AUTH_SUPERUSERS_JSON
bun dev # Запуск проекта
```

Обычные пользователи регистрируются через `/register`. После этого суперпользователь подтверждает или отклоняет заявку в разделе `/app/users`.

## Railway

Деплой настроен через `Dockerfile` и `railway.json`. Railway должен собирать сервис из корня репозитория и запускать контейнер командой из Dockerfile.

Обязательные переменные сервиса:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=...
AUTH_SUPERUSERS_JSON=[{"login":"supervisor-1","password":"ChangeMe123!"},{"login":"supervisor-2","password":"ChangeMe456!"},{"login":"supervisor-3","password":"ChangeMe789!"}]
AUTH_COOKIE_SECURE=true
```

Опциональные переменные:

```bash
REDIS_URL=redis://...
HEALTHCHECK_REDIS_REQUIRED=false
SHUTDOWN_TIMEOUT_MS=30000
```

Перед запуском контейнера Railway выполняет `npm run db:deploy`, который синхронизирует схему через Drizzle. Healthcheck смотрит на `/healthz`, чтобы деплой не зависел от прогрева базы или Redis.
