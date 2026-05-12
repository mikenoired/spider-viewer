# Spider Viewer

Средство для просмотра активности выполнения прокладки кабелей в РОАЭС

## Режим разработки

```bash
bun install # Установка зависимостей
cp .env.example .env # Создание файла с секретными ключами
# Меняйте значение JWT_SECRET на новое, например через комманду `openssl rand -hex 64`
docker compose up -d # Запуск базы данных
bun run db:push # Встраивание имеющейся схемы в БД
bun run db:seed:test-users # Вставка новых пользователей
bun dev # Запуск проекта
```

## Railway

Деплой настроен через `Dockerfile` и `railway.json`. Railway должен собирать сервис из корня репозитория и запускать контейнер командой из Dockerfile.

Обязательные переменные сервиса:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=...
AUTH_COOKIE_SECURE=true
```

Опциональные переменные:

```bash
REDIS_URL=redis://...
HEALTHCHECK_REDIS_REQUIRED=false
SHUTDOWN_TIMEOUT_MS=30000
```

Перед запуском контейнера Railway выполняет `npm run db:deploy`, который синхронизирует схему через Drizzle. Healthcheck смотрит на `/healthz`, чтобы деплой не зависел от прогрева базы или Redis.
