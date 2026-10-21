import {liveVideoControls} from './client-controls.mjs';
import {videoSettings,assertVideoSelection,confirmationPrompt} from './video-settings.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const cdp = 'http://127.0.0.1:9229';
const port = 9230;
const apiRoot = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--launch')) {
  const {launchApp}=await import('./launch.mjs');
  await launchApp();
}
async function targets() {
  const r = await fetch(`${cdp}/json/list`, {signal:AbortSignal.timeout(4000)});
  if (!r.ok) throw new Error(`CDP HTTP ${r.status}`);
  return r.json();
}
async function connect(id) {
  const t = (await targets()).find(t => t.id === id && t.type === 'page');
  if (!t || !/^doubao:\/\/(doubao-chat|doubao-launcher)\//.test(t.url)) throw new Error('需要指定豆包聊天页面的 target_id');
  const socket = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{socket.close();reject(new Error('CDP连接超时'));},5000);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('CDP连接失败'));},{once:true});
  });
  let seq=0; const pending=new Map();
  socket.addEventListener('message',e=>{
    const m=JSON.parse(e.data); const p=pending.get(m.id);
    if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
  });
  socket.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('CDP已断开'));}pending.clear();});
  return {
    send(method,params={}){return new Promise((resolve,reject)=>{
      const id=++seq;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method}超时`));},15000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
    });},
    async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;},
    close(){socket.close();}
  };
}
// 从客户端已加载的Webpack缓存获取函数；不读取Cookie、账号密钥或存储凭据。
const bootstrap = `(()=>{if(!globalThis.__doubaoLocalRequire){const chunks=globalThis['@flow-web/desktop:stable'];if(!chunks)throw Error('当前页面尚未加载豆包聊天模块');chunks.push([['doubao_local_bridge_'+Date.now()],{},r=>{globalThis.__doubaoLocalRequire=r}]);}return true})()`;
const editorSelector='[data-testid="chat_input_input"] [contenteditable="true"],[data-testid="chat_input_input"][contenteditable="true"],textarea';
const readEditor=String.raw`e=>('value'in e)?e.value:[...e.children].map(p=>p.innerText).join('\n')`;
async function withPage(id,fn){const p=await connect(id);try{return await fn(p);}finally{p.close();}}
async function confirmVideo(id,commit,settings={},pageRunner=withPage){
  if(commit!==true)throw Error('确认生成需要commit:true');
  return pageRunner(id,async p=>{
    const text=await p.evaluate('document.body.innerText');
    const prompt=confirmationPrompt(text,settings);
    await p.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(editorSelector)})].filter(e=>e.getClientRects().length);if(e.length!==1)throw Error('输入框不唯一');if((${readEditor})(e[0]).trim())throw Error('当前输入框有未发送草稿');e[0].focus();return true})()`);
    await p.send('Input.insertText',{text:prompt});
    await p.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(editorSelector)})].find(e=>e.getClientRects().length);if((${readEditor})(e).trim()!==${JSON.stringify(prompt)})throw Error('确认文字校验失败');const b=document.querySelector('[data-testid="chat_input_send_button"]');if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')throw Error('发送按钮不可用');b.click();return true})()`);
    return {confirmation_sent:true,generated:false};
  });
}
async function body(req){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>65536)throw Error('请求体过大');}return s?JSON.parse(s):{};}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
  if(req.headers.origin || !['127.0.0.1:9230','localhost:9230'].includes(req.headers.host))return reply(res,403,{error:'仅供本机脚本调用'});
  if(req.headers['x-doubao-local']!=='1')return reply(res,403,{error:'需要 X-Doubao-Local: 1 请求头'});
  try{
    const u=new URL(req.url,'http://127.0.0.1:9230');
    if(req.method==='GET'&&u.pathname==='/health'){
      try{const t=await targets();return reply(res,200,{ok:true,bridge_version:'1.2.0',service:'doubao-local-bridge',cdp_connected:true,pages:t.filter(x=>x.type==='page').length});}
      catch(e){return reply(res,503,{ok:false,bridge_version:'1.2.0',service:'doubao-local-bridge',cdp_connected:false,error:e.message});}
    }
    if(req.method==='GET'&&u.pathname==='/targets')return reply(res,200,(await targets()).filter(x=>x.type==='page').map(({id,title,url})=>({id,title,url})));
    if(req.method==='POST'&&u.pathname==='/video/confirm'){const b=await body(req);return reply(res,200,await confirmVideo(b.target_id,b.commit,videoSettings(b)));}
    if(req.method==='POST'&&u.pathname==='/video/status'){const b=await body(req);return reply(res,200,await withPage(b.target_id,p=>p.evaluate(`({url:location.href,text:document.body.innerText.slice(-6000),videos:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc||v.src,duration:Number.isFinite(v.duration)?v.duration:null,readyState:v.readyState})),busy:!![...document.querySelectorAll('[data-testid="chat_input_local_break_button"]')].find(e=>e.getClientRects().length)})`)));}
    if(req.method==='POST'&&['/inspect','/diagnostics','/video/open','/video/controls','/video/quota','/video/config','/video/prepare','/video/draft','/video/submit'].includes(u.pathname)){
      const b=await body(req);
      const result=await withPage(b.target_id,async p=>{
        if(u.pathname==='/diagnostics'){
          return p.evaluate(`(()=>{const r=globalThis.__doubaoLocalRequire;return {editorReady:!!document.querySelector('[data-testid="chat_input_input"]'),runtime:Array.isArray(globalThis['@flow-web/desktop:stable']),loginRequired:!!document.querySelector('[data-testid="to_login_button"]'),apiLoaded:!!r?.c?.['609347']?.exports.mH,quotaMethod:typeof r?.c?.['609347']?.exports.mH?.QueryVideoGenInfo,configMethod:typeof r?.c?.['609347']?.exports.mH?.SkillPack,skillType:r?.c?.['43016']?.exports.SkillType.VideoGeneration,parameterSetter:typeof r?.c?.['528914']?.exports.SW,testids:[...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')).filter(x=>/input|send|video|ratio|duration/i.test(x))}})()`);
        }
        if(u.pathname==='/video/controls'){await p.evaluate(bootstrap);return p.evaluate('('+liveVideoControls.toString()+')()');}
        if(u.pathname==='/video/open')return p.evaluate(`(()=>{if(document.querySelector('[data-testid="to_login_button"]'))throw Error('请先在豆包窗口登录');if(document.querySelector('[data-testid="skill_input_exit_button"]')?.textContent.includes('视频生成'))return {opened:true,already_open:true,submitted:false};const b=document.querySelector('[data-testid="skill_bar_button_17"]');if(!b)throw Error('没有视频生成入口');b.click();return {opened:true,submitted:false}})()`);
        if(u.pathname==='/inspect')return p.evaluate(`({url:location.href,title:document.title,text:document.body.innerText.slice(-12000),editors:[...document.querySelectorAll('textarea,[contenteditable="true"],input')].map(e=>({tag:e.tagName,testid:e.getAttribute('data-testid'),placeholder:e.getAttribute('placeholder'),role:e.getAttribute('role')})),buttons:[...document.querySelectorAll('button,[role="button"]')].slice(-60).map(e=>({text:e.innerText,testid:e.getAttribute('data-testid'),'aria-label':e.getAttribute('aria-label')})),webpack:!!globalThis.webpackChunkflow_web_extension})`);
        if(u.pathname==='/video/quota'||u.pathname==='/video/config'){
          await p.evaluate(bootstrap);
          const call=u.pathname==='/video/quota'?'QueryVideoGenInfo()':`SkillPack({skill_type:r.c['43016'].exports.SkillType.VideoGeneration})`;
          return p.evaluate(`(async()=>{if(document.querySelector('[data-testid="to_login_button"]'))throw Error('请先在豆包窗口登录；没有读取或复制原账号Cookie');const r=globalThis.__doubaoLocalRequire;if(!r.c?.['609347'])throw Error('API模块609347未加载');const api=r.c['609347'].exports.mH;if(!api)throw Error('客户端API结构已变化');const result=await api.${call};return result.data??result;})()`);
        }
        if(u.pathname==='/video/prepare'){
          await p.evaluate(bootstrap);
          const settings={ratio:b.ratio,duration:b.duration===undefined?undefined:String(b.duration),model:b.model};
          return p.evaluate(`(()=>{if(document.querySelector('[data-testid="to_login_button"]'))throw Error('请先在豆包窗口登录');const r=globalThis.__doubaoLocalRequire,params=r.c['528914']?.exports;if(!params?.SM)throw Error('参数模块未加载');const el=document.querySelector('[data-testid="chat_input"]');if(!el)throw Error('没有视频输入框');const root=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];const stack=[root],seen=new Set(),controls=new Map();while(stack.length&&seen.size<5000){const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);if(f.child)stack.push(f.child);if(f.sibling)stack.push(f.sibling);for(const v of Object.values(f.memoizedProps??{})){for(const c of (Array.isArray(v)?v:[v])){if(typeof c?.valueKey==='string'&&c.valueKey.startsWith('video-')&&Array.isArray(c.options))controls.set(c.valueKey,c);}}}const wanted=${JSON.stringify(settings)},changes=[];for(const key of ['model','ratio','duration']){if(wanted[key]===undefined)continue;const full='video-'+key,control=controls.get(full),option=control?.options.find(o=>String(o.value)===String(wanted[key])||o.label===wanted[key]);if(!control||!option)throw Error('当前视频控件不提供该参数：'+key);const old=params.ej(full)??{};changes.push([full,{...old,...option,actionBarItemId:control.actionBarItemId,submitKey:control.submitKey??old.submitKey}]);}for(const [key,value]of changes)params.SM(key,value);return {prepared:true,submitted:false,settings:Object.fromEntries(changes.map(([key,o])=>[key,{value:o.value,label:o.label,id:o.id}]))};})()`);
        }
        if(u.pathname==='/video/draft'){
          if(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>24000)throw Error('prompt必须为1—24000字符');
          const editor=await p.evaluate(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(editorSelector)})].filter(e=>e.getClientRects().length);if(all.length!==1)throw Error('需有且仅有一个可见输入框');const e=all[0];e.focus();if('value'in e){e.select();}else{const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);}return {tag:e.tagName,testid:e.getAttribute('data-testid')}})()`);
          await p.send('Input.insertText',{text:b.prompt});
          const actual=await p.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(editorSelector)})].find(e=>e.getClientRects().length);return e?(${readEditor})(e):''})()`);
          if(actual.trim()!==b.prompt.trim())throw Error('提示词写入校验失败；未提交');
          return {drafted:true,submitted:false,editor,note:'草稿未发送。可用/video/prepare设置参数，再用/video/submit明确提交。'};
        }
        if(b.commit!==true)throw Error('发送需要 commit:true；此操作可能消耗额度');
        if(typeof b.prompt!=='string'||!b.prompt.trim())throw Error('发送需提供与输入框完全一致的prompt');
        await p.evaluate(bootstrap);
        const check=await p.evaluate(`(()=>{if(document.querySelector('[data-testid="to_login_button"]'))throw Error('请先在豆包窗口登录');const es=[...document.querySelectorAll(${JSON.stringify(editorSelector)})].filter(e=>e.getClientRects().length);if(es.length!==1)throw Error('输入框不唯一');const text=(${readEditor})(es[0]);const btn=document.querySelector('[data-testid="chat_input_send_button"]');const toolbar=document.querySelector('[data-testid="chat_input"]')?.cloneNode(true);toolbar?.querySelectorAll('[data-testid="chat_input_input"],[contenteditable="true"],textarea').forEach(e=>e.remove());const params=globalThis.__doubaoLocalRequire.c['528914']?.exports;return {text,buttonFound:!!btn,disabled:btn?.disabled||btn?.getAttribute('aria-disabled')==='true',uiText:toolbar?.textContent??'',model:params?.YC('video-model'),ratio:params?.YC('video-ratio'),duration:params?.YC('video-duration')}})()`);
        assertVideoSelection(check,videoSettings(b),b.prompt);
        await p.evaluate(`document.querySelector('[data-testid="chat_input_send_button"]').click();true`);
        return {submitted:true,generated:false,note:'仅表示发送按钮已点击；仍需检查客户端回复、额度及视频任务结果。'};
      });
      return reply(res,200,result);
    }
    reply(res,404,{error:'未知接口'});
  }catch(e){reply(res,422,{error:e.message});}
});
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))server.listen(port,'127.0.0.1',()=>console.log(`豆包本地接口 http://127.0.0.1:${port}（需 X-Doubao-Local: 1）`));
export {connect,targets,confirmVideo};
