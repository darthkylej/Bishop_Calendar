import{api,esc,requireUser,nav}from'./api.js';

const $=id=>document.getElementById(id);
const els={
  weekTitle:$('weekTitle'),calendar:$('calendar'),prev:$('prev'),today:$('today'),next:$('next'),schedulePrompt:$('schedulePrompt'),
  recurringBtn:$('recurringBtn'),recurringDrawer:$('recurringDrawer'),closeRecurring:$('closeRecurring'),recurringWeek:$('recurringWeek'),recurringMsg:$('recurringMsg'),recurringList:$('recurringList'),recurringAdmin:$('recurringAdmin'),recurringForm:$('recurringForm'),recurringName:$('recurringName'),frequencyCount:$('frequencyCount'),frequencyUnit:$('frequencyUnit'),firstDue:$('firstDue'),
  drawer:$('drawer'),closeDrawer:$('closeDrawer'),drawerTitle:$('drawerTitle'),drawerWhen:$('drawerWhen'),drawerMsg:$('drawerMsg'),
  apptForm:$('apptForm'),apptId:$('apptId'),recurringId:$('recurringId'),person:$('person'),startTime:$('startTime'),durations:$('durations'),type:$('type'),
  confirmationStatus:$('confirmationStatus'),notes:$('notes'),statusField:$('statusField'),status:$('status'),cancelAppt:$('cancelAppt')
};

let user,weekStart,data,duration=15,selectedDate=null,pendingRecurring=null,recurringData=null;
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
function shortDate(s){return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(dateFromYmd(s))}
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
  els.weekTitle.textContent=`${shortDate(weekDates[0])} – ${shortDate(weekDates[6])}`;
  if(!dates.length){els.calendar.innerHTML='<div class="empty">No availability or appointments this week.</div>';return}

  const minRaw=Math.min(...dates.map(d=>bounds.get(d).first));
  const maxRaw=Math.max(...dates.map(d=>bounds.get(d).last));
  const minM=Math.max(0,Math.floor(minRaw/15)*15);
  const maxM=Math.min(1440,Math.ceil(maxRaw/15)*15);
  const cols=dates.length+1;
  let html=`<div class="week-grid" style="grid-template-columns:minmax(42px,64px) repeat(${dates.length},minmax(0,1fr))"><div class="corner"></div>`;
  const today=localYmd(new Date());
  dates.forEach(d=>{const i=dateFromYmd(d).getDay();html+=`<div class="day-head ${d===today?'today':''}"><strong>${DAY[i]}</strong><span>${new Intl.DateTimeFormat('en-US',{month:'numeric',day:'numeric'}).format(dateFromYmd(d))}</span></div>`});
  for(let m=minM;m<maxM;m+=15){
    html+=`<div class="time-cell">${m%60===0?new Intl.DateTimeFormat('en-US',{hour:'numeric'}).format(new Date(2000,0,1,Math.floor(m/60))):''}</div>`;
    dates.forEach(date=>{
      const p=preference(date,m),open=user.role==='bishop'||(user.role==='scheduler'&&!!p);
      html+=`<div class="slot ${p||''} ${open?'open':''}" data-date="${date}" data-time="${hm(m)}" ${open?'role="button" tabindex="0"':''}></div>`;
    });
  }
  html+='</div>';els.calendar.innerHTML=html;

  const grid=els.calendar.querySelector('.week-grid');
  dates.forEach((date,di)=>{for(const a of apptsFor(date)){
    const b=appointmentBounds(a),sm=b.start,em=b.end;if(sm<minM||sm>=maxM)continue;
    const row=Math.floor((sm-minM)/15),idx=cols+row*cols+1+di,cell=grid.children[idx];if(!cell)continue;
    const conf=a.confirmation_status||'confirmed',el=document.createElement('div');
    el.className=`appt ${conf}`;el.dataset.apptId=String(a.id);el.style.height=`${Math.max(42,(em-sm)/15*48-6)}px`;
    el.innerHTML=`<span class="appt-time">${esc(fmtTime(a.start_at))}</span><strong class="appt-name">${esc(a.person_name)}</strong><span class="appt-type">${esc(a.appointment_type)}</span>${conf==='tentative'?'<em>Tentative</em>':''}`;
    cell.appendChild(el);
  }});
}

