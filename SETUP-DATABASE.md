# Set up the PostgreSQL database

NestLedger stores all farm data in PostgreSQL. The tables are created automatically the first
time the app starts, so you only need an empty database and its connection string.

## Step 1: Get a free PostgreSQL database (online)

Any PostgreSQL provider works. Free options include Neon (neon.com), Supabase (supabase.com)
and Render PostgreSQL. Check each provider's current free-tier limits.

1. Create an account and a new project/database (choose a region close to you, e.g. Mumbai/Singapore).
2. Find the **connection string**. It starts with `postgresql://`.
3. Copy it.

## Step 2: Create the `.env` file

1. In the project folder, copy `.env.example` to a new file named `.env`
2. Open `.env` and replace the `DATABASE_URL=` line with your connection string:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

`.env` holds your database password. Never upload it to GitHub or share it.

## Step 3: Run

```bash
pnpm install
pnpm dev
```

(or `npm install` and `npm run dev`). Open http://localhost:3000, sign in with
`admin@nestledger.local` / `Admin@123`, and the app is running on PostgreSQL.
To use a different admin login, add `ADMIN_EMAIL` and `ADMIN_PASSWORD` to `.env`.

## Migrating legacy data (optional one-time import)

Storage in NestLedger is PostgreSQL only. If you have legacy data from an older JSON export, you can import it once:

```bash
node scripts/import-json.js path/to/data.json
```

- Safe to run again: records are matched by ID and updated, never duplicated.
- Sheds, feed stock and farm settings are replaced by the file's values.
- Staff accounts are imported with their existing passwords.
- Anything it cannot import (e.g. attendance for a worker that no longer exists) is listed.

## Good to know

- **Local and online share one database** if you use the same `DATABASE_URL`. Everything you
  enter while testing appears on the live site. For safe testing, create a second database
  (or a branch) and use its string in your local `.env`.
- Free databases may "sleep" when idle; the first request after a pause can take a few seconds.
- Back up: most providers offer backups or point-in-time restore. You can also export with
  `pg_dump` (part of the PostgreSQL tools).
- If you see `Could not start: ...` in the terminal, the message says what is wrong
  (usually a wrong password or a missing `.env`).
- If your provider's certificate is rejected, add `DATABASE_SSL=no-verify` to `.env`.

## Optional: PostgreSQL on your own computer

Install PostgreSQL from postgresql.org, create a database (e.g. `nestledger`), and use:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/nestledger
```

Data then lives only on that computer, so use an online database if you want to see it
from other devices.
