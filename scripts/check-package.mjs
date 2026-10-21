import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
assert.ok(pkg.name&&pkg.version);assert.ok(!pkg.private);assert.equal(pkg.bin['doubao-video'],'bin/doubao-video.mjs');
assert.ok(!pkg.scripts?.install&&!pkg.scripts?.postinstall&&!pkg.scripts?.preinstall,'安装不应自动改配置');
assert.equal(Object.keys(pkg.dependencies??{}).length,0);
const required=['bin/doubao-video.mjs','lib/setup.mjs','lib/cli.mjs','mcp/server.mjs','mcp/tools.mjs','mcp/workflow.mjs','bridge/bridge.mjs','bridge/client-controls.mjs','bridge/launch.mjs','bridge/video-settings.mjs','skills/doubao-video/SKILL.md','README.md','PUBLISHING.md'];
for(const name of required)await fs.access(path.join(root,name));
assert.ok((await fs.readFile(path.join(root,pkg.bin['doubao-video']),'utf8')).startsWith('#!/usr/bin/env node\n'));
async function scan(directory){for(const item of await fs.readdir(directory,{withFileTypes:true})){
 const full=path.join(directory,item.name);assert.ok(!item.isSymbolicLink(),'不能打包符号链接');
 assert.ok(!/^(profile|state|node_modules|\.npmrc|mcp-client-config\.json|installation\.json)$/i.test(item.name),'不能打包本机状态：'+full);
 assert.ok(!/\.(mp4|bak|sqlite|log|tgz)$/i.test(item.name),'不能打包个人产物：'+full);
 if(item.isDirectory())await scan(full);
}}
for(const name of pkg.files){const directory=path.join(root,name);if((await fs.stat(directory)).isDirectory())await scan(directory);}
console.log(JSON.stringify({package:pkg.name,version:pkg.version,readyToPack:true,zeroDependencies:true,installHooks:false,license:pkg.license}));
