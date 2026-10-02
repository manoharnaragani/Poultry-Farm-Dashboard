# NestLedger — Independent Poultry Farm Management System

NestLedger is a student-friendly full-stack poultry farm management project.
It uses its own email/password login and stores all data in PostgreSQL, so the same records are visible from any device once deployed.

## Stack
- Frontend: HTML/CSS/JavaScript rendered through Vite
- Backend: Node.js + Express
- Authentication: Email/password sessions with Node `crypto.scrypt` and session tokens in PostgreSQL
- Data: PostgreSQL (tables are created automatically on first start; no JSON fallback)
- Charts/UI: custom CSS + vanilla JavaScript

## Features
- Secure sign in and sign out
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
For development, the default administrator is `admin@nestledger.local` / `Admin@123`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` to change it (required when deployed online).

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
