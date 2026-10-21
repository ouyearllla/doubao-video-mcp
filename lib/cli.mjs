import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setup,pkg} from './setup.mjs';
const help=`doubao-video ${pkg.version}（Windows / Node.js 22+）

  doubao-video setup --client codex
  doubao-video setup --client codebuddy --skip-skill
  doubao-video setup --client generic --skip-skill  （WorkBuddy / 其他客户端）
  doubao-video setup --client generic --config-path C:/path/mcp.json
  doubao-video setup --client codex --replace
  doubao-video setup --dry-run --config-only
  doubao-video doctor [--install-dir PATH]
  doubao-video tools
  doubao-video call doubao_video_status --args request.json
  doubao-video server

setup选项：--doubao-exe PATH --install-dir PATH --output-dir PATH
 --state-dir PATH --skill-dir PATH --skip-skill --config-path PATH
 --codex-path PATH --config-only --dry-run --replace

安装或升级后运行setup，再在客户端重新连接MCP。安装本身不启动豆包。
CodeBuddy/generic生成通用MCP配置供导入，不猜测客户端配置位置。
server运行stdio MCP；doctor只读；生成必须显式call且commit:true。
`;
export function parseOptions(args){
 const boolean=new Set(['replace','skip-skill','config-only','dry-run']);
 const strings=new Set(['client','doubao-exe','install-dir','output-dir','state-dir','skill-dir','config-path','codex-path']);
 const output={};
 for(let i=0;i<args.length;i++){
  const argument=args[i];if(!argument.startsWith('--'))throw Error('未知参数：'+argument);
  const key=argument.slice(2);if(key in output)throw Error('重复参数：'+argument);
  if(boolean.has(key))output[key]=true;
  else if(strings.has(key)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error(argument+'缺少取值');output[key]=args[++i];}
  else throw Error('未知选项：'+argument);
 }
 return output;
}
async function loadEnvironment(installDir){
 const root=path.resolve(installDir??path.join(os.homedir(),'.doubao-video-mcp'));
 const file=path.join(root,'installation.json');
 try{const installed=JSON.parse(await fs.readFile(file,'utf8'));if(installed.owner!=='doubao-video-mcp')throw Error('安装记录所有者不匹配');
  for(const [key,value]of Object.entries({DOUBAO_PROFILE_MODE:'native',DOUBAO_EXE:installed.executable,DOUBAO_STATE_DIR:installed.stateDir,DOUBAO_OUTPUT_DIR:installed.outputDir}))if(value)process.env[key]??=value;
  const runtime=JSON.parse(await fs.readFile(path.join(root,'runtime.json'),'utf8'));
  process.env.DOUBAO_BRIDGE_FILE??=path.join(runtime.runtime,'bridge','bridge.mjs');
 }catch(e){if(e.code!=='ENOENT')throw e;}
}
export async function main(argv){
 const [command='help',...args]=argv;
 if(['help','--help','-h'].includes(command)||args.includes('--help')){console.log(help);return;}
 if(['version','--version','-v'].includes(command)){console.log(pkg.version);return;}
 if(command==='setup'){console.log(JSON.stringify(await setup(parseOptions(args)),null,2));return;}
 if(!['server','doctor','tools','call'].includes(command))throw Error('未知命令：'+command+'；使用--help查看用法。');
 const doctorOptions=command==='doctor'?parseOptions(args):{};
 if(Object.keys(doctorOptions).some(k=>k!=='install-dir'))throw Error('doctor只支持--install-dir');
 await loadEnvironment(doctorOptions['install-dir']);
 if(command==='server'){if(args.length)throw Error('server不接受额外参数；通过环境变量配置。');await import('../mcp/server.mjs');return;}
 const {definitions,runTool}=await import('../mcp/tools.mjs');
 if(command==='tools'){if(args.length)throw Error('tools不接受额外参数');console.log(JSON.stringify(definitions,null,2));return;}
 if(command==='doctor'){console.log(JSON.stringify(await runTool('doubao_doctor',{}),null,2));return;}
 const [name,flag,file,...extra]=args;if(!name||flag!=='--args'||!file||extra.length)throw Error('用法：doubao-video call 工具名 --args 参数.json');
 const parameters=JSON.parse(await fs.readFile(file,'utf8'));
 console.log(JSON.stringify(await runTool(name,parameters),null,2));
}
