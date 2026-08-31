import { db } from '../lib/db.js';
import { body, error, json } from '../lib/util.js';
import { hashPassword, isBishop } from '../lib/auth.js';
export async function list(request,env,user){ if(!isBishop(user)) return error('Forbidden.',403); const sql=db(env); return json({users:await sql`SELECT id,name,email,role,active,created_at FROM users ORDER BY name`}); }
export async function create(request,env,user){
  if(!isBishop(user)) return error('Forbidden.',403); const d=await body(request); if(!d)return error('Invalid request.');
  const name=String(d.name||'').trim(),email=String(d.email||'').trim(),password=String(d.password||''),role=String(d.role||'viewer');
  if(!name||!email.includes('@')||password.length<8||!['bishop','scheduler','viewer'].includes(role)) return error('Invalid user details.');
  const sql=db(env); try { const r=await sql`INSERT INTO users(name,email,password_hash,role) VALUES(${name},${email},${await hashPassword(password)},${role}) RETURNING id,name,email,role,active`; return json({user:r[0]},201); } catch(e){ if(String(e).includes('unique')) return error('That email is already in use.',409); throw e; }
}
export async function update(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403); const d=await body(request); if(!d)return error('Invalid request.'); const sql=db(env);
  const rows=await sql`UPDATE users SET name=COALESCE(${d.name??null},name), role=COALESCE(${d.role??null},role), active=COALESCE(${d.active??null},active), updated_at=now() WHERE id=${id} RETURNING id,name,email,role,active`;
  if(!rows[0]) return error('User not found.',404); return json({user:rows[0]});
}
