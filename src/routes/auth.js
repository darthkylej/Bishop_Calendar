import { db } from '../lib/db.js';
import { body, error, json } from '../lib/util.js';
import { createSession, cookie, hashPassword, verifyPassword } from '../lib/auth.js';

export async function login(request, env) {
  const data = await body(request); if(!data) return error('Invalid request.');
  const sql = db(env);
  const rows = await sql`SELECT * FROM users WHERE lower(email)=lower(${String(data.email||'').trim()}) AND active=true`;
  const user = rows[0];
  if(!user || !await verifyPassword(String(data.password||''), user.password_hash)) return error('Incorrect email or password.',401);
  const token = await createSession(env,user);
  const res = json({ user:{id:user.id,name:user.name,email:user.email,role:user.role} });
  res.headers.set('Set-Cookie',cookie(token)); return res;
}
export function logout() { const res=json({ok:true}); res.headers.set('Set-Cookie',cookie('',true)); return res; }
export async function me(request, env, user) { return user ? json({user}) : error('Not signed in.',401); }

export async function bootstrap(request, env) {
  const data=await body(request); if(!data) return error('Invalid request.');
  if(!env.BOOTSTRAP_SECRET || data.secret !== env.BOOTSTRAP_SECRET) return error('Invalid setup secret.',403);
  const sql=db(env); const count=await sql`SELECT count(*)::int AS n FROM users`;
  if(count[0].n>0) return error('Initial setup has already been completed.',409);
  const name=String(data.name||'').trim(), email=String(data.email||'').trim(), password=String(data.password||'');
  if(!name || !email.includes('@') || !password) return error('Enter a name, valid email, and password.');
  const hash=await hashPassword(password);
  const rows=await sql`INSERT INTO users(name,email,password_hash,role) VALUES(${name},${email},${hash},'bishop') RETURNING id,name,email,role`;
  return json({user:rows[0]},201);
}
