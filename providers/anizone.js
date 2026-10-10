const BASE="https://anizone.to",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36",HEADERS={"User-Agent":UA,"Referer":BASE+"/"},TIMEOUT=15000;

async function req(url,opt={},timeout=TIMEOUT){
  const o={...opt,headers:{...HEADERS,...(opt.headers||{})}};
  if(typeof AbortController!=="function"||typeof setTimeout!=="function")return fetch(url,o).catch(()=>null);
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...o,signal:c.signal})}catch(e){return null}finally{clearTimeout(t)}
}

async function text(url,opt={},timeout=TIMEOUT){
  const r=await req(url,opt,timeout);
  if(!r||!r.ok)return"";
  try{return await r.text()}catch(e){return""}
}

async function json(url,opt={},timeout=TIMEOUT){
  const r=await req(url,opt,timeout);
  if(!r||!r.ok)return null;
  try{return await r.json()}catch(e){return null}
}

function attrs(s){
  const o={};
  String(s||"").replace(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,(m,k,a,b,c)=>{o[k]=a!=null?a:b!=null?b:c!=null?c:"";return m});
  return o
}

function parseHTML(html){
  const root={type:"root",children:[]},stack=[root],src=String(html||""),re=/<\/?([a-zA-Z0-9:-]+)([^>]*)>/g;
  let last=0,m;
  while((m=re.exec(src))){
    if(m.index>last)stack[stack.length-1].children.push({type:"text",text:src.slice(last,m.index)});
    const full=m[0],name=m[1].toLowerCase();
    if(full[1]==="/"){
      for(let i=stack.length-1;i>0;i--)if(stack[i].name===name){stack.length=i;break}
    }else if(full[1]!=="!"){
      const n={type:"element",name,attrs:attrs(m[2]),children:[]};
      stack[stack.length-1].children.push(n);
      if(!/\/>$/.test(full)&&!["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"].includes(name))stack.push(n)
    }
    last=re.lastIndex
  }
  if(last<src.length)stack[stack.length-1].children.push({type:"text",text:src.slice(last)});
  return root
}

function children(n){return n&&n.children||[]}

function match(n,sel){
  if(!n||n.type!=="element")return false;
  if(sel[0]==="#")return n.attrs.id===sel.slice(1);
  if(sel[0]===".")return String(n.attrs.class||"").split(/\s+/).includes(sel.slice(1));
  if(sel[0]==="["){
    const m=sel.match(/^\[([^\\]=~*^$]+)(?:([~*^$]?=)["']?([^"'\\]]+)["']?)?\]$/);
    if(!m)return false;
    const v=n.attrs[m[1]];
    if(v==null)return false;
    if(!m[2])return true;
    if(m[2]==="=")return v===m[3];
    if(m[2]==="*=")return v.includes(m[3]);
    if(m[2]==="~=")return v.split(/\s+/).includes(m[3]);
    if(m[2]==="^=")return v.startsWith(m[3]);
    if(m[2]==="$=")return v.endsWith(m[3])
  }
  return n.name===sel.toLowerCase()
}

function all(root,sel){
  const out=[];
  function walk(n){
    if(n&&n.type==="element"&&match(n,sel))out.push(n);
    for(const c of children(n))walk(c)
  }
  walk(root);
  return out
}

function first(root,sel){return all(root,sel)[0]||null}

function nodeText(n){
  if(!n)return"";
  if(n.type==="text")return n.text||"";
  return children(n).map(nodeText).join("")
}

function attr(n,k){return n&&n.attrs?n.attrs[k]:undefined}

