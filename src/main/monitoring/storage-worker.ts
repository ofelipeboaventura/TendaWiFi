import { parentPort, workerData } from 'node:worker_threads';
import { MonitorDatabase } from './database';
let database: MonitorDatabase;
try { database = new MonitorDatabase(workerData.filename); parentPort!.postMessage({ id: 0, ok: true }); }
catch { parentPort!.postMessage({ id: 0, ok: false }); process.exit(1); }
parentPort!.on('message', ({ id, method, args }) => {
  try { const methods = { settings: () => database.settings(args[0]), saveSettings: () => database.saveSettings(args[0], args[1]), append: () => database.append(args[0], args[1]), event: () => database.event(args[0], args[1]), probes: () => database.probes(args[0],args[1]), history: () => database.history(args[0], args[1], args[2]), close: () => database.close() }; if (!Object.hasOwn(methods, method)) throw Error('Invalid worker command'); const value = methods[method as keyof typeof methods](); parentPort!.postMessage({ id, ok: true, value }); if (method === 'close') parentPort!.close(); }
  catch { parentPort!.postMessage({ id, ok: false }); }
});
