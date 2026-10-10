/*
 * Anikoto Nuvio provider.
 * Source-derived Anikoto -> MegaPlay/VidTube extraction.
 * Mapping is strictly read-only: this provider only queries the existing mapper
 * with pending=1 and never invokes or writes any population/database function.
 */
const BASE="https://anikototv.to";
const AJAX=BASE+"/ajax";
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const AJAX_HEADERS={
  "Referer":BASE+"/",
  "X-Requested-With":"XMLHttpRequest",
  "User-Agent":UA,
  "Accept":"*/*"
};

function log(x){console.log("[Anikoto] "+x)}

class TTLCache{
  constructor(){this.m=new Map()}
  get(k){const x=this.m.get(k);if(!x)return undefined;if(x.e<=Date.now()){this.m.delete(k);return undefined}return x.v}
  set(k,v,ttl){this.m.set(k,{v,e:Date.now()+ttl});return v}
  delete(k){this.m.delete(k)}
}
const CACHE=globalThis.__NUVIO_PROVIDER_CACHE__||(globalThis.__NUVIO_PROVIDER_CACHE__=new TTLCache());

async function req(url,opt,ms){
  opt=opt||{};
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms||5000);
  try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}
  finally{clearTimeout(t)}
}
async function getText(url,opt,ms){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+String(url).split("?")[0]);return null}
    return await r.text()
  }catch(e){
    log("TEXT FAIL "+String(url).split("?")[0]+" "+String(e&&e.message||e));
    return null
  }
}
async function getJson(url,opt,ms){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+String(url).split("?")[0]);return null}
    return await r.json()
  }catch(e){
    log("JSON FAIL "+String(url).split("?")[0]+" "+String(e&&e.message||e));
    return null
  }
}
async function memo(key,ttl,fn){
  const hit=CACHE.get(key);
  if(hit!==undefined)return await Promise.resolve(hit);
  const p=Promise.resolve().then(fn);
  CACHE.set(key,p,ttl);
  try{
    const v=await p;
    if(v===null||v===undefined)CACHE.delete(key);
    else CACHE.set(key,v,ttl);
    return v
  }catch(e){
    CACHE.delete(key);
    throw e
  }
}
async function settle(tasks,limit=4){
  const out=[],queue=tasks.slice();
  async function worker(){
    while(queue.length){
      const task=queue.shift();
      try{out.push(await task())}catch(e){}
    }
  }
  const n=Math.min(Math.max(1,limit),queue.length);
  await Promise.all(Array.from({length:n},worker));
  return out
}

