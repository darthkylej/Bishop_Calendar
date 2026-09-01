import { db } from '../lib/db.js';
import { body, error, json } from '../lib/util.js';
import { canSchedule, isBishop } from '../lib/auth.js';

function hhmm(date, tz){ return new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(date); }
function ymd(date,tz){ const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date); const o=Object.fromEntries(p.map(x=>[x.type,x.value])); return `${o.year}-${o.month}-${o.day}`; }
function dow(date,tz){ const name=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short'}).format(date); return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(name); }
function min(t){ const [h,m]=String(t).slice(0,5).split(':').map(Number); return h*60+m; }
function confirmation(v, fallback='confirmed'){ return ['tentative','confirmed'].includes(v) ? v : fallback; }
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
function advanceDate(s,count,unit){ const d=dateUtc(s); if(unit==='days')d.setUTCDate(d.getUTCDate()+count); else if(unit==='weeks')d.setUTCDate(d.getUTCDate()+count*7); else d.setUTCMonth(d.getUTCMonth()+count); return ymdUtc(d); }
function covered(start,end, intervals, blocks){
  let pts=[start,end]; for(const i of intervals) pts.push(Math.max(start,i.s),Math.min(end,i.e)); for(const b of blocks) pts.push(Math.max(start,b.s),Math.min(end,b.e)); pts=[...new Set(pts.filter(x=>x>=start&&x<=end))].sort((a,b)=>a-b);
  for(let i=0;i<pts.length-1;i++){ const a=pts[i],b=pts[i+1],mid=(a+b)/2; if(b<=a)continue; const avail=intervals.some(x=>mid>=x.s&&mid<x.e); const blocked=blocks.some(x=>mid>=x.s&&mid<x.e); if(!avail||blocked)return false; }
  return true;
}
async function isAvailable(sql,startAt,endAt,tz){
  const s=new Date(startAt),e=new Date(endAt); if(!Number.isFinite(+s)||!Number.isFinite(+e)||e<=s)return false;
  const date=ymd(s,tz); if(date!==ymd(new Date(e.getTime()-1),tz)) return false;
  const start=min(hhmm(s,tz)), end=min(hhmm(e,tz)); const day=dow(s,tz);
  const rules=await sql`SELECT start_time,end_time FROM availability_rules WHERE active=true AND day_of_week=${day}`;
  const ovs=await sql`SELECT start_time,end_time,override_type FROM availability_overrides WHERE date=${date}::date`;
  const ints=rules.map(r=>({s:min(r.start_time),e:min(r.end_time)})); const blocks=[];
  for(const o of ovs){ const i={s:min(o.start_time),e:min(o.end_time)}; if(o.override_type==='add')ints.push(i); else blocks.push(i); }
  return covered(start,end,ints,blocks);
}
async function coverRecurring(sql,id,appointmentDate){
  if(!id) return;
  const row=(await sql`SELECT id,frequency_count,frequency_unit,next_due_date,one_time FROM recurring_interviews WHERE id=${id} AND active=true`)[0];
  if(!row) return;
  if(row.one_time){
    await sql`UPDATE recurring_interviews SET active=false,updated_at=now() WHERE id=${id}`;
    return;
  }
  let due=ymdValue(row.next_due_date); if(!due)throw new Error('Recurring interview has an invalid due date.');
  let earlyLimit=addDays(appointmentDate,14),guard=0;
  if(due>earlyLimit) return;
  do { due=advanceDate(due,Number(row.frequency_count),row.frequency_unit); guard++; }
  while(due<=earlyLimit&&guard<500);
  await sql`UPDATE recurring_interviews SET next_due_date=${due},updated_at=now() WHERE id=${id}`;
}
export async function week(request,env,user){
  if(!user)return error('Unauthorized.',401); const u=new URL(request.url); const start=u.searchParams.get('start'); if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')) return error('Invalid week start.');
  const sql=db(env); const settings=await sql`SELECT key,value FROM settings`; const sm=Object.fromEntries(settings.map(x=>[x.key,x.value]));
  const appts=await sql`SELECT a.*, u.name AS created_by_name FROM appointments a LEFT JOIN users u ON u.id=a.created_by WHERE a.start_at >= (${start}::date AT TIME ZONE ${sm.timezone||'America/Chicago'}) AND a.start_at < ((${start}::date + interval '7 days') AT TIME ZONE ${sm.timezone||'America/Chicago'}) ORDER BY a.start_at`;
  const rules=await sql`SELECT * FROM availability_rules WHERE active=true ORDER BY day_of_week,start_time`;
  const ovs=await sql`SELECT * FROM availability_overrides WHERE date BETWEEN ${start}::date AND (${start}::date + 6) ORDER BY date,start_time`;
  return json({appointments:appts,rules,overrides:ovs,settings:sm,user});
}
export async function create(request,env,user){
  if(!canSchedule(user))return error('Forbidden.',403); const d=await body(request); if(!d)return error('Invalid request.'); const sql=db(env);
  const settings=await sql`SELECT key,value FROM settings`; const sm=Object.fromEntries(settings.map(x=>[x.key,x.value])); const tz=sm.timezone||'America/Chicago';
  if(!isBishop(user) && !await isAvailable(sql,d.start_at,d.end_at,tz)) return error('That time is outside the bishop’s available hours.',409);
  const recurringId=d.recurring_interview_id?Number(d.recurring_interview_id):null;
  if(recurringId){ const rr=(await sql`SELECT id FROM recurring_interviews WHERE id=${recurringId} AND active=true`)[0]; if(!rr)return error('That appointment need is no longer active.',409); }
  try{
    const r=await sql`INSERT INTO appointments(start_at,end_at,person_name,appointment_type,notes,confirmation_status,recurring_interview_id,created_by,updated_by) VALUES(${d.start_at},${d.end_at},${String(d.person_name||'').trim()},${d.appointment_type||'Interview'},${d.notes||null},${confirmation(d.confirmation_status)},${recurringId},${user.id},${user.id}) RETURNING *`;
    if(recurringId) await coverRecurring(sql,recurringId,ymd(new Date(d.start_at),tz));
    return json({appointment:r[0]},201);
  } catch(e){ if(String(e).includes('appointments_no_overlap')||String(e).includes('conflict')) return error('That time overlaps an existing appointment.',409); throw e; }
}
export async function update(request,env,user,id){
  if(!canSchedule(user))return error('Forbidden.',403); const d=await body(request); if(!d)return error('Invalid request.'); const sql=db(env);
  const old=(await sql`SELECT * FROM appointments WHERE id=${id}`)[0]; if(!old)return error('Appointment not found.',404);
  const start=d.start_at||old.start_at,end=d.end_at||old.end_at; const settings=await sql`SELECT key,value FROM settings`; const sm=Object.fromEntries(settings.map(x=>[x.key,x.value]));
  if(!isBishop(user)&&!await isAvailable(sql,start,end,sm.timezone||'America/Chicago'))return error('That time is outside the bishop’s available hours.',409);
  try{ const r=await sql`UPDATE appointments SET start_at=${start},end_at=${end},person_name=${d.person_name??old.person_name},appointment_type=${d.appointment_type??old.appointment_type},notes=${d.notes??old.notes},confirmation_status=${confirmation(d.confirmation_status,old.confirmation_status||'confirmed')},status=${d.status??old.status},updated_by=${user.id},updated_at=now() WHERE id=${id} RETURNING *`; return json({appointment:r[0]}); }catch(e){ if(String(e).includes('appointments_no_overlap')||String(e).includes('conflict'))return error('That time overlaps an existing appointment.',409); throw e; }
}
export async function remove(request,env,user,id){ if(!canSchedule(user))return error('Forbidden.',403); const sql=db(env); const r=await sql`UPDATE appointments SET status='cancelled',updated_by=${user.id},updated_at=now() WHERE id=${id} RETURNING id`; if(!r[0])return error('Appointment not found.',404); return json({ok:true}); }
