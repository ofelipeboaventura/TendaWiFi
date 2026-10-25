import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
if (!process.argv.includes('--read-only-live')) throw Error('Explicit --read-only-live is required.');
fs.mkdirSync('artifacts/monitoring', { recursive: true });
await build({ stdin: { contents: "export {WindowsProbes} from './src/main/monitoring/probes';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: 'artifacts/monitoring/probes.cjs' });
const { WindowsProbes } = createRequire(import.meta.url)('../artifacts/monitoring/probes.cjs');
const provider = new WindowsProbes();
try { const samples = await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(Error('ICMP helper timeout')), 12000); provider.start('192.168.0.1', (rows, available) => { clearTimeout(deadline); if (rows.length === 3) resolve({ helper: true, available, samples: rows }); else reject(Error('ICMP helper unavailable')); }); }); fs.writeFileSync('artifacts/monitoring/probe-check.json', JSON.stringify(samples, null, 2)); console.log(JSON.stringify(samples, null, 2)); }
finally { provider.stop(); }
