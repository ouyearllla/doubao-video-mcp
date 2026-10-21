import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {windowsArguments} from '../bridge/launch.mjs';

test('Windows原生解析保留启动参数中的Unicode、空格、尾斜杠、引号和空参数',{skip:process.platform!=='win32'},()=>{
 const values=['--remote-debugging-port=9229','--user-data-dir=C:\\测试 目录\\profile\\','quoted"value','',String.raw`a\\"b`,"$(literal) ` $env:DOUBAO_EXE; &"];
 const script=String.raw`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type @'
using System;using System.Runtime.InteropServices;
public class DoubaoArgumentParser {
 [DllImport("shell32.dll",SetLastError=true)]public static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)]string command,out int argc);
 [DllImport("kernel32.dll")]public static extern IntPtr LocalFree(IntPtr h);
}
'@
$taskCount=0;$taskPtr=[DoubaoArgumentParser]::CommandLineToArgvW($env:DOUBAO_TEST_COMMAND,[ref]$taskCount)
if($taskPtr -eq [IntPtr]::Zero){throw 'CommandLineToArgvW failed'}
try{
 $taskArgs=[Collections.Generic.List[string]]::new()
 for($taskIndex=1;$taskIndex -lt $taskCount;$taskIndex++){$taskArgPtr=[Runtime.InteropServices.Marshal]::ReadIntPtr($taskPtr,$taskIndex*[IntPtr]::Size);$taskArgs.Add([Runtime.InteropServices.Marshal]::PtrToStringUni($taskArgPtr))}
 ConvertTo-Json -InputObject @($taskArgs) -Compress
}finally{[DoubaoArgumentParser]::LocalFree($taskPtr)|Out-Null}`;
 const stdout=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:10000,env:{...process.env,DOUBAO_TEST_COMMAND:'doubao.exe '+windowsArguments(values)}});
 assert.deepEqual(JSON.parse(stdout.trim()),values);
 assert.throws(()=>windowsArguments(['bad\0arg']));
});
