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

Changing `ADMIN_PASSWORD` in Render resets the admin password. Unchanged bootstrap settings do not override later profile changes.

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

## Google sign-in and authentication setup

This site uses server-side Google OpenID Connect with PKCE, one-use state, a nonce, and signed ID-token verification. Google tokens never go to browser storage. App sessions use HttpOnly cookies, Secure in production, and only hashed session tokens are stored in PostgreSQL.

1. In Google Cloud / Google Auth Platform, configure branding and audience, then create an OAuth client with application type **Web application**. Request only `openid`, `email`, and `profile`.
2. For the current live site, register this exact authorized redirect URI:
   `https://nestledger-b41v.onrender.com/api/auth/google/callback`
   For local development, optionally add `http://localhost:3000/api/auth/google/callback`.
3. Add these in **Render > Environment**:
   - `APP_URL=https://nestledger-b41v.onrender.com`
   - `GOOGLE_CLIENT_ID=<web application client ID>`
   - `GOOGLE_CLIENT_SECRET=<client secret>`
   - `ALLOW_REGISTRATION=true` if new users should be able to sign up. The existing default is false. Registration creates staff accounts with access to this shared farm, not separate private farms.
4. If the Google app is in Testing, add the intended Google accounts as test users. Before general use, configure the appropriate production audience in Google.
5. Push the changes and deploy the latest commit. Google buttons remain disabled until all three Google settings are configured. Keep the client secret in Render, never in GitHub or the client bundle.
6. For an existing password account, sign in first and choose **My Account > Connect Google account** with the same email. A verified Google email alone never takes over an existing password account.

Verification: `pnpm test:auth` tests local signup, login, logout, sessions, duplicates, profile changes, and Google redirects/callbacks with cryptographically signed test identity tokens. It uses the configured database, creates temporary records inside a rolled-back transaction, and applies additive schema migrations. Real Google consent and Render redirects still require a manual live check after credentials are configured.

Live acceptance check: sign up with a permitted email, sign out, sign in with a password, connect matching Google, sign out again and Continue with Google. Test a new Google account, cancellation, duplicates, incorrect passwords, and logout.

References:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/openid-connect/reference
