import { db } from '../lib/db.js';
import { body, error, json } from '../lib/util.js';
import { canSchedule, isBishop } from '../lib/auth.js';

async function ensureNeedSchema(sql){
  await sql`ALTER TABLE recurring_interviews ADD COLUMN IF NOT EXISTS one_time BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE recurring_interviews ADD COLUMN IF NOT EXISTS assigned_to_counselor TEXT`;
}
function validYmd(s){ return /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')); }
function ymdValue(v){
  if(v instanceof Date && Number.isFinite(+v)) return v.toISOString().slice(0,10);
  const s=String(v??''),m=s.match(/^(\d{4}-\d{2}-\d{2})/);
  if(m) return m[1];
  const d=new Date(s);
  return Number.isFinite(+d)?d.toISOString().slice(0,10):'';
}
function dateUtc(s){ const v=ymdValue(s); if(!v)return new Date(NaN); const [y,m,d]=v.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
function ymdUtc(d){ return d.toISOString().slice(0,10); }
function addDays(s,n){ const d=dateUtc(s); d.setUTCDate(d.getUTCDate()+n); return ymdUtc(d); }
function advance(s,count,unit){
  const d=dateUtc(s);
  if(unit==='days') d.setUTCDate(d.getUTCDate()+count);
  else if(unit==='weeks') d.setUTCDate(d.getUTCDate()+count*7);
  else d.setUTCMonth(d.getUTCMonth()+count);
  return ymdUtc(d);
}
function dayDiff(a,b){ return Math.floor((dateUtc(b)-dateUtc(a))/86400000); }
function cleanFrequency(d){
  const count=Number(d.frequency_count),unit=String(d.frequency_unit||'');
  if(!Number.isInteger(count)||count<1||count>365) return null;
  if(!['days','weeks','months'].includes(unit)) return null;
  return {count,unit};
}

export async function list(request,env,user){
  if(!canSchedule(user)) return error('Forbidden.',403);
  const u=new URL(request.url),week=u.searchParams.get('week');
  if(!validYmd(week)) return error('Invalid week.');
  const weekEnd=addDays(week,6),earlyEnd=addDays(weekEnd,14),sql=db(env); await ensureNeedSchema(sql);
  const rows=isBishop(user)
    ? await sql`SELECT id,person_name,frequency_count,frequency_unit,next_due_date,one_time,assigned_to_counselor,active FROM recurring_interviews WHERE active=true ORDER BY next_due_date,person_name`
    : await sql`SELECT id,person_name,frequency_count,frequency_unit,next_due_date,one_time,assigned_to_counselor,active FROM recurring_interviews WHERE active=true AND next_due_date <= ${earlyEnd}::date ORDER BY next_due_date,person_name`;
  const items=rows.map(r=>{
    const due=ymdValue(r.next_due_date);
    if(!validYmd(due)) throw new Error('Invalid appointment-needed due date returned from database.');
    let state='upcoming',overdue_weeks=0;
    if(due<week){ state='overdue'; overdue_weeks=Math.max(1,Math.floor(dayDiff(due,week)/7)+1); }
    else if(due<=weekEnd) state='due';
    return {...r,next_due_date:due,state,overdue_weeks};
  });
  return json({items,week,week_end:weekEnd,early_end:earlyEnd});
}

export async function create(request,env,user){
  if(!isBishop(user)) return error('Forbidden.',403);
  const d=await body(request); if(!d) return error('Invalid request.');
  const name=String(d.person_name||'').trim(),due=String(d.next_due_date||''),oneTime=!!d.one_time;
  const freq=oneTime?{count:1,unit:'days'}:cleanFrequency(d);
  if(!name||!freq||!validYmd(due)) return error(oneTime?'Enter a name and due date.':'Enter a name, frequency, and first due date.');
  const sql=db(env); await ensureNeedSchema(sql);
  const r=await sql`INSERT INTO recurring_interviews(person_name,frequency_count,frequency_unit,next_due_date,one_time,created_by)
    VALUES(${name},${freq.count},${freq.unit},${due},${oneTime},${user.id}) RETURNING *`;
  return json({item:{...r[0],next_due_date:ymdValue(r[0].next_due_date)}},201);
}

export async function update(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403);
  const d=await body(request); if(!d) return error('Invalid request.');
  const sql=db(env); await ensureNeedSchema(sql); const old=(await sql`SELECT * FROM recurring_interviews WHERE id=${id}`)[0];
  if(!old) return error('Appointment need not found.',404);
  const name=d.person_name===undefined?old.person_name:String(d.person_name||'').trim();
  const oneTime=d.one_time===undefined?!!old.one_time:!!d.one_time;
  const freq=oneTime?{count:1,unit:'days'}:(d.frequency_count===undefined&&d.frequency_unit===undefined?{count:old.frequency_count,unit:old.frequency_unit}:cleanFrequency({frequency_count:d.frequency_count??old.frequency_count,frequency_unit:d.frequency_unit??old.frequency_unit}));
  const due=d.next_due_date===undefined?ymdValue(old.next_due_date):String(d.next_due_date||'');
  if(!name||!freq||!validYmd(due)) return error('Invalid appointment-needed settings.');
  const r=await sql`UPDATE recurring_interviews SET person_name=${name},frequency_count=${freq.count},frequency_unit=${freq.unit},next_due_date=${due},one_time=${oneTime},updated_at=now() WHERE id=${id} RETURNING *`;
  return json({item:{...r[0],next_due_date:ymdValue(r[0].next_due_date)}});
}

export async function assign(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403);
  const d=await body(request); if(!d) return error('Invalid request.');
  const counselor=String(d.counselor_name||'').trim()||null;
  const sql=db(env); await ensureNeedSchema(sql);
  const r=await sql`UPDATE recurring_interviews SET assigned_to_counselor=${counselor},updated_at=now() WHERE id=${id} AND active=true RETURNING *`;
  if(!r[0]) return error('Appointment need not found.',404);
  return json({item:{...r[0],next_due_date:ymdValue(r[0].next_due_date)}});
}

