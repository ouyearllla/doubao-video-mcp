import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {setup,makePlan,mergeClientConfig,packageRoot} from '../lib/setup.mjs';
import {parseOptions} from '../lib/cli.mjs';
const scratch=path.join(os.tmpdir(),'doubao-video-mcp-tests');await fs.mkdir(scratch,{recursive:true});
const deps=home=>({home,platform:'win32',resolveExecutable:async()=>path.join(home,'豆包 app','Doubao.exe')});
test('setup参数严格解析，拒绝未知和缺失选项',()=>{
 assert.deepEqual(parseOptions(['--client','codebuddy','--dry-run']),{client:'codebuddy','dry-run':true});
 for(const args of [['--client'],['--unknown'],['extra'],['--replace','--replace']])assert.throws(()=>parseOptions(args));
});
test('通用配置保留其他MCP与字段，不默认覆盖同名服务',()=>{
 const entry={command:'node',args:['our-server']},original={theme:'dark',mcpServers:{other:{command:'keep'}}};
 const merged=mergeClientConfig(original,entry);assert.equal(merged.theme,'dark');assert.equal(merged.mcpServers.other.command,'keep');assert.ok(!original.mcpServers.doubao);
 assert.throws(()=>mergeClientConfig({mcpServers:{doubao:{args:['another']}}},entry));
 assert.equal(mergeClientConfig({mcpServers:{doubao:{args:['another']}}},entry,{replace:true}).mcpServers.doubao.args[0],'our-server');
 assert.throws(()=>mergeClientConfig({mcpServers:[]},entry));
});
test('dry-run不创建目录、不改配置',async()=>{
 const home=await fs.mkdtemp(path.join(scratch,'npm-dry-'));
 try{const result=await setup({client:'codebuddy','dry-run':true},deps(home));assert.equal(result.written,false);await assert.rejects(()=>fs.stat(result.installDir),{code:'ENOENT'});}finally{await fs.rm(home,{recursive:true});}
});
test('Windows限定及客户端错误在写入前拒绝',async()=>{
 await assert.rejects(()=>makePlan({}, {platform:'linux'}),/Windows/);
 await assert.rejects(()=>makePlan({client:'unknown'},deps(scratch)),/client/);
});
test('npx安装使用稳定目录，重装保留状态、备份配置并能启动stdio',async()=>{
 const home=await fs.mkdtemp(path.join(scratch,'npm-stable 中文 空格-'));
 try{
  const first=await setup({client:'codebuddy'},deps(home));assert.ok(first.written);assert.equal(first.registered,false);assert.ok(!first.launcher.startsWith(packageRoot));
  const cfg=JSON.parse(await fs.readFile(first.configPath,'utf8'));assert.equal(cfg.mcpServers.doubao.args[0],first.launcher);
  await fs.mkdir(first.stateDir,{recursive:true});await fs.writeFile(path.join(first.stateDir,'personal.json'),'preserve');
  const second=await setup({client:'codebuddy'},deps(home));assert.equal(await fs.readFile(path.join(first.stateDir,'personal.json'),'utf8'),'preserve');assert.ok(second.backups.length>=3);assert.equal(first.runtime,second.runtime);
  const child=spawn(process.execPath,[first.launcher],{stdio:['pipe','pipe','pipe'],env:{...process.env,...cfg.mcpServers.doubao.env,DOUBAO_BRIDGE_FILE:path.join(home,'stale-bridge.mjs')}});
  const lines=readline.createInterface({input:child.stdout});let stderr='';child.stderr.on('data',c=>stderr+=c);
  try{const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr||'stdio timeout')),5000);lines.once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line));});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',clientInfo:{name:'setup-test',version:'1'},capabilities:{}}})+'\n');});assert.equal(result.result.serverInfo.name,'doubao');}finally{child.stdin.end();child.kill();lines.close();}
 }finally{await fs.rm(home,{recursive:true});}
});
test('拒绝覆盖未知安装目录及不同skill',async()=>{
 const home=await fs.mkdtemp(path.join(scratch,'npm-protect-'));
 try{
  const root=path.join(home,'.doubao-video-mcp');await fs.mkdir(root);await fs.writeFile(path.join(root,'important.txt'),'keep');
  await assert.rejects(()=>setup({client:'generic'},deps(home)),/不属于/);assert.equal(await fs.readFile(path.join(root,'important.txt'),'utf8'),'keep');
  const skill=path.join(home,'custom-skill');await fs.mkdir(skill);await fs.writeFile(path.join(skill,'SKILL.md'),'custom');
  await assert.rejects(()=>setup({client:'generic','install-dir':path.join(home,'fresh'),'skill-dir':skill},deps(home)),/技能/);assert.equal(await fs.readFile(path.join(skill,'SKILL.md'),'utf8'),'custom');
 }finally{await fs.rm(home,{recursive:true});}
});
test('Codex配置通过CLI参数传递，无shell拼接，并备份原配置',async()=>{
 const home=await fs.mkdtemp(path.join(scratch,'npm-codex-'));const calls=[];
 try{
  const configDir=path.join(home,'.codex');await fs.mkdir(configDir);await fs.writeFile(path.join(configDir,'config.toml'),'other config');
  const result=await setup({client:'codex','skip-skill':true},{...deps(home),findCodex:async()=>({command:'codex.exe',prefix:[]}),execFile:async(command,args,options)=>{calls.push({command,args,options});if(args.includes('get'))throw Object.assign(Error('missing'),{stderr:'No MCP server named doubao found'});return {stdout:''};}});
  assert.equal(result.registered,true);assert.equal(calls.length,2);assert.deepEqual(calls[1].args.slice(0,3),['mcp','add','doubao']);assert.ok(!calls[1].options.shell);assert.ok(result.backups.some(b=>b.endsWith('config.toml')));
 }finally{await fs.rm(home,{recursive:true});}
});
test('已管理技能更新时保留修改前的备份',async()=>{
 const home=await fs.mkdtemp(path.join(scratch,'npm-skill-'));const skill=path.join(home,'skills','doubao-video');
 try{await setup({client:'generic','skill-dir':skill},deps(home));await fs.writeFile(path.join(skill,'SKILL.md'),'user edits');const next=await setup({client:'generic','skill-dir':skill},deps(home));
 const copies=await Promise.all(next.backups.filter(p=>path.basename(p).endsWith('doubao-video')).map(p=>fs.readFile(path.join(p,'SKILL.md'),'utf8')));assert.ok(copies.includes('user edits'));
 }finally{await fs.rm(home,{recursive:true});}
});
test('拒绝配置、运行代码、状态与skill的危险路径重叠',async()=>{
 const home=await fs.mkdtemp(path.join(scratch,'npm-paths-'));const root=path.join(home,'.doubao-video-mcp');
 try{for(const options of [{'skill-dir':home},{'config-path':path.join(root,'runtime.json')},{'state-dir':root},{'state-dir':path.join(root,'runtime')},{'config-path':path.join(root,'state','request.json')}])await assert.rejects(()=>makePlan({client:'generic',...options},deps(home)));}
 finally{await fs.rm(home,{recursive:true});}
});
