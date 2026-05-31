# Public Site v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Public Site v1 for Nicole Beauty using Next.js (App Router), capturing booking requests and notifying the admin via Telegram, along with required database schema changes.

**Architecture:** A new Next.js application in `public-site/` deployed as a separate Vercel project, using raw `fetch` to Supabase REST API.

**Spec:** `docs/public-site-v1.md`

## Task 1: Scaffold `public-site/`

- [ ] **Step 1: Scaffold Next.js App**
  Run the following command in the root of the project:
  ```bash
  npx create-next-app@latest public-site --typescript --eslint --app --no-tailwind --no-src-dir --import-alias "@/*"
  ```
- [ ] **Step 2: Add Vitest**
  Inside `public-site/`, run:
  ```bash
  cd public-site
  npm install -D vitest @vitest/ui
  ```
- [ ] **Step 3: Configure Vitest**
  Create `public-site/vitest.config.ts`:
  ```typescript
  import { defineConfig } from 'vitest/config'
  import react from '@vitejs/plugin-react'
  import path from 'path'
  
  export default defineConfig({
    plugins: [react()],
    test: {
      environment: 'node',
      alias: {
        '@': path.resolve(__dirname, './')
      }
    }
  })
  ```
  Update `package.json` scripts to include `"test": "vitest"`.

## Task 2: Base layout & tokens

- [ ] **Step 1: Add tokens to globals.css**
  Replace `public-site/app/globals.css` with the CSS tokens from `index.html`:
  ```css
  :root {
    --bg: #FAFAF7;
    --bg-elevated: #FFFFFF;
    --ink: #1F1C18;
    --ink-soft: #3D3934;
    --muted: #8A857D;
    --hairline: #E8E6E1;
    --accent: #E2B27D;
    --accent-deep: #C7955C;
    --positive: #5D8068;
    --positive-bg: #EAF0EC;
    --danger: #AB5252;
    --serif: 'Cormorant Garamond', serif;
    --sans: 'DM Sans', sans-serif;
  }
  
  body {
    background-color: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    margin: 0;
    padding: 0;
  }
  
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--serif);
    color: var(--ink-soft);
  }
  ```

- [ ] **Step 2: Update layout.tsx**
  Update `public-site/app/layout.tsx` to include Russian language, fonts from Google Fonts, and Yandex Metrica script.
  ```typescript
  import type { Metadata } from 'next'
  import Script from 'next/script'
  import './globals.css'

  export const metadata: Metadata = {
    title: 'Nicole Beauty',
    description: 'Салон красоты в Самаре',
  }

  export default function RootLayout({
    children,
  }: {
    children: React.ReactNode
  }) {
    const ymId = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
    return (
      <html lang="ru">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet" />
        </head>
        <body>
          {children}
          {ymId && (
            <Script id="yandex-metrica" strategy="afterInteractive">
              {\`
                (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                m[i].l=1*new Date();
                for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
                k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
                (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
          
                ym(\${ymId}, "init", {
                     clickmap:true,
                     trackLinks:true,
                     accurateTrackBounce:true
                });
              \`}
            </Script>
          )}
        </body>
      </html>
    )
  }
  ```

## Task 3: Migration 008 (booking_requests)

- [ ] **Step 1: Create `supabase/migrations/008_booking_requests.sql`**
  ```sql
  create table if not exists booking_requests (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      service_id bigint references services(id) on delete set null,
      service_name text,
      master_id bigint references masters(id) on delete set null,
      master_name text,
      help_choosing boolean not null default false,
      preferred_day text,
      preferred_period text,
      client_name text not null,
      client_contact text not null,
      contact_method text,
      note text,
      status text not null default 'new',
      source text not null default 'public_site',
      ip text,
      user_agent text
  );

  create index if not exists idx_booking_requests_created_at on booking_requests(created_at);
  create index if not exists idx_booking_requests_ip_created on booking_requests(ip, created_at);

  alter table booking_requests enable row level security;
  -- No anon policies (service-role only)
  ```

- [ ] **Step 2: Append to `supabase/schema.sql`**
  Copy the above table definition into `supabase/schema.sql` to keep it as the source of truth.

## Task 4: Migration 009 (masters public columns)

- [ ] **Step 1: Create `supabase/migrations/009_masters_public_fields.sql`**
  ```sql
  alter table masters add column if not exists photo_url text;
  alter table masters add column if not exists bio text;
  alter table masters add column if not exists display_order int not null default 100;
  alter table masters add column if not exists is_public boolean not null default true;

  drop view if exists masters_public;
  create or replace view masters_public as
    select id, name, specialty, active, photo_url, bio, display_order, is_public, created_at
    from masters;

  grant select on masters_public to anon, authenticated;
  ```

