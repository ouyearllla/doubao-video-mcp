import {version,bridgeVersion,waitFor,requestMedia,recoverPage,confirmationKey} from './workflow.mjs';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {createWriteStream,existsSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';

const root=path.dirname(fileURLToPath(import.meta.url));
const installedBridge=path.resolve(root,'../bridge/bridge.mjs');
const bridgeFile=process.env.DOUBAO_BRIDGE_FILE??(existsSync(installedBridge)?installedBridge:path.resolve(root,'../doubao-local-api/bridge.mjs'));
const {models,videoSettings}=await import(pathToFileURL(path.join(path.dirname(bridgeFile),'video-settings.mjs')).href);
const api='http://127.0.0.1:9230';
const stateDir=process.env.DOUBAO_STATE_DIR??path.join(os.homedir(),'.codex','doubao-mcp-state');
const outputDefault=process.env.DOUBAO_OUTPUT_DIR??path.resolve(root,'..');
const headers={'X-Doubao-Local':'1','Content-Type':'application/json; charset=utf-8'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=(description,extra={})=>({type:'string',description,...extra});
const videoArgs={model:str('模型编号，默认seedance_v2.0（Fast）；实际可用性以客户端为准。',{enum:Object.keys(models)}),ratio:str('画面比例或auto，默认16:9。',{pattern:'^(auto|[1-9][0-9]?:[1-9][0-9]?)$'}),duration:{type:'integer',description:'秒数，默认15，实际范围由客户端决定。',minimum:1,maximum:60}};
const target={target_id:str('从doubao_list_pages获取。只有一个聊天页面时可省略。')};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const readonly={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true};
const localwrite={readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true};
const generation={readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true};
export const definitions=[
 {name:'doubao_doctor',description:'只读检查Node版本、安装路径、桥接版本和连接状态，不启动客户端、不读取凭据。',inputSchema:schema({}),annotations:readonly},
 {name:'doubao_list_requests',description:'列出本机生成回执，不返回提示词或媒体链接。',inputSchema:schema({limit:{type:'integer',minimum:1,maximum:100}}),annotations:readonly},
 {name:'doubao_resume_request',description:'恢复原请求对话；优先复用页面，必要时在无草稿、无正在回复的页面打开原对话，不重发生成。',inputSchema:schema({...target,request_id:str('原请求编号。',{pattern:'^[A-Za-z0-9_-]{1,100}$'})},['request_id']),annotations:localwrite},
 {name:'doubao_video_options',description:'进入视频模式并读取当前模型、比例和时长真实选项，不发送、也不选择新模型。',inputSchema:schema(target),annotations:localwrite},
 {name:'doubao_video_bind_task',description:'旧回执无任务绑定或出现歧义时，将用户明确选定的可见task_id绑定到原请求；不生成，不自动猜测。',inputSchema:schema({...target,request_id:str('原请求编号。',{pattern:'^[A-Za-z0-9_-]{1,100}$'}),task_id:str('原对话中的真实任务ID。',{pattern:'^[0-9]+$'})},['request_id','task_id']),annotations:localwrite},
 {name:'doubao_connect',description:'连接本机豆包，复用登录；多个页面时可传target_id。等待聊天实际就绪，不生成视频。',inputSchema:schema(target),annotations:localwrite},
 {name:'doubao_list_pages',description:'列出可控制的豆包聊天页面。',inputSchema:schema({}),annotations:readonly},
 {name:'doubao_inspect',description:'读取选中页面的文本和控件，不截图、不执行任意脚本。',inputSchema:schema(target),annotations:readonly},
 {name:'doubao_new_chat',description:'打开新对话。若有未发送草稿则拒绝，不覆盖草稿。',inputSchema:schema(target),annotations:localwrite},
 {name:'doubao_video_config',description:'查询视频参数和旧版额度接口。旧版remain_count可能不反映新版任务实时状态。',inputSchema:schema(target),annotations:readonly},
 {name:'doubao_video_prepare',description:'进入视频模式，模型、比例、时长可选，默认Fast、16:9、15秒。客户端不提供的选项明确报错，不发送。',inputSchema:schema({...target,...videoArgs}),annotations:localwrite},
 {name:'doubao_video_draft',description:'准确写入完整提示词并校验段落，不提交生成。',inputSchema:schema({...target,prompt:str('完整提示词，不会自动改写。',{minLength:1,maxLength:24000})},['prompt']),annotations:localwrite},
 {name:'doubao_video_submit',description:'按与prepare一致的model/ratio/duration提交，省略则默认Fast、16:9、15秒。需要用户授权和commit:true；相同request_id不会重复发送。',inputSchema:schema({...target,...videoArgs,request_id:str('本次唯一编号，重试保持原编号。',{pattern:'^[A-Za-z0-9_-]{1,100}$'}),prompt:str('须与草稿一致。',{minLength:1,maxLength:24000}),commit:{type:'boolean',const:true}},['request_id','prompt','commit']),annotations:generation},
 {name:'doubao_video_confirm',description:'豆包要求确认时，在原提交的同一页面回应一次。与submit使用同一个request_id，不启动额外任务。',inputSchema:schema({request_id:str('已提交请求的编号。',{pattern:'^[A-Za-z0-9_-]{1,100}$'}),commit:{type:'boolean',const:true}},['request_id','commit']),annotations:generation},
 {name:'doubao_video_status',description:'读取当前对话的可播放视频、时长和文本。可以传request_id检查原任务；不会重试生成。',inputSchema:schema({...target,request_id:str('可选，定位本次提交的任务。',{pattern:'^[A-Za-z0-9_-]{1,100}$'})}),annotations:readonly},
 {name:'doubao_video_download',description:'下载已有视频：默认优先无水印，资源缺失或不可下载时退回普通版并说明。require_clean:true禁用降级。拒绝覆盖；不生成或自行去除水印。',inputSchema:schema({...target,request_id:str('可选，定位原任务。',{pattern:'^[A-Za-z0-9_-]{1,100}$'}),output_dir:str('绝对输出目录；默认使用安装时配置的目录。'),filename:str('仅文件名，须以.mp4结尾；不接受路径。'),require_clean:{type:'boolean',description:'默认false，优先无水印、缺少则下载普通版。只有用户明确要求必须无水印时传true。'}}),annotations:{...localwrite,idempotentHint:false}}
];

export function validateArgs(def,args){
 if(typeof args?.request_id==='string'&&args.request_id.startsWith('__internal_'))throw Error('请求编号不能使用内部保留前缀');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('arguments必须为对象');
 for(const k of def.inputSchema.required??[])if(!(k in args))throw Error(`缺少参数${k}`);
 for(const [k,v]of Object.entries(args)){
  const s=def.inputSchema.properties[k];if(!s)throw Error(`未知参数${k}`);
  if(s.type==='integer'?!Number.isInteger(v):typeof v!==s.type)throw Error(`${k}类型错误`);
  if(s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum)throw Error(`${k}超出范围`);
  if(s.enum&&!s.enum.includes(v))throw Error(`${k}不支持该取值`);
  if('const'in s&&v!==s.const)throw Error(`${k}必须为${s.const}`);
  if(s.pattern&&!new RegExp(s.pattern).test(v))throw Error(`${k}格式错误`);
  if(s.minLength!==undefined&&v.length<s.minLength)throw Error(`${k}不能为空`);
  if(s.maxLength!==undefined&&v.length>s.maxLength)throw Error(`${k}过长`);
 }
}
export class Ledger{
 constructor(directory){this.directory=directory;}
 file(id){if(!/^[A-Za-z0-9_-]{1,110}$/.test(id))throw Error('请求编号格式错误');return path.join(this.directory,id+'.json');}
 async get(id){try{return JSON.parse(await fs.readFile(this.file(id),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async put(id,value){await fs.mkdir(this.directory,{recursive:true});const temp=this.file(id)+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2),{flag:'wx'});await fs.rename(temp,this.file(id));}
 async once(id,payload,perform){
  const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const old=await this.get(id);
  if(old){if(old.digest!==digest)throw Error('同一请求编号对应了不同参数，拒绝提交');return {...old.result,replayed:true,state:old.state};}
  await fs.mkdir(this.directory,{recursive:true});
  try{await fs.writeFile(this.file(id)+'.lock',digest,{flag:'wx'});}catch(e){if(e.code==='EEXIST')throw Error('该请求正在处理或回执不完整，请检查原任务，不要重新发送');throw e;}
  const record={digest,payload,state:'attempted',result:{sent_unknown:true,request_id:id}};
  await this.put(id,record);
  try{record.result=await perform(record);record.state='accepted';await this.put(id,record);return {...record.result,state:record.state,replayed:false};}
  catch(e){record.state='uncertain';record.result={...record.result,error:e.message,sent_unknown:true,request_id:id,note:'不要换请求编号自动重试；先查看原对话。'};await this.put(id,record);throw e;}
 }
}
export function safeFilename(name){
 if(typeof name!=='string'||!name||name!==path.basename(name)||/[\\/:*?"<>|\x00-\x1f]/.test(name)||!name.toLowerCase().endsWith('.mp4')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('无效MP4文件名');
 return name;
}
export function canAdoptConversation(previous,current,marker,text){return /^chrome:\/\/doubao-chat\/chat\/local_[0-9]+$/.test(previous??'')&&/^chrome:\/\/doubao-chat\/chat\/[0-9]+$/.test(current??'')&&typeof marker==='string'&&marker.length>=40&&text.replace(/\s/g,'').includes(marker);}
const ledger=new Ledger(stateDir);
async function bridge(route,payload){
 const r=await fetch(api+route,{method:payload===undefined?'GET':'POST',headers,body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
 const data=await r.json();if(!r.ok)throw Error(data.error??`HTTP ${r.status}`);return data;
}
async function selectTarget(id){
 const pages=await bridge('/targets');
 const chat=pages.filter(p=>/^doubao:\/\/doubao-chat\//.test(p.url));
 if(id){if(!chat.some(p=>p.id===id))throw Error('指定聊天页面不存在');return id;}
 if(chat.length!==1)throw Error('存在多个聊天页面，请先列出页面并指定target_id');return chat[0].id;
}
async function core(){return import(pathToFileURL(bridgeFile).href);}
function decodeModel(card,raw,hasClean){
 try{
 if(!raw)return null;
 const model=typeof raw==='string'?JSON.parse(raw):raw;
 if(model.status!==10)return null;
 const streams=Object.values(model.video_list??{}).filter(v=>v.vtype==='mp4'&&!v.encryption_method);
 const preferred=streams.filter(v=>v.codec_type==='h264');
 const stream=(preferred.length?preferred:streams).sort((a,b)=>b.vwidth*b.vheight-a.vwidth*a.vheight)[0];
 if(!stream?.main_url)return null;
 const src=Buffer.from(stream.main_url,'base64').toString('utf8');
 const u=new URL(src);if(u.protocol!=='https:'||!/^v\d+-vdl\.doubao\.com$/.test(u.hostname))return null;
 const watermark=hasClean?'unwatermarked':u.searchParams.get('lr')??'unknown';
 return {src,duration:model.video_duration,width:stream.vwidth,height:stream.vheight,expected_bytes:stream.size,task_id:card.creation_task_id,readyState:1,source:hasClean?'client_clean_card_metadata':'successful_card_metadata',watermark};
 }catch{return null;}
}
export function decodeCardMedia(card){
 if(!card?.isSuccess)return null;
 const normal=decodeModel(card,card.videoModel,false);
 let clean=decodeModel(card,card.cleanVideoModel,true);
 if(!clean&&card.cleanVideoUrl&&normal){try{const u=new URL(card.cleanVideoUrl);if(u.protocol==='https:'&&/^v\d+-vdl\.doubao\.com$/.test(u.hostname))clean={...normal,src:card.cleanVideoUrl,expected_bytes:undefined,watermark:'unwatermarked',source:'client_clean_card_metadata'};}catch{}}
 const list=[clean,normal].filter(Boolean).filter((v,i,a)=>a.findIndex(x=>x.src===v.src)===i);
 return list.length?{...list[0],alternatives:list.slice(1),clean_available:list.some(v=>v.watermark==='unwatermarked')}:null;
}
export class ResourceUnavailable extends Error{}
export async function downloadWithFallback(video,requireClean,attempt){
 const all=[video,...video.alternatives??[]].filter((v,i,a)=>a.findIndex(x=>x.src===v.src)===i);
 const clean=all.filter(v=>v.watermark==='unwatermarked'),normal=all.filter(v=>v.watermark!=='unwatermarked');
 const choices=requireClean?clean:[...clean,...normal];
 if(!choices.length)throw Error('客户端尚未提供去水印资源，未下载普通版，也未重新生成');
 const errors=[];
 for(const choice of choices){
  try{const result=await attempt(choice);const fallback=choice.watermark!=='unwatermarked';return {...result,video:choice,fallback_used:fallback,fallback_reason:fallback?(clean.length?'clean_download_unavailable':'clean_resource_missing'):null,notice:fallback?(choice.watermark==='unknown'?'无水印资源不可用，已下载普通版（水印状态未确认）':'无水印资源不可用，已下载带水印普通版'):'已下载无水印版'};}
  catch(e){if(!(e instanceof ResourceUnavailable))throw e;errors.push(e.message);}
 }
 throw Error((requireClean?'无水印版不可下载，严格模式未下载普通版：':'所有已有视频资源均不可下载：')+errors.join('；'));
}
async function readSnapshot(id){
 const p=await (await core()).connect(id);
 try{
  const data=await p.evaluate(`(()=>{const pick=raw=>{try{if(!raw)return null;const m=typeof raw==='string'?JSON.parse(raw):raw;return {status:m.status,video_duration:m.video_duration,video_list:Object.fromEntries(Object.entries(m.video_list??{}).map(([k,s])=>[k,{vtype:s.vtype,codec_type:s.codec_type,encryption_method:s.encryption_method,vwidth:s.vwidth,vheight:s.vheight,size:s.size,main_url:s.main_url}]))}}catch{return null;}};const players=[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc||v.src,duration:Number.isFinite(v.duration)?v.duration:null,width:v.videoWidth,height:v.videoHeight,readyState:v.readyState,source:'player'}));const cards=[];for(const el of document.querySelectorAll('[class*="block-video-"]')){let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];for(let i=0;f&&i<15;f=f.return,i++){const props=f.memoizedProps,v=props?.video;if(v?.videoModel||v?.creation_task_id){cards.push({isSuccess:v.isSuccess,creation_task_id:v.creation_task_id,videoModel:pick(v.videoModel),cleanVideoModel:pick(props.removeAiWatermarkVideoModel),cleanVideoUrl:props.removeAiWatermarkVideoUrl});break;}}}return {players,cards}})()`);
  const players=data.players.filter(v=>v.src&&v.duration>0&&v.readyState>=1);
  const cards=data.cards.map(decodeCardMedia).filter(Boolean);
  return {tasks:[...new Map(data.cards.filter(c=>c.creation_task_id).map(c=>[c.creation_task_id,{task_id:c.creation_task_id,isSuccess:c.isSuccess}])).values()],videos:cards.length?cards:players.map(v=>({...v,watermark:new URL(v.src).searchParams.get('lr')??'unknown'}))};
 }finally{p.close();}
}
async function connectApp(args={}){
 let launch;
 let healthy=false,bridgeAlive=false;
 try{const r=await fetch(api+'/health',{headers,signal:AbortSignal.timeout(3000)});const h=await r.json();if(h.service!=='doubao-local-bridge'||h.bridge_version!==bridgeVersion)throw Object.assign(Error('桥接版本不匹配，请重新运行doubao-video setup并重启MCP客户端；若旧桥接不属于本安装，请停止旧桥接后重连'),{code:'BRIDGE_VERSION'});bridgeAlive=true;healthy=r.ok;}catch(e){if(e.code==='BRIDGE_VERSION')throw e;}
 if(!healthy){
  let cdpReady=false;try{const r=await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(3000)});cdpReady=r.ok;}catch{}
  if(!cdpReady){const {launchApp}=await import(pathToFileURL(path.join(path.dirname(bridgeFile),'launch.mjs')).href);launch=await launchApp();}
  if(!bridgeAlive){
   const c=spawn(process.execPath,[bridgeFile],{stdio:'ignore',windowsHide:true,detached:true,env:process.env});
   c.on('error',e=>console.error('桥接启动失败：'+e.message));c.unref();
  }
  let ready=false;for(let i=0;i<30;i++){await sleep(500);try{await bridge('/health');ready=true;break;}catch{}}
  if(!ready)throw Error('豆包调试连接未启动，请检查安装路径及9229/9230端口；常用客户端若已打开，请完整退出后重试');
 }
 const ready=await waitFor(async()=>{const id=await selectTarget(args.target_id);return {target_id:id,...await bridge('/diagnostics',{target_id:id})};},d=>d.loginRequired||d.runtime&&d.editorReady,{label:'豆包聊天页面'});return {version,profile_mode:process.env.DOUBAO_PROFILE_MODE??'native',...ready,...(launch?{launch}:{client_reused:true})};
}
async function newChat(id){
 const p=await (await core()).connect(id);
 try{return await p.evaluate(`(()=>{const ed=document.querySelector('[data-testid="chat_input_input"]');if(ed?.innerText.trim())throw Error('有未发送草稿，拒绝新建对话');const b=[...document.querySelectorAll('button,[role="button"]')].find(b=>b.innerText?.trim().startsWith('新对话'));if(!b)throw Error('没有新对话按钮');b.click();return {opened:true,submitted:false}})()`);}finally{p.close();}
}
async function openVideo(id){
 const p=await (await core()).connect(id);
 try{
  const viewport=await p.evaluate('({width:innerWidth,height:innerHeight})');
  if(viewport.width<1100||viewport.height<650){
   const {expandVideoWindow}=await import(pathToFileURL(path.join(path.dirname(bridgeFile),'launch.mjs')).href);
   await expandVideoWindow();await sleep(500);
  }
  for(let i=0;i<8;i++){
   const result=await p.evaluate(`(()=>{if(document.querySelector('[data-testid="to_login_button"]'))throw Error('请先在豆包窗口登录');if(document.querySelector('[data-testid="skill_input_exit_button"]')?.textContent.includes('视频生成'))return 'opened';const b=document.querySelector('[data-testid="skill_bar_button_17"]');if(b){b.click();return 'opening';}const more=document.querySelector('[data-testid="skill_bar_button_more"]');if(more&&${i}===0){more.click();return 'menu';}return 'waiting'})()`);
   if(result==='opened')return;await sleep(300);
  }
  throw Error('没有可用视频生成入口，未提交');
 }finally{p.close();}
}
async function jobTarget(args){
 if(!args.request_id)return selectTarget(args.target_id);
 const job=await ledger.get(args.request_id);if(!job)throw Error('没有该请求记录');
 const found=await recoverPage(job,await bridge('/targets'),id=>bridge('/video/status',{target_id:id}),args.target_id);
 if(found.adopt)job.result.conversation_url=found.status.url;
 if(found.adopt||job.result.target_id!==found.id){job.result.target_id=found.id;await ledger.put(args.request_id,job);}
 return found.id;
}
async function mediaFor(args,id){
 const snapshot=await readSnapshot(id);
 if(!args.request_id){const task=snapshot.tasks.at(-1)?.task_id;return {videos:task?snapshot.videos.filter(v=>v.task_id===task):snapshot.videos,task_id:task,binding:'current_page'};}
 const job=await ledger.get(args.request_id),selected=requestMedia(job,snapshot);
 if(selected.task_id&&job.result.task_id!==selected.task_id){job.result.task_id=selected.task_id;await ledger.put(args.request_id,job);}
 return selected;
}
async function prepareVideo(id,args){
 await openVideo(id);const settings=videoSettings(args),{model,ratio,duration}=settings;
 const before=await waitFor(()=>bridge('/video/controls',{target_id:id}),d=>d.controls['video-model']?.options?.length,{label:'视频模型选项'});
 if(!before.controls['video-model'].options.some(o=>o.value===model))throw Error('客户端不提供模型：'+model);
 await bridge('/video/prepare',{target_id:id,model});
 let last;
 try{last=await waitFor(async()=>last=await bridge('/video/controls',{target_id:id}),d=>d.selected.model===model&&d.controls['video-ratio']?.options.some(o=>o.value===ratio)&&d.controls['video-duration']?.options.some(o=>String(o.value)===String(duration)),{label:'模型的比例与时长选项'});}catch{throw Error('该模型未提供所选比例或时长，或控件未就绪；当前选项：'+JSON.stringify(last?.controls??{}));}
 await bridge('/video/prepare',{target_id:id,ratio,duration});
 const verified=await waitFor(()=>bridge('/video/controls',{target_id:id}),d=>d.selected.model===model&&d.selected.ratio===ratio&&String(d.selected.duration)===String(duration)&&d.ui_text.includes(models[model])&&d.ui_text.includes(ratio==='auto'?'自动':ratio)&&d.ui_text.includes(duration+'s'),{label:'视频参数显示'});
 return {prepared:true,submitted:false,settings,ui_verified:true,available:verified.controls};
}
async function listRequests(limit=25){
 let names;try{names=await fs.readdir(stateDir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const rows=[];for(const name of names.filter(n=>n.endsWith('.json')&&!n.startsWith('__internal_'))){const id=name.slice(0,-5);let job;try{job=await ledger.get(id);}catch{continue;}if(!job?.payload?.prompt_sha256)continue;const stat=await fs.stat(ledger.file(id));rows.push({request_id:id,state:job.state,settings:videoSettings(job.payload.settings),conversation_url:job.result.conversation_url,task_id:job.result.task_id,updated_at:stat.mtime.toISOString()});}
 return rows.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,limit);
}
async function resumeRequest(args){
 try{return {target_id:await jobTarget(args),resumed:true,navigated:false};}catch(e){if(!e.message.startsWith('原任务对话尚未打开'))throw e;}
 const job=await ledger.get(args.request_id);
 if(!/^chrome:\/\/doubao-chat\/chat\/[0-9]+$/.test(job?.result.conversation_url??''))throw Error('没有可恢复的正式对话地址，请手动打开原任务');
 const id=await selectTarget(args.target_id),p=await (await core()).connect(id);
 try{
  const guard=await p.evaluate(`(()=>{const e=document.querySelector('[data-testid="chat_input_input"]');return {draft:!!e?.innerText.trim(),busy:!![...document.querySelectorAll('[data-testid="chat_input_local_break_button"]')].find(e=>e.getClientRects().length)}})()`);
  if(guard.draft||guard.busy)throw Error('当前页面有草稿或正在回复，未切换对话；请另开豆包聊天窗口');
  await p.send('Page.navigate',{url:job.result.conversation_url});
 }finally{p.close();}
 const recovered=await waitFor(()=>jobTarget({...args,target_id:id}),Boolean,{label:'原任务对话'});
 return {target_id:recovered,resumed:true,navigated:true};
}
async function download(args,id){
 const selected=await mediaFor(args,id),video=selected.videos.at(-1);if(!video)throw Error('本次任务没有已完成的视频资源；绑定状态：'+selected.binding);
 const dir=args.output_dir??outputDefault;if(!path.isAbsolute(dir))throw Error('output_dir必须为绝对路径');
 const name=safeFilename(args.filename??`doubao-${args.request_id??randomUUID()}.mp4`);
 const output=path.join(dir,name);await fs.mkdir(dir,{recursive:true});
 try{await fs.stat(output);throw Error('输出文件已经存在，拒绝覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.mkdir(stateDir,{recursive:true});
 const chosen=await downloadWithFallback(video,args.require_clean===true,async candidate=>{
  const u=new URL(candidate.src);if(u.protocol!=='https:'||!/^v\d+-vdl\.doubao\.com$/.test(u.hostname))throw Error('非已验证豆包视频地址');
  let response;try{response=await fetch(u,{signal:AbortSignal.timeout(120000)});}catch(e){throw new ResourceUnavailable('视频资源连接失败：'+e.message);}
  if(!response.ok)throw new ResourceUnavailable(`下载HTTP ${response.status}`);
  const temp=path.join(stateDir,'download-'+randomUUID()+'.part');
  try{try{await pipeline(Readable.fromWeb(response.body),createWriteStream(temp,{flags:'wx'}));}catch(e){if(['EPERM','EACCES','ENOSPC','EEXIST','EROFS'].includes(e.code))throw e;throw new ResourceUnavailable('视频传输失败：'+e.message);}const bytes=(await fs.stat(temp)).size;if(candidate.expected_bytes&&bytes!==candidate.expected_bytes)throw new ResourceUnavailable('下载大小与客户端媒体信息不一致');const handle=await fs.open(temp,'r');try{const header=Buffer.alloc(8);await handle.read(header,0,8,0);if(header.toString('ascii',4,8)!=='ftyp')throw new ResourceUnavailable('返回内容不是已验证的MP4容器');}finally{await handle.close();}return {temp,bytes};}catch(e){await fs.unlink(temp).catch(()=>{});throw e;}
 });
 const v=chosen.video;
 try{await fs.copyFile(chosen.temp,output,1);return {path:output,bytes:chosen.bytes,duration:v.duration,width:v.width,height:v.height,watermark:v.watermark,source:v.source,fallback_used:chosen.fallback_used,fallback_reason:chosen.fallback_reason,notice:chosen.notice};}finally{await fs.unlink(chosen.temp).catch(()=>{});}
}
export async function runTool(name,args){
 const def=definitions.find(t=>t.name===name);if(!def)throw Error('未知工具');validateArgs(def,args);
 if(name==='doubao_connect')return connectApp(args);
 if(name==='doubao_list_pages')return bridge('/targets');
 if(name==='doubao_doctor')return doctor();
 if(name==='doubao_list_requests')return listRequests(args.limit);
 if(name==='doubao_resume_request')return resumeRequest(args);
 if(name==='doubao_video_bind_task'){const id=await jobTarget(args),snapshot=await readSnapshot(id);if(!snapshot.tasks.some(t=>t.task_id===args.task_id))throw Error('该任务不在原对话中');const job=await ledger.get(args.request_id);if(job.result.task_id&&job.result.task_id!==args.task_id)throw Error('原请求已绑定其他任务，拒绝改绑');job.result.task_id=args.task_id;await ledger.put(args.request_id,job);return {bound:true,task_id:args.task_id};}
 if(name==='doubao_video_submit'){
  const old=await ledger.get(args.request_id);if(old)return submitOnce(ledger,args.request_id,old.payload.target_id,args.prompt,videoSettings(args),()=>{throw Error('旧请求禁止再次提交');});
  const id=await selectTarget(args.target_id);
  return submitOnce(ledger,args.request_id,id,args.prompt,videoSettings(args),async record=>{
   const before=await bridge('/video/status',{target_id:id}),snapshot=await readSnapshot(id);
   const fresh=/^chrome:\/\/doubao-chat\/chat(?:\/local_[0-9]+)?$/.test(before.url)&&snapshot.tasks.length===0&&snapshot.videos.length===0;
   record.result={target_id:id,conversation_url:before.url,prompt_marker:args.prompt.replace(/\s/g,'').slice(0,120),baseline_task_ids:snapshot.tasks.map(t=>t.task_id),binding_policy:fresh?'new_conversation':'explicit'};await ledger.put(args.request_id,record);
   const result=await bridge('/video/submit',{target_id:id,prompt:args.prompt,...videoSettings(args),commit:args.commit});
   await sleep(700);const after=await bridge('/video/status',{target_id:id});return {...record.result,...result,request_id:args.request_id,conversation_url:after.url};
  });
 }
 if(name==='doubao_video_confirm'){
  if(args.commit!==true)throw Error('需要commit:true');
  const job=await ledger.get(args.request_id);if(!job||job.state!=='accepted')throw Error('原请求尚未成功提交或状态不确定');
  const legacy=await ledger.get(args.request_id+'-confirm');if(legacy?.payload?.parent===args.request_id)return {...legacy.result,replayed:true,state:legacy.state};
  const key=confirmationKey(args.request_id),old=await ledger.get(key);if(old)return {...old.result,replayed:true,state:old.state};
  const id=await jobTarget({request_id:args.request_id});
  return ledger.once(key,{parent:args.request_id},()=>bridge('/video/confirm',{target_id:id,commit:true,...videoSettings(job.payload.settings)}));
 }
 const id=await (name==='doubao_video_status'||name==='doubao_video_download'?jobTarget(args):selectTarget(args.target_id));
 if(name==='doubao_new_chat')return newChat(id);
 if(name==='doubao_inspect')return bridge('/inspect',{target_id:id});
 if(name==='doubao_video_config'){const result={controls:await bridge('/video/controls',{target_id:id}),defaults:videoSettings(),quota_warning:'旧版额度不能证明任务完成'};try{result.legacy_quota=await bridge('/video/quota',{target_id:id});}catch(e){result.legacy_error=e.message;}return result;}
 if(name==='doubao_video_prepare')return prepareVideo(id,args);
 if(name==='doubao_video_options'){await openVideo(id);return waitFor(()=>bridge('/video/controls',{target_id:id}),d=>d.available,{label:'视频可用选项'});}
 if(name==='doubao_video_draft')return bridge('/video/draft',{target_id:id,prompt:args.prompt});
 if(name==='doubao_video_status'){const s=await bridge('/video/status',{target_id:id});const selected=await mediaFor(args,id),videos=selected.videos;return {...s,text:s.text.slice(-2500),...selected,video_ready:videos.some(v=>v.readyState>=1&&v.duration>0&&v.src)};}
 if(name==='doubao_video_download')return download(args,id);
 throw Error('未实现工具');
}

export async function submitOnce(store,id,targetId,prompt,settings,perform){
 const normalized=videoSettings(settings),old=await store.get(id);
 const base={target_id:targetId,prompt_sha256:createHash('sha256').update(prompt).digest('hex')};
 if(old&&!old.payload.settings){
  if(JSON.stringify(normalized)!==JSON.stringify(videoSettings()))throw Error('旧请求使用默认参数，拒绝以自定义参数复用同一编号');
  return store.once(id,base,perform);
 }
 return store.once(id,{...base,settings:normalized},perform);
}

async function doctor(){
 const report={version,platform:process.platform,node:process.versions.node,node_supported:Number(process.versions.node.split('.')[0])>=22,profile_mode:process.env.DOUBAO_PROFILE_MODE??'native',state_dir:stateDir,output_dir:outputDefault,bridge_file:bridgeFile};
 try{const {resolveExecutable}=await import(pathToFileURL(path.join(path.dirname(bridgeFile),'launch.mjs')).href);report.executable=await resolveExecutable();}catch(e){report.executable_error=e.message;}
 try{const r=await fetch(api+'/health',{headers,signal:AbortSignal.timeout(3000)});report.bridge=await r.json();report.bridge_compatible=report.bridge.service==='doubao-local-bridge'&&report.bridge.bridge_version===bridgeVersion;}catch(e){report.bridge={ok:false,error:e.message};report.bridge_compatible=false;}
 try{const r=await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(3000)});const pages=await r.json();report.chat_pages=pages.filter(t=>t.type==='page'&&/^doubao:\/\/doubao-chat\//.test(t.url)).map(({id,title,url})=>({id,title,url}));}catch(e){report.chat_pages=[];report.cdp_error=e.message;}
 return report;
}
