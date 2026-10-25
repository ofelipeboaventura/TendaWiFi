// Explicit opt-in: authenticated reads only; no diagnostic start, CLEAR_MODULE or router writes.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
if (!process.argv.includes('--read-only-live')) throw Error('Use --read-only-live to authorize the local read-only inspection.');
fs.mkdirSync('artifacts/monitoring', { recursive: true });
await build({ stdin: { contents: "export {RouterClient} from './src/main/router'; export {loadAutoLoginConfig} from './src/main/auto-login'; export {AppService} from './src/main/service';", resolveDir: process.cwd() }, platform: 'node', format: 'cjs', bundle: true, outfile: 'artifacts/monitoring/client.cjs' });
const require = createRequire(import.meta.url), { RouterClient, AppService, loadAutoLoginConfig } = require('../artifacts/monitoring/client.cjs');
const client = new RouterClient(); let config; const report = { success: false, readOnly: true, fields: [], rounds: [] };
try {
  config = await loadAutoLoginConfig(process.cwd()); if (!config) throw Error('Local auto-login is not configured.');
  await client.connect(config.host, config.password); config.password = '';
  const files = { clear() {} }; const service = new AppService(files, () => client, client);
  const raw = await client.readModules(['wanStatus', 'systemCfg', 'deviceList']); const fields = new Map();
  const inspect = (value, prefix, depth = 0) => { if (depth > 12 || fields.size > 500) return; if (Array.isArray(value)) { for (const item of value.slice(0, 4)) inspect(item, prefix + '[*]', depth + 1); return; } if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { const name = prefix ? prefix + '.' + key : key; if (/byte|octet|total|flow|traffic|cpu|mem|runtime|rate|speed/i.test(key)) fields.set(name, { field: name, type: Array.isArray(child) ? 'array' : typeof child }); inspect(child, name, depth + 1); } };
  inspect(raw, ''); report.fields = [...fields.values()];
  for (let i = 0; i < 4; i++) { const started = performance.now(); const reading = await service.readMonitoring(i === 0, i === 0); report.rounds.push({ milliseconds: Math.round(performance.now() - started), internet: reading.overview.internet, nodes: reading.nodes.length, onlineClients: reading.clients.filter(d => d.online).length, validRates: [reading.overview.upload, reading.overview.download].every(n => Number.isFinite(n) && n >= 0), counters: reading.counters.length, diagnosticCpuPresent: reading.resources.some(r => r.cpu !== null), diagnosticMemoryPresent: reading.resources.some(r => r.memory !== null), currentResourceReadings: reading.resources.filter(r => r.current).length }); if (i < 3) await new Promise(resolve => setTimeout(resolve, Math.max(0, 1000 - (performance.now() - started)))); }
  const original = await client.overview(); report.reference = { internet: original.internet, nodes: original.nodes.length, validRates: [original.upload, original.download].every(n => Number.isFinite(n) && n >= 0) }; report.success = true;
} catch (error) { report.error = { code: typeof error.code === 'string' ? error.code : 'INSPECTION', message: 'Read-only inspection did not complete. No configuration was changed.' }; process.exitCode = 1; }
finally { if (config) config.password = ''; await client.disconnect(); }
fs.writeFileSync('artifacts/monitoring/inspection.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