/* ---------- Small Hermes-safe HTML parser for the exact Anikoto structures ---------- */
function decodeEntities(s){
  return String(s||"")
    .replace(/&#x([0-9a-f]+);?/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/&#(\d+);?/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&apos;/gi,"'")
    .replace(/&#39;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">");
}
function parseAttrs(raw){
  const a={};
  const re=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while((m=re.exec(raw||""))){
    const k=String(m[1]||"").toLowerCase();
    if(!k||k==="div"||k==="a"||k==="img"||k==="span"||k==="ul"||k==="li"||k==="script")continue;
    a[k]=decodeEntities(m[2]!==undefined?m[2]:m[3]!==undefined?m[3]:m[4]!==undefined?m[4]:"")
  }
  return a
}
function parseHTML(html){
  const root={tag:"#root",attrs:{},children:[],text:""};
  const stack=[root],src=String(html||"").replace(/<!--[\s\S]*?-->/g,"");
  const token=/<\/?[^>]+>|[^<]+/g;
  let m;
  while((m=token.exec(src))){
    const t=m[0],parent=stack[stack.length-1];
    if(t[0]!=="<"){parent.children.push({tag:"#text",attrs:{},children:[],text:decodeEntities(t)});continue}
    if(/^<\s*\//.test(t)){
      const name=(t.match(/^<\s*\/\s*([^\s>]+)/)||[])[1];
      if(!name)continue;
      for(let i=stack.length-1;i>0;i--){
        if(stack[i].tag===String(name).toLowerCase()){stack.length=i;break}
      }
      continue
    }
    if(/^<\s*!/.test(t)||/^<\s*\?/.test(t))continue;
    const mm=t.match(/^<\s*([^\s/>]+)/);
    if(!mm)continue;
    const tag=String(mm[1]).toLowerCase();
    const selfClosing=/\/\s*>$/.test(t)||/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag);
    const node={tag,attrs:parseAttrs(t.slice(mm[0].length,-(selfClosing?2:1))),children:[],text:""};
    parent.children.push(node);
    if(!selfClosing)stack.push(node)
  }
  return root
}
function all(root,selector){
  const out=[],sel=String(selector||"").trim();
  const am=sel.match(/^\[([^\]=]+)\]$/);
  if(am){
    const key=am[1].toLowerCase();
    (function visitAttr(n){
      if(!n)return;
      if(n.tag!=="#text"&&Object.prototype.hasOwnProperty.call(n.attrs,key))out.push(n);
      for(const c of n.children||[])visitAttr(c)
    })(root);
    return out
  }
  const m=sel.match(/^([a-z0-9_-]+)?(?:#([a-z0-9_-]+))?(?:\.([a-z0-9_.-]+))?$/i);
  if(!m)return out;
  const tag=m[1]&&m[1].toLowerCase(),id=m[2],classes=(m[3]||"").split(".").filter(Boolean);
  function visit(n){
    if(!n)return;
    if(n.tag!=="#text"){
      const okTag=!tag||n.tag===tag,okId=!id||String(n.attrs.id||"")===id;
      const cs=String(n.attrs.class||"").split(/\s+/);
      const okClass=classes.every(c=>cs.indexOf(c)>=0);
      if(okTag&&okId&&okClass)out.push(n)
    }
    for(const c of n.children||[])visit(c)
  }
  visit(root);
  return out
}
function first(root,selector){return all(root,selector)[0]||null}
function attr(n,k){return n&&n.attrs?String(n.attrs[String(k).toLowerCase()]||""):""}
function nodeText(n){
  if(!n)return"";
  if(n.tag==="#text")return n.text||"";
  return(n.children||[]).map(nodeText).join(" ")
}
function hasClass(n,c){return String(attr(n,"class")).split(/\s+/).indexOf(c)>=0}
function directChildren(n){return(n&&n.children||[]).filter(x=>x&&x.tag!=="#text")}

/* ---------- Read-only target mapper ---------- */
async function mapperLookup(tmdbId,season,episode){
  const u=MAPPING_URL
    +"?tmdb_id="+encodeURIComponent(tmdbId)
    +"&tmdbId="+encodeURIComponent(tmdbId)
    +"&season="+encodeURIComponent(season)
    +"&episode="+encodeURIComponent(episode)
    +"&pending=1";
  const d=await getJson(u,{headers:{"Accept":"application/json","User-Agent":UA}},5000);
  if(!d||!d.ok||!d.mapping)return null;
  const m=d.mapping;
  const malId=String(m.mal_id||m.malId||"").trim();
  const malEpisode=Number(m.mal_episode!=null?m.mal_episode:m.target_episode);
  if(!malId||!Number.isInteger(malEpisode)||malEpisode<1)return null;
  const titles=[];
  if(Array.isArray(m.titles))titles.push(...m.titles);
  for(const k of ["anime_title","title","name","mal_title","mal_title_english","mal_title_romanji"]){
    if(m[k])titles.push(m[k])
  }
  return{
    malId,
    malEpisode,
    title:String(m.anime_title||m.title||m.name||m.mal_title||"").trim(),
    titles:[...new Set(titles.map(x=>String(x||"").trim()).filter(Boolean))],
    seasonName:String(m.season_name||m.seasonName||"").trim()
  }
}

async function movieMapperLookup(tmdbId){
  const id=String(tmdbId||"").trim();
  if(!/^\d{1,10}$/.test(id)||Number(id)<=0)return null;
  const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(id)+"&tmdbId="+encodeURIComponent(id)+"&mediaType=movie&pending=1";
  const d=await getJson(u,{headers:{"Accept":"application/json","User-Agent":UA}},5000);
  const m=d&&d.ok&&d.mapping;
  if(!m||m.media_type!=="movie"||String(m.tmdb_id)!==id||m.animeEligible!==true||!m.mal_id)return null;
  const titles=[m.title,m.original_title,m.mal_title,m.mal_title_english,m.mal_title_romanji,...(Array.isArray(m.titles)?m.titles:[])].filter(Boolean).map(String);
  return{tmdbId:id,malId:String(m.mal_id),title:String(m.mal_title||m.title||""),titles:[...new Set(titles)],mediaType:"movie"};
}
async function tmdbMovieTitle(id){
  const url="https://api.themoviedb.org/3/movie/"+encodeURIComponent(id)+"?api_key=68e094699525b18a70bab2f86b1fa706&language=en-US";
  const d=await getJson(url,{headers:{"Accept":"application/json","User-Agent":UA}},5000);
  if(!d||String(d.id)!==String(id))return null;
  return{title:String(d.title||""),originalTitle:String(d.original_title||"")};
}
async function findMovie(mapping,tmdbInfo){
  const queries=[tmdbInfo&&tmdbInfo.title,tmdbInfo&&tmdbInfo.originalTitle,mapping.title,...mapping.titles].filter(Boolean);
  const unique=[...new Set(queries.map(x=>String(x).trim()).filter(Boolean))].slice(0,6);
  const cards=[],seen=new Set();
  const results=await settle(unique.map(q=>()=>search(q)),3);
  for(const list of results)for(const c of list||[]){
    const href=String(c.href||"").toLowerCase();
    const pathParts=href.split(/[?#]/)[0].split("/").filter(Boolean);
    if(!pathParts.some(part=>part==="movie"||part==="movies"))continue;
    if(!seen.has(c.href)){seen.add(c.href);cards.push(c)}
  }
  const wanted=unique.map(normalizeTitle).filter(Boolean);
  const scored=cards.map(c=>{
    const name=normalizeTitle(c.name);
    const score=wanted.reduce((best,t)=>Math.max(best,name===t?1000:(name.includes(t)||t.includes(name)?650:0)),0);
    return{c,score}
  }).filter(x=>x.score>=650).sort((a,b)=>b.score-a.score);
  if(!scored.length)return null;
  if(scored.length>1&&scored[0].score===scored[1].score&&normalizeTitle(scored[0].c.name)!==normalizeTitle(scored[1].c.name))return null;
  return scored[0].c;
}

/* ---------- Anikoto search / matching ---------- */
function normalizeTitle(s){
  let x=String(s||"").toLowerCase().replace(/&/g,"and");
  try{x=x.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")}catch(e){}
  return x.replace(/[^a-z0-9]+/g,"").trim()
}
function searchTitleBase(s){
  return String(s||"").split(":")[0].replace(/\b(?:season|saison)\s*\d+\b/ig,"").replace(/\b\d+(?:st|nd|rd|th)\s+season\b/ig,"").trim()
}
function titleSeason(s){
  const x=String(s||"");
  let m=x.match(/\bseason\s*([0-9]+)\b/i);
  if(m)return Number(m[1]);
  m=x.match(/\bs([0-9]{1,2})(?:\b|[-\s])/i);
  return m?Number(m[1]):null
}
function cardScore(card,targets,base,season){
  const ct=normalizeTitle(card.name),cb=normalizeTitle(base);
  let best=0;
  for(const t of targets){
    const nt=normalizeTitle(t);
    if(!nt)continue;
    if(ct===nt)best=Math.max(best,1000);
    else if(ct.includes(nt)||nt.includes(ct))best=Math.max(best,800);
    else{
      const nb=normalizeTitle(searchTitleBase(t));
      if(nb&&(ct===nb||ct.includes(nb)||nb.includes(ct)))best=Math.max(best,650)
    }
  }
  if(cb&&ct===cb)best=Math.max(best,900);
  const explicit=titleSeason(card.name);
  if(explicit!==null){
    if(explicit===season)best+=150;
    else best-=1000
  }else if(season===1&&/\b(?:season|saison)\s*\d+\b/i.test(card.name))best-=700;
  return best
}

/* ---------- FIXED SEARCH PARSER ---------- */
function parseSearchCards(html){
  const root=parseHTML(html),container=first(root,"div.scaff.items");
  if(!container)return[];
  const direct=directChildren(container),out=[],seen=new Set();
  for(const item of direct){
    let card=item,href=attr(card,"href");
    if(!href){
      const a=first(card,"a");
      if(!a)continue;
      href=attr(a,"href");
    }
    if(!href||seen.has(href))continue;
    const titleNode=first(card,".name.d-title");
    const name=decodeEntities(nodeText(titleNode||card)).replace(/\s+/g," ").trim();
    if(!name)continue;
    const img=first(card,"img");
    seen.add(href);
    out.push({name,href,img:attr(img,"src")||""})
  }
  if(!out.length){
    for(const a of all(container,"a")){
      const href=attr(a,"href");
      if(!href||seen.has(href))continue;
      const titleNode=first(a,".name.d-title");
      const name=decodeEntities(nodeText(titleNode||a)).replace(/\s+/g," ").trim();
      if(!name)continue;
      const img=first(a,"img");
      seen.add(href);
      out.push({name,href,img:attr(img,"src")||""})
    }
  }
  return out
}

async function search(query){
  const q=String(query||"").trim();
  if(!q)return[];
  const key="anikoto:search:"+normalizeTitle(q);
  const hit=CACHE.get(key);
  if(hit!==undefined)return await Promise.resolve(hit);
  const started=Date.now();
  const d=await getJson(
    AJAX+"/anime/search?keyword="+encodeURIComponent(q),
    {headers:AJAX_HEADERS},
    5000
  );
  const html=d&&d.result&&d.result.html;
  if(!html)return[];
  const cards=parseSearchCards(html);
  log("SEARCH "+q+" results="+cards.length+" "+(Date.now()-started)+"ms");
  if(cards.length)CACHE.set(key,cards,600000);
  return cards
}
function absoluteUrl(href){
  try{return new URL(href,BASE+"/").toString()}catch(e){return BASE+(String(href||"").startsWith("/")?href:"/"+href)}
}
async function findAnime(mapping,season){
  const rawQueries=[mapping.title,...mapping.titles].filter(Boolean);
  const queries=[];
  for(const q of rawQueries){
    queries.push(String(q));
    const b=searchTitleBase(q);
    if(b&&b!==q)queries.push(b)
  }
  const unique=[...new Set(queries.map(x=>x.trim()).filter(Boolean))];
  if(!unique.length)return null;
  const allCards=[];
  const seen=new Set();
  const results=await settle(unique.slice(0,6).map(q=>()=>search(q)),3);
  for(const rs of results)for(const c of rs||[]){
    const key=String(c.href);
    if(!seen.has(key)){seen.add(key);allCards.push(c)}
  }
  if(!allCards.length)return null;
  const scored=allCards.map(c=>({c,score:cardScore(c,unique,mapping.title,season)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const best=scored[0];
  if(!best)return null;
  log("ANIME MATCH "+best.c.name+" score="+best.score);
  return best.c
}

/* ---------- Anikoto anime / episode / server discovery ---------- */
async function getAnimeId(animeUrl){
  const key="anikoto:animeid:"+animeUrl;
  return memo(key,600000,async()=>{
    const started=Date.now();
    const html=await getText(animeUrl,{headers:AJAX_HEADERS},6000);
    if(!html)return null;
    const root=parseHTML(html),watch=first(root,"div#watch-main"),id=attr(watch,"data-id").trim();
    if(!id){log("ANIME ID NOT FOUND");return null}
    log("ANIME ID "+id+" "+(Date.now()-started)+"ms");
    return id
  })
}
async function getEpisodes(animeId){
  const key="anikoto:episodes:"+animeId;
  return memo(key,600000,async()=>{
    const started=Date.now();
    const d=await getJson(AJAX+"/episode/list/"+encodeURIComponent(animeId)+"?vrf=",{headers:AJAX_HEADERS},6000);
    const html=d&&d.result;
    if(!html)return[];
    const root=parseHTML(html),box=first(root,"div.episodes");
    if(!box)return[];
    const out=[],seen=new Set();
    for(const a of all(box,"a")){
      const id=attr(a,"data-ids").trim(),num=Number(attr(a,"data-num"));
      if(!id||!Number.isInteger(num)||num<1||seen.has(id))continue;
      seen.add(id);
      out.push({
        episodeId:id,
        episodeNumber:num,
        malId:attr(a,"data-mal").trim(),
        hasDub:attr(a,"data-dub")==="1",
        title:attr(a,"title").trim(),
        href:attr(a,"href").trim()
      })
    }
    out.sort((a,b)=>a.episodeNumber-b.episodeNumber);
    log("EPISODES="+out.length+" "+(Date.now()-started)+"ms");
    return out
  })
}
async function getServerList(episodeId){
  const key="anikoto:servers:"+episodeId;
  return memo(key,120000,async()=>{
    const started=Date.now();
    const d=await getJson(AJAX+"/server/list?servers="+encodeURIComponent(episodeId),{headers:AJAX_HEADERS},5000);
    const html=d&&d.result;
    if(!html)return[];
    const root=parseHTML(html),groups=all(root,"div.servers"),out=[];
    for(const group of groups){
      const groupName=nodeText(directChildren(group)[0]||group).replace(/\s+/g," ").trim();
      for(const type of all(group,"div.type")){
        const dataType=attr(type,"data-type").toLowerCase();
        if(dataType!=="sub"&&dataType!=="dub")continue;
        for(const item of all(type,"[data-link-id]")){
          const linkId=attr(item,"data-link-id").trim();
          if(!linkId)continue;
          const serverName=nodeText(item).replace(/\s+/g," ").trim();
          out.push({srv_name:serverName||"Anikoto",link_id:linkId,group_name:groupName,dataType})
        }
      }
    }
    log("SERVERS="+out.length+" "+(Date.now()-started)+"ms");
    return out
  })
}
async function getServerUrl(linkId){
  const d=await getJson(AJAX+"/server?get="+encodeURIComponent(linkId),{headers:AJAX_HEADERS},5000);
  return String(d&&d.result&&d.result.url||"").trim()
}

/* ---------- Base64 / UTF-8 ---------- */
function b64dec(s){
  s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");
  s+="=".repeat((4-s.length%4)%4);
  const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",o=[];
  let bits=0,v=0;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==="=")break;
    const n=abc.indexOf(c);
    if(n<0)continue;
    v=(v<<6)|n;
    bits+=6;
    if(bits>=8){
      bits-=8;
      o.push((v>>bits)&255)
    }
  }
  return new Uint8Array(o)
}
function utf8(a){
  let s="";
  for(let i=0;i<a.length;){
    const c=a[i++];
    if(c<128)s+=String.fromCharCode(c);
    else if(c<224)s+=String.fromCharCode(((c&31)<<6)|(a[i++]&63));
    else if(c<240)s+=String.fromCharCode(((c&15)<<12)|((a[i++]&63)<<6)|(a[i++]&63));
    else{
      const cp=((c&7)<<18)|((a[i++]&63)<<12)|((a[i++]&63)<<6)|(a[i++]&63);
      const z=cp-65536;
      s+=String.fromCharCode(55296+(z>>10),56320+(z&1023))
    }
  }
  return s
}
function utf8enc(s){
  const e=encodeURIComponent(String(s)),a=[];
  for(let i=0;i<e.length;){
    if(e[i]==="%"){
      a.push(parseInt(e.slice(i+1,i+3),16));
      i+=3
    }else a.push(e.charCodeAt(i++))
  }
  return new Uint8Array(a)
}
function b64url(a){
  const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",u=a instanceof Uint8Array?a:new Uint8Array(a),o=[];
  for(let i=0;i<u.length;i+=3){
    const x=u[i],y=i+1<u.length?u[i+1]:0,z=i+2<u.length?u[i+2]:0;
    o.push(
      abc[x>>2],
      abc[((x&3)<<4)|(y>>4)],
      i+1<u.length?abc[((y&15)<<2)|(z>>6)]:"=",
      i+2<u.length?abc[z&63]:"="
    )
  }
  return o.join("").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")
}

/* ---------- AES-256-CBC ---------- */
const AES_SBOX=[99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
const AES_ISBOX=[82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37,114,248,246,100,134,104,152,22,212,164,92,204,93,101,182,146,108,112,72,80,253,237,185,218,94,21,70,87,167,141,157,132,144,216,171,0,140,188,211,10,247,228,88,5,184,179,69,6,208,44,30,143,202,63,15,2,193,175,189,3,1,19,138,107,58,145,17,65,79,103,220,234,151,242,207,206,240,180,230,115,150,172,116,34,231,173,53,133,226,249,55,232,28,117,223,110,71,241,26,113,29,41,197,137,111,183,98,14,170,24,190,27,252,86,62,75,198,210,121,32,154,219,192,254,120,205,90,244,31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125];
const AES_RCON=[0,1,2,4,8,16,32,64,128,27,54,108,216,171,77];
function aesX(a,b){
  let r=0;
  for(let i=0;i<8;i++){
    if(b&1)r^=a;
    const h=a&128;
    a=(a<<1)&255;
    if(h)a^=27;
    b>>=1
  }
  return r
}
function aesKey(key){
  const k=new Uint8Array(240);
  k.set(key);
  const bytes=key.length;
  let i=bytes,temp=new Uint8Array(4),r=1;
  while(i<240){
    for(let j=0;j<4;j++)temp[j]=k[i-4+j];
    if(i%bytes===0){
      const t=temp[0];
      temp[0]=AES_SBOX[temp[1]];
      temp[1]=AES_SBOX[temp[2]];
      temp[2]=AES_SBOX[temp[3]];
      temp[3]=AES_SBOX[t];
      temp[0]^=AES_RCON[r++]
    }else if(bytes===32&&i%bytes===16){
      for(let j=0;j<4;j++)temp[j]=AES_SBOX[temp[j]]
    }
    for(let j=0;j<4;j++){
      k[i]=k[i-bytes]^temp[j];
      i++
    }
  }
  return k
}
function aesAdd(s,k,r){
  const o=r*16;
  for(let i=0;i<16;i++)s[i]^=k[o+i]
}
function aesInvShift(s){
  const t=s.slice();
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)s[4*c+r]=t[4*((c-r+4)%4)+r]
}
function aesInvSub(s){
  for(let i=0;i<16;i++)s[i]=AES_ISBOX[s[i]]
}
function aesInvMix(s){
  for(let c=0;c<4;c++){
    const i=4*c,a=s[i],b=s[i+1],d=s[i+2],e=s[i+3];
    s[i]=aesX(a,14)^aesX(b,11)^aesX(d,13)^aesX(e,9);
    s[i+1]=aesX(a,9)^aesX(b,14)^aesX(d,11)^aesX(e,13);
    s[i+2]=aesX(a,13)^aesX(b,9)^aesX(d,14)^aesX(e,11);
    s[i+3]=aesX(a,11)^aesX(b,13)^aesX(d,9)^aesX(e,14)
  }
}
function aesDecBlock(block,key){
  const s=new Uint8Array(block),k=aesKey(key),nr=key.length===16?10:14;
  aesAdd(s,k,nr);
  aesInvShift(s);
  aesInvSub(s);
  for(let r=nr-1;r>0;r--){
    aesAdd(s,k,r);
    aesInvMix(s);
    aesInvShift(s);
    aesInvSub(s)
  }
  aesAdd(s,k,0);
  return s
}
function aesCbcDec(data,key,iv){
  if(data.length%16)throw new Error("Invalid AES ciphertext");
  const o=new Uint8Array(data.length);
  let prev=iv.slice();
  for(let p=0;p<data.length;p+=16){
    const b=aesDecBlock(data.slice(p,p+16),key);
    for(let i=0;i<16;i++)o[p+i]=b[i]^prev[i];
    prev=data.slice(p,p+16)
  }
  const pad=o[o.length-1];
  if(!pad||pad>16)throw new Error("Invalid PKCS7 padding");
  for(let i=o.length-pad;i<o.length;i++)if(o[i]!==pad)throw new Error("Invalid PKCS7 padding");
  return o.slice(0,o.length-pad)
}

/* ---------- SHA-256 / HMAC ---------- */
const SHA_K=[1116352408,1899447441,3049327441,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162072063,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,3382418951,666307205,773529912,1294757372,1396183700,1695183700,2177026350,2456956037,2730485921,2820302411,3259734187,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873772,1779033703,1839830562,2092067163,2281173324,2358390877,2454569567,2730485921,2820302411];
const SHA_H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];

function sha256(m){
  const a=m instanceof Uint8Array?m:utf8enc(m),l=a.length,n=((l+9+63)>>6)<<6,b=new Uint8Array(n);
  b.set(a);
  b[l]=128;
  const bits=l*8;
  for(let i=0;i<8;i++)b[n-1-i]=(bits/2**(8*i))&255;
  let h=SHA_H.slice(),w=new Uint32Array(64);
  for(let p=0;p<n;p+=64){
    for(let i=0;i<16;i++)w[i]=(b[p+4*i]<<24)|(b[p+4*i+1]<<16)|(b[p+4*i+2]<<8)|b[p+4*i+3];
    for(let i=16;i<64;i++){
      const x=w[i-15],y=w[i-2];
      const s0=((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3);
      const s1=((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0
    }
    let[a0,a1,a2,a3,a4,a5,a6,a7]=h;
    for(let i=0;i<64;i++){
      const S1=((a4>>>6)|(a4<<26))^((a4>>>11)|(a4<<21))^((a4>>>25)|(a4<<7));
      const ch=(a4&a5)^(~a4&a6);
      const t1=(a7+S1+ch+SHA_K[i]+w[i])>>>0;
      const S0=((a0>>>2)|(a0<<30))^((a0>>>13)|(a0<<19))^((a0>>>22)|(a0<<10));
      const maj=(a0&a1)^(a0&a2)^(a1&a2);
      const t2=(S0+maj)>>>0;
      a7=a6;a6=a5;a5=a4;a4=(a3+t1)>>>0;
      a3=a2;a2=a1;a1=a0;a0=(t1+t2)>>>0
    }
    h[0]=(h[0]+a0)>>>0;
    h[1]=(h[1]+a1)>>>0;
    h[2]=(h[2]+a2)>>>0;
    h[3]=(h[3]+a3)>>>0;
    h[4]=(h[4]+a4)>>>0;
    h[5]=(h[5]+a5)>>>0;
    h[6]=(h[6]+a6)>>>0;
    h[7]=(h[7]+a7)>>>0
  }
  const o=new Uint8Array(32);
  for(let i=0;i<8;i++){
    o[4*i]=h[i]>>>24;
    o[4*i+1]=h[i]>>>16;
    o[4*i+2]=h[i]>>>8;
    o[4*i+3]=h[i]
  }
  return o
}
function hmac256(key,msg){
  let k=utf8enc(key),m=msg instanceof Uint8Array?msg:utf8enc(msg);
  if(k.length>64)k=sha256(k);
  const p=new Uint8Array(64),q=new Uint8Array(64);
  p.fill(54);q.fill(92);
  for(let i=0;i<k.length;i++){p[i]^=k[i];q[i]^=k[i]}
  const z=new Uint8Array(64+m.length);
  z.set(p);z.set(m,64);
  const ih=sha256(z);
  const z2=new Uint8Array(64+ih.length);
  z2.set(q);z2.set(ih,64);
  return sha256(z2)
}

/* ---------- MegaPlay / VidTube extraction ---------- */
function sourceFile(r){
  const enc=r&&r.enc;
  if(typeof enc==="string"&&enc){
    try{
      const k=new Uint8Array(32);
      k.set(utf8enc("i?LMTAx0Q6,:}50U"));
      const iv=utf8enc("W0;27ToaUpl_P%'c");
      const p=aesCbcDec(b64dec(enc),k,iv);
      const o=JSON.parse(utf8(p));
      if(o&&typeof o.file==="string"&&o.file)return o.file
    }catch(e){
      log("Megaplay decrypt failed: "+e.message)
    }
  }
  const s=r&&r.sources;
  if(s&&!Array.isArray(s)&&typeof s.file==="string")return s.file;
  if(Array.isArray(s)&&s.length&&s[0]&&typeof s[0].file==="string")return s[0].file;
  return null
}
function signMegaplay(u){
  try{
    const x=new URL(u),m=x.pathname.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if(!m)return u;
    const p=utf8enc(Math.floor(Date.now()/1000)+90+"|"+m[1].toLowerCase()+"/"+m[2].toLowerCase());
    const sig=hmac256("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s",p);
    const q=x.search?x.search+"&":"?";
    return x.href.split("?")[0]+q+"token="+b64url(p)+"."+b64url(sig)
  }catch(e){
    log("Megaplay signing failed: "+e.message);
    return u
  }
}
function subFormat(u,d){
  const a=["srt","vtt","ass"],x=String(d||"").toLowerCase().replace(/^\./,"");
  if(a.indexOf(x)>=0)return x;
  try{
    const p=new URL(u).pathname.split(".").pop().toLowerCase();
    return a.indexOf(p)>=0?p:"vtt"
  }catch(e){return"vtt"}
}
function streamHeaders(ref,origin){
  return{"Referer":ref,"Origin":origin,"User-Agent":UA,"Accept":"*/*"}
}
function cleanStreamUrl(u){return String(u||"").replace(/\\/g,"").trim()}

async function extractVidtube(u,server){
  const h=await getText(u,{headers:AJAX_HEADERS},7000);
  if(!h)return null;
  const r=parseHTML(h),p=first(r,"#megaplay-player"),id=attr(p,"data-id").trim();
  if(!id)return null;
  const z=new URL(u),parts=z.pathname.split("/").filter(Boolean),type=parts[parts.length-1];
  if(!type)return null;
  const d=await getJson(
    "https://vidtube.site/stream/getSourcesNew?id="+encodeURIComponent(id)+"&type="+encodeURIComponent(type),
    {
      headers:{
        "X-Requested-With":"XMLHttpRequest",
        "Referer":"https://vidtube.site/",
        "Origin":"https://vidtube.site",
        "User-Agent":UA,
        "Accept":"*/*"
      }
    },
    10000
  );
  const playlist=d&&d.sources&&d.sources.file;
  if(!playlist)return null;
  const tr=Array.isArray(d&&d.tracks)?d.tracks:[];
  let sub=null;
  for(const x of tr)if(x&&x.kind==="captions"&&String(x.lang||"").toLowerCase()==="english"){sub=x.file;break}
  if(!sub)for(const x of tr)if(x&&x.kind==="captions"&&x.default===true){sub=x.file;break}
  sub=cleanStreamUrl(sub);
  return{
    name:server||"vidtube",
    title:(server||"vidtube")+" [multi-quality]",
    url:cleanStreamUrl(playlist),
    quality:"multi-quality",
    headers:streamHeaders("https://vidtube.site/","https://vidtube.site"),
    subtitle:sub||"",
    subtitleFormat:sub?"vtt":"",
    subtitles:sub?[{
      url:sub,
      name:"English",
      language:"en",
      format:"vtt",
      default:true,
      headers:streamHeaders("https://vidtube.site/","https://vidtube.site")
    }]:[],
    backup:false
  }
}

async function extractMegaplay(u,server){
  const h=await getText(u,{headers:AJAX_HEADERS},7000);
  if(!h)return null;
  const r=parseHTML(h),p=first(r,"#megaplay-player"),id=attr(p,"data-id").trim();
  if(!id)return null;
  const page=new URL(u);
  let source=null,file=null;
  for(const ep of["getSources","getSourcesNew"]){
    try{
      let q=page.origin+"/stream/"+ep+"?id="+encodeURIComponent(id);
      const sec=page.searchParams&&page.searchParams.get("s");
      if(sec)q+="&s="+encodeURIComponent(sec);
      const d=await getJson(
        q,
        {
          headers:{
            "X-Requested-With":"XMLHttpRequest",
            "Referer":u,
            "Origin":page.origin,
            "User-Agent":UA,
            "Accept":"*/*"
          }
        },
        10000
      );
      const f=sourceFile(d);
      if(f){
        source=d;
        file=cleanStreamUrl(f);
        break
      }
    }catch(e){
      log("Megaplay "+ep+" failed: "+e.message)
    }
  }
  if(!file||!source)return null;
  const tr=Array.isArray(source.tracks)?source.tracks:[];
  let en=null;
  for(const x of tr)if(x&&x.kind==="captions"&&String(x.label||"").toLowerCase()==="english"){en=x;break}
  if(!en)for(const x of tr)if(x&&x.kind==="captions"&&x.default===true){en=x;break}
  const sub=cleanStreamUrl(en&&en.file);
  const fmt=sub?subFormat(sub,en&&en.format):"";
  const signed=signMegaplay(file);
  log("Megaplay source resolved; signed playback URL generated");
  return{
    name:server||"Megaplay",
    title:(server||"Megaplay")+" [multi-quality]",
    url:signed,
    quality:"multi-quality",
    headers:streamHeaders("https://megaplay.buzz/","https://megaplay.buzz/"),
    subtitle:sub||"",
    subtitleFormat:fmt,
    subtitles:sub?[{
      url:sub,
      name:"English",
      language:"en",
      format:fmt||"vtt",
      default:true,
      headers:streamHeaders("https://megaplay.buzz/","https://megaplay.buzz/")
    }]:[],
    backup:false
  }
}

async function extractHost(u,server){
  try{
    const h=new URL(u).hostname.toLowerCase().split(".")[0];
    if(h==="vidtube")return await extractVidtube(u,server);
    if(h==="megaplay")return await extractMegaplay(u,server);
    log("Unsupported extractor host: "+h);
    return null
  }catch(e){
    log("Extractor "+(server||"unknown")+" failed: "+String(e&&e.message||e));
    return null
  }
}
function validMediaUrl(u){
  try{
    const x=new URL(String(u||""));
    return x.protocol==="http:"||x.protocol==="https:"
  }catch(e){return false}
}
function streamType(u){
  const x=String(u||"").toLowerCase();
  if(x.includes(".m3u8"))return"m3u8";
  if(x.includes(".mpd"))return"mpd";
  return"unknown"
}

/* ---------- Settings ---------- */
function getSetting(settings,names,fallback){
  if(!settings||typeof settings!=="object")return fallback;
  for(const n of names){
    if(Object.prototype.hasOwnProperty.call(settings,n)&&settings[n]!==undefined&&settings[n]!==null)return settings[n]
  }
  return fallback
}
function modes(settings){
  const sub=getSetting(settings,["sub","Sub","subtitle"],true)!==false;
  const dub=getSetting(settings,["dub","Dub"],false)===true;
  const out=[];
  if(sub)out.push(false);
  if(dub)out.push(true);
  return out.length?out:[false]
}
function qualitySetting(settings){
  return String(getSetting(settings,["quality","Quality"],"multi-quality")||"multi-quality")
}

/* ---------- Parallel server resolution ---------- */
async function resolveServers(servers,quality){
  const started=Date.now(),state={firstStart:started,firstStreamLogged:false};
  const tasks=servers.map(server=>async()=>{
    const serverStarted=Date.now(),link=server&&server.link_id;
    if(!link)return null;
    const d=await getJson(AJAX+"/server?get="+encodeURIComponent(link),{headers:AJAX_HEADERS},5000);
    const streamUrl=String(d&&d.result&&d.result.url||"").trim();
    if(!streamUrl)return null;
    log("SERVER RESOLVE "+String(server.srv_name||"Anikoto")+" "+(Date.now()-serverStarted)+"ms");
    let host="";
    try{host=new URL(streamUrl).hostname.toLowerCase().split(".")[0]}catch(e){}
    log("HOST="+(host||"unknown"));
    const extractStarted=Date.now();
    const stream=await extractHost(streamUrl,quality,String(server.srv_name||"Anikoto"));
    log("EXTRACT "+(host||"unknown")+" "+(Date.now()-extractStarted)+"ms");
    if(!stream)return null;
    stream.title="Anikoto "+(server.dataType==="dub"?"DUB":"SUB")+" - "+(server.srv_name||"Anikoto");
    stream.name="Anikoto ["+(server.dataType==="dub"?"DUB":"SUB")+"] "+(server.srv_name||"Anikoto");
    stream.provider="anikoto";
    stream.type=streamType(stream.url);
    if(!state.firstStreamLogged){
      state.firstStreamLogged=true;
      log("TIME TO FIRST STREAM "+(Date.now()-state.firstStart)+"ms");
    }
    return stream
  });
  const out=await settle(tasks,4);
  log("SERVER/EXTRACTION TOTAL "+(Date.now()-started)+"ms");
  return out
}
async function resolveMode(episodeId,isDub,quality){
  const servers=(await getServerList(episodeId)).filter(x=>x.dataType===(isDub?"dub":"sub"));
  if(!servers.length)return[];
  const streams=await resolveServers(servers,quality);
  const out=[],seen=new Set();
  for(const s of streams){
    if(!s||!validMediaUrl(s.url)||seen.has(s.url))continue;
    seen.add(s.url);
    out.push(s)
  }
  return out
}

/* ---------- Main ---------- */
async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  try{
    const type=String(mediaType||"tv").toLowerCase();
    if(type!=="tv"&&type!=="movie")return[];
    const id=String(tmdbId||"").trim(),s=Number(season)||1,e=Number(episode)||1;
    if(!/^\d{1,10}$/.test(id)||Number(id)<=0)return[];
    const key=type==="movie"?"anikoto:streams:movie:"+id+":"+JSON.stringify(settings||{}):"anikoto:streams:tv:"+id+":"+s+":"+e+":"+JSON.stringify(settings||{});
    const hit=CACHE.get(key);
    if(hit!==undefined)return await Promise.resolve(hit);
    const p=(async()=>{
      const started=Date.now();
      log("REQUEST TMDB="+id+" type="+type+" S"+s+"E"+e);
      if(type==="movie"){
        const [mapping,tmdbInfo]=await Promise.all([movieMapperLookup(id),tmdbMovieTitle(id)]);
        if(!mapping||!tmdbInfo)return[];
        const movieCard=await findMovie(mapping,tmdbInfo);
        if(!movieCard)return[];
        const animeUrl=absoluteUrl(movieCard.href),animeId=await getAnimeId(animeUrl);
        if(!animeId)return[];
        const items=await getEpisodes(animeId);
        const titleNeedles=[normalizeTitle(tmdbInfo.title),normalizeTitle(tmdbInfo.originalTitle),...mapping.titles.map(normalizeTitle)].filter(Boolean);
        let item=items.find(x=>x.title&&titleNeedles.includes(normalizeTitle(x.title)));
        if(!item&&items.length===1)item=items[0];
        if(!item)return[];
        const modesList=modes(settings);
        if(modesList.includes(true)&&!item.hasDub&&modesList.length===1)return[];
        const out=(await Promise.all(modesList.map(isDub=>resolveMode(item.episodeId,isDub,qualitySetting(settings))))).flat();
        const seen=new Set();
        return out.filter(x=>x&&x.url&&!seen.has(x.url)&&seen.add(x.url));
      }
      const mapperStarted=Date.now();
      const mapping=await mapperLookup(id,s,e);
      log("MAPPER "+(Date.now()-mapperStarted)+"ms");
      if(!mapping){
        log("MAPPING MISS — READ ONLY, NO POPULATION");
        return[]
      }
      log("MAPPING HIT MAL="+mapping.malId+" E"+mapping.malEpisode);
      const searchStarted=Date.now();
      const anime=findAnime(mapping,s);
      const modesList=modes(settings);
      const [animeResult]=await Promise.all([anime]);
      log("SEARCH/MATCH TOTAL "+(Date.now()-searchStarted)+"ms");
      if(!animeResult){
        log("ANIME MATCH FAILED");
        return[]
      }
      const animeUrl=absoluteUrl(animeResult.href);
      const animeId=await getAnimeId(animeUrl);
      if(!animeId)return[];
      const episodes=await getEpisodes(animeId);
      let episodeMatch=episodes.find(x=>x.episodeNumber===mapping.malEpisode);
      if(!episodeMatch){
        log("EPISODE MATCH FAILED MAL E"+mapping.malEpisode);
        return[]
      }
      if(modesList.indexOf(true)>=0&&!episodeMatch.hasDub){
        log("DUB REQUESTED BUT EPISODE HAS NO DUB");
        if(modesList.length===1)return[]
      }
      log("EPISODE MATCH E"+episodeMatch.episodeNumber+" ID="+episodeMatch.episodeId);
      const modeResults=await Promise.all(
        modesList.map(isDub=>resolveMode(episodeMatch.episodeId,isDub,qualitySetting(settings)))
      );
      const allStreams=modeResults.flat();
      const seen=new Set(),out=[];
      for(const stream of allStreams){
        if(!stream||!stream.url||seen.has(stream.url))continue;
        seen.add(stream.url);
        out.push(stream)
      }
      log("DONE streams="+out.length+" time="+(Date.now()-started)+"ms");
      return out
    })();
    CACHE.set(key,p,1800000);
    try{
      const v=await p;
      if(v&&v.length)return CACHE.set(key,v,1800000);
      CACHE.delete(key);
      return v
    }catch(e){
      CACHE.delete(key);
      log("ERROR "+String(e&&e.message||e));
      return[]
    }
  }catch(e){
    log("FATAL "+String(e&&e.message||e));
    return[]
  }
}

module.exports={getStreams};
