import{api,esc,requireUser,nav}from'./api.js';

const $=id=>document.getElementById(id);
const els={
  userForm:$('userForm'),name:$('name'),email:$('email'),password:$('password'),role:$('role'),userMsg:$('userMsg'),users:$('users')
};
let me;

async function load(){
  const d=await api('/api/users');
  els.users.innerHTML=`<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th>Active</th></tr></thead><tbody>${d.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><select class="role" data-id="${u.id}"><option ${u.role==='bishop'?'selected':''}>bishop</option><option ${u.role==='scheduler'?'selected':''}>scheduler</option><option ${u.role==='viewer'?'selected':''}>viewer</option></select></td><td>${u.must_change_password?'Change required':'Set'}</td><td><input class="active" data-id="${u.id}" type="checkbox" ${u.active?'checked':''}></td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('.role').forEach(x=>x.onchange=async()=>{try{await api(`/api/users/${x.dataset.id}`,{method:'PUT',body:JSON.stringify({role:x.value})})}catch(e){alert(e.message);await load()}});
  document.querySelectorAll('.active').forEach(x=>x.onchange=async()=>{try{await api(`/api/users/${x.dataset.id}`,{method:'PUT',body:JSON.stringify({active:x.checked})})}catch(e){alert(e.message);await load()}});
}

(async()=>{
  me=await requireUser();if(!me)return;
  if(me.role!=='bishop'){location.href='/';return}
  nav(me);await load();
})();

els.userForm.onsubmit=async e=>{
  e.preventDefault();
  els.userMsg.innerHTML='';
  const payload={name:els.name.value.trim(),email:els.email.value.trim(),password:els.password.value,role:els.role.value};
  try{
    await api('/api/users',{method:'POST',body:JSON.stringify(payload)});
    els.userForm.reset();
    els.role.value='scheduler';
    els.userMsg.innerHTML='<div class="notice">User added. They must change the temporary password after signing in.</div>';
    await load();
  }catch(err){
    els.userMsg.innerHTML=`<div class="notice error">${esc(err.message)}</div>`;
  }
};
