// Production portable smoke, real reads only. Own process tree is stopped in finally.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
if (!process.argv.includes('--read-only-live')) throw Error('Explicit --read-only-live is required.');
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid version');
const executable = path.resolve('TendaWiFi-'+version+'.exe');
if (!fs.existsSync(executable)) throw Error('Prepare the portable executable first.');
await build({ stdin: { contents: "export {loadAutoLoginConfig} from './src/main/auto-login';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: 'artifacts/monitoring/packaged-config.cjs' });
const { loadAutoLoginConfig } = createRequire(import.meta.url)('../artifacts/monitoring/packaged-config.cjs');
const config = await loadAutoLoginConfig(process.cwd()); if (!config) throw Error('Local auto-login not configured.');
const root = path.resolve('artifacts/packaged-check'); fs.mkdirSync(root, { recursive: true }); const profile = fs.mkdtempSync(path.join(root, 'native-profile-'));
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows', powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ps = (code, env = process.env) => execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue';" + code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, env, timeout: 10000 }).trim();
const admin = ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)') === 'True';
const env = { ...process.env, PATH: path.join(systemRoot, 'System32'), TENDA_ROUTER_HOST: config.host, TENDA_ROUTER_PASSWORD: config.password, TENDA_AUTO_LOGIN: 'true' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.TENDA_DEV_URL;
const child = spawn(executable, ['--hidden', '--user-data-dir=' + profile], { env, windowsHide: true, stdio: 'ignore' }); config.password = ''; delete env.TENDA_ROUTER_PASSWORD;
let processError = false; child.on('error', () => { processError = true; }); let report = { success: false, administrator: admin, nodeAbsentFromPath: true, isolatedProfile: true };
const database = path.join(profile, 'monitoring.sqlite');
try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (processError || child.exitCode !== null) throw Error('Portable app did not remain running.');
    if (fs.existsSync(database)) { let db; try { db = new DatabaseSync(database, { readOnly: true }); const row = db.prepare("SELECT SUM(json_extract(data,'$.samples')) AS count FROM minutes WHERE mac='wan'").get(); if (Number(row?.count ?? 0) >= 6) { report = { ...report, success: !admin, samples: Number(row.count), databaseValid: db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok', historicalCpuPresent: Number(db.prepare("SELECT SUM(json_extract(data,'$.cpuN')) AS n FROM minutes WHERE mac='wan'").get()?.n ?? 0) > 0 }; break; } } catch {} finally { db?.close(); } }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!report.success) throw Error('Portable read-only collection did not validate.');
} finally {
  if (child.pid && child.exitCode === null && !processError) {
    const owned = JSON.parse(ps("$rootId=[int]$env:TENDA_TEST_ROOT_PID; $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $ids=@($rootId); do { $new=@($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object { [int]$_.ProcessId }); $ids+= $new } while ($new.Count -gt 0); ConvertTo-Json -Compress -InputObject @($ids)", { ...process.env, TENDA_TEST_ROOT_PID: String(child.pid) }));
    for (const pid of owned.reverse()) { try { process.kill(pid); } catch {} }
  }
  fs.writeFileSync(path.join(root, 'native-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
