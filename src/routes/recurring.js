import { db } from '../lib/db.js';
import { body, error, json } from '../lib/util.js';
import { canSchedule, isBishop } from '../lib/auth.js';

function validYmd(s){ return /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')); }
function dateUtc(s){ const [y,m,d]=String(s).split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
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
  const weekEnd=addDays(week,6),earlyEnd=addDays(weekEnd,14),sql=db(env);
  const rows=await sql`SELECT id,person_name,frequency_count,frequency_unit,next_due_date,active
    FROM recurring_interviews WHERE active=true AND next_due_date <= ${earlyEnd}::date
    ORDER BY next_due_date,person_name`;
  const items=rows.map(r=>{
    const due=String(r.next_due_date).slice(0,10);
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
  const name=String(d.person_name||'').trim(),freq=cleanFrequency(d),due=String(d.next_due_date||'');
  if(!name||!freq||!validYmd(due)) return error('Enter a name, frequency, and first due date.');
  const sql=db(env);
  const r=await sql`INSERT INTO recurring_interviews(person_name,frequency_count,frequency_unit,next_due_date,created_by)
    VALUES(${name},${freq.count},${freq.unit},${due},${user.id}) RETURNING *`;
  return json({item:r[0]},201);
}

export async function update(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403);
  const d=await body(request); if(!d) return error('Invalid request.');
  const sql=db(env),old=(await sql`SELECT * FROM recurring_interviews WHERE id=${id}`)[0];
  if(!old) return error('Recurring interview not found.',404);
  const name=d.person_name===undefined?old.person_name:String(d.person_name||'').trim();
  const freq=d.frequency_count===undefined&&d.frequency_unit===undefined?{count:old.frequency_count,unit:old.frequency_unit}:cleanFrequency({frequency_count:d.frequency_count??old.frequency_count,frequency_unit:d.frequency_unit??old.frequency_unit});
  const due=d.next_due_date===undefined?String(old.next_due_date).slice(0,10):String(d.next_due_date||'');
  if(!name||!freq||!validYmd(due)) return error('Invalid recurring interview settings.');
  const r=await sql`UPDATE recurring_interviews SET person_name=${name},frequency_count=${freq.count},frequency_unit=${freq.unit},next_due_date=${due},updated_at=now() WHERE id=${id} RETURNING *`;
  return json({item:r[0]});
}

export async function skip(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403);
  const sql=db(env),row=(await sql`SELECT * FROM recurring_interviews WHERE id=${id} AND active=true`)[0];
  if(!row) return error('Recurring interview not found.',404);
  const next=advance(String(row.next_due_date).slice(0,10),Number(row.frequency_count),row.frequency_unit);
  const r=await sql`UPDATE recurring_interviews SET next_due_date=${next},updated_at=now() WHERE id=${id} RETURNING *`;
  return json({item:r[0]});
}

export async function remove(request,env,user,id){
  if(!isBishop(user)) return error('Forbidden.',403);
  const sql=db(env),r=await sql`UPDATE recurring_interviews SET active=false,updated_at=now() WHERE id=${id} RETURNING id`;
  if(!r[0]) return error('Recurring interview not found.',404);
  return json({ok:true});
}

export function advanceDate(s,count,unit){ return advance(s,count,unit); }
