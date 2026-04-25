# Nicole Beauty

Панель управления салоном красоты: мастера, услуги, цены, ежедневные итоги, доходы/расходы, продукция, отчёты за произвольный период.

**Стек:** статический HTML/CSS/JS + Supabase (Postgres) + Vercel (хостинг).

## Возможности

- **Записи** — ежедневные итоги выручки по каждому мастеру, журнал по дням, итоги за месяц, журнал услуг (из /register)
- **/register** — мобильная страница для мастеров: вход по PIN, выбор услуги, авто-расчёт комиссии, сохранение за 2 клика
- **📷 Распознавание фото отчёта** — загрузите фото страницы из тетради, Claude Vision (Sonnet 4.6) распознает данные, вы проверите и сохраните в один клик
- **Финансы** — доходы и расходы с категориями, статусами оплаты, поставщиками
- **Продукция** — каталог продукции по брендам (Constant Delight, Matrix, …)
- **Мастера** — CRUD мастеров, услуг и матрицы «мастер × услуга» с ценой и % комиссии + управление PIN-кодами
- **Отчёты** — фильтр по произвольному периоду (от/до), пресеты (этот/прошлый месяц, год, всё), диаграммы, услуги за период, экспорт CSV

## Быстрый старт

### 1. Supabase

1. Создайте проект на <https://supabase.com>
2. **SQL Editor → New query** → вставьте содержимое [`supabase/schema.sql`](supabase/schema.sql) → **RUN**
3. **Settings → API** — скопируйте `Project URL` и `anon public` key

### 2. Локальный запуск

```sh
cp config.js.example config.js
# отредактируйте config.js, вставьте URL и anon key
```

Откройте `index.html` в браузере (двойным кликом или через Live Server).

> Anon key — публичный ключ, безопасен в браузере. Доступ ограничен политиками RLS в Postgres. **Никогда** не коммитьте `service_role` key.

### 3. Деплой на Vercel

1. Запушьте репозиторий на GitHub
2. На <https://vercel.com/new> импортируйте репо → Framework preset: **Other** → Deploy
3. `vercel.json` уже настроен, сборка не нужна

### 4. (Опционально) Настройка распознавания фото отчётов

Для работы вкладки «Загрузить фото отчёта» нужен ключ Anthropic API:

1. Создайте ключ на <https://console.anthropic.com/settings/keys>
2. Vercel Dashboard → ваш проект → **Settings** → **Environment Variables**
3. Добавьте: `ANTHROPIC_API_KEY` = `sk-ant-api03-...` (для всех окружений: Production, Preview, Development)
4. Redeploy: вкладка **Deployments** → последний деплой → меню `⋯` → **Redeploy**

Используется модель `claude-sonnet-4-6` со structured outputs (JSON schema) — стоимость ~$0.01–0.03 за фото в зависимости от качества.

> ⚠️ **Безопасность:** ключ хранится только на стороне Vercel как env var, никогда не попадает в браузер и не коммитится в репозиторий.

### 5. Self-service для мастеров (`/register`)

Мастера могут сами фиксировать услуги в реальном времени с телефона. Это требует миграции БД и двух дополнительных переменных окружения.

**БД:**

1. Supabase → **SQL Editor → New query** → вставьте [`supabase/migrations/002_attendances.sql`](supabase/migrations/002_attendances.sql) → **RUN**. Добавит:
   - колонку `masters.pin_hash` (scrypt-хэш)
   - таблицу `attendances` (запись по услугам)
   - таблицу `pin_attempts` (аудит + rate-limit)
   - view `masters_public` (без `pin_hash` для anon)

**Vercel env vars** (добавить и сделать Redeploy):

| Key                         | Value | Где взять |
|-----------------------------|-------|-----------|
| `SUPABASE_URL`              | `https://XXXXX.supabase.co` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (длинный JWT)       | Supabase → Settings → API → `service_role` (⚠️ НЕ anon) |
| `ADMIN_PASSWORD`            | любой пароль, который вы запомните | придумайте сами — используется для установки PIN |

> ⚠️ `service_role` key обходит RLS. Храните только как Vercel env var, **никогда** не в репо и не в браузере.

**Настройка PIN для каждого мастера:**

1. Откройте `/` → вкладка **Мастера** → кнопка **PIN** рядом с именем
2. Введите новый PIN (4–8 цифр) и пароль администратора (из `ADMIN_PASSWORD`)
3. Сообщите PIN мастеру

**Использование мастером:**

1. Мастер открывает `https://ваш-домен.vercel.app/register` на телефоне
2. Выбирает своё имя → вводит PIN → «Войти»
3. Для каждой услуги: выбирает услугу → цена подтягивается → «Записать» (2 клика)
4. Сессия хранится до закрытия вкладки. «Выход» — вручную.

**Безопасность:**

- PIN хэшируется scrypt-ом (Node built-in) перед сохранением
- 5 ошибок подряд за минуту → блокировка на 60 секунд (`pin_attempts` audit)
- Цена переопределяется мастером, но ограничена 10× прайса из `master_services`
- Комиссия вычисляется сервером по `master_services.commission_master_pct` — мастер не влияет
- `masters.pin_hash` скрыт от anon через view `masters_public`

## Структура

```
index.html             — админская панель (single-page)
register.html          — форма мастера (/register)
config.js              — URL и anon key (см. config.js.example)
config.js.example      — шаблон конфига
assets/nicole-logo.png — логотип
api/parse-report.js    — Vercel serverless: Claude Vision для распознавания фото (admin OCR)
api/attendance.js      — Vercel serverless: запись услуги (PIN-валидация, service-role insert)
api/verify-pin.js      — Vercel serverless: логин мастера
api/set-pin.js         — Vercel serverless: админ устанавливает PIN
supabase/schema.sql              — полная схема (для fresh deploys)
supabase/migrations/002_attendances.sql  — дельта для существующих установок
vercel.json            — настройки хостинга
```

## Схема БД

- `masters` (с `pin_hash` scrypt) — мастера
- `masters_public` — view без `pin_hash` для anon-чтения
- `services` — каталог услуг
- `master_services` — цена и % комиссии мастера для каждой услуги
- `day_summaries` — ежедневные агрегаты (ручной ввод / OCR)
- `attendances` — запись услуги (из `/register`); комиссия вычислена сервером
- `pin_attempts` — аудит попыток ввода PIN (rate-limit источник)
- `income` / `expenses` / `inventory` — финансы и продукция

RLS: `masters`, `services`, `master_services`, `day_summaries`, `income`, `expenses`, `inventory` открыты для anon (внутреннее использование). `attendances` — anon только SELECT, INSERT/UPDATE/DELETE только через service-role (`/api/attendance`). `pin_attempts` — только service-role.

## Отчёты за произвольный период

Вкладка «Отчёты» поддерживает фильтр `с` / `по` + пресеты. Кнопка «Экспорт CSV» выгружает журнал, доходы и расходы за выбранный период одним файлом (UTF-8 BOM, `;`-разделитель для Excel).
