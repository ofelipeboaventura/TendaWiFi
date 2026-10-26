import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import { validateRouterHost } from '../router/transport';
import { probeSchema } from './metrics';
import type { ProbeSample } from '../../shared/monitoring';

// Fixed program, never assembled from IPC, host names, credentials or shell fragments.
const script = `$ErrorActionPreference='Stop'
while ($null -ne ($line=[Console]::ReadLine())) {
 try {
  $targets=ConvertFrom-Json $line
  if ($targets.Count -lt 1 -or $targets.Count -gt 4) { break }
  $results=@()
  foreach ($target in $targets) {
   $ip=$null
   if (-not [System.Net.IPAddress]::TryParse([string]$target,[ref]$ip) -or $ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Invalid IP' }
   $ping=New-Object System.Net.NetworkInformation.Ping
   $latency=$null; $status='error'
   try { $reply=$ping.Send($ip,1000); if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) { $latency=$reply.RoundtripTime; $status='success' } else { $status='timeout' } } catch {} finally { $ping.Dispose() }
   $results+=@{target=[string]$target;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();latency=$latency;status=$status}
  }
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @($results)))
 } catch { [Console]::WriteLine('[]') }
}`;
export interface ProbeProvider { start(host: string, callback: (samples: ProbeSample[], available: boolean) => void): void; stop(): void }
export class WindowsProbes implements ProbeProvider {
  private child?: ChildProcessWithoutNullStreams; private timer?: ReturnType<typeof setTimeout>; private deadline?: ReturnType<typeof setTimeout>; private generation = 0;
  constructor(private cadenceMs=5000) {}
  start(host: string, callback: (samples: ProbeSample[], available: boolean) => void) { validateRouterHost(host);this.launch([host,'1.1.1.1','8.8.8.8'],callback); }
  startMesh(host:string,addresses:string[],callback:(samples:ProbeSample[],available:boolean)=>void){validateRouterHost(host);const prefix=host.split('.').slice(0,3).join('.')+'.';const targets=[...new Set(addresses)].filter(ip=>{try{validateRouterHost(ip);return ip!==host&&ip.startsWith(prefix);}catch{return false;}}).slice(0,4);if(!targets.length){this.stop();callback([],false);return;}this.launch(targets,callback);}
  private launch(targets:string[],callback:(samples: ProbeSample[], available: boolean)=>void) {
    this.stop(); const generation = this.generation;
    if (process.platform !== 'win32') { callback([], false); return; }

    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const environment: NodeJS.ProcessEnv = {}; for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[key]) environment[key] = process.env[key];
    const child = this.child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: environment });
    let buffer = '', running = false, sentAt = 0;
    const next = () => { if (generation !== this.generation || running || child.killed) return; running = true; sentAt = Date.now(); child.stdin.write(JSON.stringify(targets) + '\n'); this.deadline = setTimeout(fail, 6000); };
    const fail = () => { if (generation !== this.generation) return; this.stop(); callback([], false); this.timer = setTimeout(() => this.launch(targets, callback), 30000); };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail); child.stderr.on('data', () => undefined);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => {
      if (generation !== this.generation) return; buffer += chunk; if (buffer.length > 8192) { fail(); return; }
      let end: number; while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!running) { fail(); return; }
        let raw: unknown; try { raw = JSON.parse(line); } catch { fail(); return; }
        const parsed = z.array(probeSchema).length(targets.length).safeParse(raw);
        if (!parsed.success || new Set(parsed.data.map(s => s.target)).size !== targets.length || parsed.data.some(s => !targets.includes(s.target) || s.at < sentAt - 1000 || s.at > Date.now() + 1000 || (s.status === 'success') !== (s.latency !== null))) { fail(); return; }
        running = false; if (this.deadline) clearTimeout(this.deadline); callback(parsed.data, parsed.data.some(p => p.status !== 'error'));
        this.timer = setTimeout(next, Math.max(0, this.cadenceMs - (Date.now() - sentAt)));
      }
    }); next();
  }
  stop() { this.generation++; if (this.timer) clearTimeout(this.timer); if (this.deadline) clearTimeout(this.deadline); this.child?.stdin.end(); this.child?.kill(); this.child = undefined; }
}