function sanitizeJson(s){
  return String(s||"")
    .replace(/\\u0022/g,'"')
    .replace(/\\u0026/g,"&")
    .replace(/\\'/g,"'")
    .replace(/\\\//g,"/")
    .replace(/\\\\/g,"\\")
    .replace(/\\&/g,"&")
    .replace(/\\0/g,"\\u0000")
    .replace(/\\x([0-9a-fA-F]{2})/g,(_,h)=>"\\u00"+h)
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g,"")
}

function decodeJSON(s){
  try{return JSON.parse(sanitizeJson(s))}catch(e){return null}
}

function parseCards(html){
  const cards=[],src=String(html||""),m=src.match(/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if(m){
    const d=decodeJSON(m[1]);
    if(Array.isArray(d)){
      for(const x of d){
        if(!x||!x.slug)continue;
        const titles=new Set();
        if(x.main_title)titles.add(String(x.main_title));
        if(x.title_list&&typeof x.title_list==="object")for(const t of Object.values(x.title_list))if(t)titles.add(String(t));
        if(x.title)titles.add(String(x.title));
        cards.push({slug:String(x.slug),url:x.url||"/anime/"+x.slug,titles:Array.from(titles)})
      }
    }
  }
  if(cards.length)return cards;
  const root=parseHTML(src);
  for(const n of all(root,"[x-data]")){
    const xd=String(attr(n,"x-data")||"");
    if(!xd.includes("anmTitles"))continue;
    const links=all(n,"a");
    const a=links.find(x=>String(attr(x,"href")||"").includes("/anime/"))||null;
    const href=attr(a,"href")||"";
    if(!href.includes("/anime/"))continue;
    const p=href.split("/").filter(Boolean),slug=p[p.length-1]||"";
    if(!slug)continue;
    const titles=new Set();
    if(a){
      const t=nodeText(a).trim();
      if(t)titles.add(t)
    }
    const jm=xd.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
    if(jm){
      const d=decodeJSON(jm[1]);
      if(d&&typeof d==="object")for(const t of Object.values(d))if(t)titles.add(String(t))
    }
    cards.push({slug,titles:Array.from(titles)})
  }
  return cards
}

function cardSlug(c){
  if(!c)return"";
  return String(c.slug||c.url||c.href||c.link||"")
    .replace(/^https?:\/\/[^/]+/,"")
    .replace(/^\/anime\//,"")
    .replace(/^\/+/,"")
    .replace(/\/+$/g,"")
}

function cardTitles(c){
  if(!c)return[];
  const out=[];
  if(Array.isArray(c.titles))out.push(...c.titles);
  for(const k of ["main_title","title","name","anime_title","animeTitle","en","english","romaji","original_title","originalTitle"])if(c[k])out.push(c[k]);
  if(c.title_list&&typeof c.title_list==="object")out.push(...Object.values(c.title_list));
  return[...new Set(out.map(x=>String(x||"").trim()).filter(Boolean))]
}

function cardTitle(c){return cardTitles(c)[0]||""}

function normalize(s){
  return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"").trim()
}

function seasonRules(season){
  const s=Number(season)||1;
  if(s===1)return{mustNot:[
    /season\s*[2-9]/i,
    /saison\s*[2-9]/i,
    /[\s\-][iI]{2,}/,
    /\s+[2-9]nd/i,
    /\s+[2-9]rd/i,
    /\s+[2-9]th/i,
    /\s+ii\b/i,
    /\s+iii\b/i,
    /\s+iv\b/i,
    /\s+v\b/i,
    /movie/i,
    /gekijouban/i,
    /the movie/i
  ]};
  if(s===2)return{must:[/season\s*2/i,/saison\s*2/i,/2nd\s*season/i,/[\s\-]ii\b/i,/\b2\b/]};
  if(s===3)return{must:[/season\s*3/i,/saison\s*3/i,/3rd\s*season/i,/[\s\-]iii\b/i,/\b3\b/]};
  if(s===4)return{must:[/season\s*4/i,/saison\s*4/i,/4th\s*season/i,/[\s\-]iv\b/i,/\b4\b/,/final\s*season/i]};
  return{must:[
    new RegExp("(?:season|saison)\\s*"+s,"i"),
    new RegExp("\\b"+s+"\\b")
  ]}
}

function matchCard(cards,targetTitles,baseTitle,season=1,seasonName="",episodeTitle=""){
  const normalizeTitle=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  const targets=[...new Set((targetTitles||[]).map(normalizeTitle).filter(Boolean))];
  const base=normalizeTitle(baseTitle),sn=normalizeTitle(seasonName),en=normalizeTitle(episodeTitle),seasonNo=Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1;
  const scored=[];
  for(const c of cards){
    const titles=cardTitles(c).map(normalizeTitle).filter(Boolean);
    if(!titles.length)continue;
    let identity=0,seasonEvidence=0;
    for(const n of titles){
      if(targets.includes(n))identity=Math.max(identity,100);
      // Allow a provider's season-qualified title only when the mapped canonical title
      // is a complete title component, not an arbitrary substring.
      if(targets.some(t=>n===t+" "+sn||n===sn+" "+t))identity=Math.max(identity,120);
      if(base&&(n===base||n.startsWith(base+" ")||n.endsWith(" "+base)))identity=Math.max(identity,75);
      if(sn&&sn!=="season "+seasonNo&&(n===sn||n.endsWith(" "+sn)||n.includes(" "+sn+" ")))seasonEvidence=Math.max(seasonEvidence,15);
      if(en&&n===en)seasonEvidence=Math.max(seasonEvidence,5);
    }
    if(identity>0)scored.push({slug:cardSlug(c),score:identity+seasonEvidence});
  }
  scored.sort((a,b)=>b.score-a.score);
  if(!scored.length)return null;
  if(scored.length>1&&scored[0].score===scored[1].score)return null;
  return scored[0].slug||null;
}

function matchMovieCard(cards,targetTitles){
  const normalizeTitle=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  const targets=[...new Set((targetTitles||[]).map(normalizeTitle).filter(Boolean))];
  const matches=[];
  for(const c of cards){
    if(cardTitles(c).some(t=>targets.includes(normalizeTitle(t))))matches.push(cardSlug(c));
  }
  const unique=[...new Set(matches.filter(Boolean))];
  return unique.length===1?unique[0]:null;
}

async function searchCards(q){
  if(!q)return[];
  const h=await text(BASE+"/anime?search="+encodeURIComponent(q)+"&sort=title-asc",{},9000);
  return h?parseCards(h):[]
}

function parseVidstack(html){
  const src=String(html||""),m=src.match(/vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/);
  if(m){
    const d=decodeJSON(m[1]);
    if(d&&d.src){
      const subtitles=(Array.isArray(d.subtitles)?d.subtitles:[])
        .map(s=>({
          url:String(s.file||"").replace(/\\/g,""),
          name:s.title||s.language||"English",
          language:s.language||"en"
        }))
        .filter(s=>s.url);
      return{masterUrl:String(d.src).replace(/\\/g,""),subtitles}
    }
  }
  const root=parseHTML(src);
  let masterUrl=attr(first(root,"media-player"),"src")||"";
  if(!masterUrl){
    const u=src.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/i);
    if(u)masterUrl=u[0]
  }
  const subtitles=[];
  for(const t of all(root,"track")){
    const u=attr(t,"src")||"",kind=String(attr(t,"kind")||"").toLowerCase();
    if(u&&(kind==="subtitles"||kind==="captions"||/\.(ass|vtt)(?:\?|$)/i.test(u)))subtitles.push({
      url:u,
      name:attr(t,"label")||"English",
      language:attr(t,"srclang")||"en"
    })
  }
  return{masterUrl,subtitles}
}

function parseAudioFormat(s){
  const x=String(s||"").toLowerCase(),j=x.includes("japanese")||x.includes("jpn")||x.includes("ja"),e=x.includes("english")||x.includes("eng")||x.includes("en");
  if(e&&j)return"Dual Audio";
  if(e)return"Dub";
  if(j)return"Sub";
  if(x.includes("multi"))return"Multi-Audio";
  return"Sub"
}

async function episodePage(slug,ep){
  const r=await req(BASE+"/anime/"+slug+"/"+ep,{},10000);
  if(!r||!r.ok)return null;
  let html="";
  try{html=await r.text()}catch(e){return null}
  let cookie="";
  try{
    if(r.headers&&typeof r.headers.getSetCookie==="function")cookie=r.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
    else if(r.headers&&r.headers.get)cookie=r.headers.get("set-cookie")||""
  }catch(e){}
  return{html,cookie}
}

async function getTmdbInfo(tmdbId,mediaType,season=1,episode=1){
  const type=mediaType==="movie"?"movie":"tv";
  const url="https://api.themoviedb.org/3/"+type+"/"+encodeURIComponent(tmdbId)+"?api_key="+TMDB_API_KEY+"&language=en-US";
  const d=await json(url,{headers:{"Accept":"application/json"}},7000);
  if(!d)return null;
  let seasonData=null;
  if(type==="tv"){
    seasonData=await json("https://api.themoviedb.org/3/tv/"+encodeURIComponent(tmdbId)+"/season/"+encodeURIComponent(Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1)+"?api_key="+TMDB_API_KEY+"&language=en-US",{headers:{"Accept":"application/json"}},7000);
  }
  const requestedEpisode=seasonData&&Array.isArray(seasonData.episodes)?seasonData.episodes.find(x=>Number(x.episode_number)===(Number(episode)||1)):null;
  return{
    title:d.name||d.title||d.original_name||d.original_title||"",
    originalTitle:d.original_name||d.original_title||"",
    seasonName:seasonData&&seasonData.name||"",
    episodeTitle:requestedEpisode&&requestedEpisode.name||"",
    seasonEpisodeCount:seasonData&&Array.isArray(seasonData.episodes)?seasonData.episodes.length:0
  }
}

async function dbMovieMapping(tmdbId){
  const id=String(tmdbId||"").trim();
  if(!/^\\d{1,10}$/.test(id)||Number(id)<=0)return null;
  const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(id)+"&tmdbId="+encodeURIComponent(id)+"&mediaType=movie&pending=1";
  const d=await json(u,{headers:{"Accept":"application/json"}},5000);
  if(d&&d.eligibility==="non_anime")return{media_type:"movie",tmdb_id:id,eligibility_status:"confirmed_non_anime",animeEligible:false};
  return d&&d.ok&&d.mapping&&d.mapping.media_type==="movie"&&String(d.mapping.tmdb_id)===id?d.mapping:null;
}
async function dbMapping(tmdbId,season,episode){
  tmdbId=String(tmdbId||"").trim();
  season=Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1;
  episode=Number(episode)||1;
  if(!tmdbId){
    console.log("[AniZone Lazy] REFUSING EMPTY TMDB ID");
    return null
  }
  const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&pending=1";
  const d=await json(u,{headers:{"Accept":"application/json"}},8000);
  if(d&&d.ok&&d.mapping){
    console.log("[AniZone Lazy] DB HIT",{tmdbId,season,episode,boundary:!!(d.state&&d.state.boundary)});
    return{mapping:d.mapping,fromDb:true,state:d.state||null}
  }
  console.log("[AniZone Lazy] DB MISS",{tmdbId,season,episode,status:d&&d.status,error:d&&d.error});
  return null
}

function pollLazyMapping(tmdbId,season,episode,maxWait){
  const delays=[250,500,1000,1500,2000];
  const start=Date.now();
  return new Promise(resolve=>{
    let i=0;
    const attempt=()=>{
      if(i>=delays.length)return resolve(null);
      if(Date.now()-start>=maxWait)return resolve(null);
      const d=delays[i++];
      setTimeout(()=>{
        if(Date.now()-start>=maxWait)return resolve(null);
        const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&pending=1";
        json(u,{headers:{"Accept":"application/json"}},8000).then(d=>{
          if(d&&d.ok&&d.mapping)return resolve({mapping:d.mapping,fromDb:true,state:d.state||null});
          attempt()
        }).catch(()=>attempt())
      },d)
    };
    attempt()
  })
}

function mapTitle(m){
  return String(m&&(m.anime_title||m.title||m.name||m.mal_title)||"").trim()
}

function mapEp(m,fallback){
  const n=Number(m&&(m.mal_episode!=null?m.mal_episode:m.episode!=null?m.episode:m.malEpisode));
  return Number.isInteger(n)&&n>0?n:null
}

function mapTitles(m){
  const a=[];
  if(m&&Array.isArray(m.titles))a.push(...m.titles);
  const t=mapTitle(m);
  if(t)a.push(t);
  return[...new Set(a.map(x=>String(x||"").trim()).filter(Boolean))]
}

function mapMalId(m){
  const v=m&&(m.mal_id!=null?m.mal_id:m.malId!=null?m.malId:m.id);
  return v==null?"":String(v)
}

function mapImdb(m){
  return String(m&&(m.imdb_id||m.imdbId||m.imdb)||"")
}

function cleanQuery(s){
  return String(s||"").split(":")[0].replace(/season.*|\d+(?:st|nd|rd|th)\s+season|saison.*/i,"").trim()
}

async function resolveStream(tmdbId,mediaType,season,episode,settings){
  tmdbId=String(tmdbId||"").trim();
  mediaType=String(mediaType||"tv").toLowerCase();
  season=Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1;
  episode=Number(episode)||1;
  if(!tmdbId){
    console.log("[AniZone Lazy] ABORT EMPTY TMDB ID");
    return[]
  }

  console.log("[AniZone Lazy] REQUEST",{tmdbId,mediaType,season,episode});

  const movie=mediaType==="movie";
  let mappingResult=null,title="",altTitles=[],targetTitles=[],malEpisode=movie?1:episode,imdbId="",malId="",seasonName="";

  if(!movie){
    mappingResult=await dbMapping(tmdbId,season,episode);
    if(!mappingResult||!mappingResult.mapping){
      const autoPopulate=!["false","0","disabled","off"].includes(String(getSetting(settings,["autoPopulateMissingMappings","auto_populate_missing_mappings","autoPopulate","autoPopulateMappings"],"enabled")).toLowerCase());
      if(!autoPopulate){
        console.log("[AniZone Lazy] AUTO POPULATION DISABLED — READ ONLY");
        return[]
      }
      const triggerUrl=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&populate=1&trigger=anizone-lazy";
      const triggered=await json(triggerUrl,{headers:{"Accept":"application/json"}},8000);
      if(triggered&&triggered.ok&&triggered.mapping)mappingResult={mapping:triggered.mapping,fromDb:true,state:triggered.state||null};
      else {
        const polled=await pollLazyMapping(tmdbId,season,episode,8000);
        if(polled&&polled.mapping){console.log("[AniZone Lazy] POLL SUCCESS");mappingResult=polled}
        else {console.log("[AniZone Lazy] POPULATION PENDING OR UNAVAILABLE");return[]}
      }
    }

    const m=mappingResult.mapping;
    title=mapTitle(m);
    targetTitles=mapTitles(m);
    malEpisode=mapEp(m,episode);
    if(!malEpisode){console.log("[AniZone Lazy] MAPPING HAS NO VALID PROVIDER EPISODE",{tmdbId,season,episode});return[]}
    imdbId=mapImdb(m);
    malId=mapMalId(m);
    seasonName=String(m.season_name||m.seasonName||"");


  }else{
    if(!/^\\d{1,10}$/.test(tmdbId)||Number(tmdbId)<=0){
      console.log("[AniZone Lazy] INVALID MOVIE TMDB ID",tmdbId);
      return[]
    }
    const existingMovie=await dbMovieMapping(tmdbId);
    if(existingMovie&&existingMovie.eligibility_status==="confirmed_non_anime")return[];
    if(existingMovie){
      title=String(existingMovie.title||existingMovie.original_title||existingMovie.mal_title||"").trim();
      if(existingMovie.mal_title&&normalize(existingMovie.mal_title)!==normalize(title))altTitles.push(existingMovie.mal_title);
      targetTitles=mapTitles(existingMovie);
    }
    const info=await getTmdbInfo(tmdbId,"movie");
    if(!info||!info.title){
      console.log("[AniZone Lazy] MOVIE TMDB LOOKUP FAILED",tmdbId);
      return[]
    }
    if(!existingMovie){
      const autoPopulate=!["false","0","disabled","off"].includes(String(getSetting(settings,["autoPopulateMissingMappings","auto_populate_missing_mappings","autoPopulate","autoPopulateMappings"],"enabled")).toLowerCase());
      if(autoPopulate){
        const triggerUrl=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&mediaType=movie&operation=movie-franchise&populate=1&trigger=anizone-lazy";
        json(triggerUrl,{headers:{"Accept":"application/json"}},5000).catch(()=>{});
      }else console.log("[AniZone Lazy] MOVIE AUTO POPULATION DISABLED — READ ONLY");
    }
    if(!title)title=info.title;
    if(info.originalTitle&&normalize(info.originalTitle)!==normalize(title))altTitles.push(info.originalTitle)
  }

  const tmdbInfo=!movie?await getTmdbInfo(tmdbId,"tv",season,episode):null;
  if(tmdbInfo){
    if(tmdbInfo.title&&!title)title=tmdbInfo.title;
    if(tmdbInfo.originalTitle&&normalize(tmdbInfo.originalTitle)!==normalize(title))altTitles.push(tmdbInfo.originalTitle);
    seasonName=seasonName||tmdbInfo.seasonName||""
  }

  const specific=[...new Set([...targetTitles,title,...altTitles].filter(Boolean))];
  const base=cleanQuery(title);

  let cards=await searchCards(base);

  if(!cards.length&&title!==base)cards=await searchCards(title);

  if(!cards.length){
    for(const t of altTitles){
      cards=await searchCards(t.split(":")[0].trim());
      if(cards.length)break
    }
  }

  if(!cards.length){
    console.log("[AniZone Lazy] SEARCH EMPTY",title);
    return[]
  }

  const seasonEvidence=tmdbInfo&&tmdbInfo.episodeTitle||"";
  const slug=movie?matchMovieCard(cards,specific):matchCard(cards,specific,base,season,seasonName,seasonEvidence);

  if(!slug){
    console.log("[AniZone Lazy] CARD NOT FOUND",{title,season,results:cards.length});
    return[]
  }

  console.log("[AniZone Lazy] CARD MATCH",{title,slug,episode:malEpisode});

  const page=await episodePage(slug,malEpisode);
  if(!page){
    console.log("[AniZone Lazy] EPISODE PAGE FAILED",{slug,episode:malEpisode});
    return[]
  }

  const root=parseHTML(page.html);
  const parsed=parseVidstack(page.html);
  const streams=[];
  const seen=new Set();

  const buttons=all(root,"button").filter(b=>String(attr(b,"wire:click")||"").includes("setVideo"));

  let defaultFormat="Sub",defaultServerName="AniZone";

  if(buttons.length){
    const label=nodeText(buttons[0]).replace(/\s+/g," ").trim();
    defaultFormat=parseAudioFormat(label);
    const nm=label.match(/^([A-Za-z0-9_-]+)/);
    if(nm)defaultServerName=nm[1]
  }

  if(parsed.masterUrl){
    seen.add(parsed.masterUrl);
    streams.push({
      name:"AniZone",
      title:title+" - Episode "+malEpisode+" ["+defaultServerName+" - "+defaultFormat+"]",
      url:parsed.masterUrl,
      quality:"Multi",
      headers:HEADERS,
      subtitles:parsed.subtitles||[]
    })
  }

  if(buttons.length>1){
    const csrf=String(
      attr(first(root,"script[data-csrf]"),"data-csrf")||
      attr(first(root,'meta[name="csrf-token"]'),"content")||
      ""
    );
    const snapshot=attr(first(root,"[wire:snapshot]"),"wire:snapshot")||"";
    const componentId=attr(first(root,"[wire:id]"),"wire:id")||"";

    if(csrf&&snapshot&&page.cookie){
      const jobs=[];

      for(let i=1;i<buttons.length;i++){
        const btn=buttons[i];
        const vm=String(attr(btn,"wire:click")||"").match(/setVideo\((\d+)\)/);
        if(!vm)continue;

        const videoId=Number(vm[1]);
        const label=nodeText(btn).replace(/\s+/g," ").trim();
        const format=parseAudioFormat(label);
        const nm=label.match(/^([A-Za-z0-9_-]+)/);
        const serverName=nm?nm[1]:"Server "+(i+1);

        jobs.push((async()=>{
          try{
            const body={
              _token:csrf,
              components:[{
                snapshot,
                updates:{},
                calls:[{
                  path:"",
                  method:"setVideo",
                  params:[videoId]
                }]
              }]
            };

            const r=await req(BASE+"/livewire/update",{
              method:"POST",
              headers:{
                "Accept":"*/*",
                "Content-Type":"application/json",
                "X-Livewire":"",
                "X-CSRF-TOKEN":csrf,
                "Origin":BASE,
                "Referer":BASE+"/anime/"+slug+"/"+malEpisode,
                "Cookie":page.cookie,
                ...(componentId?{"X-Livewire-Id":componentId}:{})
              },
              body:JSON.stringify(body)
            },8000);

            if(!r||!r.ok)return null;

            let raw="";
            try{raw=await r.text()}catch(e){return null}

            let data=null;
            try{data=JSON.parse(raw)}catch(e){}

            let html="";
            if(data&&data.components&&data.components[0]&&data.components[0].effects){
              html=data.components[0].effects.html||""
            }
            if(!html)html=raw;
            if(!html)return null;

            const p=parseVidstack(html);
            if(!p.masterUrl||seen.has(p.masterUrl))return null;

            return{
              url:p.masterUrl,
              stream:{
                name:"AniZone",
                title:title+" - Episode "+malEpisode+" ["+serverName+" - "+format+"]",
                url:p.masterUrl,
                quality:"Multi",
                headers:HEADERS,
                subtitles:p.subtitles&&p.subtitles.length?p.subtitles:parsed.subtitles||[]
              }
            }
          }catch(e){
            console.log("[AniZone Lazy] LIVEWIRE SERVER FAILED",videoId,String(e));
            return null
          }
        })())
      }

      const extra=await Promise.all(jobs);

      for(const x of extra){
        if(x&&x.stream&&!seen.has(x.url)){
          seen.add(x.url);
          streams.push(x.stream)
        }
      }
    }
  }

  console.log("[AniZone Lazy] STREAMS FOUND",{title,slug,episode:malEpisode,count:streams.length});
  return streams
}

function getSetting(settings,names,fallback){
  if(!settings||typeof settings!=="object")return fallback;
  for(const n of names)if(Object.prototype.hasOwnProperty.call(settings,n)&&settings[n]!==undefined&&settings[n]!==null)return settings[n];
  return fallback
}
function onSettings(){
  return [{type:"select",key:"autoPopulateMissingMappings",name:"autoPopulateMissingMappings",label:"Auto-populate missing mappings",options:[{label:"Enabled",value:"enabled"},{label:"Disabled",value:"disabled"}],default:"enabled"}]
}
async function getStreams(tmdbId,mediaType,season,episode,settings={}){
  try{
    return await resolveStream(
      String(tmdbId||""),
      String(mediaType||"tv"),
      Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1,
      Number(episode)||1,
      settings
    )
  }catch(e){
    console.log("[AniZone Lazy] ERROR",String(e));
    return[]
  }
}

module.exports={getStreams,onSettings};