function showDrawer(){els.drawer.classList.add('show')}
function hideDrawer(){els.drawer.classList.remove('show');els.drawerMsg.innerHTML=''}
function setDur(n){duration=n;document.querySelectorAll('.duration').forEach(b=>b.classList.toggle('active',+b.dataset.n===n))}
function clearPending(){pendingRecurring=null;els.schedulePrompt.hidden=true;els.schedulePrompt.innerHTML=''}
function setPending(item){pendingRecurring={id:item.id,name:item.person_name};els.schedulePrompt.hidden=false;els.schedulePrompt.innerHTML=`Choose a time for <strong>${esc(item.person_name)}</strong> <button type="button" class="prompt-cancel">Cancel</button>`}
function openNew(date,time,recurring=null){
  const linked=recurring||pendingRecurring;selectedDate=date;els.apptId.value='';els.recurringId.value=linked?.id||'';els.person.value=linked?.name||'';els.startTime.value=time;els.type.value='Interview';els.confirmationStatus.value='confirmed';els.notes.value='';els.status.value='scheduled';els.statusField.style.display='none';els.cancelAppt.style.display='none';els.drawerTitle.textContent='Schedule appointment';els.drawerWhen.textContent=fmtDate(date);setDur(15);clearPending();showDrawer();if(!linked)els.person.focus();
}
function openExisting(a){
  clearPending();selectedDate=localYmd(new Date(a.start_at));els.apptId.value=a.id;els.recurringId.value=a.recurring_interview_id||'';els.person.value=a.person_name;els.startTime.value=new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(a.start_at));els.type.value=a.appointment_type;els.confirmationStatus.value=a.confirmation_status||'confirmed';els.notes.value=a.notes||'';els.status.value=a.status;els.statusField.style.display='block';els.cancelAppt.style.display=['bishop','scheduler'].includes(user.role)?'inline-block':'none';els.drawerTitle.textContent='Edit appointment';els.drawerWhen.textContent=fmtDate(selectedDate);setDur(Math.round((new Date(a.end_at)-new Date(a.start_at))/60000));showDrawer();
}
async function load(){data=await api(`/api/week?start=${weekStart}`);render();await refreshRecurringBadge()}

async function fetchRecurring(){recurringData=await api(`/api/recurring?week=${weekStart}`);return recurringData}
async function refreshRecurringBadge(){
  if(!['bishop','scheduler'].includes(user.role)){els.recurringBtn.hidden=true;return}
  try{const d=await fetchRecurring(),n=d.items.filter(i=>i.state!=='upcoming').length;els.recurringBtn.textContent=n?`Appointments Needed · ${n}`:'Appointments Needed';els.recurringBtn.classList.toggle('has-due',n>0)}catch{els.recurringBtn.textContent='Appointments Needed'}
}
function recurringItemHtml(i){
  const overdue=i.state==='overdue',urgent=overdue&&i.overdue_weeks>=2;
  return `<div class="recurring-item ${i.state} ${urgent?'urgent':''} choose-recurring-card" data-id="${i.id}" role="button" tabindex="0"><div class="recurring-main"><strong>${esc(i.person_name)}</strong><span>Due ${esc(shortDate(i.next_due_date))}</span></div>${user.role==='bishop'?`<div class="recurring-actions"><button type="button" class="btn skip-recurring" data-id="${i.id}">Skip</button><button type="button" class="btn danger remove-recurring" data-id="${i.id}">Remove</button></div>`:''}</div>`;
}
function renderRecurring(){
  const items=recurringData?.items||[];els.recurringWeek.textContent=`${shortDate(weekStart)} – ${shortDate(addDays(weekStart,6))}`;
  if(!items.length){els.recurringList.innerHTML='<div class="empty">No appointments needed in this window.</div>';return}
  els.recurringList.innerHTML=items.map(recurringItemHtml).join('');
}
async function openRecurring(){
  els.recurringMsg.innerHTML='';els.recurringDrawer.classList.add('show');els.recurringAdmin.hidden=user.role!=='bishop';if(!els.firstDue.value)els.firstDue.value=weekStart;
  try{await fetchRecurring();renderRecurring()}catch(x){els.recurringList.innerHTML='';els.recurringMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}
}
function closeRecurring(){els.recurringDrawer.classList.remove('show');els.recurringMsg.innerHTML=''}

