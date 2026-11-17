// Read only the currently rendered video's React controls, without account storage.
export function liveVideoControls(){
 const el=document.querySelector('[data-testid="chat_input"]');
 const root=el?.[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];
 const stack=[root],seen=new Set(),controls=new Map(),selection={};
 const modern=Array.isArray(globalThis['chunk_@flow-web/desktop']);
 while(stack.length&&seen.size<8000){
  const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);
  if(f.child)stack.push(f.child);if(f.sibling)stack.push(f.sibling);
  const props=f.memoizedProps;
  if(modern&&(props?.control||Array.isArray(props?.controls))){
   const direct=props.control?.valueKey;
   const group=Array.isArray(props.controls)?props.controls.map(c=>c?.valueKey):[];
   for(let hook=f.memoizedState,i=0;hook&&i<100;hook=hook.next,i++){
    const state=Array.isArray(hook.memoizedState)?hook.memoizedState[0]:hook.memoizedState;
    if(direct?.startsWith('video-')&&typeof state?.selectOption==='function')selection[direct]=state.selectedValue;
    for(const key of group)if(key?.startsWith('video-')&&typeof state?.[key]?.selectOption==='function')selection[key]=state[key].selectedValue;
   }
  }
  for(const v of Object.values(f.memoizedProps??{}))for(const c of Array.isArray(v)?v:[v]){
   if(typeof c?.valueKey==='string'&&c.valueKey.startsWith('video-')&&Array.isArray(c.options))controls.set(c.valueKey,c);
  }
 }
 const params=globalThis.__doubaoLocalRequire?.c?.['528914']?.exports;
 const toolbar=el?.cloneNode(true);toolbar?.querySelectorAll('[data-testid="chat_input_input"],[contenteditable="true"],textarea').forEach(e=>e.remove());
 return {available:controls.size>0,ui_text:toolbar?.textContent??'',selected:Object.fromEntries(['model','ratio','duration'].map(k=>[k,modern?selection['video-'+k]:params?.YC('video-'+k)])),controls:Object.fromEntries([...controls].map(([key,c])=>[key,{options:c.options.map(o=>({value:o.value,label:o.label,id:o.id,subscription_tag:o.extra?.subs_only_tag??null}))}]))};
}

function videoMenu(action, label) {
 const shown=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible';
 const unique=(elements,name)=>{
  if(elements.length!==1)throw Error('未找到唯一可见的豆包视频'+name);
  return elements[0];
 };
 const firstLine=e=>e.innerText.split('\n')[0].trim();
 const point=e=>{
  if(e.disabled||e.hasAttribute('data-disabled')||e.getAttribute('aria-disabled')==='true')throw Error('客户端禁用了该视频选项');
  const rect=e.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  if(!e.contains(document.elementFromPoint(x,y)))throw Error('视频控件被遮挡');
  return {x,y};
 };
 if(action==='trigger'){
  const toolbar=document.querySelector('[data-testid="chat_input"]');
  if(!toolbar)throw Error('没有视频输入框');
  const trigger=unique([...toolbar.querySelectorAll('button[aria-haspopup="menu"]')].filter(e=>shown(e)&&(label==='model'?firstLine(e)==='模型':/\b\d+s\b/.test(e.innerText))), '菜单按钮');
  return trigger.getAttribute('aria-expanded')==='true'?null:point(trigger);
 }
 const isModel=action==='model';
 const menu=unique([...document.querySelectorAll('[role="menu"]')].filter(e=>shown(e)&&(isModel?firstLine(e)==='模型':firstLine(e)==='比例'&&e.innerText.includes('时长'))),'菜单');
 if(action==='duration'){
  const slider=unique([...menu.querySelectorAll('[role="slider"]')].filter(shown),'时长滑块');
  slider.focus();
  if(document.activeElement!==slider)throw Error('无法聚焦视频时长滑块');
  return {...Object.fromEntries(['min','max','now'].map(key=>[key,Number(slider.getAttribute('aria-value'+key))]))};
 }
 const option=unique([...menu.querySelectorAll(isModel?'[role="menuitem"]':'button')].filter(e=>shown(e)&&firstLine(e)===label),'选项 '+label);
 return point(option);
}

export async function prepareModernVideo(page, settings) {
 const read=()=>page.evaluate('('+liveVideoControls.toString()+')()');
 const ui=(action,label)=>page.evaluate('('+videoMenu.toString()+')('+JSON.stringify(action)+','+JSON.stringify(label)+')');
 const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
 const click=async point=>{
  if(!point)return;
  const event={...point,button:'left',clickCount:1};
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...event});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...event});
 };
 const key=async (name,number)=>{
  const event={key:name,code:name,windowsVirtualKeyCode:number};
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',...event});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',...event});
 };
 const open=async name=>{
  await key('Escape',27);
  for(let attempt=0;attempt<24;attempt++){
   let trigger;
   try{trigger=await ui('trigger',name);}
   catch(error){
    if(!error.message.includes('未找到唯一可见的豆包视频菜单按钮')||attempt===23)throw error;
    await pause();
    continue;
   }
   await click(trigger);
   await pause();
   return;
  }
 };
 const wait=async (matches,message)=>{
  for(let i=0;i<24;i++){
   const state=await read();
   if(matches(state))return state;
   await pause();
  }
  throw Error(message);
 };
 const changes={};
 for(const kind of ['model','ratio','duration']){
  if(settings[kind]===undefined)continue;
  const state=await read(),control=state.controls['video-'+kind];
  const index=control?.options.findIndex(option=>String(option.value)===String(settings[kind]))??-1;
  if(index<0)throw Error('当前视频控件不提供该参数：'+kind);
  const option=control.options[index];
  if(String(state.selected[kind])!==String(option.value)){
   await open(kind==='model'?'model':'parameters');
   if(kind==='duration'){
    const slider=await ui('duration',null);
    const currentIndex=control.options.findIndex(item=>String(item.value)===String(state.selected.duration));
    if(slider.min!==0||slider.max!==control.options.length-1||slider.now!==currentIndex)throw Error('视频时长滑块与当前选项不一致');
    const steps=index-slider.now;
    for(let step=0;step<Math.abs(steps);step++)await key(steps>0?'ArrowRight':'ArrowLeft',steps>0?39:37);
    await key('Escape',27);
   }else{
    await click(await ui(kind,option.label));
    if(kind==='ratio')await key('Escape',27);
   }
   await wait(next=>String(next.selected[kind])===String(option.value),'豆包未选中 '+option.label);
  }
  changes['video-'+kind]=option;
 }
 return {prepared:true,submitted:false,settings:changes};
}
