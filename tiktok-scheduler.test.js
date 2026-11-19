const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const deliveryStatus=require('./delivery-status');
const source=fs.readFileSync(require.resolve('./server'),'utf8');
test('scheduled TikTok retains video and options and rejects missing media',async()=>{
 let handler,saved;
 const start=source.indexOf("app.post('/api/posts/schedule'");
 const end=source.indexOf("app.get('/api/posts/scheduled/",start);
 vm.runInNewContext(source.slice(start,end),{app:{post:(_,fn)=>handler=fn},pool:{query:async(sql,args)=>{saved=args;return {rows:[{id:8}]};}},tiktokPublisher:{creator:async()=>({}),validate:()=>{}},console});
 let code=200,body;
 const res={status(c){code=c;return this;},json(b){body=b;}};
 const media=[{type:'video',url:'https://res.cloudinary.com/nnit/video.mp4',tiktok:{privacy:'SELF_ONLY',consent:true,duration:12}}];
 await handler({body:{clientId:4,content:'video',platforms:['tiktok'],scheduledTime:'2026-11-20T10:00:00Z',media}},res);
 assert.equal(body.success,true);assert.deepEqual(JSON.parse(saved[4]),media);
 saved=null;
 await handler({body:{clientId:4,platforms:['tiktok']}},res);
 assert.equal(code,400);assert.equal(saved,null);
});
test('scheduler resumes saved TikTok session without uploading again',async()=>{
 const start=source.indexOf('let schedulerRunning = false');
 const end=source.indexOf('setInterval(runScheduler');
 let saved,checks=0,uploads=0;
 const old={id:9,results:{facebook:{success:true},tiktok:{success:false,pending:true,publish_id:'saved'}},published_at:'2026-11-18T18:00:00Z'};
 const pool={query:async(sql,args)=>{
  if(sql.includes("status = 'processing'"))return {rows:[old]};
  if(sql.startsWith('SELECT'))return {rows:[]};
  saved=args;return {rows:[]};
 }};
 await vm.runInNewContext(source.slice(start,end)+'\nrunScheduler();',{pool,deliveryStatus,tiktokPublisher:{status:async id=>{assert.equal(id,'saved');checks++;return {success:true,pending:false,publish_id:id};}},platformPublishers:{tiktok:async()=>{uploads++;}},console});
 assert.equal(checks,1);assert.equal(uploads,0);assert.equal(saved[0],'published');
 assert.equal(saved[2],old.published_at);
});
