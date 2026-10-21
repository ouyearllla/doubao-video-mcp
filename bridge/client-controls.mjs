// Read only the currently rendered video's React controls, without account storage.
export function liveVideoControls(){
 const el=document.querySelector('[data-testid="chat_input"]');
 const root=el?.[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];
 const stack=[root],seen=new Set(),controls=new Map();
 while(stack.length&&seen.size<8000){
  const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);
  if(f.child)stack.push(f.child);if(f.sibling)stack.push(f.sibling);
  for(const v of Object.values(f.memoizedProps??{}))for(const c of Array.isArray(v)?v:[v]){
   if(typeof c?.valueKey==='string'&&c.valueKey.startsWith('video-')&&Array.isArray(c.options))controls.set(c.valueKey,c);
  }
 }
 const params=globalThis.__doubaoLocalRequire?.c?.['528914']?.exports;
 const toolbar=el?.cloneNode(true);toolbar?.querySelectorAll('[data-testid="chat_input_input"],[contenteditable="true"],textarea').forEach(e=>e.remove());
 return {available:controls.size>0,ui_text:toolbar?.textContent??'',selected:Object.fromEntries(['model','ratio','duration'].map(k=>[k,params?.YC('video-'+k)])),controls:Object.fromEntries([...controls].map(([key,c])=>[key,{options:c.options.map(o=>({value:o.value,label:o.label,id:o.id,subscription_tag:o.extra?.subs_only_tag??null}))}]))};
}
