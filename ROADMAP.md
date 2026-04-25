# Nicole Beauty — Roadmap

Funcionalidades planejadas mas não implementadas. Cada seção é auto-contida: basta abrir uma nova conversa com o Claude, apontar para este arquivo, e dizer "implementa a seção X".

---

## 1. Notificações Telegram

**Goal:** toda vez que uma mestre registra um serviço via `/register`, o admin recebe uma notificação no Telegram em tempo real — nome da mestre, serviço, valor, cliente, comissão.

**Por que é útil:** admin fica a par do dia sem precisar abrir o dashboard; serve também como audit log paralelo ao Supabase.

### Arquitetura

```
/register → /api/attendance → insert + fire-and-forget POST para Telegram Bot API
                               └─ falha de Telegram NÃO quebra o insert
```

Sem webhook, sem polling — basta uma chamada HTTP outbound do serverless para `api.telegram.org`.

### Setup externo (uma vez)

1. Abrir `@BotFather` no Telegram → `/newbot` → escolher nome (ex.: "Nicole Salon Bot") e username (ex.: `@nicole_salon_bot`) → salvar **bot token** (formato `123456:ABC-DEF...`)
2. Criar um chat privado com o bot OU um grupo e adicionar o bot como membro
3. Obter `chat_id`:
   - Mandar qualquer mensagem para o bot (ou no grupo)
   - Abrir `https://api.telegram.org/bot<TOKEN>/getUpdates` no browser
   - Procurar `"chat": {"id": 123456789, ...}` no JSON retornado
4. Adicionar dois env vars no Vercel (ambos os projetos admin e pro):
   - `TELEGRAM_BOT_TOKEN` = o token do BotFather
   - `TELEGRAM_CHAT_ID` = o chat_id (número, pode ser negativo para grupos)
5. Redeploy

### Mudanças no código

**Modificar** [`api/attendance.js`](api/attendance.js):

Depois do `await sb('POST', 'attendances', {...})` bem-sucedido e antes do `return json(res, 200, ...)`, adicionar chamada não-bloqueante:

```js
// Fire-and-forget Telegram notification — never breaks the response.
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  const msg = [
    '✂️ *Новая запись*',
    '',
    `*Мастер:* ${master.name}`,
    `*Услуга:* ${serviceName || '—'}`,
    `*Цена:* ${price.toLocaleString('ru-RU')} ₽`,
    `*Мастеру:* ${masterPay.toLocaleString('ru-RU')} ₽ (${commissionPct}%)`,
    clientName ? `*Клиент:* ${clientName}` : null,
    paymentMethod ? `*Оплата:* ${paymentMethod}` : null,
    `_${nowTime.slice(0, 5)} · ${todayDate}_`,
  ].filter(Boolean).join('\n');

  fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: 'Markdown',
    }),
  }).catch(e => console.error('telegram notify failed:', e));
}
```

Não usar `await` — a resposta HTTP para a mestre não deve esperar o Telegram. Se cair, a nota falha silenciosamente (apenas log de erro no Vercel).

**Por segurança** — escape de caracteres Markdown nos valores dinâmicos (caractere `_` `*` `[` `]` `(` `)` quebram Markdown):

```js
function escMd(s) { return String(s || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1'); }
```

Aplicar a `master.name`, `serviceName`, `clientName`, `paymentMethod` antes de compor a msg.

### Opcional — tabela de preferências

Se quiser ligar/desligar notificações por mestre (ou mudar destino por mestre), criar uma nova migration:

```sql
alter table masters add column if not exists notify_telegram boolean not null default true;
```

No `/api/attendance`, checar `master.notify_telegram` antes de enviar. Dashboard admin ganha um toggle na aba Мастера.

### Verificação

