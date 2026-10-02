import crypto from 'node:crypto';
import { query, withTx } from './db/pool.js';
import { hashPassword, verifyPassword, hashToken, parseCookies, validEmail, validPassword, validName, cookie, sameOrigin } from './authSecurity.js';
import { registerGoogleRoutes } from './googleAuth.js';
const SESSION_COOKIE = 'nestledger_session';
const isProd = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const publicUser = (user) => user ? { id: user.id, name: user.name, email: user.email, role: user.role, googleLinked: Boolean(user.google_sub), hasPassword: Boolean(user.password_hash) } : null;
const fail = (res, status, message) => res.status(status).json({success:false,message});
const ah = (fn) => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
export async function createSession(db, userId, previousToken) {
  if (previousToken) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(previousToken)]);
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [hashToken(token),userId,new Date(Date.now()+604800000)]);
  return token;
}
// Reuse existing administrator accounts and reject staff-email conflicts clearly.
export async function initializeAdmin(db, { email, password = '', name = 'Farm Admin', production = false, explicitEmail = true }) {
  const adminEmail = String(email || 'admin@nestledger.local').trim().toLowerCase();
  // Serialize startup on multiple application instances.
  await db.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
  const { rows } = await db.query("SELECT * FROM users WHERE id = 'USR-ADMIN' OR lower(email) = $1 FOR UPDATE", [adminEmail]);
  const matching = rows.find((user) => user.email.toLowerCase() === adminEmail);
  if (matching && matching.role !== 'admin') {
    throw new Error('ADMIN_EMAIL belongs to an existing staff account. In Render Environment, use the email of your existing administrator or an unused email, then redeploy.');
  }
  const admin = matching || rows.find((user) => user.id === 'USR-ADMIN');
  if (!admin) {
    if (production && (!explicitEmail || !password)) {
      throw new Error('First start: set ADMIN_EMAIL and ADMIN_PASSWORD environment variables to create the admin account.');
    }
    await db.query(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES ('USR-ADMIN', $1, $2, $3, 'admin')",
      [name, adminEmail, await hashPassword(password || 'Admin@123')],
    );
    await db.query('INSERT INTO meta (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', ['admin-bootstrap:USR-ADMIN',JSON.stringify({email:adminEmail,passwordHash:await hashPassword(password || 'Admin@123')})]);
    return;
  }
  const bootstrapKey = `admin-bootstrap:${admin.id}`;
  const bootstrapRow = (await db.query('SELECT value FROM meta WHERE key=$1',[bootstrapKey])).rows[0];
  let bootstrap = null;
  try { bootstrap = bootstrapRow ? JSON.parse(bootstrapRow.value) : null; } catch {}
  // A profile change must survive restarts. Apply environment credentials only when configuration changes.
  const passwordChanged = password && (!bootstrap?.passwordHash || !await verifyPassword(password, bootstrap.passwordHash));
  if (passwordChanged && !await verifyPassword(password, admin.password_hash)) {
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), admin.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [admin.id]);
  }
  if (explicitEmail && bootstrap?.email !== adminEmail && admin.email.toLowerCase() !== adminEmail) {
    await db.query('UPDATE users SET email = $1 WHERE id = $2', [adminEmail, admin.id]);
  }
  await db.query('INSERT INTO meta (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',[bootstrapKey,JSON.stringify({email:explicitEmail ? adminEmail : bootstrap?.email,passwordHash:passwordChanged ? await hashPassword(password) : bootstrap?.passwordHash})]);
}
export async function initAuth() {
  await withTx((db) => initializeAdmin(db, {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD || '',
    name: process.env.ADMIN_NAME || 'Farm Admin',
    production: isProd,
    explicitEmail: Boolean(process.env.ADMIN_EMAIL),
  }));
}

