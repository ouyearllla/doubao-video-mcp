import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),scratch=path.join(os.tmpdir(),'doubao-video-mcp-tests');
await fs.mkdir(scratch,{recursive:true});
test('真实工具流程：旧结果隔离、页面ID恢复、完成后只取新任务',async()=>{
 const dir=await fs.mkdtemp(path.join(scratch,'doubao-integration-'));
 try{
  const bridge=path.join(dir,'bridge.mjs');
  await fs.copyFile(new URL('../bridge/video-settings.mjs',import.meta.url),path.join(dir,'video-settings.mjs'));
  await fs.writeFile(bridge,`export async function connect(){return {evaluate:async()=>globalThis.fixtureMedia,close(){}}}`);
  const script=`
import fs from 'node:fs/promises';
process.env.DOUBAO_STATE_DIR=${JSON.stringify(dir)};process.env.DOUBAO_BRIDGE_FILE=${JSON.stringify(bridge)};
const conversation='chrome://doubao-chat/chat/123';
await fs.writeFile(${JSON.stringify(path.join(dir,'case.json'))},JSON.stringify({state:'accepted',payload:{target_id:'expired'},result:{conversation_url:conversation,binding_policy:'new_conversation',baseline_task_ids:['old']}}));
const model={status:10,video_duration:10,video_list:{a:{vtype:'mp4',codec_type:'h264',vwidth:720,vheight:1280,main_url:Buffer.from('https://v11-vdl.doubao.com/video').toString('base64')}}};
globalThis.fixtureMedia={players:[],cards:[{isSuccess:true,creation_task_id:'old',videoModel:model},{isSuccess:false,creation_task_id:'new'}]};
globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/targets')?[{id:'new-page',url:'doubao://doubao-chat/chat/123'}]:{url:conversation,text:'pending',busy:false}});
const {runTool}=await import(${JSON.stringify(new URL('../mcp/tools.mjs',import.meta.url).href)});
const pending=await runTool('doubao_video_status',{request_id:'case'});
let rejected=false;try{await runTool('doubao_video_download',{request_id:'case',output_dir:${JSON.stringify(dir)}});}catch{rejected=true;}
globalThis.fixtureMedia.cards[1]={isSuccess:true,creation_task_id:'new',videoModel:model};
const done=await runTool('doubao_video_status',{request_id:'case'});
const job=JSON.parse(await fs.readFile(${JSON.stringify(path.join(dir,'case.json'))},'utf8'));
console.log(JSON.stringify({pending:pending.video_ready,rejected,done:done.video_ready,task:done.videos[0].task_id,page:job.result.target_id}));`;
  const runner=path.join(dir,'run.mjs');await fs.writeFile(runner,script);
  const {stdout}=await exec(process.execPath,[runner]);assert.deepEqual(JSON.parse(stdout),{pending:false,rejected:true,done:true,task:'new',page:'new-page'});
 }finally{await fs.rm(dir,{recursive:true});}
});
test('发送结果未知时保留任务基线与原对话元数据',async()=>{
 const {Ledger}=await import('../mcp/tools.mjs');const dir=await fs.mkdtemp(path.join(scratch,'doubao-uncertain-metadata-'));
 try{const ledger=new Ledger(dir);await assert.rejects(()=>ledger.once('case',{},async record=>{record.result={conversation_url:'original',baseline_task_ids:['old']};throw Error('lost reply');}));const result=await ledger.get('case');assert.equal(result.state,'uncertain');assert.deepEqual(result.result.baseline_task_ids,['old']);assert.equal(result.result.conversation_url,'original');}finally{await fs.rm(dir,{recursive:true});}
});