1. Env vars setados, redeploy em ambos os projetos
2. Mestre registra um serviço no `/register`
3. Mensagem aparece no Telegram em <2s
4. Se Telegram estiver fora do ar, o registro ainda é salvo (confere no admin Журнал услуг)
5. Logs do Vercel (Deployments → Functions → attendance) mostram `telegram notify failed: ...` se der erro — não é retornado ao browser

---

## 2. Relatório visual + impressão

**Goal:** substituir / complementar o CSV export por uma **visualização bonita na tela** de todos os dados do período (receita, comissões, serviços, lucro) que pode ser impressa diretamente ou salva como PDF pelo próprio navegador.

**Por que é útil:** entregar relatório impresso ao contador, imprimir para arquivo físico, mostrar resumo bonito para a dona do salão.

### Arquitetura

Nova rota `/report?from=YYYY-MM-DD&to=YYYY-MM-DD` (arquivo `report.html`) que:
- Lê os params da URL
- Carrega dados do Supabase via anon key (SELECT only — já permitido)
- Renderiza layout editorial otimizado para A4
- Tem um botão grande "Печать" que dispara `window.print()`
- Tem CSS `@media print` que esconde o próprio botão e ajusta margens

O admin ganha um botão "Открыть отчёт" na aba Отчёты, abrindo `/report?from=...&to=...` em nova aba.

### Arquivos a criar/modificar

**Criar** `report.html`:

Estrutura:
```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <!-- Cormorant + DM Sans via Google Fonts (mesma do admin) -->
  <style>
    /* Champagne palette + print-optimized layout */
    @page { size: A4; margin: 15mm 12mm; }
    @media print {
      .no-print { display: none !important; }
      body { background: white; }
      .card { box-shadow: none; border: 1px solid #ddd; page-break-inside: avoid; }
      .section-break { page-break-before: always; }
    }
    /* ... restante do Champagne subset ... */
  </style>
</head>
<body>
  <div class="report">
    <header class="report-head">
      <img src="assets/nicole-logo.png" class="report-logo">
      <h1>Nicole Salon</h1>
      <div class="period">Отчёт за период: ДД.ММ.ГГГГ — ДД.ММ.ГГГГ</div>
      <div class="generated">Сформирован: ДД.ММ.ГГГГ ЧЧ:ММ</div>
    </header>

    <div class="no-print toolbar">
      <button onclick="window.print()">Печать</button>
      <button onclick="window.close()">Закрыть</button>
    </div>

    <section class="summary">
      <!-- 4 big stat cards: receita, renda, despesas, lucro -->
    </section>

    <section class="masters">
      <!-- Per-master breakdown: dias, receita, comissão, salão -->
    </section>

    <section class="services">
      <!-- Per-service breakdown: contagem, gross, master pay, salon pay, % do total -->
    </section>

    <section class="journal section-break">
      <!-- Journal of all attendances + day_summaries unified -->
    </section>

    <section class="finance section-break">
      <!-- Income and expenses tables -->
    </section>

    <footer class="report-foot">
      <span>Nicole Salon · Панель управления</span>
      <span>стр. <span class="pageno"></span></span>
    </footer>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="./config.js"></script>
  <script>
    // Read params, query Supabase, populate sections
    const params = new URLSearchParams(location.search);
    const from = params.get('from');
    const to   = params.get('to');
    // ... use same unifiedTotals logic from index.html ...
    // ... render sections ...
  </script>
</body>
</html>
```

**Modificar** [`index.html`](index.html):

Adicionar botão ao lado do "Экспорт CSV" na aba Отчёты:
```html
<button class="btn btn-sm" onclick="openReportViewer()">Просмотр и печать</button>
```

Função:
```js
function openReportViewer() {
  const from = val('repFrom');
  const to   = val('repTo');
  const params = new URLSearchParams({ from, to });
  window.open('/report?' + params.toString(), '_blank');
}
```

### Considerações de layout

