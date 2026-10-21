import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveExecutable} from '../bridge/launch.mjs';
const exec=promisify(execFile);
export const packageRoot=fileURLToPath(new URL('../',import.meta.url));
export const pkg=JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'),'utf8'));
const runtimeFiles=['mcp/server.mjs','mcp/tools.mjs','mcp/workflow.mjs','bridge/bridge.mjs','bridge/launch.mjs','bridge/video-settings.mjs','bridge/client-controls.mjs'];
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
async function exists(file){try{await fs.stat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(file){return JSON.parse(await fs.readFile(file,'utf8'));}
export async function atomicJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});try{await fs.rename(temporary,file);}catch(e){await fs.unlink(temporary).catch(()=>{});throw e;}}
async function backup(file,directory){if(!await exists(file))return null;await fs.mkdir(directory,{recursive:true});const to=path.join(directory,stamp()+'-'+path.basename(file));await fs.cp(file,to,{recursive:true,errorOnExist:true,force:false});return to;}
async function stopPreviousBridge(runtime,execute){
 if(!runtime||process.platform!=='win32')return null;
 const script=String.raw`$ErrorActionPreference='Stop';$taskPattern='^\s*"?'+[regex]::Escape($env:DOUBAO_MANAGED_NODE)+'"?\s+"?'+[regex]::Escape($env:DOUBAO_MANAGED_BRIDGE)+'"?(?:\s+--launch)?\s*$';Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine -match $taskPattern} | ForEach-Object {Stop-Process -Id $_.ProcessId}`;
 try{await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:8000,env:{...process.env,DOUBAO_MANAGED_NODE:process.execPath,DOUBAO_MANAGED_BRIDGE:path.join(runtime,'bridge','bridge.mjs')}});return null;}catch{return '无法重启旧桥接；若doctor报告桥接版本不匹配，请结束旧桥接进程再连接。未关闭豆包窗口。';}
}
export async function findCodex(explicit,env=process.env){
 const candidates=explicit?[path.resolve(explicit)]:(env.PATH??env.Path??'').split(path.delimiter).filter(Boolean).flatMap(dir=>[path.join(dir,process.platform==='win32'?'codex.exe':'codex'),path.join(dir,'node_modules','@openai','codex','bin','codex.js')]);
 for(const file of candidates){if(!await exists(file))continue;if(file.endsWith('.js'))return {command:process.execPath,prefix:[file]};if(!/\.(cmd|bat)$/i.test(file))return {command:file,prefix:[]};}
 throw Error('未找到可直接运行的Codex CLI；安装Codex CLI，指定--codex-path，或使用--config-only生成配置。');
}
export async function makePlan(options={},deps={}){
 const home=deps.home??os.homedir(),platform=deps.platform??process.platform;
 if(platform!=='win32')throw Error('当前版本只支持Windows豆包桌面客户端。');
 if(Number(process.versions.node.split('.')[0])<22)throw Error('需要Node.js 22或更高版本。');
 const client=options.client??'codex';if(!['codex','codebuddy','generic'].includes(client))throw Error('--client须为codex、codebuddy或generic');
 const installDir=path.resolve(options['install-dir']??path.join(home,'.doubao-video-mcp'));
 const executable=await (deps.resolveExecutable??resolveExecutable)({...process.env,...(options['doubao-exe']?{DOUBAO_EXE:path.resolve(options['doubao-exe'])}:{})});
 const outputDir=path.resolve(options['output-dir']??path.join(home,'Downloads','DoubaoVideos'));
 const stateDir=path.resolve(options['state-dir']??path.join(installDir,'state'));
 const configPath=path.resolve(options['config-path']??path.join(installDir,'configs',client+'.json'));
 const skillDir=options['skip-skill']?null:options['skill-dir']?path.resolve(options['skill-dir']):client==='codex'?path.join(home,'.codex','skills','doubao-video'):null;
 const under=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
 if(path.extname(configPath).toLowerCase()!=='.json')throw Error('--config-path须为JSON文件路径');
 if(under(stateDir,configPath)||stateDir===installDir||['runtime','backups'].some(dir=>under(path.join(installDir,dir),stateDir)||under(path.join(installDir,dir),configPath)))throw Error('状态和配置目录不能覆盖运行代码或备份目录');
 if(['installation.json','runtime.json'].some(name=>configPath===path.join(installDir,name)))throw Error('配置路径与内部安装记录冲突');
 if(skillDir&&(under(skillDir,installDir)||['runtime','backups','state'].some(dir=>under(path.join(installDir,dir),skillDir))))throw Error('技能路径不能覆盖安装根目录、运行代码、备份或状态目录');
 return {version:pkg.version,client,installDir,executable,outputDir,stateDir,configPath,skillDir,launcher:path.join(installDir,'server.mjs'),replace:!!options.replace,register:client==='codex'&&!options['config-only'],dryRun:!!options['dry-run']};
}
export function mergeClientConfig(current,entry,{replace=false}={}){
 if(!current||typeof current!=='object'||Array.isArray(current))throw Error('配置根节点须为JSON对象');
 if(current.mcpServers!==undefined&&(!current.mcpServers||typeof current.mcpServers!=='object'||Array.isArray(current.mcpServers)))throw Error('mcpServers须为JSON对象');
 const previous=current.mcpServers?.doubao;
 if(previous&&JSON.stringify(previous)!==JSON.stringify(entry)&&previous.args?.[0]!==entry.args[0]&&!replace)throw Error('doubao配置已存在且不是本安装；使用--replace显式替换，或另选--config-path。');
 return {...current,mcpServers:{...current.mcpServers,doubao:entry}};
}
async function skillFiles(root){const output=[];for(const item of await fs.readdir(root,{withFileTypes:true})){if(item.isSymbolicLink())throw Error('技能包含符号链接，未复制');const file=path.join(root,item.name);if(item.isDirectory())for(const sub of await skillFiles(file))output.push(path.join(item.name,sub));else output.push(item.name);}return output.sort();}
async function sameSkill(source,target){if(!await exists(target))return true;const sourceFiles=await skillFiles(source),targetFiles=await skillFiles(target);if(JSON.stringify(sourceFiles)!==JSON.stringify(targetFiles))return false;for(const name of sourceFiles)if(!(await fs.readFile(path.join(source,name))).equals(await fs.readFile(path.join(target,name))))return false;return true;}
async function codexState(runner,entry,replace,execute){
 let previous;
 try{const result=await execute(runner.command,[...runner.prefix,'mcp','get','doubao','--json'],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});previous=JSON.parse(result.stdout).transport;}
 catch(e){if(e instanceof SyntaxError||!/No MCP server named|MCP server[^\n]*not found|MCP[^\n]*不存在/i.test(e.stderr??e.message))throw Error('无法检查现有Codex配置，未覆盖：'+e.message);}
 if(previous&&previous.args?.[0]!==entry.args[0]&&!replace)throw Error('Codex已有其他doubao配置；使用--replace明确替换（旧配置会备份）。');
}
export async function setup(options={},deps={}){
 const plan=await makePlan(options,deps);
 const entry={command:process.execPath,args:[plan.launcher],env:{DOUBAO_PROFILE_MODE:'native',DOUBAO_EXE:plan.executable,DOUBAO_STATE_DIR:plan.stateDir,DOUBAO_OUTPUT_DIR:plan.outputDir}};
 const manifestPath=path.join(plan.installDir,'installation.json');
 let manifest=null;if(await exists(plan.installDir)){
  if(!await exists(manifestPath))throw Error('安装目录已有内容且不属于本工具，请另选--install-dir。');
  manifest=await json(manifestPath);if(manifest.owner!=='doubao-video-mcp')throw Error('安装目录所有者不匹配，未覆盖。');
 }
 const sourceSkill=path.join(packageRoot,'skills','doubao-video');
 if(plan.skillDir&&await exists(plan.skillDir)&&manifest?.skillDir!==plan.skillDir&&!plan.replace&&!await sameSkill(sourceSkill,plan.skillDir))throw Error('已有不同内容的技能；使用--replace或--skip-skill，原内容会先备份。');
 const current=await exists(plan.configPath)?await json(plan.configPath):{};
 const configuration=mergeClientConfig(current,entry,plan);
 const execute=deps.execFile??exec;
 const runner=plan.register?await (deps.findCodex??findCodex)(options['codex-path']):null;
 if(runner)await codexState(runner,entry,plan.replace,execute);
 if(plan.dryRun)return {...plan,configuration,written:false};
 const backups=[];const backupDir=path.join(plan.installDir,'backups');
 const previousRuntime=await exists(path.join(plan.installDir,'runtime.json'))?(await json(path.join(plan.installDir,'runtime.json'))).runtime:null;
 if(previousRuntime&&path.dirname(previousRuntime)!==path.join(plan.installDir,'runtime'))throw Error('运行指针不属于本安装目录，未更新或停止进程');
 await fs.mkdir(plan.installDir,{recursive:true});
 const hash=createHash('sha256');for(const name of runtimeFiles){hash.update(name);hash.update(await fs.readFile(path.join(packageRoot,name)));}
 const digest=hash.digest('hex'),runtime=path.join(plan.installDir,'runtime',pkg.version+'-'+digest.slice(0,16));
 if(!await exists(runtime)){
  const stage=runtime+'.staging-'+randomUUID();await fs.mkdir(stage,{recursive:true});
  for(const name of runtimeFiles){const to=path.join(stage,name);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(path.join(packageRoot,name),to);}
  await fs.rename(stage,runtime);
 }else{for(const name of runtimeFiles)if(!(await fs.readFile(path.join(runtime,name))).equals(await fs.readFile(path.join(packageRoot,name))))throw Error('已有运行目录内容与校验不符，未覆盖');}
 // Register a stable launcher, never a path under npx's disposable cache.
 const launcher=`import fs from 'node:fs/promises';\nimport path from 'node:path';\nimport {pathToFileURL} from 'node:url';\nconst root=new URL('./',import.meta.url);\nconst config=JSON.parse(await fs.readFile(new URL('runtime.json',root),'utf8'));\nprocess.env.DOUBAO_BRIDGE_FILE=path.join(config.runtime,'bridge','bridge.mjs');\nawait import(pathToFileURL(path.join(config.runtime,'mcp','server.mjs')).href);\n`;
 for(const file of [plan.configPath,path.join(plan.installDir,'runtime.json'),plan.launcher,manifestPath]){const copy=await backup(file,backupDir);if(copy)backups.push(copy);}
 if(plan.skillDir){const copy=await backup(plan.skillDir,backupDir);if(copy)backups.push(copy);await fs.mkdir(plan.skillDir,{recursive:true});await fs.cp(sourceSkill,plan.skillDir,{recursive:true,force:true});}
 await fs.writeFile(plan.launcher,launcher);
 await atomicJson(path.join(plan.installDir,'runtime.json'),{version:pkg.version,runtime,digest});
 await atomicJson(plan.configPath,configuration);
 await atomicJson(manifestPath,{owner:'doubao-video-mcp',version:pkg.version,client:plan.client,skillDir:plan.skillDir,configuration:plan.configPath,executable:plan.executable,outputDir:plan.outputDir,stateDir:plan.stateDir});
 if(runner){
  const home=deps.home??os.homedir(),codexConfig=path.join(process.env.CODEX_HOME??path.join(home,'.codex'),'config.toml');
  const copy=await backup(codexConfig,backupDir);if(copy)backups.push(copy);
  const args=[...runner.prefix,'mcp','add','doubao'];for(const [key,value]of Object.entries(entry.env))args.push('--env',key+'='+value);args.push('--',entry.command,...entry.args);
  try{await execute(runner.command,args,{windowsHide:true,timeout:20000,maxBuffer:1024*1024});}catch(e){throw Error('通用配置和运行代码已安装，但Codex注册失败；旧配置备份在'+backupDir+'。'+e.message);}
 }
 const bridgeRestartWarning=previousRuntime&&previousRuntime!==runtime?await stopPreviousBridge(previousRuntime,execute):null;
 return {...plan,runtime,backups,written:true,registered:!!runner,bridgeRestartWarning,credentialsCopied:false,next:runner?'重新打开Codex后使用doubao MCP。':'将生成文件中的mcpServers.doubao导入目标客户端；未修改该客户端的其他配置。'};
}
