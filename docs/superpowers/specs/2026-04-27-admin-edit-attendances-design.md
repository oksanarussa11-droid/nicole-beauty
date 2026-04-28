# Admin edição/exclusão/criação retroativa de atendimentos — Design

**Data:** 2026-04-27
**Status:** Aprovado pelo usuário, pronto para planejamento

## Motivação

Masters solicitaram poder editar/apagar seus próprios lançamentos de atendimentos no app delas. Isso é um anti-padrão: quem registra não deve poder alterar silenciosamente — abre porta para manipulação de comissões. Solução: a administradora corrige lançamentos errados a pedido, com auditoria completa e notificação automática no Telegram.

## Escopo

- Admin pode **editar todos os campos** de um atendimento (data, hora, master, serviço, preço, fonte de produtos, cliente, pagamento, observação).
- Admin pode **apagar** (soft delete).
- Admin pode **restaurar** linhas apagadas.
- Admin pode **criar lançamento retroativo** em nome de qualquer master.
- Toda ação dispara auditoria em tabela dedicada e notificação Telegram.
- Acesso protegido por re-autenticação ("modo edição") válida por 15 min.

## Modelo de dados

### Alterações em `attendances`

```sql
ALTER TABLE attendances
  ADD COLUMN deleted_at timestamptz NULL,
  ADD COLUMN edited_at timestamptz NULL;

CREATE INDEX attendances_deleted_at_idx ON attendances (deleted_at);
```

`source` (já existente) ganha novo valor possível: `'admin_retro'` para retroativos criados por admin.

Todas as queries existentes que listam atendimentos (no painel e no app da master) recebem filtro `deleted_at IS NULL`. Locais a atualizar:
- `Nicole_Beauty_Панель.html` → `loadAttendancesForMonth()`
- `register.html` (histórico pessoal da master) — verificar todos selects de `attendances`

### Nova tabela `attendance_audit`

```sql
CREATE TABLE attendance_audit (
  id              bigserial PRIMARY KEY,
  attendance_id   bigint NOT NULL,
  action          text   NOT NULL CHECK (action IN ('create_retro','update','delete','restore')),
  actor           text   NOT NULL DEFAULT 'admin',
  actor_ip        text,
  before          jsonb,           -- snapshot completo da linha antes (NULL para create_retro)
  after           jsonb,           -- snapshot completo depois (NULL para delete)
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendance_audit_att_idx     ON attendance_audit (attendance_id);
CREATE INDEX attendance_audit_created_idx ON attendance_audit (created_at DESC);
```

RLS: apenas service-role escreve/lê. Anon não enxerga.

## API

Todos os endpoints novos seguem o padrão de `api/attendance.js`: serverless Vercel, service-role key, validação server-side, sem confiar em valores derivados vindos do cliente.

### `POST /api/admin-session`

Destrava modo edição.

**Request:** `{ admin_password }`

**Response (200):** Set-Cookie HTTP-only assinado (HMAC-SHA256 com segredo de env var, payload `{exp: <unix-ts>}`), expira em 15 min. Body: `{ ok: true, expires_at }`.

**Errors:** 401 senha inválida, 429 rate-limit (5 falhas/min por IP).

### `POST /api/admin-attendance`

Operação unificada CRUD.

**Auth:** aceita ou cookie de sessão admin válido **ou** `admin_password` no body (para chamadas avulsas/scripts). Cada uso bem-sucedido renova o cookie por mais 15 min.

**Body:**
```json
{
  "action": "create" | "update" | "delete" | "restore",
  "id": 123,                    // obrigatório exceto em create
  "fields": {                   // obrigatório em create/update
    "date": "YYYY-MM-DD",
    "time": "HH:MM:SS",
    "master_id": 1,
    "service_id": 5,
    "price": 1500,
    "uses_salon_products": false,
    "client_name": "...",
    "payment_method": "...",
    "note": "..."
  },
  "reason": "texto opcional"
}
```

**Lógica por ação:**

- **create:** valida `master_id`+`service_id` em `master_services`, escolhe `commission_master_pct` ou `commission_master_pct_salon` conforme `uses_salon_products`, aplica `MAX_PRICE_MULTIPLIER` (10× preço de catálogo), calcula `master_pay`. Insere com `source='admin_retro'`. Audit `before=null, after=<linha>`.

- **update:** lê linha atual (incluindo apagadas? não — bloqueia update de linha com `deleted_at`). Snapshot `before`. Se algum dos campos `price`, `service_id`, `master_id`, `uses_salon_products` mudou, **recalcula `master_pay` e `commission_pct`** com a mesma lógica do create. Atualiza linha + `edited_at=now()`. Audit `before/after`.

