const {test}=require('node:test');
const assert=require('node:assert/strict');
const create=require('./tiktok-publisher');
const delivery=require('./delivery-status');
function fixture({size=10,final='PROCESSING_UPLOAD',expire=false,uploadFail=false}={}) {
 const calls=[], puts=[]; let refreshed=false;
 const row={id:7,access_token:'old',page_access_token:'refresh'};
 const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[row]};}};
 const http={get:async()=>({data:Buffer.alloc(size)}),put:async(url,data,config)=>{puts.push({size:data.length,range:config.headers['Content-Range']}); if(uploadFail)throw new Error('timeout');},post:async(url,payload)=>{
  calls.push({url,payload});
  if(url.includes('oauth/token')){refreshed=true;return {data:{access_token:'new',refresh_token:'rotated'}};}
  if(expire&&!refreshed){return {data:{error:{code:'access_token_invalid',message:'expired'}}};}
  if(url.includes('creator_info'))return {data:{error:{code:'ok'},data:{privacy_level_options:['SELF_ONLY','PUBLIC_TO_EVERYONE'],max_video_post_duration_sec:60,comment_disabled:true}}};
  if(url.includes('video/init'))return {data:{data:{publish_id:'session1',upload_url:'https://upload.example/video'}}};
  if(url.includes('status/fetch'))return {data:{data:{status:final,fail_reason:final==='FAILED'?'duration_check_failed':undefined}}};
  throw new Error('unexpected request');
 }};
 return {api:create(pool,http),calls,puts};
}
const input={content:'NNIT video',videoUrl:'https://res.cloudinary.com/nnit/video/upload/test.mp4',tiktok:{privacy:'SELF_ONLY',duration:10,consent:true,comments:true}};
test('upload is checkpointed before transfer and pending is not published',async()=>{
 const f=fixture();let saved;
 const result=await f.api.publish(input,async x=>{assert.equal(f.puts.length,0);saved=x;});
 assert.equal(saved.publish_id,'session1');assert.equal(result.pending,true);assert.equal(result.success,false);
 assert.equal(delivery({tiktok:result}).status,'processing');
 const init=f.calls.find(x=>x.url?.includes('video/init')).payload;
 assert.equal(init.source_info.chunk_size,10);assert.equal(init.source_info.total_chunk_count,1);
 assert.equal(init.post_info.disable_comment,true);
});
test('confirmed and rejected publication remain distinct',async()=>{
 assert.equal((await fixture({final:'PUBLISH_COMPLETE'}).api.publish(input)).success,true);
 const failed=await fixture({final:'FAILED'}).api.publish(input);
 assert.equal(failed.pending,false);assert.equal(failed.error,'duration_check_failed');
});
test('expired access token refreshes and stores rotated credentials',async()=>{
 const f=fixture({expire:true});await f.api.creator();
 assert.ok(f.calls.some(x=>x.sql?.startsWith('UPDATE social_accounts')&&x.args[1]==='rotated'));
});
test('invalid consent, privacy, duration and external URL never initialize a post',async()=>{
 for(const variant of [{tiktok:{...input.tiktok,consent:false}},{tiktok:{...input.tiktok,privacy:''}},{tiktok:{...input.tiktok,duration:90}},{videoUrl:'http://localhost/video'}]){
  const f=fixture();await assert.rejects(f.api.publish({...input,...variant}));
  assert.ok(!f.calls.some(x=>x.url?.includes('video/init')));
 }
});
test('uncertain upload retains session instead of reporting failure or retrying',async()=>{
 const f=fixture({uploadFail:true});const result=await f.api.publish(input);
 assert.equal(result.pending,true);assert.equal(result.publish_id,'session1');
 assert.equal(f.calls.filter(x=>x.url?.includes('video/init')).length,1);
});
test('large upload includes trailing bytes in final chunk',async()=>{
 const size=65*1024*1024+3;const f=fixture({size});await f.api.publish(input);
 assert.equal(f.puts.reduce((sum,x)=>sum+x.size,0),size);
 assert.equal(f.puts.length,3);
 assert.ok(f.puts.at(-1).range.endsWith(`${size-1}/${size}`));
});