export function registerAuthRoutes(app, options = {}) {
  const dbQuery = options.query || query;
  const tx = options.withTx || withTx;
  const production = options.production ?? isProd;
  const origin = options.origin ?? process.env.APP_URL?.replace(/\/$/, '');
  const allowRegistration = options.allowRegistration ?? (process.env.ALLOW_REGISTRATION === 'true' || (!production && process.env.ALLOW_REGISTRATION !== 'false'));
  const attempts = new Map();
  const limiter = (req,res,next) => {
    const key = req.ip || 'unknown'; const now = Date.now();
    for (const [ip, record] of attempts) if (record.until < now) attempts.delete(ip);
    const record = attempts.get(key) || { count:0, until:now+900000 };
    if (record.count >= 30) { res.set('Retry-After','900'); return fail(res,429,'Too many sign-in attempts. Please try again in 15 minutes.'); }
    record.count++; attempts.set(key,record); next();
  };
  const current = async (req) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (await dbQuery('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()', [hashToken(token)])).rows[0] || null;
  };
  const session = async (req,res,user,db = {query:dbQuery}) => {
    const token = await createSession(db,user.id,parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    cookie(res,SESSION_COOKIE,token,production);
  };
  app.use('/api',(req,res,next) => {
    res.set('Cache-Control','no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','same-origin');
    if (!sameOrigin(req,origin)) return fail(res,403,'This request is not allowed. Refresh the page and try again.');
    next();
  });
  app.get('/api/auth/config',(_req,res) => res.json({success:true,data:{registrationEnabled:allowRegistration,googleEnabled:Boolean((options.google?.clientId || process.env.GOOGLE_CLIENT_ID) && (options.google?.clientSecret || process.env.GOOGLE_CLIENT_SECRET) && origin)}}));
  app.get('/api/session',ah(async(req,res) => res.json({success:true,data:publicUser(await current(req))})));
  app.post('/api/auth/login',limiter,ah(async(req,res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!validEmail(email) || typeof password !== 'string' || !password || password.length > 256) return fail(res,400,'Enter a valid email address and password.');
    const user = (await dbQuery('SELECT * FROM users WHERE lower(email)=$1',[email])).rows[0];
    // A dummy hash keeps nonexistent accounts on the same expensive verification path.
    const stored = user?.password_hash || `00000000000000000000000000000000:${'0'.repeat(128)}`;
    if (!await verifyPassword(password,stored)) return fail(res,401,'Email or password is incorrect. If you registered with Google, continue with Google.');
    await tx(async(db) => session(req,res,user,db));
    res.json({success:true,data:publicUser(user)});
  }));
  app.post('/api/auth/register',limiter,ah(async(req,res) => {
    if (!allowRegistration) return fail(res,403,'New accounts are disabled for this farm. Ask the administrator for access.');
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!validName(name)) return fail(res,400,'Enter a name between 2 and 100 characters.');
    if (!validEmail(email)) return fail(res,400,'Enter a valid email address.');
    if (!validPassword(password)) return fail(res,400,'Use 12 to 256 characters with a letter and a number or symbol.');
    const passwordHash = await hashPassword(password);
    let user;
    try {
      await tx(async(db) => {
        user = {id:`USR-${crypto.randomUUID()}`,name,email,role:'staff',password_hash:passwordHash};
        await db.query('INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)',[user.id,name,email,passwordHash,'staff']);
        await session(req,res,user,db);
      });
    } catch(error) { if(error.code==='23505') return fail(res,409,'An account already uses this email. Sign in instead.'); throw error; }
    res.status(201).json({success:true,data:publicUser(user)});
  }));
  app.put('/api/auth/profile',limiter,ah(async(req,res) => {
    const user = await current(req);
    if (!user) return fail(res,401,'Please sign in again to update your account.');
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : user.name;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : user.email;
    const {newPassword,currentPassword} = req.body || {};
    if (!validName(name) || !validEmail(email)) return fail(res,400,'Enter a valid name and email address.');
    const sensitive = email !== user.email.toLowerCase() || Boolean(newPassword);
    if (user.google_sub && email !== user.email.toLowerCase()) return fail(res,400,'Your email is managed by Google and cannot be changed here.');
    if (sensitive && (!user.password_hash || !await verifyPassword(currentPassword,user.password_hash))) return fail(res,401,'Enter your current password to change your email or password.');
    if (newPassword && !validPassword(newPassword)) return fail(res,400,'Use 12 to 256 characters with a letter and a number or symbol.');
    try {
      await tx(async(db) => {
        await db.query('UPDATE users SET name=$1,email=$2 WHERE id=$3',[name,email,user.id]);
        if (newPassword) await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword(newPassword),user.id]);
        if (sensitive) { await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]); await session(req,res,user,db); }
      });
    } catch(error) { if(error.code==='23505') return fail(res,409,'That email already belongs to another account.'); throw error; }
    res.json({success:true,data:publicUser({...user,name,email})});
  }));
  app.post('/api/logout',ah(async(req,res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if(token) await dbQuery('DELETE FROM sessions WHERE token_hash=$1',[hashToken(token)]);
    cookie(res,SESSION_COOKIE,'',production,0);
    res.json({success:true,data:{loggedOut:true}});
  }));
  registerGoogleRoutes(app,{...options.google,origin,production,allowRegistration,query:dbQuery,withTx:tx,current,session,limiter});
  app.use('/api/auth',(error,_req,res,_next) => {
    console.error('Authentication request failed:',error.code || error.name);
    if (error.type === 'entity.too.large') return fail(res,413,'That request is too large. Enter shorter account details.');
    if (error.type === 'entity.parse.failed') return fail(res,400,'Invalid request. Refresh the page and try again.');
    fail(res,503,'Sign-in is temporarily unavailable. Please try again shortly.');
  });
}
export async function getAuthenticatedUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const {rows} = await query('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()',[hashToken(token)]);
  return rows[0] || null;
}
