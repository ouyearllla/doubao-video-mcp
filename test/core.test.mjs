import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {definitions,validateArgs,Ledger,safeFilename,canAdoptConversation,decodeCardMedia,downloadWithFallback,ResourceUnavailable,submitOnce} from '../mcp/tools.mjs';
import {videoSettings,confirmationPrompt,assertVideoSelection} from '../bridge/video-settings.mjs';
import {confirmVideo} from '../bridge/bridge.mjs';
test('自定义模型、整数时长与比例通过校验，非法时长拒绝',()=>{
 const def=definitions.find(d=>d.name==='doubao_video_prepare');
 validateArgs(def,{model:'seedance_v2.0_mini',ratio:'9:16',duration:10});
 for(const duration of [0,61,10.5,'10',NaN,Infinity])assert.throws(()=>validateArgs(def,{duration}));
 assert.throws(()=>validateArgs(def,{model:'unknown'}));
 assert.deepEqual(videoSettings(),{model:'seedance_v2.0',ratio:'16:9',duration:15});
});
const custom={model:'seedance_v2.0_mini',ratio:'9:16',duration:10};
const confirmation='模型： Seedance 2.0 Mini\n时长： 10 秒\n比例： 9:16 竖屏\n确认后我再开始生成视频。';
test('确认采用原自定义参数，参数不符或已开始时拒绝',()=>{
 assert.match(confirmationPrompt(confirmation,custom),/Mini生成10秒、9:16/);
 assert.throws(()=>confirmationPrompt(confirmation,{...custom,duration:15}));
 assert.throws(()=>confirmationPrompt(confirmation+'现在开始生成视频',custom));
});
test('实际确认函数发送自定义确认词且不在校验失败后发送',async()=>{
 const sent=[];const runner=async(id,fn)=>fn({evaluate:async()=>confirmation,send:async(method,args)=>sent.push(args.text)});
 await confirmVideo('test',true,custom,runner);assert.equal(sent.length,1);assert.match(sent[0],/Mini生成10秒、9:16/);
 await assert.rejects(()=>confirmVideo('test',true,{...custom,ratio:'16:9'},runner));assert.equal(sent.length,1);
});
test('提交检查拒绝控件值或可见参数与自定义请求不符',()=>{
 const check={text:'prompt',buttonFound:true,disabled:false,model:custom.model,ratio:'9:16',duration:'10',uiText:'Seedance 2.0 Mini 9:16 · 10s'};
 assertVideoSelection(check,custom,'prompt');
 assert.throws(()=>assertVideoSelection({...check,model:'seedance_v2.0'},custom,'prompt'));
 assert.throws(()=>assertVideoSelection({...check,uiText:'Seedance 2.0 Mini 9:16 · 15s'},custom,'prompt'));
 assert.throws(()=>assertVideoSelection({...check,duration:'5',uiText:'Seedance 2.0 Mini 9:16 · 15s'},{...custom,duration:5},'prompt'));
 assert.throws(()=>assertVideoSelection({...check,model:'seedance_v2.0_std',uiText:'Seedance 2.0 Fast 9:16 · 10s'},{...custom,model:'seedance_v2.0_std'},'prompt'));
});
test('请求去重包含所有生成参数，省略默认值与显式默认值一致',async()=>{
 const dir=await fs.mkdtemp(path.join(scratch,'doubao-params-'));const ledger=new Ledger(dir);let calls=0;
 try{const perform=async()=>{calls++;return {submitted:true};};await submitOnce(ledger,'custom','target','prompt',custom,perform);
 for(const changed of [{...custom,duration:15},{...custom,ratio:'16:9'},{...custom,model:'seedance_v2.0'}])await assert.rejects(()=>submitOnce(ledger,'custom','target','prompt',changed,perform));
 await submitOnce(ledger,'default','target','prompt',{},perform);await submitOnce(ledger,'default','target','prompt',videoSettings(),perform);assert.equal(calls,2);
 }finally{await cleanup(dir);}
});
test('旧请求回执保留默认参数兼容，不以新参数再次执行',async()=>{
 const dir=await fs.mkdtemp(path.join(scratch,'doubao-legacy-'));const ledger=new Ledger(dir);let calls=0;
 try{const {createHash}=await import('node:crypto');await ledger.once('old',{target_id:'target',prompt_sha256:createHash('sha256').update('prompt').digest('hex')},async()=>({submitted:true}));
 const result=await submitOnce(ledger,'old','target','prompt',{},async()=>{calls++;});assert.equal(result.replayed,true);
 await assert.rejects(()=>submitOnce(ledger,'old','target','prompt',custom,async()=>{calls++;}));assert.equal(calls,0);
 }finally{await cleanup(dir);}
});
import {launchSettings} from '../bridge/launch.mjs';
import {resolveExecutable} from '../bridge/launch.mjs';
import {requestMedia,recoverPage,waitFor,confirmationKey} from '../mcp/workflow.mjs';
test('已有旧视频而新任务未完成时，不返回旧结果',()=>{
 const job={result:{binding_policy:'new_conversation',baseline_task_ids:['old']}},snapshot={tasks:[{task_id:'old'},{task_id:'new'}],videos:[{task_id:'old',src:'old'}]};
 const selected=requestMedia(job,snapshot);assert.equal(selected.task_id,'new');assert.deepEqual(selected.videos,[]);
 job.result.task_id=selected.task_id;snapshot.videos.push({task_id:'new',src:'new'});assert.equal(requestMedia(job,snapshot).videos[0].src,'new');
});
test('多个新任务或旧回执缺少基线时，不猜测视频',()=>{
 const snapshot={tasks:[{task_id:'a'},{task_id:'b'}],videos:[{task_id:'a'}]};
 assert.equal(requestMedia({result:{binding_policy:'new_conversation',baseline_task_ids:[]}},snapshot).binding,'ambiguous');
 assert.equal(requestMedia({result:{}},snapshot).binding,'required');
 assert.deepEqual(requestMedia({result:{task_id:'not-visible'}},snapshot).videos,[]);
 assert.equal(requestMedia({result:{binding_policy:'explicit',baseline_task_ids:[]}},snapshot).binding,'required');
});
test('重启后按原对话定位新页面，拒绝其他对话及重复页面',async()=>{
 const job={payload:{target_id:'old'},result:{conversation_url:'chrome://doubao-chat/chat/123'}};
 const page={id:'new',url:'doubao://doubao-chat/chat/123'};
 const found=await recoverPage(job,[page],async()=>({url:job.result.conversation_url,text:''}));assert.equal(found.id,'new');
 await assert.rejects(()=>recoverPage(job,[page],async()=>({url:'chrome://doubao-chat/chat/456',text:''})));
 await assert.rejects(()=>recoverPage(job,[page,{...page,id:'second'}],async()=>({url:job.result.conversation_url,text:''})));
});
test('慢加载会等待实际就绪，失败不会调用提交',async()=>{
 let reads=0;const value=await waitFor(async()=>({ready:++reads===4}),d=>d.ready,{interval:0,attempts:5});assert.equal(value.ready,true);assert.equal(reads,4);
 await assert.rejects(()=>waitFor(async()=>({ready:false}),d=>d.ready,{interval:0,attempts:2}));
});
test('自动发现豆包路径及显式路径错误',async()=>{
 const actual=path.resolve('custom install/Doubao.exe');
 assert.equal(await resolveExecutable({}, {exists:async p=>p===actual,discover:async()=>[actual]}),actual);
 await assert.rejects(()=>resolveExecutable({DOUBAO_EXE:'missing'}, {exists:async()=>false}));
});
test('内部确认键不会和用户编号x-confirm碰撞',()=>{
 assert.notEqual(confirmationKey('x'),'x-confirm');
 const def=definitions.find(d=>d.name==='doubao_video_submit');
 assert.throws(()=>validateArgs(def,{request_id:'__internal_x',prompt:'p',commit:true}));
});
test('默认启动常用豆包，旧独立目录不能覆盖原生模式',()=>{
 const config=launchSettings({DOUBAO_PROFILE_DIR:'old-isolated-profile'});
 assert.equal(config.mode,'native');assert.ok(!config.args.some(a=>a.startsWith('--user-data-dir')));
 assert.ok(config.args.includes('--remote-debugging-address=127.0.0.1'));
});
test('独立登录环境必须显式选择，且指定目录',()=>{
 const config=launchSettings({DOUBAO_PROFILE_MODE:'isolated',DOUBAO_PROFILE_DIR:'C:\\test profile'});
 assert.ok(config.args.includes('--user-data-dir=C:\\test profile'));
 assert.throws(()=>launchSettings({DOUBAO_PROFILE_MODE:'isolated'}));
 assert.throws(()=>launchSettings({DOUBAO_PROFILE_MODE:'unknown'}));
});
const scratch=path.join(os.tmpdir(),'doubao-video-mcp-tests');
await fs.mkdir(scratch,{recursive:true});
async function cleanup(dir){if(!path.resolve(dir).startsWith(path.resolve(scratch)+path.sep))throw Error('清理目录不在测试工作目录内');await fs.rm(dir,{recursive:true});}
test('请求回执跨重启复用，不再执行提交',async()=>{
 const dir=await fs.mkdtemp(path.join(scratch,'doubao-ledger-'));let calls=0;
 try{const a=new Ledger(dir);await a.once('smoke',{prompt_sha256:'same'},async()=>{calls++;return {submitted:true};});const b=new Ledger(dir);const r=await b.once('smoke',{prompt_sha256:'same'},async()=>{calls++;return {submitted:true};});assert.equal(calls,1);assert.equal(r.replayed,true);await assert.rejects(()=>b.once('smoke',{prompt_sha256:'different'},()=>{}),/不同参数/);}finally{await cleanup(dir);}
});
test('发送结果不确定时不自动重试',async()=>{
 const dir=await fs.mkdtemp(path.join(scratch,'doubao-uncertain-'));let calls=0;
 try{const a=new Ledger(dir);await assert.rejects(()=>a.once('case',{x:1},async()=>{calls++;throw Error('connection lost');}));const r=await new Ledger(dir).once('case',{x:1},async()=>{calls++;});assert.equal(calls,1);assert.equal(r.state,'uncertain');assert.equal(r.sent_unknown,true);}finally{await cleanup(dir);}
});
test('两个实例并发使用同一请求编号也只执行一次',async()=>{
 const dir=await fs.mkdtemp(path.join(scratch,'doubao-concurrent-'));let calls=0;
 try{const perform=async()=>{calls++;await new Promise(r=>setTimeout(r,30));return {submitted:true};};const outcomes=await Promise.allSettled([new Ledger(dir).once('parallel',{x:1},perform),new Ledger(dir).once('parallel',{x:1},perform)]);assert.equal(calls,1);assert.ok(outcomes.some(o=>o.status==='fulfilled'));}finally{await cleanup(dir);}
});
test('提交必须有commit:true及唯一请求编号',()=>{
 const def=definitions.find(d=>d.name==='doubao_video_submit');assert.throws(()=>validateArgs(def,{prompt:'test',request_id:'x',commit:false}));assert.throws(()=>validateArgs(def,{prompt:'test',commit:true}));assert.throws(()=>validateArgs(def,{prompt:'test',request_id:'../x',commit:true}));validateArgs(def,{prompt:'test',request_id:'smoke-1',commit:true});
});
test('下载文件名拒绝路径和Windows设备名',()=>{for(const n of ['../x.mp4','a\\b.mp4','CON.mp4','x.txt'])assert.throws(()=>safeFilename(n));assert.equal(safeFilename('视频.mp4'),'视频.mp4');});
test('只能把同一提示词的临时对话绑定到正式对话，不接受正式对话切换',()=>{const marker='a'.repeat(50);assert.equal(canAdoptConversation('chrome://doubao-chat/chat/local_1','chrome://doubao-chat/chat/123',marker,marker),true);assert.equal(canAdoptConversation('chrome://doubao-chat/chat/100','chrome://doubao-chat/chat/123',marker,marker),false);assert.equal(canAdoptConversation('chrome://doubao-chat/chat/local_1','chrome://doubao-chat/chat/123',marker,'other prompt'),false);});
test('播放器未挂载时读取已成功卡片的真实720p媒体尺寸，而非封面尺寸',()=>{const model={status:10,video_duration:15.073,video_list:{video_1:{vtype:'mp4',codec_type:'h264',vwidth:1280,vheight:720,size:1902103,main_url:Buffer.from('https://v11-vdl.doubao.com/generated.mp4').toString('base64')}}};const video=decodeCardMedia({isSuccess:true,width:384,height:216,videoModel:JSON.stringify(model)});assert.equal(video.width,1280);assert.equal(video.height,720);assert.equal(video.duration,15.073);assert.equal(video.source,'successful_card_metadata');assert.equal(decodeCardMedia({isSuccess:false,videoModel:model}),null);});
test('同时提供普通版与去水印版时使用客户端的去水印版，不改写普通链接参数',()=>{const model=url=>({status:10,video_duration:15.073,video_list:{a:{vtype:'mp4',codec_type:'h264',vwidth:1280,vheight:720,size:100,main_url:Buffer.from(url).toString('base64')}}});const normal=model('https://v11-vdl.doubao.com/normal?lr=video_gen_watermark_dyn');const clean=model('https://v26-vdl.doubao.com/actual-clean?lr=unwatermarked');const decoded=decodeCardMedia({isSuccess:true,videoModel:normal,cleanVideoModel:clean});assert.equal(decoded.src,'https://v26-vdl.doubao.com/actual-clean?lr=unwatermarked');assert.equal(decoded.watermark,'unwatermarked');assert.equal(decoded.source,'client_clean_card_metadata');assert.equal(decodeCardMedia({isSuccess:true,videoModel:normal}).watermark,'video_gen_watermark_dyn');});
const cleanVideo={src:'https://v11-vdl.doubao.com/clean',watermark:'unwatermarked'};
const normalVideo={src:'https://v11-vdl.doubao.com/normal',watermark:'video_gen_watermark_dyn'};
test('默认先下载无水印，不调用普通版',async()=>{const seen=[];const r=await downloadWithFallback({...normalVideo,alternatives:[cleanVideo]},false,async v=>{seen.push(v.src);return {bytes:1};});assert.deepEqual(seen,[cleanVideo.src]);assert.equal(r.fallback_used,false);});
test('无订阅场景未提供无水印资源时默认下载普通版并说明',async()=>{const r=await downloadWithFallback(normalVideo,false,async()=>({bytes:1}));assert.equal(r.video.src,normalVideo.src);assert.equal(r.fallback_used,true);assert.equal(r.fallback_reason,'clean_resource_missing');assert.match(r.notice,/带水印/);});
test('无水印链接403等资源失败时默认降级到普通版',async()=>{const seen=[];const r=await downloadWithFallback({...cleanVideo,alternatives:[normalVideo]},false,async v=>{seen.push(v.src);if(v.watermark==='unwatermarked')throw new ResourceUnavailable('下载HTTP 403');return {bytes:1};});assert.deepEqual(seen,[cleanVideo.src,normalVideo.src]);assert.equal(r.fallback_reason,'clean_download_unavailable');});
test('必须无水印时不降级，缺少资源也不下载普通版',async()=>{let calls=0;await assert.rejects(()=>downloadWithFallback(normalVideo,true,async()=>{calls++;}),/尚未提供/);assert.equal(calls,0);await assert.rejects(()=>downloadWithFallback({...cleanVideo,alternatives:[normalVideo]},true,async()=>{calls++;throw new ResourceUnavailable('HTTP 403');}),/严格模式/);assert.equal(calls,1);});
test('本地保存错误不会误触发普通版下载',async()=>{let calls=0;await assert.rejects(()=>downloadWithFallback({...cleanVideo,alternatives:[normalVideo]},false,async()=>{calls++;throw Error('permission denied');}),/permission denied/);assert.equal(calls,1);});
test('去水印元数据未准备好或损坏时仍保留普通版候选',()=>{const model={status:10,video_duration:15,video_list:{a:{vtype:'mp4',codec_type:'h264',vwidth:1280,vheight:720,main_url:Buffer.from('https://v11-vdl.doubao.com/normal?lr=video_gen_watermark_dyn').toString('base64')}}};for(const clean of ['malformed',{status:0}]){const r=decodeCardMedia({isSuccess:true,videoModel:model,cleanVideoModel:clean});assert.equal(r.watermark,'video_gen_watermark_dyn');}});
test('stdio握手、工具发现和未知工具错误均为有效JSON-RPC',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../mcp/server.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
 const output=readline.createInterface({input:child.stdout});const pending=new Map();let stderr='';child.stderr.on('data',c=>stderr+=c);output.on('line',line=>{const m=JSON.parse(line);pending.get(m.id)?.(m);});
 const call=(id,method,params)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr||'MCP timeout')),5000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 try{const i=await call(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});assert.equal(i.result.serverInfo.name,'doubao');const tools=await call(2,'tools/list',{});assert.equal(tools.result.tools.length,definitions.length);const err=await call(3,'tools/call',{name:'does_not_exist',arguments:{}});assert.equal(err.error.code,-32602);}finally{child.stdin.end();child.kill();output.close();}
});