- **Cabeçalho repetido em cada página** (via `@page` + `position: running`): difícil em CSS puro, mas dá para fazer um cabeçalho fixo no topo de cada section com `page-break-inside: avoid`
- **Totais no rodapé de cada tabela** — já temos esse padrão no dashboard, reutilizar
- **Orientação retrato** por padrão; se usuário quiser paisagem para tabelas largas, CSS `@page { size: A4 landscape }` via classe toggle
- **Fonte:** Cormorant para títulos + DM Sans para tabelas (tabular-nums para números alinhados)
- **Cor:** manter paleta Champagne mas reduzir saturação na impressão (var(--ink) já é marrom-grafite, imprime bem); nunca depender só de cor para transmitir informação (ex: usar "+" e "−" além do verde/vermelho)
- **Impressão em preto e branco**: verificar que todos os contrastes funcionam; CSS `@media print and (monochrome)` pode fallback para cinza

### Dependências

Nenhuma. Todo o cálculo reusa `unifiedTotals()` e outras funções que já estão em `index.html` — basta extrair para um arquivo comum ou copiar inline.

Se quiser ir mais longe e gerar PDF server-side (não depende do navegador do usuário), adicionar `puppeteer-core` + `@sparticuz/chromium` numa nova serverless function `/api/report-pdf.js` que retorna um PDF binário. Porém isso aumenta bundle, tempo de cold-start e custo. A abordagem client-side via `window.print()` + "Salvar como PDF" do diálogo nativo do OS é gratuita e funciona em 100% dos browsers modernos.

### Verificação

1. Admin → Отчёты → escolher período "Este mês" → clicar **Просмотр и печать**
2. Nova aba abre com layout A4
3. Todos os dados do período aparecem corretamente
4. `⌘P` (Mac) ou `Ctrl+P` (Windows) → diálogo de impressão
5. Preview mostra quebras de página sensatas, nada cortado no meio
6. Selecionar "Salvar como PDF" no diálogo → PDF salvo funciona como arquivo

### Extensões futuras (se valer a pena)

- **Filtros adicionais:** por mestre específico (parâmetro `?master=<id>`)
- **Comparação com mês anterior:** duas colunas lado a lado, + diferença %
- **Gráficos inline:** reaproveitar os bar charts existentes (funcionam em print se for CSS)
- **Logo customizável** via env var (para futuras franquias)

---

## 3. Histórico de atendimentos para as mestres (no `/register`)

**Goal:** hoje a mestre vê apenas o card "Сегодня" — atendimentos do dia corrente. Adicionar um card "История" abaixo, onde ela pode escolher um período e ver seus próprios atendimentos anteriores, agrupados por dia, com totais diários e do período. Permite que cada mestre acompanhe o próprio faturamento sem depender do admin.

**Por que é útil:** autonomia da mestre; transparência; reduz perguntas do tipo "quanto eu faturei semana passada?".

### Arquitetura

Cliente-only — nenhuma mudança em Supabase nem em serverless functions. A tabela `attendances` já tem RLS `anon SELECT` liberado e o `master_id` fica em sessionStorage após login. Apenas ampliar o range de datas na query.

### Mudanças no código

**Modificar** [`register.html`](register.html):

1. **Novo card "История"** depois do card "Сегодня":
   ```html
   <details class="card history-card" id="historyCard" style="display:none;">
     <summary>
       <h2 style="margin:0;">История</h2>
       <span class="history-caret">▾</span>
     </summary>
     <div class="history-filters">
       <button class="btn-chip" data-days="7">7 дней</button>
       <button class="btn-chip" data-days="14">14 дней</button>
       <button class="btn-chip" data-days="30">30 дней</button>
       <button class="btn-chip" data-custom>…</button>
     </div>
     <div class="history-range" style="display:none;">
       <label>С <input type="date" id="histFrom"></label>
       <label>По <input type="date" id="histTo"></label>
       <button class="btn btn-sm" onclick="loadHistory()">Показать</button>
     </div>
     <ul class="history-days" id="historyList"></ul>
     <div class="total-row" id="historyTotal" style="display:none;">
       <span>Итого за период</span><strong id="historyTotalVal">—</strong>
     </div>
   </details>
   ```

