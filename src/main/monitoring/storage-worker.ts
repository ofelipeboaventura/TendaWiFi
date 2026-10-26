import { parentPort, workerData } from 'node:worker_threads';
import { AppError } from '../errors';
import { MonitorDatabase } from './database';
let database: MonitorDatabase;
try { database = new MonitorDatabase(workerData.filename); parentPort!.postMessage({ id: 0, ok: true }); }
catch { parentPort!.postMessage({ id: 0, ok: false }); process.exit(1); }
parentPort!.on('message', ({ id, method, args }) => {
  try { const methods = { intelligence:()=>database.intelligence(args[0],args[1],args[2]),reportsList:()=>database.reportsList(args[0]),reportGet:()=>database.reportGet(args[0],args[1]),layout:()=>database.layout(args[0]),saveLayout:()=>database.saveLayout(args[0],args[1]),extraQuality:()=>database.extraQuality(args[0],args[1]),qualityReport:()=>database.qualityReport(args[0],args[1],args[2]),observation:()=>database.observation(args[0],args[1],args[2]), device:()=>database.device(args[0],args[1],args[2]), settings: () => database.settings(args[0]), saveSettings: () => database.saveSettings(args[0], args[1]), append: () => database.append(args[0], args[1]), event: () => database.event(args[0], args[1]), probes: () => database.probes(args[0],args[1]), history: () => database.history(args[0], args[1], args[2]), close: () => database.close() }; if (!Object.hasOwn(methods, method)) throw Error('Invalid worker command'); const value = methods[method as keyof typeof methods](); parentPort!.postMessage({ id, ok: true, value }); if (method === 'close') parentPort!.close(); }
  catch (error) { const safe=error instanceof AppError && ['FORBIDDEN','VALIDATION','UNSUPPORTED'].includes(error.code)?{code:error.code,message:error.message.slice(0,800)}:undefined; parentPort!.postMessage({ id, ok: false, error:safe }); }
});