export async function complete(request,env,user,id){
  if(!canSchedule(user)) return error('Forbidden.',403);
  const sql=db(env); await ensureNeedSchema(sql);
  const row=(await sql`SELECT * FROM recurring_interviews WHERE id=${id} AND active=true`)[0];
  if(!row) return error('Appointment need not found.',404);
  if(!row.assigned_to_counselor) return error('This appointment need is not assigned to a counselor.',409);
  if(row.one_time){
    await sql`UPDATE recurring_interviews SET active=false,assigned_to_counselor=NULL,updated_at=now() WHERE id=${id}`;
    return json({ok:true,closed:true});
  }
  const due=ymdValue(row.next_due_date); if(!validYmd(due)) return error('Appointment need has an invalid due date.',500);
  const next=advance(due,Number(row.frequency_count),row.frequency_unit);
  const r=await sql`UPDATE recurring_interviews SET next_due_date=${next},assigned_to_counselor=NULL,updated_at=now() WHERE id=${id} RETURNING *`;
  return json({ok:true,closed:false,item:{...r[0],next_due_date:ymdValue(r[0].next_due_date)}});
}

export async function skip(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403);
  const sql=db(env); await ensureNeedSchema(sql); const row=(await sql`SELECT * FROM recurring_interviews WHERE id=${id} AND active=true`)[0];
  if(!row) return error('Recurring interview not found.',404);
  if(row.one_time) return error('One-time appointment needs cannot be skipped. Remove it instead.',409);
  const due=ymdValue(row.next_due_date); if(!validYmd(due)) return error('Recurring interview has an invalid due date.',500);
  const next=advance(due,Number(row.frequency_count),row.frequency_unit);
  const r=await sql`UPDATE recurring_interviews SET next_due_date=${next},assigned_to_counselor=NULL,updated_at=now() WHERE id=${id} RETURNING *`;
  return json({item:{...r[0],next_due_date:ymdValue(r[0].next_due_date)}});
}

export async function remove(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403);
  const sql=db(env); await ensureNeedSchema(sql); const r=await sql`UPDATE recurring_interviews SET active=false,updated_at=now() WHERE id=${id} RETURNING id`;
  if(!r[0]) return error('Appointment need not found.',404);
  return json({ok:true});
}

export function advanceDate(s,count,unit){ return advance(s,count,unit); }
