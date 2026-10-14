const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVidcoreSession } = require('../utils/vidcoreSession');

function fixture({ status = 200, launchError, cors = false } = {}) {
  const logs = []; const calls = []; let closes = 0; let releases = 0; let disposed = 0;
  const responseHeaders = {server:'cloudflare','cf-ray':'ray-id','cf-mitigated':status === 403 ? 'challenge' : '', 'content-type':'text/html'};
  const response = {ok:()=>status===200,status:()=>status,statusText:()=>'',text:async()=>'<html>initial</html>',allHeaders:async()=>responseHeaders};
  const page = {goto:async(url)=>{calls.push(['goto',url]);return response;},content:async()=>'<script>{"token":"rendered-secret"}</script>',
    evaluate:async(fn,args)=>{calls.push(['fetch',args]);if(cors)throw new Error('Failed to fetch');return {status:200,statusText:'OK',text:'ok',headers:responseHeaders};}};
  const context = {addCookies:async()=>{},addInitScript:async()=>{},route:async()=>{},newPage:async()=>page,close:async()=>{closes++;},
    request:{fetch:async(url,options)=>{calls.push(['context',options]);return {status:()=>200,statusText:()=>'',text:async()=> 'ok',headers:()=>responseHeaders,dispose:async()=>{disposed++;}};}}};
  const session = createVidcoreSession({ acquireBrowser:async()=>{if(launchError)throw new Error(launchError);return {version:()=> '156.0',newContext:async()=>context};},
    releaseBrowser:()=>{releases++;},logger:{log:x=>logs.push(x),warn:x=>logs.push(x)},
    http:{request:async()=>({status:200,statusText:'OK',data:'decoded',headers:{'content-type':'application/json'}})} });
  return {session,logs,calls,counts:()=>({closes,releases,disposed})};
}

test('browser navigation captures rendered HTML and uses the same page for CSRF requests',async()=>{
  const f=fixture();
  try {
    const r=await f.session('https://vidcore.io/movie/550',{},'Page');
    assert.match(await r.text(),/rendered-secret/);
    await f.session('https://vidcore.io/api/signed-secret',{method:'POST',headers:{'X-CSRF-Token':'csrf-secret',Cookie:'ignored',Referer:'https://vidcore.io/'}},'handoff');
    const args=f.calls[1][1];
    assert.equal(args.headers['X-CSRF-Token'],'csrf-secret');
    assert.equal(args.headers.Cookie,undefined);
    assert.equal(args.referrer,'https://vidcore.io/');
    assert.doesNotMatch(f.logs.join('\n'),/signed-secret|csrf-secret|rendered-secret/);
  } finally {await f.session.close();await f.session.close();}
  assert.deepEqual(f.counts(),{closes:1,releases:1,disposed:0});
});

test('403 keeps rejection status and records diagnostic headers without reading rendered page',async()=>{
  const f=fixture({status:403});
  try {
    const r=await f.session('https://vidcore.io/private-secret?token=secret',{},'Page');
    assert.equal(r.status,403);assert.equal(await r.text(),'<html>initial</html>');
    const log=f.logs.join('\n');
    for(const value of ['403','cloudflare','ray-id','challenge','text/html','Page'])assert.ok(log.includes(value));
    assert.doesNotMatch(log,/private-secret|token=secret/);
  }finally{await f.session.close();}
});

test('CORS fallback uses cookie-sharing context request and disposes response',async()=>{
  const f=fixture({cors:true});
  try {await f.session('https://vidcore.io/movie/550',{},'Page');await f.session('https://vidcore.io/api',{method:'POST',headers:{'X-CSRF-Token':'csrf'}},'API');
    assert.equal(f.calls[2][1].headers['X-CSRF-Token'],'csrf');
  }finally{await f.session.close();}
  assert.equal(f.counts().disposed,1);
});

test('missing Chromium is actionable, redacted and releases no unacquired browser',async()=>{
  const f=fixture({launchError:"Executable doesn't exist /private-secret"});
  await assert.rejects(f.session('https://vidcore.io/movie/550',{},'Page'),/CHROMIUM_NOT_INSTALLED/);
  await f.session.close();
  assert.doesNotMatch(f.logs.join('\n'),/private-secret/);
  assert.equal(f.counts().releases,0);
});
