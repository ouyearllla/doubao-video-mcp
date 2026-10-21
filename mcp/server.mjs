import readline from 'node:readline';
import {definitions,runTool} from './tools.mjs';
import {version} from './workflow.mjs';
const versions=['2025-11-25','2025-06-18','2024-11-05'];
let initialized=false,mutationQueue=Promise.resolve();
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const result=(id,value)=>send({jsonrpc:'2.0',id,result:value});
const error=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
async function request(m){
 if(!m||Array.isArray(m)||m.jsonrpc!=='2.0'||typeof m.method!=='string')return error(m?.id??null,-32600,'Invalid Request');
 if(m.id===undefined)return; // MCP notifications do not receive a response.
 try{
  if(m.method==='initialize'){if(typeof m.params?.protocolVersion!=='string')return error(m.id,-32602,'protocolVersion is required');initialized=true;return result(m.id,{protocolVersion:versions.includes(m.params.protocolVersion)?m.params.protocolVersion:versions[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'doubao',version},instructions:'通过本机已登录豆包生成视频。模型、画面比例与时长可选（默认Seedance 2.0 Fast、16:9、15秒），客户端未提供的取值会明确报错。生成需用户授权与commit:true；同一request_id不会重复发送；旧版额度字段不用于判断生成完成。默认优先下载无水印，没有或不可下载则降级为普通版并告知。只有必须无水印时传require_clean:true禁止降级。'});}
  if(m.method==='ping')return result(m.id,{});
  if(!initialized)return error(m.id,-32000,'Initialize first');
  if(m.method==='tools/list')return result(m.id,{tools:definitions});
  if(m.method==='tools/call'){
   const name=m.params?.name,def=definitions.find(t=>t.name===name);
   if(!def)return error(m.id,-32602,'Unknown tool');
   const action=()=>runTool(name,m.params.arguments??{});
   let value;if(def.annotations.readOnlyHint)value=await action();else{const pending=mutationQueue.then(action);mutationQueue=pending.catch(()=>{});value=await pending;}
   return result(m.id,{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:{result:value},isError:false});
  }
  error(m.id,-32601,'Method not found');
 }catch(e){if(m.method==='tools/call')result(m.id,{content:[{type:'text',text:e.message}],structuredContent:{error:e.message},isError:true});else error(m.id,-32603,e.message);}
}
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{if(Buffer.byteLength(line)>1024*1024)return error(null,-32600,'Request too large');let m;try{m=JSON.parse(line);}catch{return error(null,-32700,'Parse error');}request(m).catch(e=>console.error(e.message));});
input.on('close',()=>{mutationQueue.finally(()=>process.exit(0));});