- **delete:** SET `deleted_at=now()` (idempotente — se já apagada, retorna ok). Audit `before=<linha>, after=null`.

- **restore:** SET `deleted_at=null` apenas se atualmente apagada. Audit `before=<apagada>, after=<restaurada>`.

**Response:** `{ ok: true, id, master_pay?, commission_pct? }` (quando aplicável).

**Telegram:** toda ação bem-sucedida dispara mensagem com prefixo distintivo:
- ➕ *Ретро-запись* — admin criou retroativo
- 🛠️ *Админ-правка* — admin editou (lista campos alterados: `Цена: 1500 → 1800`)
- 🗑️ *Админ-удаление* — admin apagou
- ↩️ *Восстановление* — admin restaurou

Mensagem inclui: nome da master afetada, serviço, valores relevantes, motivo se houver. Mesmo padrão de timeout/await do `attendance.js`.

### `GET /api/admin-audit`

Lista entradas de auditoria.

**Query:** `from=YYYY-MM-DD&to=YYYY-MM-DD&master_id=&action=&limit=100&offset=0`

**Auth:** mesma do `admin-attendance`.

**Response:** `{ rows: [...], total }`. Cada row inclui `before`, `after`, e — quando possível — join com `masters.name` e `services.name` resolvidos a partir dos snapshots para apresentação amigável.

## UI no painel (`Nicole_Beauty_Панель.html`)

### Inline na aba Финансы

- Cada linha de atendimento ganha botões à direita: ✏️ editar, 🗑️ apagar.
- Toggle no topo da lista: "Показать удалённые" — quando ativo, inclui linhas com `deleted_at`, mostra-as riscadas com botão ↩️ restaurar.
- Botão fixo no topo da seção: **"+ Ретро-запись"**.

### Modais

Todos no mesmo estilo HTML/CSS do painel atual, sem dependências novas.

- **Editar:** form com todos os campos pré-preenchidos. Mostra preview ao vivo do `master_pay` e `%` recalculados conforme o usuário altera preço/serviço/master/fonte de produtos (cálculo client-side só para preview; servidor é a fonte da verdade). Campo opcional `Причина правки`. Botão Salvar → POST `/api/admin-attendance`.
- **Apagar:** confirmação com resumo da linha (data, master, serviço, preço, cliente). Campo `Причина` opcional. Botão Подтвердить.
- **Ретро-запись:** mesmo form do editar, sem ID. Date/time defaults = agora, editáveis. Master e serviço obrigatórios.

### Modo edição

Primeira ação destrutiva da sessão abre modal "Введите пароль администратора" → POST `/api/admin-session` → cookie set → modal real abre encadeado. Próximas 15 min: ações abrem direto.

Indicador discreto no topo do painel quando ativo:
`🔓 Режим правки активен (осталось 12 мин)`

Botão de "Заблокировать" para encerrar modo edição manualmente (limpa cookie via novo endpoint `POST /api/admin-session/end` ou simplesmente expira no client e ignora o cookie).

### Nova aba "Журнал правок"

Tabela paginada com filtros (período padrão = mês corrente; master; ação).

Colunas: `Когда | Кто | Действие | Запись (master/услуга) | Сводка изменений | Причина`.

Linha clicável expande in-place mostrando diff JSON `before` vs `after` com campos alterados em destaque visual (verde=novo, vermelho=antigo).

## Segurança

- Senha admin nunca trafega em clear via GET; sempre POST body.
- Cookie de sessão é HTTP-only, `SameSite=Strict`, `Secure` em produção.
- HMAC do cookie usa `ADMIN_SESSION_SECRET` (nova env var Vercel).
- Rate-limit em `/api/admin-session` (5 falhas/min/IP), reusando padrão de `pin_attempts` adaptado para admin (nova tabela `admin_login_attempts` ou reuso de `pin_attempts` com `master_id=NULL` — decidir no plano).
- `MAX_PRICE_MULTIPLIER` aplicado em create e update.
- Todas as escritas via service-role; RLS em `attendance_audit` bloqueia anon.

## Migrações

Uma migração em `supabase/migrations/` adicionando colunas em `attendances`, criando `attendance_audit` e índices, e ajustando RLS.

## Fora de escopo

- Multi-admin com identidades distintas (campo `actor` fica `'admin'` por enquanto; design preparado para evoluir).
- UI no app das masters (`register.html`) para solicitar correção formalmente — por ora, comunicação verbal/Telegram.
- Reverter automaticamente uma edição (no MVP a admin re-edita manualmente; o diff visível ajuda).
- Exportar log de auditoria (CSV/PDF) — adicionar depois se necessário.
