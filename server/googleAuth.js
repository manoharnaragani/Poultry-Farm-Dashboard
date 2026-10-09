import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { hashToken, parseCookies, validEmail, cookie } from './authSecurity.js';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export async function verifyGoogleToken(token, audience) {
  const {payload} = await jwtVerify(token,googleKeys,{audience,issuer:['https://accounts.google.com','accounts.google.com'],algorithms:['RS256'],requiredClaims:['exp','iat','sub','nonce','email','email_verified'],maxTokenAge:'10 minutes'});
  return payload;
}
export function validateGoogleClaims(claims, nonce, clientId) {
  if (claims.nonce !== nonce || claims.email_verified !== true || !validEmail(claims.email) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || (claims.azp && claims.azp !== clientId)) throw new Error('Invalid Google identity');
}
export function registerGoogleRoutes(app, options) {
  const {query,withTx,current,session,limiter,production,origin,allowRegistration} = options;
  const clientId = options.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = options.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const tokenFetch = options.fetch || fetch;
  const verify = options.verify || verifyGoogleToken;
  const enabled = Boolean(clientId && clientSecret && origin);
  const callback = origin ? `${origin}/api/auth/google/callback` : '';
  if (enabled) {
    const url = new URL(origin);
    if (production && url.protocol !== 'https:') throw new Error('APP_URL must be HTTPS in production.');
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('APP_URL must contain only the website origin.');
  }
  const errorRedirect = (res,code) => res.redirect(303,`/?auth_error=${code}`);
  app.get('/api/auth/google',limiter,async(req,res,next) => {
    try {
      if (!enabled) return errorRedirect(res,'google_unavailable');
      const mode = req.query.mode === 'link' ? 'link' : 'signin';
      const user = mode === 'link' ? await current(req) : null;
      if (mode === 'link' && !user) return errorRedirect(res,'session_expired');
      const state = crypto.randomBytes(32).toString('base64url');
      const binding = crypto.randomBytes(32).toString('base64url');
      const nonce = crypto.randomBytes(32).toString('base64url');
      const verifier = crypto.randomBytes(32).toString('base64url');
      await query('DELETE FROM oauth_states WHERE expires_at < now()');
      await query('INSERT INTO oauth_states (state_hash,binding_hash,nonce,verifier,user_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',[hashToken(state),hashToken(binding),nonce,verifier,user?.id || null,new Date(Date.now()+600000)]);
      cookie(res,'poultry_farm_management_oauth',binding,production,600,'/api/auth/google');
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();
      res.redirect(302,url.toString());
    } catch(error) { next(error); }
  });
  app.get('/api/auth/google/callback',async(req,res) => {
    cookie(res,'poultry_farm_management_oauth','',production,0,'/api/auth/google');
    res.set('Referrer-Policy','no-referrer');
    try {
      if (!enabled) return errorRedirect(res,'google_unavailable');
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const binding = parseCookies(req.headers.cookie).poultry_farm_management_oauth;
      if (!state || state.length > 256 || !binding) return errorRedirect(res,'google_expired');
      // Delete atomically: state cannot be replayed, even on multiple app instances.
      const {rows} = await query('DELETE FROM oauth_states WHERE state_hash=$1 AND binding_hash=$2 AND expires_at > now() RETURNING *',[hashToken(state),hashToken(binding)]);
      const saved = rows[0];
      if (!saved) return errorRedirect(res,'google_expired');
      if (req.query.error) return errorRedirect(res,'google_cancelled');
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return errorRedirect(res,'google_failed');
      const response = await tokenFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,code:req.query.code,redirect_uri:callback,grant_type:'authorization_code',code_verifier:saved.verifier}),signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Google token exchange failed');
      const tokens = await response.json();
      if (typeof tokens.id_token !== 'string') throw new Error('Missing identity token');
      const claims = await verify(tokens.id_token,clientId);
      validateGoogleClaims(claims,saved.nonce,clientId);
      let user;
      await withTx(async(db) => {
        await db.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
        const bySubject = (await db.query('SELECT * FROM users WHERE google_sub=$1',[claims.sub])).rows[0];
        const byEmail = (await db.query('SELECT * FROM users WHERE lower(email)=$1',[claims.email.toLowerCase()])).rows[0];
        if (saved.user_id) {
          const signedIn = await current(req);
          if (!signedIn || signedIn.id !== saved.user_id) throw Object.assign(new Error('Link requires session'),{authCode:'session_expired'});
          if (signedIn.email.toLowerCase() !== claims.email.toLowerCase() || (bySubject && bySubject.id !== signedIn.id)) throw Object.assign(new Error('Account mismatch'),{authCode:'google_link_mismatch'});
          if (signedIn.google_sub && signedIn.google_sub !== claims.sub) throw Object.assign(new Error('Already linked'),{authCode:'google_link_mismatch'});
          await db.query('UPDATE users SET google_sub=$1 WHERE id=$2',[claims.sub,signedIn.id]);
          user = signedIn;
        } else if (bySubject) user = bySubject;
        else if (byEmail) throw Object.assign(new Error('Explicit linking required'),{authCode:'google_link_required'});
        else {
          if (!allowRegistration) throw Object.assign(new Error('Registration disabled'),{authCode:'registration_disabled'});
          user = {id:`USR-${crypto.randomUUID()}`,name:String(claims.name || claims.email.split('@')[0]).slice(0,100),email:claims.email.toLowerCase(),role:'staff'};
          await db.query('INSERT INTO users (id,name,email,password_hash,role,google_sub) VALUES ($1,$2,$3,NULL,$4,$5)',[user.id,user.name,user.email,'staff',claims.sub]);
        }
        await session(req,res,user,db);
      });
      res.redirect(303,'/?auth_success=google');
    } catch(error) {
      console.error('Google sign-in failed:',error.authCode || error.code || error.name);
      errorRedirect(res,error.authCode || 'google_failed');
    }
  });
}
