const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const path=require('node:path');
const file=path.resolve(__dirname,'../providers/cinestream.js');
function load(sources){
 const calls=[];const context={module:{exports:{}},require:createRequire(file),process,URL,console:{log(){},warn(){}},capture:url=>{calls.push(url);return Promise.resolve(sources);}};
 vm.runInNewContext(fs.readFileSync(file,'utf8')+'\ngetVideoSources = capture;',context);
 return {provider:context.module.exports,calls};
}
test('movie, tv and series map IDs and episodes correctly',async()=>{
 const {provider,calls}=load([]);
 await provider.getcinestreams(550,'movie');
 await provider.getcinestreams(1622,'tv',1,3);
 await provider.getcinestreams(1622,'series',2,4);
 assert.deepEqual(calls,['cs://movie/550/1/1','cs://tv/1622/1/3','cs://tv/1622/2/4']);
 await assert.rejects(provider.getcinestreams(1622,'tv',1,0),/Invalid/);
});
test('normalizes streams while preserving required headers and subtitles',async()=>{
 const {provider}=load([{url:'https://media.example/master.m3u8',label:'Vidcore [1080p]',container:'hls',headers:{Referer:'https://vidcore.io/','User-Agent':'upstream-agent'},subtitles:[{url:'https://media.example/en.vtt',lang:'en',label:'English'}]}]);
 const [s]=await provider.getcinestreams(550,'movie');
 assert.equal(s.provider,'cinestream');assert.equal(s.quality,'1080p');
 assert.equal(s.format,'hls');assert.equal(s.mimeType,'application/vnd.apple.mpegurl');
 assert.equal(s.headers['User-Agent'],'upstream-agent');assert.equal(s.headers.Referer,'https://vidcore.io/');
 assert.equal(s.subtitles.length,1);
});
test('probes Googleusercontent downloads with GET and preserves response headers',async()=>{
 let request;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  request={url,options};
  return {ok:true,status:200,headers:new Map([
   ['content-type','video/mkv'],
   ['x-guploader-uploadid','upload-123'],
   ['content-disposition','attachment; filename="episode.mkv"'],
   ['content-length','6303134380'],
   ['server','UploadServer']
  ]),body:{cancel:async()=>{}}};
 };
 try {
  const {provider}=load([{url:'https://video-downloads.googleusercontent.com/stream?id=1',label:'HubCloud [1080p]',container:'mkv',headers:{Referer:'https://hubcloud.example/'}}]);
  const [s]=await provider.getcinestreams(550,'movie');
  assert.equal(request.options.method,'GET');
  assert.equal(request.url,'https://video-downloads.googleusercontent.com/stream?id=1');
  assert.equal(s.headers['content-type'],'video/mkv');
  assert.equal(s.headers['x-guploader-uploadid'],'upload-123');
  assert.equal(s.headers['content-disposition'],'attachment; filename="episode.mkv"');
  assert.equal(s.headers['content-length'],'6303134380');
  assert.equal(s.headers.server,'UploadServer');
 } finally {
  globalThis.fetch=originalFetch;
 }
});
