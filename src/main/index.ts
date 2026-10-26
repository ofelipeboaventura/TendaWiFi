import { app, BrowserWindow, ipcMain, Menu, protocol, session, Tray, nativeImage, Notification, powerMonitor, dialog, type IpcMainInvokeEvent } from 'electron';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname, dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { DesktopCommand, ErrorCode, Result, Values } from '../shared/types';
import { actionSchema, AppService, clientChangeSchema } from './service';
import { FileVault } from './files';
import { AppError } from './errors';
import { loadAutoLoginConfig } from './auto-login';
import { MonitoringCollector } from './monitoring/collector';
import { WorkerStore } from './monitoring/storage';
import { ExtraQuality } from './monitoring/extra-quality';
import { WindowsProbes } from './monitoring/probes';
import { settingsSchema, querySchema, pauseSchema, exportSchema } from './monitoring/metrics';
import { layoutSchema,savedIdSchema } from './monitoring/reports';
import { csv } from './monitoring/metrics';
import { observationSchema } from './monitoring/calendar';
import { exportObservation as observationCSV } from './monitoring/observation-export';
import { startupStatus,setStartup } from './startup';
import { exportHistory } from './monitoring/export';

protocol.registerSchemesAsPrivileged([{ scheme: 'tenda', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);
const autoLoginEnvironment: NodeJS.ProcessEnv = {}; for (const key of ['TENDA_AUTO_LOGIN', 'TENDA_ROUTER_HOST', 'TENDA_ROUTER_PASSWORD']) if (process.env[key] !== undefined) autoLoginEnvironment[key] = process.env[key];
delete process.env.TENDA_ROUTER_PASSWORD;
// Main-process kill switch, also used by read-only integration checks. Never supplied to a renderer.
const resourceDiagnosticsAllowed = process.env.TENDA_RESOURCE_DIAGNOSTICS !== 'false';
delete process.env.TENDA_RESOURCE_DIAGNOSTICS;
app.enableSandbox();
const devOrigin = !app.isPackaged && process.env.TENDA_DEV_URL === 'http://127.0.0.1:5173' ? process.env.TENDA_DEV_URL : undefined;
const allowedOrigin = devOrigin ?? 'tenda://app';
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
let mainWindow: BrowserWindow;
let service: AppService;
let monitoring: MonitoringCollector;
let tray: Tray;
let quitting = false, shutdownComplete = false, shutdownStarted = false;
let connectionQueue: Promise<unknown> = Promise.resolve();
function connectionAction<T>(action: () => Promise<T>): Promise<T> { const next = connectionQueue.then(async () => { await monitoring.stop(); const result = await action(); if (service.connection().connected) await monitoring.start(); updateTray(); return result; }); connectionQueue = next.catch(() => undefined); return next; }
let startupLogin: Promise<Error | null> | undefined;
const callTimes: number[] = [];
const empty = z.undefined();
const previewId = z.object({ id: z.string().min(1).max(180) }).strict();
const schemas: Record<DesktopCommand, z.ZodType> = {
  connect: z.object({ host: z.string().min(7).max(15), password: z.string().min(1).max(63) }).strict(),
  demo: empty, disconnect: empty, connection: empty, overview: empty, clients: empty, mesh: empty, features: empty,
  readFeature: z.object({ id: z.string().min(1).max(64) }).strict(),
  prepareChange: z.object({ id: z.string().min(1).max(64), revision: z.string().regex(/^[a-f0-9]{64}$/), values: z.record(z.string().max(150), z.unknown()) }).strict(),
  prepareClientChange: clientChangeSchema, prepareAction: actionSchema,
  applyChange: previewId, cancelChange: previewId,
  selectFile: z.object({ kind: z.enum(['firmware', 'configuration']) }).strict(), backup: empty, logs: empty, maintenanceStatus: empty,
  observationIntelligence:observationSchema,observationReports:empty,observationLayout:empty,saveObservationLayout:layoutSchema,exportSavedReport:savedIdSchema,observationQuality:observationSchema,observationReport:observationSchema,observationDevice:observationSchema.refine(v=>!!v.deviceMac),exportObservation:z.strictObject({range:z.enum(['today','yesterday','7d','month','lastMonth','year','custom']),from:z.number().int().nonnegative().optional(),to:z.number().int().nonnegative().optional(),deviceMac:z.string().regex(/^(?:[A-F0-9]{2}:){5}[A-F0-9]{2}$/).optional(),kind:z.enum(['volumes','inventory','events'])}),desktopStartup:empty,desktopSetStartup:z.strictObject({enabled:z.boolean()}),
  monitoringStatus: empty, monitoringHistory: querySchema, monitoringSaveSettings: settingsSchema, monitoringPause: pauseSchema, exportMonitoring: exportSchema,
};
const codes: ErrorCode[] = ['VALIDATION', 'AUTH', 'LOCKED', 'OFFLINE', 'TIMEOUT', 'UNCERTAIN', 'CONFLICT', 'UNSUPPORTED', 'ROUTER', 'FORBIDDEN', 'INTERNAL'];
export function toPublicError(error: unknown): Result<never> {
  if (error instanceof z.ZodError) return { ok: false, error: { code: 'VALIDATION', message: 'Verifique o formato, os limites e os campos informados. Nenhuma alteração foi aplicada.' } };
  if (error instanceof AppError || error instanceof Error && 'code' in error && codes.includes(error.code as ErrorCode)) return { ok: false, error: { code: (error as AppError).code, message: error.message.slice(0, 800) } };
  return { ok: false, error: { code: 'INTERNAL', message: 'Não foi possível concluir a operação. Atualize os dados e tente novamente.' } };
}
function validateSender(event: IpcMainInvokeEvent) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new AppError('FORBIDDEN', 'Origem da operação não autorizada.');
  const url = new URL(event.senderFrame.url);
  if (devOrigin ? url.origin !== devOrigin : url.protocol !== 'tenda:' || url.host !== 'app') throw new AppError('FORBIDDEN', 'Origem da operação não autorizada.');
  const now = Date.now(); while (callTimes.length && now - callTimes[0] > 60_000) callTimes.shift();
  if (callTimes.length >= 240) throw new AppError('LOCKED', 'Muitas solicitações. Aguarde alguns segundos antes de continuar.'); callTimes.push(now);
}
function registerIPC() {
  const handlers: Record<DesktopCommand, (payload: any) => unknown> = {
    connect: input => connectionAction(() => service.connect(input)), demo: () => connectionAction(() => service.demo()), disconnect: () => connectionAction(() => service.disconnect()), connection: async () => { const pending = startupLogin; startupLogin = undefined; const error = await pending; if (error) throw error; return service.connection(); }, overview: () => service.overview(), clients: () => service.clients(), mesh: () => service.mesh(), features: () => service.definitions(),
    readFeature: input => service.readFeature(input), prepareChange: input => service.prepareChange(input as { id: string; values: Values; revision: string }), prepareClientChange: input => service.prepareClientChange(input), prepareAction: input => service.prepareAction(input), applyChange: input => service.applyChange(input), cancelChange: input => service.cancelChange(input), selectFile: input => service.selectFile(input), backup: () => service.backup(), logs: () => service.logs(), maintenanceStatus: () => service.maintenanceStatus(),
    observationIntelligence:input=>monitoring.intelligence(input),observationReports:()=>monitoring.reports(),observationLayout:()=>monitoring.layout(),saveObservationLayout:input=>monitoring.saveLayout(input),
    exportSavedReport:async input=>{const identity=monitoring.identity(),report=await monitoring.savedReport(input.id),text=csv([['Inicio UTC','Fim UTC','Cobertura %','Origem','Upload medido bytes','Download medido bytes','Upload estimado bytes','Download estimado bytes','Disponibilidade observada %'],[new Date(report.from).toISOString(),new Date(report.to).toISOString(),report.coverage,report.totals.basis,report.totals.measuredUp,report.totals.measuredDown,report.totals.estimatedUp,report.totals.estimatedDown,report.availability],[],['MAC','Nome','Volume observado bytes','Origem'],...report.top.map(d=>[d.mac,d.name,d.bytes,d.basis]),[],['Dia UTC','Upload medido bytes','Download medido bytes','Upload estimado bytes','Download estimado bytes','Cobertura ms'],...report.days.map(d=>[new Date(d.at).toISOString(),d.measuredUp,d.measuredDown,d.estimatedUp,d.estimatedDown,d.coveredMs])]);const result=await dialog.showSaveDialog(mainWindow,{title:'Exportar relatorio',defaultPath:'TendaWiFi-'+report.id+'.csv',filters:[{name:'CSV',extensions:['csv']}]});if(result.canceled||!result.filePath)return{saved:false};monitoring.assertIdentity(identity);if(!result.filePath.toLowerCase().endsWith('.csv'))throw new AppError('VALIDATION','Escolha um arquivo CSV.');await writeFile(result.filePath,text,{mode:0o600});return{saved:true};},
    observationQuality:input=>monitoring.qualityReport(input),observationReport:input=>monitoring.observation(input),observationDevice:input=>monitoring.device(input),desktopStartup:()=>startupStatus(),desktopSetStartup:input=>{if(!service.connection().connected)throw new AppError('AUTH','Conecte-se ao roteador antes de alterar a inicializacao.');if(service.connection().demo)throw new AppError('UNSUPPORTED','A demonstracao nao altera a inicializacao do Windows.');return setStartup(input.enabled);},
    exportObservation:async input=>{const identity=monitoring.identity(),{kind,...query}=input;const report=await monitoring.observation(query);const text=observationCSV(kind,report);if(Buffer.byteLength(text)>8*1024*1024)throw new AppError('VALIDATION','Exportacao muito grande.');const result=await dialog.showSaveDialog(mainWindow,{title:'Exportar observacoes',defaultPath:'TendaWiFi-'+kind+'.csv',filters:[{name:'CSV',extensions:['csv']}]});if(result.canceled||!result.filePath)return{saved:false};monitoring.assertIdentity(identity);if(!result.filePath.toLowerCase().endsWith('.csv'))throw new AppError('VALIDATION','Escolha um arquivo CSV.');await writeFile(result.filePath,text,{mode:0o600});return{saved:true};},
    monitoringStatus: () => monitoring.status(), monitoringHistory: input => monitoring.history(input), monitoringSaveSettings: input => monitoring.saveSettings(input), monitoringPause: input => monitoring.pause(input.paused),
    exportMonitoring: async input => { const identity = monitoring.identity(), query = exportSchema.parse(input), history = await monitoring.history(querySchema.parse({ period: query.period, ...(query.deviceMac ? { deviceMac: query.deviceMac } : {}) })); const text = exportHistory(query, history); if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new AppError('VALIDATION', 'A exportação excede o limite permitido.'); const result = await dialog.showSaveDialog(mainWindow, { title: 'Exportar monitoramento', defaultPath: `TendaWiFi-${query.kind}-${query.period}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (result.canceled || !result.filePath) return { saved: false }; monitoring.assertIdentity(identity); if (!result.filePath.toLowerCase().endsWith('.csv')) throw new AppError('VALIDATION', 'Salve a exportação com extensão .csv.'); await writeFile(result.filePath, text, { mode: 0o600 }); return { saved: true }; },
  };
  for (const name of Object.keys(handlers) as DesktopCommand[]) ipcMain.handle(`tenda:${name}`, async (event, payload: unknown): Promise<Result<unknown>> => {
    try {
      validateSender(event);
      // IPC itself is not authorization. Bound and validate every request in the trusted process.
      if (payload !== undefined && JSON.stringify(payload).length > 64_000) throw new AppError('VALIDATION', 'A solicitação excede o tamanho permitido.');
      const input = schemas[name].parse(payload);
      return { ok: true, data: await handlers[name](input) };
    } catch (error) { return toPublicError(error); }
  });
}
async function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 960, minWidth: 980, minHeight: 680, show: false, backgroundColor: '#0b101b', title: 'Tenda WiFi Desktop', icon: resolve(__dirname, '../resources/icon.png'), autoHideMenuBar: true, webPreferences: { preload: resolve(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged, spellcheck: false } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event, destination) => { if (!destination.startsWith(`${allowedOrigin}/`) && destination !== allowedOrigin) event.preventDefault(); });
  mainWindow.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) mainWindow.show(); });
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
  await mainWindow.loadURL(devOrigin ?? 'tenda://app/index.html');
}
async function bootstrap() {
  Menu.setApplicationMenu(null); app.setAppUserModelId('local.tendawifi.desktop');
  protocol.handle('tenda', async request => {
    try {
      const url = new URL(request.url); if (url.host !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
      const root = resolve(__dirname, '../dist'); const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) return new Response('Forbidden', { status: 403 });
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep) || !['.html', '.js', '.css', '.svg', '.png', '.woff2'].includes(extname(file))) return new Response('Not found', { status: 404 });
      const content = await readFile(file); const mime: Record<string,string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
      return new Response(content, { status: 200, headers: { 'Content-Type': mime[extname(file)], 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try { const url = new URL(details.url); const allowed = url.protocol === 'tenda:' && url.hostname === 'app' || Boolean(devOrigin && (url.origin === devOrigin || url.origin === 'ws://127.0.0.1:5173')); callback({ cancel: !allowed }); } catch { callback({ cancel: true }); }
  });
  service = new AppService(new FileVault(() => mainWindow));
  await mkdir(app.getPath('userData'), { recursive: true });
  monitoring = new MonitoringCollector({ connected: () => service.connection().connected, demo: () => service.connection().demo, host: () => service.connection().host, read: (topology, resources,radio) => service.readMonitoring(topology, resources,radio), diagnostics: enabled => service.setResourceDiagnostics(enabled && resourceDiagnosticsAllowed), suspendDiagnostics: () => service.suspendResourceDiagnostics() }, demo => new WorkerStore(demo ? ':memory:' : resolve(app.getPath('userData'), 'monitoring.sqlite')), new WindowsProbes(), event => { try { const title = 'Tenda WiFi — Monitoramento', content = event.message + (event.target ? ` (${event.target})` : ''); if (process.platform === 'win32' && tray && !tray.isDestroyed()) tray.displayBalloon({ title, content, iconType: event.severity === 'critical' ? 'error' : 'warning', respectQuietTime: true }); else if (Notification.isSupported()) new Notification({ title, body: content }).show(); } catch { /* OS notifications may be disabled. */ } },()=>Date.now(),new ExtraQuality());
  monitoring.onUpdate(state => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) { const url = mainWindow.webContents.getURL(); if (url.startsWith(allowedOrigin + '/')) mainWindow.webContents.send('tenda:monitoring-update', state); } updateTray(); });
  createTray();
  powerMonitor.on('suspend', () => monitoring.suspend()); powerMonitor.on('resume', () => monitoring.resume());
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  const configDirectory = app.isPackaged ? portable && isAbsolute(portable) ? portable : dirname(process.execPath) : resolve(__dirname, '..');
  startupLogin = (async () => { const config = await loadAutoLoginConfig(configDirectory, autoLoginEnvironment); if (config) { try { await connectionAction(() => service.connect(config)); } finally { config.password = ''; } } return null; })().catch(error => error instanceof Error ? error : new AppError('INTERNAL', 'Não foi possível concluir o login automático.')).finally(() => { delete autoLoginEnvironment.TENDA_ROUTER_PASSWORD; });
  registerIPC(); await createWindow();
}
function showWindow() { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } }
let traySignature = '';
function updateTray() {
  if (!tray || !monitoring) return; const state = monitoring.snapshot(), connected = service.connection().connected;
  const signature = `${connected}:${state.status}:${state.settings.muted}`; if (signature === traySignature) return; traySignature = signature;
  tray.setToolTip(`Tenda WiFi — ${state.status === 'paused' ? 'Coleta pausada' : connected ? 'Monitoramento local' : 'Desconectado'}`);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir painel', click: showWindow }, { label: state.status === 'paused' ? 'Retomar coleta' : 'Pausar coleta', enabled: connected, click: () => { void monitoring.pause(state.status !== 'paused').catch(() => undefined); } }, { label: 'Silenciar alertas', type: 'checkbox', checked: state.settings.muted, enabled: connected, click: () => { void monitoring.saveSettings({ ...monitoring.snapshot().settings, muted: !monitoring.snapshot().settings.muted }).catch(() => undefined); } }, { type: 'separator' }, { label: 'Sair', click: () => { quitting = true; app.quit(); } }]));
}
function createTray() {
  const icon = nativeImage.createFromPath(resolve(__dirname, '../resources/tray.png'));
  if (icon.isEmpty()) throw new Error('Ícone da aplicação indisponível.');
  tray = new Tray(icon); tray.on('double-click', showWindow); tray.on('balloon-click', showWindow); updateTray();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(bootstrap).catch(() => app.quit());
  app.on('before-quit', event => { if (shutdownComplete) return; event.preventDefault(); if (shutdownStarted) return; shutdownStarted = true; quitting = true; void (async () => { await monitoring?.stop(); await service?.shutdown(); tray?.destroy(); shutdownComplete = true; app.quit(); })().catch(() => { shutdownComplete = true; app.quit(); }); });
}
