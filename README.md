# Nicole Beauty

Панель управления салоном красоты: мастера, услуги, цены, ежедневные итоги, доходы/расходы, продукция, отчёты за произвольный период.

**Стек:** статический HTML/CSS/JS + Supabase (Postgres) + Vercel (хостинг).

## Возможности

- **Записи** — ежедневные итоги выручки по каждому мастеру, журнал по дням, итоги за месяц, журнал услуг
- **Отдельный поддомен для мастеров** (`nicole-salon-pro.vercel.app`): вход по PIN, выбор услуги, авто-расчёт комиссии, сохранение за 2 клика. Админская панель не доступна с этого адреса.
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

### 5. Self-service для мастеров (отдельный поддомен)

Мастера получают **собственный адрес** `nicole-salon-pro.vercel.app`, полностью отделённый от админской панели. Это достигается через **второй Vercel-проект**, подключённый к тому же GitHub-репозиторию: деплои синхронизированы, но URL разные. [`vercel.json`](vercel.json) содержит rewrite, который на хосте `nicole-salon-pro.vercel.app` отдаёт `register.html` вместо `index.html`.

**5.1. Миграция БД**

Supabase → **SQL Editor → New query** → вставьте по очереди:

1. [`supabase/migrations/002_attendances.sql`](supabase/migrations/002_attendances.sql) → **RUN**. Добавит:
   - колонку `masters.pin_hash` (scrypt-хэш)
   - таблицу `attendances` (запись по услугам)
   - таблицу `pin_attempts` (аудит + rate-limit)
   - view `masters_public` (без `pin_hash` для anon)

2. [`supabase/migrations/003_master_services_autofill.sql`](supabase/migrations/003_master_services_autofill.sql) → **RUN**. Гарантирует, что при добавлении новой услуги или нового мастера автоматически создаются записи в `master_services` (цена=0, комиссия=50%) для **всех** существующих пар. Без этой миграции новые услуги не будут видны в pro-форме мастеров. Также делает one-time backfill для пар, которые уже разъехались.

3. [`supabase/migrations/004_product_source.sql`](supabase/migrations/004_product_source.sql) → **RUN**. Добавляет дифференцированные комиссии в зависимости от источника продуктов:
   - `master_services.commission_master_pct_salon` — % мастеру, когда используются продукты салона (обычно ниже)
   - `master_services.commission_master_pct` (уже было) — % мастеру, когда используются свои продукты (выше)
   - `attendances.uses_salon_products` — аудит-флаг, какое правило применено к записи

> После добавления новой услуги через админку зайдите во вкладку **Мастера → «Цены и комиссии»**, проставьте реальную цену и оба процента (свои/салон) для каждого мастера и сохраните. По-умолчанию цена 0 — мастер увидит услугу, но не сможет её записать без цены. Дефолтные комиссии: свои 50%, салон 40% — пересмотрите под свой салон.

> В pro-форме мастер при записи услуги выбирает «Продукты салона: Да/Нет» — сервер автоматически применяет соответствующий процент. Клиент не может подменить процент — обе ставки берутся из БД сервером.

**5.2. Создать второй Vercel-проект**

1. Vercel Dashboard → **Add New → Project** → импортируйте тот же репозиторий `nicole-beauty`
2. **Project Name** = `nicole-salon-pro` (даст URL `https://nicole-salon-pro.vercel.app`)
3. Framework preset: **Other** → **Deploy**

> Имя любое — домен определяется именем проекта. Важно: на этом проекте нужно выставить env var `SITE=pro` (см. ниже), тогда [`vercel.json`](vercel.json)-овский `buildCommand` подменит `index.html` содержимым `register.html` при сборке.

**5.3. Env vars**

На **обоих** проектах (`nicole-beauty` и `nicole-salon-pro`) в **Settings → Environment Variables** (Production/Preview/Development):

| Key                         | Value                                         | Где взять                                                 |
|-----------------------------|-----------------------------------------------|-----------------------------------------------------------|
| `SUPABASE_URL`              | `https://gyixkgytywjtttcnynzn.supabase.co`    | Supabase → Settings → API                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (длинный JWT)                        | Supabase → Settings → API → **service_role** (⚠️ НЕ anon) |
| `ADMIN_PASSWORD`            | любой пароль, придумайте сами                 | нужен для установки PIN в админке                          |