- [ ] **Step 2: Append to `supabase/schema.sql`**
  Copy the column additions and view definition into `supabase/schema.sql`.

## Task 5: lib/supabase.ts

- [ ] **Step 1: Create `public-site/lib/supabase.ts`**
  ```typescript
  export async function sbSelect(path: string, revalidate: number = 300) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    
    if (!url || !anonKey) {
      throw new Error('Supabase env vars missing');
    }

    const res = await fetch(\`\${url}/rest/v1/\${path}\`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': \`Bearer \${anonKey}\`,
        'Content-Type': 'application/json'
      },
      next: { revalidate }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(\`Supabase select failed: \${res.status} \${err}\`);
    }

    return res.json();
  }
  ```

## Task 6: lib/data.ts

- [ ] **Step 1: Create `public-site/lib/data.ts`**
  ```typescript
  import { sbSelect } from './supabase';

  export async function getPublicMasters() {
    return sbSelect('masters_public?is_public=eq.true&active=eq.true&order=display_order.asc,name.asc');
  }

  export async function getServices() {
    return sbSelect('services?select=*');
  }

  export async function getMasterServices() {
    return sbSelect('master_services?select=*');
  }

  export function servicePrices(services: any[], ms: any[], publicMasterIds: number[]) {
    return services.map(s => {
      const masterPrices = ms
        .filter(m => m.service_id === s.id && publicMasterIds.includes(m.master_id) && m.price > 0)
        .map(m => Number(m.price));
      
      const minPrice = masterPrices.length > 0 ? Math.min(...masterPrices) : null;
      return { service: s, from: minPrice };
    });
  }
  ```

## Task 7: lib/telegram.ts

- [ ] **Step 1: Create `public-site/lib/telegram.ts`**
  ```typescript
  export function escMd(s: string): string {
    return String(s || '').replace(/([_*\\[\\]()~\`>#+\\-=|{}.!])/g, '\\\\$1');
  }

  export async function notifyAdmin(text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      await fetch(\`https://api.telegram.org/bot\${token}/sendMessage\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'MarkdownV2'
        }),
        signal: controller.signal
      });
    } catch (e) {
      console.error('Telegram notification failed:', e);
    } finally {
      clearTimeout(timeout);
    }
  }
  ```

## Task 8: app/api/booking-create/route.ts

- [ ] **Step 1: Create `public-site/app/api/booking-create/route.ts`**
  ```typescript
  import { notifyAdmin, escMd } from '@/lib/telegram';

  export async function POST(req: Request) {
    try {
      const ip = req.headers.get('x-forwarded-for') || 'unknown';
      const body = await req.json();
      
      if (!body.client_name || !body.client_contact) {
        return Response.json({ error: 'Name and contact required' }, { status: 400 });
      }

      const url = process.env.SUPABASE_URL;
      const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      // Rate limit check: count requests from IP in last minute
      const limitRes = await fetch(\`\${url}/rest/v1/booking_requests?ip=eq.\${ip}&created_at=gte.\${new Date(Date.now() - 60000).toISOString()}\`, {
        headers: {
          'apikey': serviceRole!,
          'Authorization': \`Bearer \${serviceRole}\`,
          'Range-Unit': 'items'
        }
      });
      const limitData = await limitRes.json();
      if (limitData.length >= 5) {
        return Response.json({ error: 'Too many requests' }, { status: 429 });
      }

      // Insert record
      const insertData = {
        service_id: body.service_id,
        service_name: body.service_name,
        master_id: body.help_choosing ? null : body.master_id,
        master_name: body.help_choosing ? 'Помогите выбрать' : body.master_name,
        help_choosing: body.help_choosing || false,
        preferred_day: body.preferred_day,
        preferred_period: body.preferred_period,
        client_name: body.client_name.substring(0, 100),
        client_contact: body.client_contact.substring(0, 100),
        contact_method: body.contact_method,
        note: body.note ? body.note.substring(0, 500) : null,
        ip,
        user_agent: req.headers.get('user-agent') || 'unknown'
      };

      const res = await fetch(\`\${url}/rest/v1/booking_requests\`, {
        method: 'POST',
        headers: {
          'apikey': serviceRole!,
          'Authorization': \`Bearer \${serviceRole}\`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(insertData)
      });
      
      if (!res.ok) throw new Error('DB insert failed');
      const inserted = await res.json();
      
      // Notify Admin
      const msg = \`*Новая заявка с сайта* 💅\\n\\n\` +
        \`👤 Клиент: \${escMd(insertData.client_name)}\\n\` +
        \`📞 Контакт: \${escMd(insertData.client_contact)} (\${escMd(insertData.contact_method)})\\n\\n\` +
        \`✂️ Услуга: \${escMd(insertData.service_name || '?')}\\n\` +
        \`👩‍🎨 Мастер: \${escMd(insertData.master_name)}\\n\` +
        \`📅 Желаемое время: \${escMd(insertData.preferred_day || '?')} / \${escMd(insertData.preferred_period || '?')}\\n\` +
        (insertData.note ? \`📝 Комментарий: \${escMd(insertData.note)}\` : '');
        
      await notifyAdmin(msg);

      return Response.json({ ok: true, id: inserted[0].id });
    } catch (err: any) {
      console.error(err);
      return Response.json({ error: 'Server error' }, { status: 500 });
    }
  }
  ```

