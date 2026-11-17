export const models={'seedance_v2.0':'Seedance 2.0 Fast','seedance_v2.0_mini':'Seedance 2.0 Mini','seedance_v2.0_std':'Seedance 2.0', 'seedance_v2.5':'Seedance 2.5', 'seedance_v2.5_flash':'Seedance 2.5 Flash'};
export function videoSettings(args={}){
 const settings={model:args.model??'seedance_v2.0',ratio:args.ratio??'16:9',duration:args.duration??15};
 if(!Object.hasOwn(models,settings.model))throw Error('不支持的模型编号');
 if(settings.ratio!=='auto'&&!/^[1-9][0-9]?:[1-9][0-9]?$/.test(settings.ratio))throw Error('比例格式错误');
 if(!Number.isInteger(settings.duration)||settings.duration<1||settings.duration>60)throw Error('时长须为1—60秒的整数；实际范围由客户端决定');
 return settings;
}
export function assertVideoSelection(check,expected,prompt){
 const s=videoSettings(expected);
 if(check.text.trim()!==prompt.trim())throw Error('输入框与请求prompt不一致；拒绝发送');
 if(!check.buttonFound||check.disabled)throw Error('发送按钮不可用');
 if(check.model!==s.model||check.ratio!==s.ratio||String(check.duration)!==String(s.duration))throw Error('当前视频参数与请求不一致；拒绝发送');
 if(!videoSettingsMatchUI(check.uiText,s))throw Error('视频界面显示与参数状态不一致；拒绝发送');
}
export function videoSettingsMatchUI(text,s){
 const modelLabel=models[s.model];
 return text.includes(modelLabel)
  && !Object.values(models).some(label=>label!==modelLabel&&label.startsWith(modelLabel)&&text.includes(label))
  && text.includes(s.ratio==='auto'?'自动':s.ratio)
  && new RegExp('(?:^|\\D)'+s.duration+'s(?![0-9])').test(text);
}
export function confirmationPrompt(text,expected){
 const s=videoSettings(expected),marker='确认后我再开始生成视频',end=text.lastIndexOf(marker);
 if(end<0)throw Error('当前对话没有生成确认请求');
 if(/现在开始生成视频|预计等待|你的视频生成好了/.test(text.slice(end+marker.length)))throw Error('本次请求已经确认或生成，拒绝重复确认');
 const before=text.slice(0,end);
 const last=(label)=>[...before.matchAll(new RegExp('(?:^|\\n)\\s*'+label+'\\s*[：:]\\s*([^\\n]+)','g'))].at(-1)?.[1]?.trim();
 if(last('模型')!==models[s.model]||!new RegExp('^'+s.duration+'\\s*秒(?:\\s|$)').test(last('时长')??'')||!new RegExp('^'+(s.ratio==='auto'?'自动':s.ratio)+'(?:\\s|$)').test(last('比例')??''))throw Error('豆包确认参数与原提交不一致，未确认');
 return `确认。按上述已确认的原始提示词，使用${models[s.model]}生成${s.duration}秒、${s.ratio==='auto'?'自动比例':s.ratio+'画面比例'}视频。现在开始生成视频。`;
}
