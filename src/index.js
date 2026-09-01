import * as auth from './routes/auth.js';
import * as users from './routes/users.js';
import * as availability from './routes/availability.js';
import * as appointments from './routes/appointments.js';
import * as recurring from './routes/recurring.js';
import { getSession } from './lib/auth.js';
import { error } from './lib/util.js';

export default {
  async fetch(request, env) {
    const url=new URL(request.url), path=url.pathname, method=request.method;
    try {
      if(!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      if(path==='/api/bootstrap'&&method==='POST') return auth.bootstrap(request,env);
      if(path==='/api/login'&&method==='POST') return auth.login(request,env);
      if(path==='/api/logout'&&method==='POST') return auth.logout();
      const user=await getSession(request,env);
      if(path==='/api/me'&&method==='GET') return auth.me(request,env,user);
      if(!user) return error('Unauthorized.',401);
      if(path==='/api/change-password'&&method==='POST') return auth.changePassword(request,env,user);
      if(user.must_change_password) return error('Password change required.',403);
      if(path==='/api/week'&&method==='GET') return appointments.week(request,env,user);
      if(path==='/api/appointments'&&method==='POST') return appointments.create(request,env,user);
      let m;
      if((m=path.match(/^\/api\/appointments\/(\d+)$/))&&method==='PUT') return appointments.update(request,env,user,m[1]);
      if((m=path.match(/^\/api\/appointments\/(\d+)$/))&&method==='DELETE') return appointments.remove(request,env,user,m[1]);
      if(path==='/api/recurring'&&method==='GET') return recurring.list(request,env,user);
      if(path==='/api/recurring'&&method==='POST') return recurring.create(request,env,user);
      if((m=path.match(/^\/api\/recurring\/(\d+)$/))&&method==='PUT') return recurring.update(request,env,user,m[1]);
      if((m=path.match(/^\/api\/recurring\/(\d+)\/skip$/))&&method==='POST') return recurring.skip(request,env,user,m[1]);
      if((m=path.match(/^\/api\/recurring\/(\d+)$/))&&method==='DELETE') return recurring.remove(request,env,user,m[1]);
      if(path==='/api/availability/rules'&&method==='GET') return availability.listRules(request,env,user);
      if(path==='/api/availability/rules'&&method==='POST') return availability.addRule(request,env,user);
      if((m=path.match(/^\/api\/availability\/rules\/(\d+)$/))&&method==='DELETE') return availability.deleteRule(request,env,user,m[1]);
      if(path==='/api/availability/overrides'&&method==='GET') return availability.listOverrides(request,env,user);
      if(path==='/api/availability/overrides'&&method==='POST') return availability.addOverride(request,env,user);
      if((m=path.match(/^\/api\/availability\/overrides\/(\d+)$/))&&method==='DELETE') return availability.deleteOverride(request,env,user,m[1]);
      if(path==='/api/users'&&method==='GET') return users.list(request,env,user);
      if(path==='/api/users'&&method==='POST') return users.create(request,env,user);
      if((m=path.match(/^\/api\/users\/(\d+)$/))&&method==='PUT') return users.update(request,env,user,m[1]);
      return error('Not found.',404);
    } catch(e) { console.error(e); return error('Something went wrong.',500); }
  }
};
