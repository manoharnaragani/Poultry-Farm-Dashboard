import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { jwtVerify, generateKeyPair, SignJWT } from 'jose';
import { getPool, closePool } from '../server/db/pool.js';
import { initSchema } from '../server/db/schema.js';
import { registerAuthRoutes } from '../server/localAuth.js';
import { hashToken, verifyPassword, parseCookies, sameOrigin } from '../server/authSecurity.js';

await initSchema();
const db = await getPool().connect();
let server;
let count = 0;
try {
 await db.query('BEGIN');
 const prefix = `auth-test-${crypto.randomUUID()}`;
 const app = express(); app.use(express.json());
 server = app.listen(0,'127.0.0.1'); await once(server,'listening');
 const origin = `http://127.0.0.1:${server.address().port}`;
 const {privateKey,publicKey} = await generateKeyPair('RS256');
 let nonce, googleEmail = `${prefix}-google@example.test`, subject = prefix;
 let failExchange = false, badNonce = false, unverified = false, badAudience = false, expired = false, tamper = false, failSession = false;
 const verify = async(token) => (await jwtVerify(token,publicKey,{issuer:'https://accounts.google.com',audience:'test-client',algorithms:['RS256'],requiredClaims:['exp','iat','sub','nonce','email','email_verified']})).payload;
 registerAuthRoutes(app,{
   query: db.query.bind(db), withTx: async(fn) => {
     await db.query('SAVEPOINT auth_request');
     try { const result = await fn({query:async(sql,params) => { if(failSession && sql.startsWith('INSERT INTO sessions')) throw new Error('Simulated session failure'); return db.query(sql,params); }}); await db.query('RELEASE SAVEPOINT auth_request'); return result; }
     catch(error) { await db.query('ROLLBACK TO SAVEPOINT auth_request'); throw error; }
   }, production:false,origin,allowRegistration:true,
   google:{clientId:'test-client',clientSecret:'test-secret',verify,fetch:async(_url,options) => {
     assert.ok(options.body.get('code_verifier'));
     if (failExchange) return {ok:false};
     const id_token = await new SignJWT({nonce:badNonce ? 'wrong' : nonce,email:googleEmail,email_verified:!unverified,name:'Google Tester'})
       .setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setAudience(badAudience ? 'wrong-client' : 'test-client').setSubject(subject).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now()/1000)-10 : '5m').sign(privateKey);
     return {ok:true,json:async() => ({id_token:tamper ? id_token.slice(0,-12)+'AAAAAAAAAAAA' : id_token})};
   }},
 });
 const jar = new Map();
 const call = async(path,method='GET',body,headers={}) => {
   const response = await fetch(origin+path,{method,redirect:'manual',headers:{'Content-Type':'application/json',Cookie:[...jar].map(([key,value]) => `${key}=${value}`).join('; '),...headers},...(body ? {body:JSON.stringify(body)} : {})});
   for (const value of response.headers.getSetCookie()) {
     const [key,token] = value.split(';')[0].split('=');
     if (value.includes('Max-Age=0')) jar.delete(key); else jar.set(key,token);
   }
   return response;
 };
 const check = (label,condition) => {assert.ok(condition,label); count++; console.log('PASS '+label);};
 const signupEmail = `${prefix}@example.test`, password='Long-password-123!';
 let result = await call('/api/auth/register','POST',{name:'Test User',email:signupEmail,password});
 check('signup creates session',result.status===201 && jar.has('poultry_farm_management_session'));
 check('HttpOnly SameSite cookie',result.headers.get('set-cookie').includes('HttpOnly; SameSite=Lax'));
 const user = (await result.json()).data;
 const original = jar.get('poultry_farm_management_session');
 const stored = (await db.query('SELECT token_hash FROM sessions WHERE user_id=$1',[user.id])).rows[0].token_hash;
 check('database stores only session hash',stored===hashToken(original) && stored!==original);
 check('session authenticates',(await (await call('/api/session')).json()).data.id===user.id);
 result=await call('/api/auth/register','POST',{name:'Test User',email:signupEmail.toUpperCase(),password});
 check('case-insensitive duplicate rejected',result.status===409);
 failSession=true;
 result=await call('/api/auth/register','POST',{name:'Failed Signup',email:`atomic-${signupEmail}`,password});
 check('session failure rolls back signup',result.status===503 && (await db.query('SELECT 1 FROM users WHERE email=$1',[`atomic-${signupEmail}`])).rowCount===0);
 failSession=false;
 check('weak signup password rejected',(await call('/api/auth/register','POST',{name:'Test User',email:`weak-${signupEmail}`,password:'password'})).status===400);
 check('invalid email rejected',(await call('/api/auth/login','POST',{email:'bad',password})).status===400);
 check('wrong password rejected',(await call('/api/auth/login','POST',{email:signupEmail,password:'wrong'})).status===401);
 check('cross-origin request rejected',(await call('/api/logout','POST',null,{Origin:'https://evil.example'})).status===403);
 check('malformed cookie does not crash',parseCookies('broken=%E0%A4%A').broken===undefined);
 check('malformed stored hash does not crash',await verifyPassword(password,'bad:bad')===false);
 result=await call('/api/auth/login','POST',{email:signupEmail,password});
 check('login rotates session',result.status===200 && jar.get('poultry_farm_management_session')!==original);
 check('old session revoked',(await db.query('SELECT 1 FROM sessions WHERE token_hash=$1',[hashToken(original)])).rowCount===0);
 await call('/api/logout','POST');
 check('logout revokes session',(await (await call('/api/session')).json()).data===null);
 const startGoogle = async(mode='signin') => {
   const response=await call(`/api/auth/google?mode=${mode}`);
   assert.equal(response.status,302);
   const url=new URL(response.headers.get('location')); nonce=url.searchParams.get('nonce');
   assert.equal(url.searchParams.get('code_challenge_method'),'S256');
   assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/auth/google/callback');
   return url.searchParams.get('state');
 };
 let state=await startGoogle();
 result=await call(`/api/auth/google/callback?state=${state}&code=test-code`);
 check('Google signup using signed identity token',result.headers.get('location')==='/?auth_success=google');
 const googleUser=(await (await call('/api/session')).json()).data;
 check('Google creates staff account only',googleUser.role==='staff' && googleUser.googleLinked && !googleUser.hasPassword);
 await call('/api/logout','POST');
 state=await startGoogle();
 await call(`/api/auth/google/callback?state=${state}&code=test-code`);
 check('repeat Google sign-in reuses account',(await (await call('/api/session')).json()).data.id===googleUser.id);
 result=await call(`/api/auth/google/callback?state=${state}&code=test-code`);
 check('OAuth replay rejected',result.headers.get('location')==='/?auth_error=google_expired');
 await call('/api/logout','POST');
 state=await startGoogle();
 result=await call(`/api/auth/google/callback?state=wrong&code=test-code`);
 check('wrong state rejected',result.headers.get('location')==='/?auth_error=google_expired');
 state=await startGoogle();
 result=await call(`/api/auth/google/callback?state=${state}&error=access_denied`);
 check('Google cancellation handled',result.headers.get('location')==='/?auth_error=google_cancelled');
 for (const kind of ['exchange','nonce','email','audience','expiry','signature']) {
   failExchange=kind==='exchange'; badNonce=kind==='nonce'; unverified=kind==='email'; badAudience=kind==='audience'; expired=kind==='expiry'; tamper=kind==='signature';
   state=await startGoogle(); result=await call(`/api/auth/google/callback?state=${state}&code=test-code`);
   check('Google rejects '+kind,result.headers.get('location')==='/?auth_error=google_failed');
 }
 failExchange=badNonce=unverified=badAudience=expired=tamper=false;
 googleEmail=signupEmail; subject=prefix+'-link';
 state=await startGoogle(); result=await call(`/api/auth/google/callback?state=${state}&code=test-code`);
 check('existing password email requires explicit link',result.headers.get('location')==='/?auth_error=google_link_required');
 await call('/api/auth/login','POST',{email:signupEmail,password});
 state=await startGoogle('link'); result=await call(`/api/auth/google/callback?state=${state}&code=test-code`);
 check('signed-in user can connect matching Google account',result.headers.get('location')==='/?auth_success=google');
 await call('/api/logout','POST');
 state=await startGoogle(); await call(`/api/auth/google/callback?state=${state}&code=test-code`);
 check('linked Google login reuses password account',(await (await call('/api/session')).json()).data.id===user.id);
 check('password still works after linking',(await call('/api/auth/login','POST',{email:signupEmail,password})).status===200);
 check('linked Google email change rejected',(await call('/api/auth/profile','PUT',{email:`changed-${signupEmail}`,name:'Test User',currentPassword:password})).status===400);
 // Verify password updates and session revocation using a separate test account.
 const profileEmail = `profile-${signupEmail}`;
 await call('/api/auth/register','POST',{name:'Profile Tester',email:profileEmail,password});
 const profileToken=jar.get('poultry_farm_management_session');
 check('email update requires password',(await call('/api/auth/profile','PUT',{name:'Profile Tester',email:`changed-${profileEmail}`})).status===401);
 const nextPassword='Updated-password-456!';
 result=await call('/api/auth/profile','PUT',{name:'Profile Tester',email:profileEmail,currentPassword:password,newPassword:nextPassword});
 check('password update rotates session',result.status===200 && jar.get('poultry_farm_management_session')!==profileToken);
 check('password update revokes old session',(await db.query('SELECT 1 FROM sessions WHERE token_hash=$1',[hashToken(profileToken)])).rowCount===0);
 await call('/api/logout','POST');
 check('old password rejected after update',(await call('/api/auth/login','POST',{email:profileEmail,password})).status===401);
 check('new password works',(await call('/api/auth/login','POST',{email:profileEmail,password:nextPassword})).status===200);
 await call('/api/auth/login','POST',{email:signupEmail,password});
 const second = express(); second.use(express.json());
 registerAuthRoutes(second,{query:db.query.bind(db),withTx:async fn=>fn(db),production:true,origin:'https://poultry-farm-management-b41v.onrender.com',allowRegistration:false});
 const disabled=second.listen(0,'127.0.0.1'); await once(disabled,'listening');
 try {
   const address=`http://127.0.0.1:${disabled.address().port}`;
   result=await fetch(address+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'No Signup',email:'disabled@example.test',password})});
   check('registration policy enforced',result.status===403);
   result=await fetch(address+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:signupEmail,password})});
   check('production cookie is Secure',result.status===200 && result.headers.get('set-cookie').includes('; Secure'));
   for (let i=0;i<30;i++) result=await fetch(address+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   check('rate limit enforced',result.status===429);
 } finally {await new Promise(resolve=>disabled.close(resolve));}
 console.log(`${count} authentication checks passed. All test account and session changes are rolled back.`);
} finally {
 if(server) await new Promise(resolve=>server.close(resolve));
 await db.query('ROLLBACK'); db.release(); await closePool();
}
