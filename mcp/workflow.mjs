import {createHash} from 'node:crypto';
export const version='1.2.3';
export const bridgeVersion='1.2.3';
export const confirmationKey=id=>'__internal_confirm_'+createHash('sha256').update(id).digest('hex');
export async function waitFor(read,ready,{attempts=30,interval=300,label='客户端'}={}){
 let last,error;
 for(let i=0;i<attempts;i++){
  try{last=await read();if(ready(last))return last;error=undefined;}catch(e){error=e;}
  if(i+1<attempts)await new Promise(r=>setTimeout(r,interval));
 }
 throw Error(`${label}尚未就绪，未提交`+(error?`：${error.message}`:''));
}
export function requestMedia(job,snapshot){
 const tasks=[...new Set((snapshot.tasks??[]).map(t=>t.task_id).filter(Boolean))];
 let task=job.result.task_id;
 if(!task){
  if(!Array.isArray(job.result.baseline_task_ids)||job.result.binding_policy!=='new_conversation')return {videos:[],binding:'required',candidates:tasks};
  const candidates=tasks.filter(t=>!job.result.baseline_task_ids.includes(t));
  if(candidates.length>1)return {videos:[],binding:'ambiguous',candidates};
  task=candidates[0];
 }
 return {videos:task?snapshot.videos.filter(v=>v.task_id===task):[],task_id:task,binding:task?'bound':'pending'};
}
export async function recoverPage(job,pages,inspect,explicitId){
 const chat=pages.filter(p=>/^doubao:\/\/doubao-chat\//.test(p.url));
 const ordered=explicitId?chat.filter(p=>p.id===explicitId):[...chat].sort((a,b)=>Number(b.id===(job.result.target_id??job.payload.target_id))-Number(a.id===(job.result.target_id??job.payload.target_id)));
 const matches=[];
 for(const page of ordered){
  let status;try{status=await inspect(page.id);}catch{continue;}
  if(status.url===job.result.conversation_url)matches.push({id:page.id,status});
  else if(/^chrome:\/\/doubao-chat\/chat\/local_[0-9]+$/.test(job.result.conversation_url??'')&&/^chrome:\/\/doubao-chat\/chat\/[0-9]+$/.test(status.url??'')&&job.result.prompt_marker?.length>=40&&status.text.replace(/\s/g,'').includes(job.result.prompt_marker))matches.push({id:page.id,status,adopt:true});
 }
 if(matches.length!==1)throw Error(matches.length?'原对话打开了多个页面，请指定target_id':'原任务对话尚未打开；调用doubao_resume_request或打开原对话后重试');
 return matches[0];
}
