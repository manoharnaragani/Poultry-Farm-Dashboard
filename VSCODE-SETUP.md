# Run NestLedger in VS Code

1. Install Node.js 22+ and pnpm (`npm install -g pnpm`).
2. Get a PostgreSQL database and create `.env` (see SETUP-DATABASE.md).
3. File -> Open Folder -> choose the `NestLedger` folder (the one with `package.json`).
4. Terminal -> New Terminal, then:
   ```bash
   pnpm install
   pnpm dev
   ```
5. Open http://localhost:3000 and sign in (`admin@nestledger.local` / `Admin@123`).

Production test on your computer: `pnpm build` then `pnpm start`
(set `ADMIN_EMAIL` and `ADMIN_PASSWORD` first, see DEPLOY.md).

Troubleshooting
- `Could not start: DATABASE_URL is not set` -> create the `.env` file.
- `ECONNREFUSED` / password errors -> re-copy the connection string from your provider.
- PowerShell "scripts disabled" -> use Command Prompt, or run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