**Только** на pro-проекте (`nicole-salon-pro`) добавьте ещё:

| Key    | Value | Зачем                                          |
|--------|-------|------------------------------------------------|
| `SITE` | `pro` | Триггер для `buildCommand` в `vercel.json` — при сборке pro-проекта `register.html` копируется поверх `index.html`, поэтому корень `/` отдаёт форму мастера, а не админку |

`ANTHROPIC_API_KEY` нужен только на проекте админа — OCR-функция недоступна с pro-поддомена.

После добавления env vars: **Deployments → последний → ⋯ → Redeploy** на обоих проектах.

> ⚠️ `service_role` key обходит RLS. Храните только как Vercel env var, **никогда** не в репо и не в браузере.

**5.4. Настройка PIN для каждого мастера**

1. Откройте админку `https://nicole-beauty.vercel.app` → вкладка **Мастера**
2. Кнопка **PIN** рядом с именем мастера
3. Введите новый PIN (4–8 цифр) и пароль администратора (из `ADMIN_PASSWORD` — кэшируется в sessionStorage, запрашивается один раз)
4. Сообщите PIN мастеру

**5.5. Использование мастером**

1. Мастер открывает `https://nicole-salon-pro.vercel.app` на телефоне
2. Выбирает своё имя → вводит PIN → «Войти»
3. Для каждой услуги: выбирает услугу → цена подтягивается → «Записать»
4. Сессия хранится до закрытия вкладки. «Выход» вручную.

**Безопасность:**

- Админская панель **недоступна** с `nicole-salon-pro.vercel.app` (при сборке `index.html` заменён на `register.html` через `buildCommand`)
- PIN хэшируется scrypt-ом (Node built-in) перед сохранением
- 5 ошибок подряд за минуту → блокировка на 60 секунд (`pin_attempts` audit)
- Цена переопределяется мастером, но ограничена 10× прайса из `master_services`
- Комиссия вычисляется сервером по `master_services.commission_master_pct` — мастер не влияет
- `masters.pin_hash` скрыт от anon через view `masters_public`

## Разработка

Локальный workflow через Supabase CLI + Vercel CLI + OrbStack (Docker).

### Один раз: установка тулинга

```sh
brew install supabase/tap/supabase vercel-cli orbstack
supabase login                                          # OAuth
supabase link --project-ref gyixkgytywjtttcnynzn        # запросит DB password
vercel login                                            # OAuth
vercel link                                             # выбрать проект `nicole-beauty`
```

### Локальный стек Supabase

```sh
open -a OrbStack                  # запустить Docker daemon
supabase start                    # ~2 мин на первый pull, потом секунды
supabase db reset                 # применит migrations/001_initial.sql … 004_*.sql
```

После `supabase start`:

- API: `http://127.0.0.1:54321`
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Studio локально отключён (баг в образе) — используйте удалённый `supabase.com/dashboard` для SQL/UI

`config.js` авто-переключается между local и prod по `location.hostname` — никаких ручных правок.

### Запуск приложения локально

Два варианта:

```sh
# Вариант A: только статика (без serverless функций — OCR, attendance, PIN не работают)
python3 -m http.server 8000
# открыть http://localhost:8000/index.html

# Вариант B: полный стек с api/* функциями (нужен .env.local — создаётся автоматически при vercel link)
vercel dev
# открыть http://localhost:3000
```

`.env.local` уже содержит локальные значения (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD=dev`, Telegram отключён). Чтобы получить prod env vars вместо локальных: `vercel env pull .env.local --environment=production`.

### Новая миграция

```sh
supabase migration new <имя>           # создаст supabase/migrations/<timestamp>_<имя>.sql
# … редактируете SQL …
supabase db reset                      # применит локально, проверит что не ломает существующие
supabase db push                       # применит на prod (подтверждение y/N)
```

Миграции должны быть **идемпотентными** (`if not exists`, `or replace`, `on conflict do nothing`) — это позволяет 001-baseline + дельты сосуществовать.

### Деплой

Push в `main` → Vercel авто-деплой обоих проектов (admin + pro). Альтернативно:

```sh
vercel                                 # preview deploy
vercel --prod                          # production deploy
```

## Структура

```
index.html             — админская панель (serve на nicole-beauty.vercel.app)
register.html          — форма мастера (serve на nicole-salon-pro.vercel.app)
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