2. **Novo state field:**
   ```js
   state.history = [];   // [{date, count, gross, master_pay, items: [{time, service_name, price, master_pay, payment_method}]}]
   ```

3. **Nova função `loadHistory(days = 7)`:**
   ```js
   async function loadHistory(days) {
     const to = today();
     const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];
     const { data, error } = await sb
       .from('attendances')
       .select('date, time, service_name, price, master_pay, payment_method')
       .eq('master_id', session.masterId)
       .gte('date', from)
       .lte('date', to)
       .order('date', { ascending: false })
       .order('time', { ascending: false });
     if (error) { toast('Ошибка истории: ' + error.message, true); return; }

     // Group by date
     const byDate = new Map();
     for (const r of data || []) {
       const day = byDate.get(r.date) || { date: r.date, items: [], gross: 0, master_pay: 0 };
       day.items.push(r);
       day.gross += Number(r.price);
       day.master_pay += Number(r.master_pay);
       byDate.set(r.date, day);
     }
     state.history = Array.from(byDate.values());
     renderHistory();
   }
   ```

4. **Render por dia, com toggle para expandir items:**
   ```html
   <li class="history-day">
     <button class="history-day-head" onclick="toggleDay(this)">
       <span class="history-day-date">[fmtDate(d.date)]</span>
       <span class="history-day-totals">[fmt(d.gross)] · моё [fmt(d.master_pay)]</span>
       <span class="history-caret">▾</span>
     </button>
     <ul class="history-day-items" hidden>
       [items — mesmo layout da att-list atual]
     </ul>
   </li>
   ```
   Total do período vai no `.total-row` no rodapé do card.

5. **Integração ao fluxo:**
   - Mostrar `historyCard` depois do login (em `showEntryUI()`)
   - Preset default: 7 dias carregados ao abrir (ou carrega só ao expandir o `<details>` — economiza queries)
   - Quando salvar um novo atendimento, invalidar `state.history` (ou re-fetchear só o dia de hoje no histórico)

### CSS adicional

- `.history-card > summary` com cursor pointer, espaçamento consistente com `.ocr-box`
- `.btn-chip` — pílulas compactas para os presets 7/14/30 dias (estilo do theme swatches do admin)
- `.history-day-head` — linha clicável full-width com data à esquerda, totais à direita, chevron que rotaciona
- `.history-day-items[hidden]` oculto; toggle adiciona/remove o atributo
- Na impressão (`@media print`), expandir tudo automaticamente

### Considerações

- **Performance:** 30 dias × ~10 atendimentos/dia = 300 rows; pequeno, sem paginação necessária. Se crescer muito: adicionar `.limit(500)` e mostrar "ver mais" para carregar próximo chunk.
- **Privacy:** a query é filtrada por `master_id = session.masterId`. RLS já permite anon SELECT em attendances mas o filtro é obrigatório aqui para não vazar dados de outras mestres. Considerar mudar a RLS policy para restringir SELECT por master_id via Supabase RLS avançado (futuro).
- **Offline:** não há cache — se estiver sem internet, histórico não carrega. Acceitable para um app mobile conectado.

### Verificação

1. Logar como Людмила, registrar alguns serviços
2. Abrir "История" → 7 dias selecionado por padrão
3. Ver a lista de dias, cada um com total; expandir um dia → lista de serviços
4. Trocar para 30 dias → lista cresce
5. "Personalizar" com from/to arbitrários → funciona
6. Logar como Ирина em outra aba → NÃO vê atendimentos da Людмила

---

## 4. Sistema de agendamento de serviços

**Goal:** permitir que o admin (e opcionalmente as mestres) agendem atendimentos futuros. O admin tem uma agenda visual de serviços agendados para os próximos dias. Ao chegar o dia e ser atendido, o agendamento "gradua" para uma linha em `attendances`.

