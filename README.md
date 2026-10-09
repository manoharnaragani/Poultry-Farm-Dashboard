# Poultry Farm Management — Independent Poultry Farm Management System

Poultry Farm Management is a student-friendly full-stack poultry farm management project.
It uses its own email/password login and stores all data in PostgreSQL, so the same records are visible from any device once deployed.

## Stack
- Frontend: HTML/CSS/JavaScript rendered through Vite
- Backend: Node.js + Express
- Authentication: Email/password sessions with Node `crypto.scrypt` and session tokens in PostgreSQL
- Data: PostgreSQL (tables are created automatically on first start; no JSON fallback)
- Charts/UI: custom CSS + vanilla JavaScript

## Features
- Secure email/password sign in and sign out
- Continue with Google for sign in and signup (OAuth configuration required; see DEPLOY.md)
- Explicit Google linking for existing password accounts
- Staff account registration
- Dashboard with eggs, sales, expenses, mortality, workers, and feed stock
- Workers, attendance, worker payments, assignments, daily wages
- Feed stock, feed usage, feed purchases
- Egg production and mortality records
- Tray sales and expenses
- Shed overview and farm settings
- Create, edit, delete records with validation
- Persistent shared data in PostgreSQL
- Empty dashboard when signed out; sign in to access farm records

## Admin account
For development, the default administrator is `admin@poultry-farm-management.local` / `Admin@123`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` to change it (required when deployed online).

## Run in VS Code
1. Get a PostgreSQL database and create `.env` (see `SETUP-DATABASE.md`).
2. Then:
```powershell
pnpm install
pnpm dev
```
Open `http://localhost:3000/`. To go online see `DEPLOY.md`.

## Project structure
```text
client/             frontend
server/             Express server and authentication
server/db/          PostgreSQL connection, tables, repository
scripts/            import-json.js (optional one-time migration of legacy JSON into PostgreSQL)
```

## View and export historical data

Open any record section and select From date / To date, or use Today, Yesterday, Last 7 days, Last 30 days, or Previous month. Last 7 and 30 days include today; Previous month selects the entire previous calendar month. Search and shed/status filters also apply to **Export CSV**. Downloads include all matching records, not just the visible table page.

Open **Finance & farm > Reports** for a combined farm CSV or individual section exports. Choose a period and optionally a shed. Shed reports include records explicitly assigned to that shed; shared sales, feed purchases, and attendance/payments without a recorded shed are included only in overall farm reports. Selecting a shed does not guess historical worker assignments.

Files use UTF-8 with an Excel-compatible BOM, ISO dates, and recorded numbers. User-entered text that could execute spreadsheet formulas is escaped. Exports do not modify stored records.

Run `pnpm test:exports` to check export formatting, ranges, pagination-independent records, and shed scope.
