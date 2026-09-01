import{api,esc,requireUser,nav}from'./api.js';

const $=id=>document.getElementById(id);
const els={
  weekTitle:$('weekTitle'),calendar:$('calendar'),prev:$('prev'),today:$('today'),next:$('next'),
  drawer:$('drawer'),closeDrawer:$('closeDrawer'),drawerTitle:$('drawerTitle'),drawerWhen:$('drawerWhen'),drawerMsg:$('drawerMsg'),
  apptForm:$('apptForm'),apptId:$('apptId'),person:$('person'),startTime:$('startTime'),durations:$('durations'),type:$('type'),
  confirmationStatus:$('confirmationStatus'),notes:$('notes'),statusField:$('statusField'),status:$('status'),cancelAppt:$('cancelAppt')
};

let user,weekStart,data,duration=20,selectedDate=null;
const tz='America/Chicago';
const DAY=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function localYmd(d){const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),o=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${o.year}-${o.month}-${o.day}`}
function dateFromYmd(s){const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)}
function mondayOf(d){const x=new Date(d);x.setHours(12,0,0,0);x.setDate(x.getDate()-x.getDay());return localYmd(x)}
function addDays(s,n){const d=dateFromYmd(s);d.setDate(d.getDate()+n);return localYmd(d)}
function mins(t){const[h,m]=String(t).slice(0,5).split(':').map(Number);return h*60+m}
function hm(m){return`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`}
function fmtTime(iso){return new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit'}).format(new Date(iso))}
function fmtDate(s){return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(dateFromYmd(s))}
function toIso(date,time){const[y,m,d]=date.split('-').map(Number),[hh,mm]=time.split(':').map(Number);const probe=new Date(Date.UTC(y,m-1,d,hh+6,mm));const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,timeZoneName:'shortOffset',hour:'2-digit'}).formatToParts(probe);const off=parts.find(p=>p.type==='timeZoneName')?.value||'GMT-5';const mt=off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);let z='-05:00';if(mt){const sign=mt[1]==='+'?'+':'-',h=String(mt[2]).padStart(2,'0'),mi=String(mt[3]||'00').padStart(2,'0');z=`${sign}${h}:${mi}`}return`${date}T${time}:00${z}`}

function preference(date,m){
  const dow=dateFromYmd(date).getDay();let pref=null;
  for(const r of data.rules)if(+r.day_of_week===dow&&m>=mins(r.start_time)&&m<mins(r.end_time))pref=r.preference;
  for(const o of data.overrides)if(String(o.date).slice(0,10)===date&&m>=mins(o.start_time)&&m<mins(o.end_time)){if(o.override_type==='block')pref=null;else pref=o.preference}
  return pref;
}
function apptsFor(date){return data.appointments.filter(a=>localYmd(new Date(a.start_at))===date&&a.status!=='cancelled')}
function appointmentBounds(a){const f=d=>mins(new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(d));return{start:f(new Date(a.start_at)),end:f(new Date(a.end_at))}}
function dayBounds(date){let first=null,last=null;for(let m=0;m<1440;m+=5){if(preference(date,m)){if(first===null)first=m;last=m+5}}for(const a of apptsFor(date)){const b=appointmentBounds(a);first=first===null?b.start:Math.min(first,b.start);last=last===null?b.end:Math.max(last,b.end)}return first===null?null:{first,last}}

function render(){
  const weekDates=Array.from({length:7},(_,i)=>addDays(weekStart,i));
  const bounds=new Map(weekDates.map(d=>[d,dayBounds(d)]));
  const dates=weekDates.filter(d=>bounds.get(d));
  els.weekTitle.textContent=`${fmtDate(weekDates[0])} – ${fmtDate(weekDates[6])}`;
  if(!dates.length){els.calendar.innerHTML='<div class="empty">No availability or appointments this week.</div>';return}

  const minRaw=Math.min(...dates.map(d=>bounds.get(d).first));
  const maxRaw=Math.max(...dates.map(d=>bounds.get(d).last));
  const minM=Math.max(0,Math.floor(minRaw/15)*15);
  const maxM=Math.min(1440,Math.ceil(maxRaw/15)*15);
  const cols=dates.length+1;
  let html=`<div class="week-grid" style="grid-template-columns:76px repeat(${dates.length},minmax(140px,1fr));min-width:${Math.max(360,76+dates.length*140)}px"><div class="corner"></div>`;
  const today=localYmd(new Date());
  dates.forEach(d=>{const i=dateFromYmd(d).getDay();html+=`<div class="day-head ${d===today?'today':''}"><strong>${DAY[i]}</strong><span>${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(dateFromYmd(d))}</span></div>`});
  for(let m=minM;m<maxM;m+=15){
    html+=`<div class="time-cell">${m%60===0?new Intl.DateTimeFormat('en-US',{hour:'numeric'}).format(new Date(2000,0,1,Math.floor(m/60))):''}</div>`;
    dates.forEach(date=>{const p=preference(date,m),open=!!p&&['bishop','scheduler'].includes(user.role);html+=`<div class="slot ${p||''} ${open?'open':''}" data-date="${date}" data-time="${hm(m)}" ${open?'role="button" tabindex="0"':''}></div>`});
  }
  html+='</div>';
  els.calendar.innerHTML=html;

  const grid=els.calendar.querySelector('.week-grid');
  dates.forEach((date,di)=>{for(const a of apptsFor(date)){
    const b=appointmentBounds(a),sm=b.start,em=b.end;if(sm<minM||sm>=maxM)continue;
    const row=Math.floor((sm-minM)/15),idx=cols+row*cols+1+di,cell=grid.children[idx];if(!cell)continue;
    const conf=a.confirmation_status||'confirmed',el=document.createElement('div');
    el.className=`appt ${conf}`;el.dataset.apptId=String(a.id);el.style.height=`${Math.max(42,(em-sm)/15*48-6)}px`;
    el.innerHTML=`<strong>${esc(a.person_name)}</strong><span>${esc(fmtTime(a.start_at))} · ${esc(a.appointment_type)}</span>${conf==='tentative'?'<em>Tentative</em>':''}`;
    cell.appendChild(el);
  }});
}

function showDrawer(){els.drawer.classList.add('show')}
function hideDrawer(){els.drawer.classList.remove('show');els.drawerMsg.innerHTML=''}
function setDur(n){duration=n;document.querySelectorAll('.duration').forEach(b=>b.classList.toggle('active',+b.dataset.n===n))}
function openNew(date,time){
  selectedDate=date;els.apptId.value='';els.person.value='';els.startTime.value=time;els.type.value='Interview';els.confirmationStatus.value='tentative';els.notes.value='';els.status.value='scheduled';els.statusField.style.display='none';els.cancelAppt.style.display='none';els.drawerTitle.textContent='Schedule appointment';els.drawerWhen.textContent=fmtDate(date);setDur(20);showDrawer();els.person.focus();
}
function openExisting(a){
  selectedDate=localYmd(new Date(a.start_at));els.apptId.value=a.id;els.person.value=a.person_name;els.startTime.value=new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(a.start_at));els.type.value=a.appointment_type;els.confirmationStatus.value=a.confirmation_status||'confirmed';els.notes.value=a.notes||'';els.status.value=a.status;els.statusField.style.display='block';els.cancelAppt.style.display=['bishop','scheduler'].includes(user.role)?'inline-block':'none';els.drawerTitle.textContent='Edit appointment';els.drawerWhen.textContent=fmtDate(selectedDate);setDur(Math.round((new Date(a.end_at)-new Date(a.start_at))/60000));showDrawer();
}
async function load(){data=await api(`/api/week?start=${weekStart}`);render()}

els.calendar.addEventListener('click',e=>{
  const appt=e.target.closest('.appt');
  if(appt){const a=data.appointments.find(x=>String(x.id)===appt.dataset.apptId);if(a)openExisting(a);return}
  const slot=e.target.closest('.slot.open');
  if(slot)openNew(slot.dataset.date,slot.dataset.time);
});
els.calendar.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.slot.open')){e.preventDefault();openNew(e.target.dataset.date,e.target.dataset.time)}});

(async()=>{
  user=await requireUser();if(!user)return;nav(user);weekStart=mondayOf(new Date());
  els.durations.innerHTML=[10,15,20,30,45,60].map(n=>`<button type="button" class="duration" data-n="${n}">${n} min</button>`).join('');
  els.durations.onclick=e=>{const b=e.target.closest('.duration');if(b)setDur(+b.dataset.n)};
  await load();
})();

els.prev.onclick=async()=>{weekStart=addDays(weekStart,-7);await load()};
els.next.onclick=async()=>{weekStart=addDays(weekStart,7);await load()};
els.today.onclick=async()=>{weekStart=mondayOf(new Date());await load()};
els.closeDrawer.onclick=hideDrawer;
els.drawer.onclick=e=>{if(e.target===els.drawer)hideDrawer()};

els.apptForm.onsubmit=async e=>{
  e.preventDefault();els.drawerMsg.innerHTML='';
  const start=toIso(selectedDate,els.startTime.value),end=new Date(new Date(start).getTime()+duration*60000).toISOString();
  const payload={start_at:start,end_at:end,person_name:els.person.value,appointment_type:els.type.value,confirmation_status:els.confirmationStatus.value,notes:els.notes.value,status:els.status.value};
  try{if(els.apptId.value)await api(`/api/appointments/${els.apptId.value}`,{method:'PUT',body:JSON.stringify(payload)});else await api('/api/appointments',{method:'POST',body:JSON.stringify(payload)});hideDrawer();await load()}catch(x){els.drawerMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}
};

els.cancelAppt.onclick=async()=>{
  if(!els.apptId.value)return;if(!confirm('Cancel this appointment?'))return;
  try{await api(`/api/appointments/${els.apptId.value}`,{method:'DELETE'});hideDrawer();await load()}catch(x){els.drawerMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}
};