## Task 9: Landing sections

- [ ] **Step 1: Update `public-site/app/page.tsx`**
  ```typescript
  import { getPublicMasters, getServices, getMasterServices, servicePrices } from '@/lib/data';
  import BookingWidget from '@/components/BookingWidget';

  export default async function Home() {
    const masters = await getPublicMasters();
    const services = await getServices();
    const masterServices = await getMasterServices();
    
    const prices = servicePrices(services, masterServices, masters.map((m: any) => m.id));

    return (
      <main>
        <section className="hero">
          <h1>Nicole Beauty</h1>
          <p>Ваша красота в надежных руках</p>
        </section>
        
        <section className="masters">
          <h2>Наши мастера</h2>
          <div className="masters-list">
            {masters.map((m: any) => (
              <div key={m.id} className="master-card">
                {m.photo_url && <img src={m.photo_url} alt={m.name} />}
                <h3>{m.name}</h3>
                <p>{m.specialty}</p>
                <p>{m.bio}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="services">
          <h2>Услуги и цены</h2>
          <ul>
            {prices.map((p: any) => (
              <li key={p.service.id}>
                {p.service.name} — {p.from ? \`от \${p.from} ₽\` : 'Цена по запросу'}
              </li>
            ))}
          </ul>
        </section>

        <section className="booking">
          <h2>Запись</h2>
          <BookingWidget 
            services={services} 
            masters={masters} 
            masterServices={masterServices} 
            whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}
            telegramContact={process.env.NEXT_PUBLIC_TELEGRAM_CONTACT}
          />
        </section>
      </main>
    );
  }
  ```

## Task 10: BookingWidget.tsx

- [ ] **Step 1: Create `public-site/components/BookingWidget.tsx`**
  *(A full React component with state for serviceId, masterId, day, period, name, contact, note. It will POST to `/api/booking-create` and open `wa.me` or `t.me` links.)*
  - Implement form inputs.
  - Implement validation.
  - `reachGoal('cta_click')` on submit.
  - Fetch POST `/api/booking-create`.
  - `reachGoal('request_sent')` and open deep link.

## Task 11: Admin content editing

- [ ] **Step 1: Modify `index.html`**
  Update `renderMasters()` to add inline inputs for:
  - `photo_url` (text input)
  - `bio` (textarea)
  - `display_order` (number)
  - `is_public` (checkbox)
  
- [ ] **Step 2: Add `saveMaster(id)` in `index.html`**
  ```javascript
  async function saveMaster(id) {
    const photo_url = val('masterPhoto_' + id);
    const bio = val('masterBio_' + id);
    const display_order = parseInt(val('masterOrder_' + id));
    const is_public = $('masterPublic_' + id).checked;
    
    const { error } = await sb.from('masters').update({
      photo_url, bio, display_order, is_public
    }).eq('id', id);
    
    if (error) { toast(error.message, true); return; }
    toast('Сохранено');
    await loadAll();
  }
  ```

## Task 12: Env + deploy config + docs

- [ ] **Step 1: Create `public-site/.env.local.example`**
  ```env
  SUPABASE_URL=
  SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  TELEGRAM_BOT_TOKEN=
  TELEGRAM_CHAT_ID=
  NEXT_PUBLIC_YANDEX_METRICA_ID=
  NEXT_PUBLIC_WHATSAPP_NUMBER=
  NEXT_PUBLIC_TELEGRAM_CONTACT=
  NEXT_PUBLIC_PHONE=
  ```
- [ ] **Step 2: Create `public-site/README.md`** detailing setup and deployment.

## Task 13: Verification & soft-launch checklist

- [ ] Run `npm run build` and `npm test` successfully.
- [ ] Apply 008 and 009 migrations in Supabase.
- [ ] Set up Vercel project with Root Directory `public-site` and all env variables.
- [ ] E2E Test: Submit a request via widget, verify DB insert, Telegram notification, and deep link redirect.
- [ ] Verify admin can edit the newly added fields for masters in `index.html`.
