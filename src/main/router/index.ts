import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ClientDevice, ConnectionStatus, MeshNode, Overview } from '../../shared/types';
import { decryptPayload, encryptPayload, passwordDigest } from './crypto';
import { enabled, list, normalizeClients, normalizeMesh, normalizeOverview, record, text } from './normalize';
import { httpTransport, RouterError, validateRouterHost, type RouterRequest, type RouterResponse, type RouterTransport } from './transport';

export { RouterError, validateRouterHost } from './transport';
export type { RouterRequest, RouterResponse, RouterTransport } from './transport';
export { passwordDigest, encryptPayload, decryptPayload } from './crypto';
export { normalizeClients, normalizeMesh, normalizeOverview } from './normalize';

export const READ_MODULES = new Set([
  'workMode', 'localhost', 'wanCfg', 'wanStatus', 'wanAdvCfg', 'ipConfig', 'lanCfg', 'systemCfg', 'systemTime',
  'meshTopo', 'meshInfo', 'deviceList', 'deviceListNotNeedRate', 'wifiBasicCfg', 'wifiAdvCfg', 'wifiGuest',
  'apModeStatus', 'ledCfg', 'macFilter', 'deviceVersionList', 'parentControlList', 'wifiTime', 'staticIPList',
  'ddnsCfg', 'dmzCfg', 'remoteWeb', 'portList', 'staticRouteList', 'upnpCfg', 'cloudManage', 'firewallCfg',
  'iptvCfg', 'ipv6Cfg', 'systemLog', 'systemMaintenance', 'systemPwd', 'tr069Cfg', 'vpnServer', 'vpnAccountList',
  'vpnOnlineList', 'vpnClient', 'meshBtn', 'wifiWpsList', 'addStatus', 'syschkInfo',
]);
export const WRITE_MODULES = new Set([
  'wanCfg', 'wanAdvCfg', 'lanCfg', 'wifiBasicCfg', 'wifiAdvCfg', 'wifiGuest', 'ledCfg', 'macFilter',
  'parentControlList', 'wifiTime', 'staticIPList', 'ddnsCfg', 'dmzCfg', 'remoteWeb', 'portList', 'staticRouteList',
  'upnpCfg', 'cloudManage', 'firewallCfg', 'iptvCfg', 'ipv6Cfg', 'systemLog', 'systemMaintenance', 'systemPwd',
  'systemTime', 'tr069Cfg', 'vpnServer', 'vpnAccountList', 'vpnClient', 'meshBtn', 'wifiWpsList', 'workMode',
  'systemReboot', 'systemReset', 'meshInfo', 'meshOptimize', 'addNode', 'deviceVersionList', 'agentLocalUpgrade',
  'setDeviceInfo', 'syschkInfo', 'loginout',
]);

const disconnected: ConnectionStatus = { connected: false, demo: false, host: '', model: '', firmware: '', hardware: '', mode: '', capabilities: [] };
const credentialsSchema = z.strictObject({ host: z.string().min(7).max(15), password: z.string().min(1).max(63).refine(value => !/[\x00-\x1f\x7f]/.test(value)) });
const tokensSchema = z.strictObject({ sign: z.string().refine(value => /^[\x20-\x7e]+$/.test(value) && [16, 24, 32].includes(Buffer.byteLength(value))), stok: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
const safeKeys = new Set(['sn']);

function isPlain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Reject dangerous property names, non-JSON values and unreasonable nesting before use. */
export function validateJSONTree(value: unknown): void {
  let nodes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 100_000 || depth > 24) throw new RouterError('VALIDATION', 'Os dados excedem os limites permitidos.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.length > 1024 * 1024) throw new RouterError('VALIDATION', 'Um campo excede o tamanho permitido.');
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      if (item.length > 4096) throw new RouterError('VALIDATION', 'A lista excede o limite permitido.');
      item.forEach(child => visit(child, depth + 1)); return;
    }
    if (isPlain(item)) {
      const keys = Object.keys(item);
      if (keys.length > 1024) throw new RouterError('VALIDATION', 'O objeto excede o limite permitido.');
      for (const key of keys) {
        if (key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new RouterError('VALIDATION', 'Os dados contêm um campo inválido.');
        visit(item[key], depth + 1);
      }
      return;
    }
    throw new RouterError('VALIDATION', 'Os dados contêm um tipo inválido.');
  }
  visit(value, 0);
}

function parseObject(body: Buffer): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new RouterError('ROUTER', 'O roteador enviou uma resposta inválida.'); }
  if (!isPlain(value)) throw new RouterError('ROUTER', 'O formato da resposta do roteador não é suportado.');
  try { validateJSONTree(value); }
  catch { throw new RouterError('ROUTER', 'A resposta contém dados inválidos.'); }
  return value;
}

function codeOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{1,6}$/.test(value)) return Number(value);
  return null;
}

export interface RouterClientOptions { transport?: RouterTransport; timeoutMs?: number; minIntervalMs?: number }

export class RouterClient {
  private state: ConnectionStatus = { ...disconnected, capabilities: [] };
  private sign = '';
  private stok = '';
  private cookies = new Map<string, string>();
  private transport: RouterTransport;
  private timeoutMs: number;
  private minIntervalMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private epoch = 0;
  private attempts = new Map<string, { failures: number; nextAllowed: number }>();

  constructor(options: RouterClientOptions = {}) {
    this.transport = options.transport ?? httpTransport;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.minIntervalMs = options.minIntervalMs ?? 200;
  }

  getConnection(): ConnectionStatus { return { ...this.state, capabilities: [...this.state.capabilities] }; }

  private clear(): void {
    this.sign = ''; this.stok = ''; this.cookies.clear(); this.state = { ...disconnected, capabilities: [] };
  }

  async disconnect(): Promise<void> { this.epoch++; this.clear(); }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private authenticated(): void {
    if (!this.state.connected || !this.sign || !this.stok) throw new RouterError('AUTH', 'Conecte-se ao roteador para continuar.');
  }

  private async raw(path: string, method: 'GET' | 'POST', body?: Buffer, authenticated = true, mutation = method === 'POST', maxBytes = 4 * 1024 * 1024, contentType = 'application/json; charset=UTF-8'): Promise<RouterResponse> {
    if (authenticated) this.authenticated();
    const host = validateRouterHost(this.state.host);
    const epoch = this.epoch;
    const delay = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    if (epoch !== this.epoch) throw new RouterError('AUTH', 'A sessão foi encerrada antes do envio.');
    if (authenticated) this.authenticated();
    this.lastRequestAt = Date.now();
    const loginRequest = path === '/login/Auth' || path.startsWith('/goform/loginInfo');
    const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*', 'Content-Type': contentType, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'TendaWiFiDesktop/0.1.2', Referer: `http://${host}/${loginRequest ? 'login' : 'index'}.html` };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    if (body) { headers['Content-Type'] = contentType; headers['Content-Length'] = String(body.length); headers.Origin = `http://${host}`; }
    let response: RouterResponse;
    const request = { host, path, method, body, headers, timeoutMs: this.timeoutMs, maxBytes, mutation };
    try {
      try { response = await this.transport(request); }
      catch (error) {
        // Read-only requests may be repeated once after a transient socket failure.
        // Never retry authentication POSTs, configuration writes or action GETs.
        if (method !== 'GET' || mutation || !(error instanceof RouterError) || !['OFFLINE', 'TIMEOUT'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 300));
        if (epoch !== this.epoch) throw new RouterError('AUTH', 'A sessão foi encerrada antes de repetir a consulta.');
        response = await this.transport(request);
      }
    }
    catch (error) {
      if (error instanceof RouterError) {
        if (error.code === 'AUTH' && epoch === this.epoch) this.clear();
        throw error;
      }
      throw new RouterError(mutation ? 'UNCERTAIN' : 'OFFLINE', mutation ? 'Não foi possível confirmar a operação. Consulte o estado antes de tentar novamente.' : 'Não foi possível comunicar com o roteador.');
    }
    if (epoch !== this.epoch) throw new RouterError(mutation ? 'UNCERTAIN' : 'AUTH', mutation ? 'A sessão terminou antes da confirmação. Verifique o estado antes de repetir.' : 'A sessão foi encerrada.');
    if (!response || !Buffer.isBuffer(response.body) || response.body.length > maxBytes) throw new RouterError(mutation ? 'UNCERTAIN' : 'ROUTER', 'A resposta excedeu o limite permitido.');
    if (response.status >= 300 && response.status < 400 || response.status === 401 || response.status === 403) {
      this.clear(); throw new RouterError('AUTH', 'A sessão expirou. Entre novamente no roteador.');
    }
    if (response.status === 429) throw new RouterError('LOCKED', 'O roteador limitou as solicitações. Aguarde antes de tentar novamente.');
    if (response.status < 200 || response.status >= 300) throw new RouterError('ROUTER', `O roteador recusou a solicitação (HTTP ${response.status}).`);
    const cookieHeaders = response.headers['set-cookie'];
    for (const cookie of Array.isArray(cookieHeaders) ? cookieHeaders : typeof cookieHeaders === 'string' ? [cookieHeaders] : []) {
      const pair = cookie.split(';', 1)[0]; const split = pair.indexOf('=');
      if (split < 1 || pair.length > 4096 || /[\r\n\x00]/.test(pair)) continue;
      const name = pair.slice(0, split), value = pair.slice(split + 1);
      if (this.cookies.size >= 32 && !this.cookies.has(name)) continue;
      // This firmware emits the non-RFC name _:USERNAME:_. Accept this exact
      // observed legacy name while retaining strict bounds and value validation.
      if ((/^[!#$%&'*+.^_`|~A-Za-z0-9-]+$/.test(name) || name === '_:USERNAME:_') && /^[\x21-\x3a\x3c-\x7e]*$/.test(value)) {
        if (value) this.cookies.set(name, value); else this.cookies.delete(name);
      }
    }
    return response;
  }

  private path(route: string): string { return `/;stok=${encodeURIComponent(this.stok)}${route}`; }

  private decode(response: RouterResponse, encrypted: boolean, mutation = false, successCodes: readonly number[] = [0]): Record<string, unknown> {
    const sample = response.body.subarray(0, 2048).toString('utf8');
    if (/^\s*(?:<!doctype\s+html|<html)/i.test(sample) || /<form[^>]*(?:login|auth)/i.test(sample)) {
      this.clear(); throw new RouterError('AUTH', 'A sessão expirou. Entre novamente no roteador.');
    }
    let data: Record<string, unknown>;
    try {
      data = parseObject(response.body);
      if (encrypted && Object.hasOwn(data, 'data')) {
        if (typeof data.data !== 'string') throw new Error('Invalid envelope');
        data = parseObject(Buffer.from(decryptPayload(data.data, this.sign), 'utf8'));
      } else if (encrypted && codeOf(data.errCode) !== 1000) {
        // Authenticated module replies must not silently fall back to plaintext.
        throw new Error('Missing encrypted envelope');
      }
    } catch (error) {
      if (error instanceof RouterError && error.code === 'AUTH') throw error;
      throw new RouterError(mutation ? 'UNCERTAIN' : 'ROUTER', mutation
        ? 'O roteador não enviou uma confirmação válida. Consulte o estado antes de repetir a operação.'
        : 'A resposta do roteador não corresponde ao protocolo esperado.');
    }
    const code = codeOf(data.errCode);
    if (Object.hasOwn(data, 'errCode') && code === null) throw new RouterError(mutation ? 'UNCERTAIN' : 'ROUTER', 'O roteador enviou um código de resposta inválido.');
    if (code === 1000) { this.clear(); throw new RouterError('AUTH', 'A sessão expirou. Entre novamente no roteador.'); }
    if (code !== null && !successCodes.includes(code)) throw new RouterError(code === 2 && !encrypted ? 'AUTH' : 'ROUTER', code === 2 && !encrypted ? 'Senha incorreta.' : 'O roteador recusou a operação. Verifique os dados e o estado atual.');
    if (mutation && code === null) throw new RouterError('UNCERTAIN', 'A resposta não confirma a operação. Consulte o estado antes de tentar novamente.');
    return data;
  }

  async connect(host: string, password: string): Promise<ConnectionStatus> {
    const parsed = credentialsSchema.safeParse({ host, password });
    if (!parsed.success) throw new RouterError('VALIDATION', 'Informe o IP privado do roteador e uma senha válida.');
    validateRouterHost(host);
    const previousAttempt = this.attempts.get(host);
    if (previousAttempt && previousAttempt.nextAllowed > Date.now()) throw new RouterError('LOCKED', 'Aguarde antes de tentar entrar novamente.');
    const epoch = ++this.epoch;
    this.clear();
    return this.enqueue(async () => {
      if (epoch !== this.epoch) throw new RouterError('AUTH', 'A tentativa de conexão foi cancelada.');
      this.state.host = host;
      let stage = 'consultar o estado do login';
      try {
        const info = this.decode(await this.raw(`/goform/loginInfo?rand=${Math.random()}`, 'GET', undefined, false, false), false);
        const loginInfoSchema = z.object({ isLimit: z.union([z.boolean(), z.literal(0), z.literal(1)]), isLocked: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(), time: z.union([z.number().finite(), z.string().regex(/^\d{1,6}$/)]).optional() });
        const checkedInfo = loginInfoSchema.safeParse(info.loginInfo);
        if (!checkedInfo.success || (!enabled(checkedInfo.data.isLimit) && checkedInfo.data.isLocked === undefined)) throw new RouterError('ROUTER', 'O roteador retornou um estado de autenticação inválido.');
        const loginInfo = checkedInfo.data;
        if (enabled(loginInfo.isLimit)) throw new RouterError('LOCKED', 'O limite de sessões do roteador foi atingido.');
        if (enabled(loginInfo.isLocked)) {
          const seconds = Math.min(3600, Math.max(1, Number(loginInfo.time) || 60));
          this.attempts.set(host, { failures: previousAttempt?.failures ?? 0, nextAllowed: Date.now() + seconds * 1000 });
          throw new RouterError('LOCKED', 'O login está temporariamente bloqueado pelo roteador. Aguarde para tentar novamente.');
        }
        stage = 'autenticar a senha';
        const response = await this.raw('/login/Auth', 'POST', Buffer.from(JSON.stringify({ userName: 'admin', password: passwordDigest(password) })), false, false);
        const auth = parseObject(response.body);
        const code = codeOf(auth.errCode);
        if (code === 4 || code === 5) throw new RouterError('LOCKED', 'O roteador bloqueou temporariamente esta tentativa de login.');
        if (code !== 0) throw new RouterError('AUTH', 'Não foi possível entrar. Verifique a senha do roteador.');
        // index.js clears sign/stok before getStok(): this bootstrap endpoint is
        // cookie-authenticated, unprefixed and plaintext. It must not use Auth's tokens.
        this.sign = ''; this.stok = '';
        stage = 'validar a sessão';
        const refreshed = this.decode(await this.raw(`/goform/stokCfg?rand=${Math.random()}`, 'GET', undefined, false, false), false);
        const refreshedTokens = tokensSchema.safeParse(refreshed.stokCfg);
        if (!refreshedTokens.success) throw new RouterError('ROUTER', 'Não foi possível validar a sessão do roteador.');
        this.sign = refreshedTokens.data.sign; this.stok = refreshedTokens.data.stok;
        this.state.connected = true;
        stage = 'consultar os dados do equipamento';
        const data = await this.readRaw(['systemCfg', 'workMode', 'localhost']);
        const config = record(data.systemCfg);
        stage = 'identificar o modelo';
        const macroResponse = await this.raw('/js/macro_config.js', 'GET', undefined, true, false, 128 * 1024);
        const macro = macroResponse.body.toString('utf8');
        const macroValue = (key: string): string => macro.match(new RegExp(`\\bvar\\s+${key}\\s*=\\s*["']([^"'\\r\\n]{0,128})["']\\s*;`))?.[1] ?? '';
        const model = text(config.productName, macroValue('CONFIG_PRODUCT')).replaceAll('_', ' ');
        if (!/^RX27\s*PRO$/i.test(model.trim())) throw new RouterError('UNSUPPORTED', 'Este aplicativo foi preparado para o Tenda RX27 Pro.');
        const flags: Record<string, string> = {
          wifi24: 'CONFIG_WIFI_2_4G', wifi5: 'CONFIG_WIFI_5G', wifi6: 'CONFIG_WIFI_SUPPORT_6G', mesh: 'CONFIG_MESH_SUPPORT',
          ipv6: 'CONFIG_IPV6_SUPPORT', vpn: 'CONFIG_VPN', wps: 'CONFIG_WIFI_WPS', guest: 'CONFIG_WIFI_GUEST',
          ddns: 'CONFIG_ADVANCE_DDNS', upnp: 'CONFIG_ADVANCE_UPNP', tr069: 'CONFIG_CWMPD', firewall: 'CONFIG_SAFE_ATTACK',
        };
        this.state = { connected: true, demo: false, host, model, firmware: text(config.softVersion), hardware: text(config.hardVersion),
          mode: text(record(data.workMode).workMode, 'router'), capabilities: Object.keys(flags).filter(flag => macroValue(flags[flag]) === 'y') };
        if (epoch !== this.epoch) throw new RouterError('AUTH', 'A conexão foi cancelada.');
        this.attempts.delete(host);
        return this.getConnection();
      } catch (error) {
        if (epoch === this.epoch) this.clear();
        if (error instanceof RouterError && ['AUTH', 'LOCKED'].includes(error.code)) {
          const previous = this.attempts.get(host);
          const failures = (previous?.failures ?? 0) + 1;
          this.attempts.set(host, { failures, nextAllowed: Math.max(previous?.nextAllowed ?? 0, Date.now() + Math.min(60, 2 ** Math.min(failures, 6)) * 1000) });
        }
        if (error instanceof RouterError && error.code === 'ROUTER') throw new RouterError(error.code, `Falha ao ${stage}. ${error.message}`);
        throw error instanceof RouterError ? error : new RouterError('ROUTER', `Não foi possível ${stage}.`);
      }
    });
  }

  private async readRaw(modules: string[], params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    this.authenticated();
    const query = new URLSearchParams({ modules: modules.join(','), rand: String(Math.random()), ...params });
    const data = this.decode(await this.raw(this.path(`/goform/getModules?${query.toString()}`), 'GET'), true);
    if (modules.some(module => !Object.hasOwn(data, module === 'deviceListNotNeedRate' ? 'deviceList' : module))) {
      throw new RouterError('UNSUPPORTED', 'O roteador não retornou todos os recursos solicitados.');
    }
    return data;
  }

  readModules(modules: string[], params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (!Array.isArray(modules) || !modules.length || modules.length > 32 || modules.some(module => typeof module !== 'string' || !READ_MODULES.has(module)) || new Set(modules).size !== modules.length) {
      return Promise.reject(new RouterError('FORBIDDEN', 'Esta consulta não é permitida.'));
    }
    const basicCloud = isPlain(params) && modules.length === 1 && modules[0] === 'cloudManage' && params.action === 'basic';
    if (!isPlain(params) || Object.keys(params).some(key => !safeKeys.has(key) && !(basicCloud && key === 'action')) || Object.values(params).some(value => typeof value !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(value))) {
      return Promise.reject(new RouterError('FORBIDDEN', 'Os parâmetros da consulta não são permitidos.'));
    }
    const requested = [...modules], copied = { ...params };
    return this.enqueue(() => this.readRaw(requested, copied));
  }

  writeModules(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      if (!isPlain(payload) || !Object.keys(payload).length || Object.keys(payload).length > 16 || Object.keys(payload).some(key => !WRITE_MODULES.has(key))) throw new RouterError('FORBIDDEN', 'Esta operação não é permitida.');
      validateJSONTree(payload);
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new RouterError('VALIDATION', 'A operação excede o tamanho permitido.');
      const copied = JSON.parse(serialized) as Record<string, unknown>;
      return this.enqueue(async () => {
        this.authenticated();
        const encrypted = Buffer.from(JSON.stringify({ data: encryptPayload(copied, this.sign) }));
        const query = new URLSearchParams({ modules: Object.keys(copied).join(',') });
        return this.decode(await this.raw(this.path(`/goform/setModules?${query.toString()}`), 'POST', encrypted), true, true, [0, 100, 102]);
      });
    } catch (error) { return Promise.reject(error); }
  }

  async overview(): Promise<Overview> {
    const data = await this.readModules(['meshTopo', 'wanStatus', 'deviceListNotNeedRate', 'wifiBasicCfg', 'apModeStatus', 'workMode', 'systemCfg']);
    return normalizeOverview(data, this.getConnection());
  }
  async clients(): Promise<ClientDevice[]> {
    return normalizeClients(await this.readModules(['deviceList', 'macFilter', 'localhost']));
  }
  async mesh(): Promise<MeshNode[]> {
    return normalizeMesh(await this.readModules(['meshTopo', 'deviceListNotNeedRate', 'deviceVersionList']));
  }
  scanMesh(): Promise<Record<string, unknown>> {
    return this.enqueue(async () => {
      this.authenticated();
      const query = new URLSearchParams({ modules: 'scanNodeList', action: 'scan', rand: String(Math.random()) });
      return this.decode(await this.raw(this.path(`/goform/getModules?${query}`), 'GET', undefined, true, true), true);
    });
  }
  readScanResults(): Promise<Record<string, unknown>> {
    return this.enqueue(() => this.readRaw(['scanNodeList'], { action: 'scanResult' }));
  }
  downloadConfig(): Promise<Buffer> {
    return this.enqueue(async () => {
      const response = await this.raw('/cgi-bin/DownloadCfg/RouterCfm.cfg', 'GET', undefined, true, false, 8 * 1024 * 1024);
      if (/^\s*(?:<!doctype\s+html|<html)/i.test(response.body.subarray(0, 256).toString('utf8'))) {
        this.clear(); throw new RouterError('AUTH', 'Entre novamente antes de salvar o backup.');
      }
      if (!response.body.length) throw new RouterError('ROUTER', 'O roteador retornou um backup vazio.');
      return response.body;
    });
  }

  upload(kind: 'firmware' | 'configuration', bytes: Buffer, filename: string, fields: Record<string, string> = {}): Promise<Record<string, unknown>> {
    try {
      if (!['firmware', 'configuration'].includes(kind) || !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > (kind === 'firmware' ? 64 : 8) * 1024 * 1024) throw new RouterError('VALIDATION', 'O arquivo excede os limites permitidos.');
      const expected = kind === 'firmware' ? '.bin' : '.cfg';
      if (typeof filename !== 'string' || filename.length > 260 || !filename.toLowerCase().endsWith(expected)) throw new RouterError('VALIDATION', 'O tipo de arquivo não corresponde à operação.');
      if (kind === 'firmware' && (bytes.length < 20 || bytes.readUInt32BE(0) !== bytes.length - 4 || (bytes.length - 4) % 16 !== 0)) throw new RouterError('VALIDATION', 'O arquivo não corresponde ao formato observado do RX27 Pro.');
      if (!isPlain(fields) || Object.keys(fields).some(key => kind !== 'firmware' || key !== 'sn') || Object.values(fields).some(value => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new RouterError('VALIDATION', 'Os campos do envio são inválidos.');
      const contents = Buffer.from(bytes);
      const copiedFields = { ...fields };
      return this.enqueue(async () => {
        this.authenticated();
        const boundary = `----TendaDesktop${randomBytes(24).toString('hex')}`;
        const parts: Buffer[] = [];
        for (const [name, value] of Object.entries(copiedFields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${kind === 'firmware' ? 'firmware.bin' : 'router.cfg'}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
        parts.push(contents, Buffer.from(`\r\n--${boundary}--\r\n`));
        const response = await this.raw(kind === 'firmware' ? '/cgi-bin/upgrade' : '/cgi-bin/UploadCfg', 'POST', Buffer.concat(parts), true, true, 256 * 1024, `multipart/form-data; boundary=${boundary}`);
        const value = parseUploadResponse(response.body);
        if (value.error !== 0 && value.error !== '0') throw new RouterError('ROUTER', 'O roteador recusou o arquivo. A assinatura, o formato ou a compatibilidade podem ser inválidos.');
        return value;
      });
    } catch (error) { return Promise.reject(error); }
  }
}

/** CGI upload replies may be JSON or the panel's iframe postMessage carrier. Never execute it. */
export function parseUploadResponse(body: Buffer): Record<string, unknown> {
  const raw = body.toString('utf8').trim();
  let candidate = raw;
  const postMessage = raw.match(/^\s*(?:<!doctype html>\s*)?(?:<html>\s*(?:<head>\s*<\/head>\s*)?<body>\s*)?<script(?:\s+type=["']text\/javascript["'])?>\s*(?:window\.)?parent\.postMessage\(\s*(\{[^<>]{1,65536}\})\s*,\s*["']\*["']\s*\)\s*;?\s*<\/script>\s*(?:<\/body>\s*<\/html>)?\s*$/i);
  const bodyJSON = raw.match(/^\s*(?:<html>\s*)?<body>\s*(\{[^<>]{1,65536}\})\s*<\/body>\s*(?:<\/html>)?\s*$/i);
  if (postMessage) candidate = postMessage[1]; else if (bodyJSON) candidate = bodyJSON[1];
  try {
    const value = parseObject(Buffer.from(candidate));
    if (codeOf(value.error) === null) throw new Error('Missing CGI status');
    return value;
  } catch { throw new RouterError('UNCERTAIN', 'O envio terminou sem confirmação válida. Verifique o roteador antes de repetir.'); }
}
