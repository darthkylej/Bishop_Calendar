export async function api(path, options={}) {
  const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error||`Request failed (${res.status})`);
  return data;
}
export function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
export async function requireUser(){try{return (await api('/api/me')).user}catch{location.href='/login.html';return null}}
export function nav(user){
  const el=document.querySelector('.nav'); if(!el)return;
  el.innerHTML=`<a href="/">Schedule</a>${user.role==='bishop'?'<a href="/availability.html">Availability</a><a href="/users.html">Users</a>':''}<button id="logoutBtn">Sign out</button>`;
  document.getElementById('logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});location.href='/login.html'};
}