els.calendar.addEventListener('click',e=>{
  const appt=e.target.closest('.appt');if(appt){const a=data.appointments.find(x=>String(x.id)===appt.dataset.apptId);if(a)openExisting(a);return}
  const slot=e.target.closest('.slot.open');if(slot)openNew(slot.dataset.date,slot.dataset.time);
});
els.calendar.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.slot.open')){e.preventDefault();openNew(e.target.dataset.date,e.target.dataset.time)}});
els.schedulePrompt.addEventListener('click',e=>{if(e.target.closest('.prompt-cancel'))clearPending()});

els.recurringBtn.onclick=openRecurring;els.closeRecurring.onclick=closeRecurring;els.recurringDrawer.onclick=e=>{if(e.target===els.recurringDrawer)closeRecurring()};
els.recurringList.addEventListener('click',async e=>{
  const action=e.target.closest('button[data-id]');
  if(action){const item=recurringData?.items.find(i=>String(i.id)===action.dataset.id);if(!item)return;
    if(action.classList.contains('skip-recurring')){if(!confirm(`Skip this occurrence for ${item.person_name}?`))return;try{await api(`/api/recurring/${item.id}/skip`,{method:'POST'});await fetchRecurring();renderRecurring();await refreshRecurringBadge()}catch(x){els.recurringMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}return}
    if(action.classList.contains('remove-recurring')){if(!confirm(`Remove ${item.person_name} from recurring interviews?`))return;try{await api(`/api/recurring/${item.id}`,{method:'DELETE'});await fetchRecurring();renderRecurring();await refreshRecurringBadge()}catch(x){els.recurringMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}return}
  }
  const card=e.target.closest('.choose-recurring-card');if(!card)return;const item=recurringData?.items.find(i=>String(i.id)===card.dataset.id);if(item){setPending(item);closeRecurring()}
});
els.recurringList.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.choose-recurring-card')){e.preventDefault();const item=recurringData?.items.find(i=>String(i.id)===e.target.dataset.id);if(item){setPending(item);closeRecurring()}}});
els.recurringForm.onsubmit=async e=>{
  e.preventDefault();els.recurringMsg.innerHTML='';const payload={person_name:els.recurringName.value,frequency_count:Number(els.frequencyCount.value),frequency_unit:els.frequencyUnit.value,next_due_date:els.firstDue.value};
  try{await api('/api/recurring',{method:'POST',body:JSON.stringify(payload)});els.recurringName.value='';await fetchRecurring();renderRecurring();await refreshRecurringBadge();els.recurringName.focus()}catch(x){els.recurringMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}
};

(async()=>{
  user=await requireUser();if(!user)return;nav(user);weekStart=mondayOf(new Date());
  els.durations.innerHTML=[10,15,20,30,45,60].map(n=>`<button type="button" class="duration" data-n="${n}">${n} min</button>`).join('');els.durations.onclick=e=>{const b=e.target.closest('.duration');if(b)setDur(+b.dataset.n)};setDur(15);await load();
})();

els.prev.onclick=async()=>{weekStart=addDays(weekStart,-7);clearPending();await load()};
els.next.onclick=async()=>{weekStart=addDays(weekStart,7);clearPending();await load()};
els.today.onclick=async()=>{weekStart=mondayOf(new Date());clearPending();await load()};
els.closeDrawer.onclick=hideDrawer;els.drawer.onclick=e=>{if(e.target===els.drawer)hideDrawer()};

els.apptForm.onsubmit=async e=>{
  e.preventDefault();els.drawerMsg.innerHTML='';const start=toIso(selectedDate,els.startTime.value),end=new Date(new Date(start).getTime()+duration*60000).toISOString();
  const payload={start_at:start,end_at:end,person_name:els.person.value,appointment_type:els.type.value,confirmation_status:els.confirmationStatus.value,notes:els.notes.value,status:els.status.value,recurring_interview_id:els.recurringId.value||null};
  try{if(els.apptId.value)await api(`/api/appointments/${els.apptId.value}`,{method:'PUT',body:JSON.stringify(payload)});else await api('/api/appointments',{method:'POST',body:JSON.stringify(payload)});hideDrawer();await load()}catch(x){els.drawerMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}
};
els.cancelAppt.onclick=async()=>{if(!els.apptId.value)return;if(!confirm('Cancel this appointment?'))return;try{await api(`/api/appointments/${els.apptId.value}`,{method:'DELETE'});hideDrawer();await load()}catch(x){els.drawerMsg.innerHTML=`<div class="notice error">${esc(x.message)}</div>`}};
