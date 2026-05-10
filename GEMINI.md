# Nicole Beauty — Project Context & Instructions

Management system for a beauty salon. Tracks revenue, services, masters, commissions, and finances. Includes an OCR feature for digitizing physical reports and a dedicated master self-service portal.

## Project Overview

-   **Domain:** Beauty Salon Management (Masters, Services, Pricing, Daily Results, Income/Expenses, Inventory, Reports).
-   **Tech Stack:**
    -   **Frontend:** Vanilla HTML/CSS/JS (Single-page application style).
    -   **Backend:** Node.js Serverless Functions (Vercel).
    -   **Database:** Supabase (PostgreSQL) with Row Level Security (RLS).
    -   **OCR:** Anthropic Claude Vision API (Sonnet 3.5/3.7) for report recognition.
    -   **Hosting:** Vercel (dual-project setup for Admin and Pro/Master sites).
-   **Architecture:**
    -   `index.html`: Admin Dashboard (Revenue, Agenda, Masters, Services, Finance, Reports).
    -   `register.html`: Master Self-Service Portal (PIN login, recording services).
    -   `report.html`: Print-optimized reporting interface.
    -   `api/`: Serverless functions for sensitive logic (PIN validation, database writes, OCR).
    -   `supabase/`: Database schema, migrations, and configuration.

## Environment & Configuration

-   **`config.js`**: Automatically switches between local Supabase (127.0.0.1:54321) and production URLs based on `location.hostname`.
-   **Vercel Env Vars**:
    -   `SUPABASE_URL`: Public Supabase API URL.
    -   `SUPABASE_SERVICE_ROLE_KEY`: Secret key for serverless functions (bypasses RLS).
    -   `ADMIN_PASSWORD`: For setting master PINs and sensitive admin actions.
    -   `ADMIN_SESSION_SECRET`: For HMAC-signed admin session cookies.
    -   `ANTHROPIC_API_KEY`: For OCR functionality.
    -   `SITE`: Set to `pro` on the master-facing Vercel project to swap `register.html` for `index.html`.

## Key Commands

### Local Development

-   **Full Stack (Functions + Static):**
    ```bash
    vercel dev
    ```
-   **Static Only:**
    ```bash
    python3 -m http.server 8000
    ```
-   **Database (Supabase CLI):**
    ```bash
    supabase start       # Start local Docker-based stack
    supabase db reset    # Reset local DB and apply all migrations
    ```

### Database Management

-   **New Migration:** `supabase migration new <name>`
-   **Push to Production:** `supabase db push`

### Deployment

-   **Preview:** `vercel`
-   **Production:** `vercel --prod` (or push to `main` for auto-deploy)

## Development Conventions

-   **Security First:**
    -   Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client. Use it only in `api/` functions.
    -   Client-side operations use the `anon` key and rely on Supabase RLS.
    -   Master authentication uses PINs hashed with `scrypt` (`crypto` module).
-   **Surgical Edits:** Favor atomic changes. When adding features, check `ROADMAP.md` for pre-designed specifications.
-   **Database Integrity:** All schema changes must be recorded as migrations in `supabase/migrations/`. Use idempotent SQL (`IF NOT EXISTS`, `OR REPLACE`).
-   **Dual-Site Strategy:** The repo serves two sites. The `buildCommand` in `vercel.json` handles the swap:
    ```bash
    if [ "$SITE" = "pro" ]; then cp register.html index.html; fi
    ```
    Keep this in mind when modifying `index.html` or `register.html`.
-   **UI/UX:**
    -   Language: Russian (`ru`).
    -   Typography: Cormorant (serif) for headings, DM Sans (sans-serif) for body/tables.
    -   Palette: "Champagne" (creams, golds, dark browns).

## Key Files & Directories

-   `api/`: Vercel serverless functions (Node.js).
-   `supabase/schema.sql`: Source of truth for the database schema.
-   `supabase/migrations/`: Incremental schema updates.
-   `docs/`: Design specs and UX reviews.
-   `ROADMAP.md`: Backlog of planned features with implementation guides.
-   `vercel.json`: Deployment configuration (clean URLs, rewrites, headers).

## Roadmap & Future Features

Refer to `ROADMAP.md` for details on:
1. Telegram Notifications (Bot API).
2. Print-optimized reports (Visual improvements).
3. Attendance history for masters.
4. Appointment/Scheduling system.
