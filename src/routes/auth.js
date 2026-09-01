import { db } from '../lib/db.js';
import { body, error, json } from '../lib/util.js';
import { createSession, cookie, hashPassword, verifyPassword } from '../lib/auth.js';

async function ensurePasswordFlag(sql){
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`;
}

export async function login(request, env) {
  const data = await body(request); if(!data) return error('Invalid request.');
  const sql = db(env); await ensurePasswordFlag(sql);
  const rows = await sql`SELECT * FROM users WHERE lower(email)=lower(${String(data.email||'').trim()}) AND active=true`;
  const user = rows[0];
  if(!user || !await verifyPassword(String(data.password||''), user.password_hash)) return error('Incorrect email or password.',401);
  const token = await createSession(env,user);
  const res = json({ user:{id:user.id,name:user.name,email:user.email,role:user.role,must_change_password:!!user.must_change_password} });
  res.headers.set('Set-Cookie',cookie(token)); return res;
}
export function logout() { const res=json({ok:true}); res.headers.set('Set-Cookie',cookie('',true)); return res; }
export async function me(request, env, user) { return user ? json({user}) : error('Not signed in.',401); }

export async function changePassword(request,env,user){
  const data=await body(request); if(!data) return error('Invalid request.');
  const newPassword=String(data.new_password||'');
  if(!newPassword) return error('Enter a new password.');
  const sql=db(env); await ensurePasswordFlag(sql);
  const rows=await sql`SELECT id,name,email,role,password_hash,must_change_password FROM users WHERE id=${user.id} AND active=true`;
  const current=rows[0]; if(!current) return error('User not found.',404);
  if(!current.must_change_password){
    const oldPassword=String(data.current_password||'');
    if(!oldPassword || !await verifyPassword(oldPassword,current.password_hash)) return error('Current password is incorrect.',401);
  }
  if(await verifyPassword(newPassword,current.password_hash)) return error('Choose a different password.');
  const hash=await hashPassword(newPassword);
  const updated=(await sql`UPDATE users SET password_hash=${hash},must_change_password=false,updated_at=now() WHERE id=${user.id} RETURNING id,name,email,role,must_change_password`)[0];
  const token=await createSession(env,updated);
  const res=json({ok:true,user:{id:updated.id,name:updated.name,email:updated.email,role:updated.role,must_change_password:false}});
  res.headers.set('Set-Cookie',cookie(token)); return res;
}

export async function bootstrap(request, env) {
  const data=await body(request); if(!data) return error('Invalid request.');
  if(!env.BOOTSTRAP_SECRET || data.secret !== env.BOOTSTRAP_SECRET) return error('Invalid setup secret.',403);
  const sql=db(env); await ensurePasswordFlag(sql); const count=await sql`SELECT count(*)::int AS n FROM users`;
  if(count[0].n>0) return error('Initial setup has already been completed.',409);
  const name=String(data.name||'').trim(), email=String(data.email||'').trim(), password=String(data.password||'');
  if(!name || !email.includes('@') || !password) return error('Enter a name, valid email, and password.');
  const hash=await hashPassword(password);
  const rows=await sql`INSERT INTO users(name,email,password_hash,role,must_change_password) VALUES(${name},${email},${hash},'bishop',false) RETURNING id,name,email,role`;
  return json({user:rows[0]},201);
}
