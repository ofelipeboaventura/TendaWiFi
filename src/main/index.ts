import { app, BrowserWindow, ipcMain, Menu, protocol, session, type IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname, dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { DesktopAPI, ErrorCode, Result, Values } from '../shared/types';
import { actionSchema, AppService, clientChangeSchema } from './service';
import { FileVault } from './files';
import { AppError } from './errors';
import { loadAutoLoginConfig } from './auto-login';

protocol.registerSchemesAsPrivileged([{ scheme: 'tenda', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);
app.enableSandbox();
const devOrigin = !app.isPackaged && process.env.TENDA_DEV_URL === 'http://127.0.0.1:5173' ? process.env.TENDA_DEV_URL : undefined;
const allowedOrigin = devOrigin ?? 'tenda://app';
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
let mainWindow: BrowserWindow;
let service: AppService;
let startupLogin: Promise<Error | null> | undefined;
const callTimes: number[] = [];
const empty = z.undefined();
const previewId = z.object({ id: z.string().min(1).max(180) }).strict();
const schemas: Record<keyof DesktopAPI, z.ZodType> = {
  connect: z.object({ host: z.string().min(7).max(15), password: z.string().min(1).max(63) }).strict(),
  demo: empty, disconnect: empty, connection: empty, overview: empty, clients: empty, mesh: empty, features: empty,
  readFeature: z.object({ id: z.string().min(1).max(64) }).strict(),
  prepareChange: z.object({ id: z.string().min(1).max(64), revision: z.string().regex(/^[a-f0-9]{64}$/), values: z.record(z.string().max(150), z.unknown()) }).strict(),
  prepareClientChange: clientChangeSchema, prepareAction: actionSchema,
  applyChange: previewId, cancelChange: previewId,
  selectFile: z.object({ kind: z.enum(['firmware', 'configuration']) }).strict(), backup: empty, logs: empty, maintenanceStatus: empty,
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
  const handlers: Record<keyof DesktopAPI, (payload: any) => unknown> = {
    connect: input => service.connect(input), demo: () => service.demo(), disconnect: () => service.disconnect(), connection: async () => { const pending = startupLogin; startupLogin = undefined; const error = await pending; if (error) throw error; return service.connection(); }, overview: () => service.overview(), clients: () => service.clients(), mesh: () => service.mesh(), features: () => service.definitions(),
    readFeature: input => service.readFeature(input), prepareChange: input => service.prepareChange(input as { id: string; values: Values; revision: string }), prepareClientChange: input => service.prepareClientChange(input), prepareAction: input => service.prepareAction(input), applyChange: input => service.applyChange(input), cancelChange: input => service.cancelChange(input), selectFile: input => service.selectFile(input), backup: () => service.backup(), logs: () => service.logs(), maintenanceStatus: () => service.maintenanceStatus(),
  };
  for (const name of Object.keys(handlers) as (keyof DesktopAPI)[]) ipcMain.handle(`tenda:${name}`, async (event, payload: unknown): Promise<Result<unknown>> => {
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
  mainWindow = new BrowserWindow({ width: 1440, height: 960, minWidth: 980, minHeight: 680, show: false, backgroundColor: '#0b101b', title: 'Tenda WiFi Desktop', autoHideMenuBar: true, webPreferences: { preload: resolve(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged, spellcheck: false } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event, destination) => { if (!destination.startsWith(`${allowedOrigin}/`) && destination !== allowedOrigin) event.preventDefault(); });
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  const configDirectory = app.isPackaged ? portable && isAbsolute(portable) ? portable : dirname(process.execPath) : resolve(__dirname, '..');
  startupLogin = (async () => { const config = await loadAutoLoginConfig(configDirectory); if (config) { try { await service.connect(config); } finally { config.password = ''; } } return null; })().catch(error => error instanceof Error ? error : new AppError('INTERNAL', 'Não foi possível concluir o login automático.'));
  registerIPC(); await createWindow();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(bootstrap).catch(() => app.quit());
  app.on('window-all-closed', () => { void service?.shutdown(); app.quit(); });
  app.on('before-quit', () => { void service?.shutdown(); });
}