**Por que é útil:** hoje o registro é só retroativo (OCR ou /register após o serviço). Com agendamento: planejamento do dia, visibilidade de quanto está reservado para a semana, menos no-shows com lembretes, pipeline de receita futura.

### Arquitetura

Nova tabela `appointments` + novas telas (admin e opcional no pro). Agendamento tem um ciclo de vida: `scheduled → confirmed → completed | cancelled | no_show`.

```
[Admin cria agendamento]
       │
       ▼
   scheduled ─── cliente confirma ──▶ confirmed
       │                                  │
       │ cliente cancela                  │ no show (auto-marca após fim do dia?)
       ▼                                  ▼
   cancelled                         no_show
                                          
[No dia, cliente é atendido]
       │
       ▼
   completed ──▶ cria linha em attendances (atomicamente)
```

### Schema — `supabase/migrations/003_appointments.sql`

```sql
create table if not exists appointments (
  id                bigserial primary key,
  scheduled_at      timestamptz not null,
  duration_minutes  integer,
  master_id         bigint not null references masters(id) on delete restrict,
  service_id        bigint references services(id) on delete set null,
  service_name      text,                         -- snapshot
  estimated_price   numeric(12,2),
  client_name       text,
  client_phone      text,
  status            text not null default 'scheduled',   -- scheduled|confirmed|completed|cancelled|no_show
  attendance_id     bigint references attendances(id) on delete set null,  -- link when completed
  note              text,
  created_at        timestamptz not null default now(),
  created_by        text                          -- 'admin' | 'master:<id>' for audit
);
create index if not exists appointments_scheduled_idx on appointments(scheduled_at);
create index if not exists appointments_master_idx   on appointments(master_id);
create index if not exists appointments_status_idx   on appointments(status);

alter table appointments enable row level security;

-- Anon can SELECT (admin + mestre read their own via master_id filter).
-- Writes only via /api/appointment (service-role) — admin operations are gated by ADMIN_PASSWORD.
drop policy if exists "anon_select_appointments" on appointments;
create policy "anon_select_appointments" on appointments for select to anon using (true);
drop policy if exists "authed_select_appointments" on appointments;
create policy "authed_select_appointments" on appointments for select to authenticated using (true);
```

### Serverless endpoints

**Criar** `api/appointment.js`:

Métodos HTTP distintos:

- **POST** — criar novo agendamento. Gate: se body.created_by === 'admin', exigir `admin_password`; se 'master:<id>', exigir `pin`.
- **PATCH** — atualizar status (confirm, cancel, no_show). Gate: idem.
- **POST /complete** — marcar como completed E criar `attendance` atomicamente. Calcula `master_pay` via `master_services`. Gate: admin_password OU mestre PIN.

Body POST:
```json
{
  "scheduled_at": "2026-05-01T14:00:00",
  "master_id": 1,
  "service_id": 2,
  "estimated_price": 5000,
  "client_name": "Мария",
  "client_phone": "+7...",
  "note": "первое посещение",
  "created_by": "admin",
  "admin_password": "..."
}
```

Body complete:
```json
{
  "id": 123,
  "final_price": 5200,  // may differ from estimated
  "payment_method": "Карта",
  "admin_password": "..." // or pin + master_name para master self-complete
}
```

### UI admin — nova aba "Агенда"

Adicionar aba `<div class="tab" data-section="schedule">Агенда</div>`.

Layout:
- **Calendário visual** (semana ou mês) com blocos de agendamentos
- Filtro por mestre
- Form inline para criar novo:
  - Data + hora
  - Mestre (dropdown)
  - Serviço (dropdown com preços auto-fill de master_services)
  - Cliente (nome + telefone)
  - Nota
- Cada agendamento tem botões: **Подтверждено** (→ confirmed), **Выполнено** (→ completed + cria attendance), **Отмена** (→ cancelled)

