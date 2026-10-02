# Deploy NestLedger online (Render example)

Your data lives in PostgreSQL, so the web host needs **no persistent disk**, and redeploying
never touches your data. Do Steps 1 and 2 of SETUP-DATABASE.md first (get a database and its connection string).

## 1. Put the project on GitHub
Create a GitHub account, then a **private** repository, and upload this project.
Do NOT upload `.env` or `node_modules` (`.gitignore` already skips them).

## 2. Create the service on Render
- New -> Web Service -> connect your GitHub repo
- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Choose an instance type (free instances sleep when idle; check Render's current plans)

## 3. Environment variables
| Key | Value |
|---|---|
| NODE_VERSION | 22 |
| DATABASE_URL | your PostgreSQL connection string |
| ADMIN_EMAIL | your email (creates the admin login on first start) |
| ADMIN_PASSWORD | a strong password (12+ characters) |
| ADMIN_NAME | your name |
| ALLOW_REGISTRATION | false |

Changing `ADMIN_PASSWORD` later and redeploying resets the admin password.

## 4. Deploy, then open the https://....onrender.com link and sign in.
Staff accounts: set `ALLOW_REGISTRATION=true` briefly, let staff register, then set it back to `false`.

## Optional: Moving legacy data
Storage is PostgreSQL only. If you have legacy data from an older JSON export, run the migration script from your computer while `.env` points at the database:
`node scripts/import-json.js path/to/data.json` (see SETUP-DATABASE.md).

## Safety checklist
- Strong `ADMIN_PASSWORD`, `ALLOW_REGISTRATION=false`
- Never share `DATABASE_URL`
- Turn on backups in your database provider

## Deploy using the included Render Blueprint

1. Push this folder to your GitHub repository. Keep `.env` and `node_modules` out of the repository.
2. In Render, choose **New > Blueprint** and select the repository. Render reads `render.yaml`.
3. Enter `DATABASE_URL` from your existing local `.env` to keep your current farm records. Enter your admin email, a strong admin password, and admin name. These values stay in Render, not the repository.
4. Deploy and wait for the health check to pass. Open the generated HTTPS service URL and sign in.
5. If your local database connection needs `DATABASE_SSL=no-verify`, configure the same setting in Render only when necessary.

The Blueprint selects the free web service plan. See https://render.com/docs/free for current limitations. No new database is created.
