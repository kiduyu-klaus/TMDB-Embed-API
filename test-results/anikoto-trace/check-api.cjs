const {spawn}=require('child_process');
const fs=require('fs');
const child=spawn(process.execPath,['-e',"require('./utils/config').config.port=8788;require('./apiServer')"],{cwd:process.cwd(),env:{...process.env,BIND_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let ready=false;
const timer=setTimeout(()=>child.kill(),60000);
child.stdout.on('data',async b=>{
 if(ready||!b.toString().includes('listening on'))return;
 ready=true;
 try {
 const r=await fetch('http://127.0.0.1:8788/kiduyuTv_providers/api/streams/anikoto/anime/82684?season=2&episode=16&token='+process.env.TRACE_TOKEN);
 const d=await r.json(); console.log('Fresh API',r.status,'count',d.count);console.log((d.streams||[]).map(s=>s.name));
 fs.writeFileSync('test-results/anikoto-trace/api-result.json',JSON.stringify(d,null,2));
 }catch(e){console.log(e.message)}finally{clearTimeout(timer);child.kill()}
});
child.stderr.on('data',()=>{});
