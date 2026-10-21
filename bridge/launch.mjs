import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export function launchSettings(env=process.env){
 const mode=env.DOUBAO_PROFILE_MODE??'native';
 if(!['native','isolated'].includes(mode))throw Error('DOUBAO_PROFILE_MODE须为native或isolated');
 const args=['--remote-debugging-port=9229','--remote-debugging-address=127.0.0.1','--no-first-run'];
 if(mode==='isolated'){
  if(!env.DOUBAO_PROFILE_DIR)throw Error('独立模式须指定DOUBAO_PROFILE_DIR');
  args.push(`--user-data-dir=${env.DOUBAO_PROFILE_DIR}`);
 }
 return {mode,exe:env.DOUBAO_EXE,args};
}
export function executableCandidates(env=process.env){
 return [env.LOCALAPPDATA,env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean).flatMap(root=>[path.join(root,'Doubao','app','Doubao.exe'),path.join(root,'Doubao','Doubao.exe')]);
}
export async function resolveExecutable(env=process.env,{exists=async p=>{try{return (await fs.stat(p)).isFile();}catch{return false;}},discover}={}){
 if(env.DOUBAO_EXE){if(!path.isAbsolute(env.DOUBAO_EXE)||!await exists(env.DOUBAO_EXE))throw Error('DOUBAO_EXE须指向本机实际豆包可执行文件');return env.DOUBAO_EXE;}
 let extra=[];
 if(discover)extra=await discover();
 else if(process.platform==='win32'){
  const script=String.raw`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='SilentlyContinue';$taskPaths=@();$taskPaths+=Get-CimInstance Win32_Process -Filter "Name='Doubao.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object ExecutablePath;foreach($taskKey in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')){Get-ItemProperty $taskKey | Where-Object { $_.DisplayName -match '豆包|Doubao' } | ForEach-Object {if($_.InstallLocation){$taskPaths+=Join-Path $_.InstallLocation 'app\Doubao.exe';$taskPaths+=Join-Path $_.InstallLocation 'Doubao.exe'};if($_.DisplayIcon){$taskIcon=$_.DisplayIcon -replace ',\d+$','';$taskIcon=$taskIcon.Trim('"');$taskPaths+=Join-Path (Split-Path $taskIcon -Parent) 'app\Doubao.exe';$taskPaths+=$taskIcon}}};$taskShell=New-Object -ComObject WScript.Shell;foreach($taskDesktop in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'))){Get-ChildItem -LiteralPath $taskDesktop -Filter '*.lnk' | Where-Object {$_.BaseName -match '^(豆包|Doubao)$'} | ForEach-Object {$taskTarget=$taskShell.CreateShortcut($_.FullName).TargetPath;$taskPaths+=Join-Path (Split-Path $taskTarget -Parent) 'app\Doubao.exe';$taskPaths+=$taskTarget}};ConvertTo-Json -InputObject @($taskPaths | Where-Object {$_}) -Compress`;
  try{const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:8000});extra=JSON.parse(stdout.trim()||'[]');}catch{}
 }
 for(const candidate of [...extra,...executableCandidates(env)])if(candidate&&await exists(candidate))return candidate;
 throw Error('未找到豆包，请安装Windows桌面客户端，或指定DOUBAO_EXE / install.ps1 -DoubaoExe');
}
export async function appRunning(){
 if(process.platform!=='win32')throw Error('豆包桌面桥接当前仅支持Windows');
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[bool](Get-Process -Name Doubao -ErrorAction SilentlyContinue)"],{windowsHide:true,timeout:5000});
 return stdout.trim()==='True';
}
export function windowsArguments(args){
 return args.map(value=>{
  if(typeof value!=='string'||value.includes('\0'))throw Error('启动参数格式错误');
  return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/g,'$1$1')+'"';
 }).join(' ');
}
export async function startViaDesktop(config,env=process.env,{show=1}={}){
 if(![0,1].includes(show))throw Error('桌面窗口模式无效');
 const script=String.raw`$ErrorActionPreference='Stop';$taskShell=New-Object -ComObject Shell.Application;$taskHwnd=0;$taskDesktop=$taskShell.Windows().FindWindowSW(0,0,8,[ref]$taskHwnd,1);if($null -eq $taskDesktop -or $null -eq $taskDesktop.Document.Application){throw 'Windows desktop shell unavailable'};$taskDesktop.Document.Application.ShellExecute($env:DOUBAO_START_EXE,$env:DOUBAO_START_ARGS,$env:DOUBAO_START_CWD,'open',[int]$env:DOUBAO_START_SHOW);[Console]::Out.Write('desktop_launch_requested')`;
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',script],{windowsHide:true,timeout:15000,env:{...env,DOUBAO_START_EXE:config.exe,DOUBAO_START_CWD:path.dirname(config.exe),DOUBAO_START_ARGS:windowsArguments(config.args),DOUBAO_START_SHOW:String(show)}});
 if(stdout.trim()!=='desktop_launch_requested')throw Error('桌面启动未确认，请检查现有豆包进程，勿重复启动');
 return {launched:true,launch_method:'windows_desktop_shell'};
}
export async function launchApp(env=process.env){
 const config=launchSettings(env);
 config.exe=await resolveExecutable(env);
 if(await appRunning())throw Error('豆包已运行但调试连接不可用。请在托盘完整退出豆包一次，再调用doubao_connect；MCP会用常用登录状态打开，不会强行关闭窗口。');
 return {...await startViaDesktop(config,env),profile_mode:config.mode};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv.includes('--find-exe')){
 try{console.log(await resolveExecutable());}catch(e){console.error(e.message);process.exitCode=1;}
}
export async function expandVideoWindow(){
 const script=String.raw`
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class DoubaoVideoViewport {
 public delegate bool CB(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb,IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
}
'@
$taskPids=@(Get-Process Doubao -ErrorAction Stop | ForEach-Object Id)
[DoubaoVideoViewport]::EnumWindows({param($taskH,$taskParam) $taskPid=0; [DoubaoVideoViewport]::GetWindowThreadProcessId($taskH,[ref]$taskPid)|Out-Null; if($taskPids -contains $taskPid -and [DoubaoVideoViewport]::IsWindowVisible($taskH)){$taskTitle=[Text.StringBuilder]::new(256);[DoubaoVideoViewport]::GetWindowText($taskH,$taskTitle,256)|Out-Null; if($taskTitle.ToString() -eq '豆包'){[DoubaoVideoViewport]::SetWindowPos($taskH,[IntPtr]::Zero,0,0,1400,900,6)|Out-Null}};return $true},[IntPtr]::Zero)|Out-Null
`;
 await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:8000});
}
