import { db } from './db.js';
const enc = new TextEncoder();
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

function hex(buf) { return Array.from(buf, b => b.toString(16).padStart(2,'0')).join(''); }
function fromHex(s) { const b = new Uint8Array(s.length/2); for(let i=0;i<b.length;i++) b[i]=parseInt(s.slice(i*2,i*2+2),16); return b; }
function b64url(s) { return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function unb64url(s) { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; return atob(s); }

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${hex(salt)}:${hex(await derive(password, salt))}`;
}
export async function verifyPassword(password, stored) {
  const [s,h] = String(stored).split(':');
  if(!s || !h) return false;
  return hex(await derive(password, fromHex(s))) === h;
}
async function sign(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}
export async function createSession(env, user) {
  const payload = b64url(JSON.stringify({ userId:user.id, exp:Date.now()+TWO_WEEKS }));
  return `${payload}.${await sign(env,payload)}`;
}
export async function getSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if(!m) return null;
  const [payload,sig] = decodeURIComponent(m[1]).split('.');
  if(!payload || !sig || await sign(env,payload) !== sig) return null;
  let parsed; try { parsed=JSON.parse(unb64url(payload)); } catch { return null; }
  if(Date.now() > parsed.exp) return null;
  const sql = db(env);
  const rows = await sql`SELECT id,name,email,role,active FROM users WHERE id=${parsed.userId}`;
  if(!rows[0]?.active) return null;
  return rows[0];
}
export function cookie(token, clear=false) {
  return `session=${clear?'':token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${clear?0:TWO_WEEKS/1000}`;
}
export function canSchedule(user) { return user && ['bishop','scheduler'].includes(user.role); }
export function isBishop(user) { return user?.role === 'bishop'; }