**Implementação progressiva:**
1. **MVP:** lista simples agrupada por dia (sem calendário visual) — entrega 80% do valor
2. **v2:** calendário tipo grid de 7 colunas × horas (tipo Google Calendar)
3. **v3:** drag-and-drop para reagendar

### UI pro — seção "Мои записи"

Novo card no `/register` (depois de "История"):
- Lista de agendamentos da mestre logada, filtrados `scheduled_at >= now() AND status IN ('scheduled','confirmed')`
- Ordenado por `scheduled_at` asc
- Cada item: data/hora + cliente + serviço + preço estimado + botão **Выполнено**
- Botão cria attendance via `/api/appointment` (método complete) + atualiza status

### Notificações (integra com Telegram — Seção 1)

Quando agendamento é criado ou status muda:
- Admin recebe no Telegram: "Nova reserva: Мария, Окрашивание, 01.05 às 14:00 com Людмила"
- Mestre recebe lembrete no Telegram dia-antes das 20:00 (via cron Vercel — tem "Scheduled Functions" beta) ou Supabase Edge Function com `pg_cron`

### Tabela de clientes (opcional, futuro)

Se quiser CRM básico, adicionar tabela `clients` com histórico:
```sql
create table clients (
  id bigserial primary key,
  name text not null,
  phone text,
  email text,
  first_visit date,
  last_visit date,
  total_visits integer default 0,
  total_spent numeric(12,2) default 0,
  note text,
  created_at timestamptz default now()
);
```
`appointments.client_id` referenciaria `clients.id` em vez de só `client_name`.

### Files a criar/modificar

**Criar:**
- `supabase/migrations/003_appointments.sql`
- `api/appointment.js` (POST / PATCH / complete)

**Modificar:**
- `supabase/schema.sql` (incluir DDL para fresh installs)
- `index.html` — nova aba "Агенда", seção, JS para CRUD + calendar render
- `register.html` — novo card "Мои записи"
- `README.md` — documentar fluxo

### Verificação

1. Migration rodada, tabela appointments criada
2. Admin → aba Агенда → criar agendamento para Людмила amanhã 14:00, Окрашивание, Мария
3. Aparece na lista da Агенда
4. Logar como Людмила no `/register` → ver "Мои записи" com o agendamento
5. No dia, admin clica **Выполнено** no agendamento → cria attendance com commission correta, status vira 'completed', appointments.attendance_id linka
6. Aba Отчёты → attendance aparece normalmente
7. (Se Telegram ativo) receber notificação da criação e da conclusão

### Considerações

- **Complexidade:** essa feature é 5–10× maior que o Telegram. Planejar sprint dedicada.
- **Timezone:** usar `timestamptz` no schema; no browser converter para TZ local (salão no fuso de Moscou?).
- **Conflitos:** validar no servidor que `master_id + scheduled_at` não sobrepõe outro (+duration) já existente (não-cancelado).
- **Performance:** paginar listas por intervalo de datas visível na tela; não carregar tudo.
- **UX mobile:** calendário visual é difícil em telefone — manter fallback de lista.

---

## Prioridade sugerida

| # | Feature | Esforço | Valor | Ordem |
|---|---|---|---|---|
| 1 | Telegram notifications | ~1h | Alto (admin real-time) | **Primeiro** — baixa superfície, retorno imediato |
| 3 | Histórico no /register | ~2h | Médio-alto (autonomia das mestres) | **Segundo** — client-only, sem novo endpoint |
| 2 | Relatório visual + impressão | ~3–4h | Médio (entregável externo) | **Terceiro** — refinamento de layout |
| 4 | Agendamento | ~1–2 semanas | Muito alto (nova capability) | **Quarto** — projeto dedicado, mudanças arquiteturais |

Boa ordem: quick wins primeiro (1 → 3 → 2), depois projeto dedicado para o 4.
