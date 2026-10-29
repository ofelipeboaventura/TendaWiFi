import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ActionRequest, ApplyResult, AuditEntry, ChangePreview, ClientChange, ClientDevice, ConnectionStatus, DesktopAPI, FeatureSnapshot, MaintenanceStatus, Values } from '../shared/types';
import { RouterClient, normalizeOverview, normalizeClients, normalizeMesh } from './router';
import type { MonitorReading, ResourceReading } from '../shared/monitoring';
import { deduplicateClients } from './monitoring/metrics';
import { ResourceDiagnostics } from './monitoring/diagnostics';
import { DemoRouter } from './demo';
import { FeatureService } from './features';
import { AppError } from './errors';
import type { FileStore } from './files';
import { resolveRebootTarget, type RebootTarget } from './reboot-target';

export type ManagedRouter = Pick<RouterClient, 'getConnection' | 'connect' | 'disconnect' | 'readModules' | 'writeModules' | 'overview' | 'clients' | 'mesh' | 'scanMesh' | 'readScanResults' | 'downloadConfig' | 'upload'>;
const mac = z.string().regex(/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/).transform(v => v.toUpperCase());
const nodeId = z.string().min(1).max(128).refine(v => !/[\x00-\x1f\x7f]/.test(v));
const limit = z.number().int().min(0).max(128000).refine(v => v === 0 || v >= 64, 'Use 0 ou um limite entre 64 e 128000 KB/s.');
const deviceName = z.string().trim().min(1).max(32).refine(v => Buffer.byteLength(v, 'utf8') <= 32 && !/[\x00-\x1f\x7f]/.test(v), 'O nome deve ter até 32 bytes, sem caracteres de controle.');
export const clientChangeSchema = z.object({ mac, nodeId: z.string().max(128).refine(v => !/[\x00-\x1f\x7f]/.test(v)), name: deviceName.optional(), blocked: z.boolean().optional(), uploadLimit: limit.optional(), downloadLimit: limit.optional() }).strict().refine(v => [v.name, v.blocked, v.uploadLimit, v.downloadLimit].some(x => x !== undefined), 'Escolha uma alteração.');
const target = { nodeId: nodeId.optional() };
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reboot'), ...target }).strict(),
  z.object({ action: z.literal('reset'), ...target }).strict(),
  z.object({ action: z.literal('meshOptimize') }).strict(),
  z.object({ action: z.literal('meshScan') }).strict(),
  z.object({ action: z.literal('meshAdd'), nodeSerial: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }).strict(),
  z.object({ action: z.literal('checkFirmware'), ...target }).strict(),
  z.object({ action: z.literal('upgradeOnline'), ...target }).strict(),
  z.object({ action: z.literal('restore'), fileId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('firmware'), fileId: z.string().uuid(), ...target }).strict(),
  z.object({ action: z.literal('changePassword'), oldPassword: z.string().min(1).max(63), newPassword: z.string().min(8).max(32), confirmPassword: z.string().min(8).max(32) }).strict(),
  z.object({ action: z.literal('clearLogs') }).strict(),
]);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clientIdentity = (client: ClientDevice) => ({ mac: client.mac, nodeId: client.nodeId, name: client.name, blocked: client.blocked, local: client.local, uploadLimit: client.uploadLimit, downloadLimit: client.downloadLimit });
interface Pending { preview: ChangePreview; session: number; action?: ActionRequest; client?: ClientChange; revision?: string; filterRevision?: string; rebootTarget?: RebootTarget }
const ACTION_TITLES: Record<ActionRequest['action'], string> = { reboot: 'Reiniciar roteador', reset: 'Restaurar configurações de fábrica', meshOptimize: 'Otimizar rede Mesh', meshScan: 'Procurar novos nós', meshAdd: 'Adicionar nó Mesh', checkFirmware: 'Verificar atualização', upgradeOnline: 'Atualizar firmware online', restore: 'Restaurar backup', firmware: 'Instalar firmware local', changePassword: 'Alterar senha de administração', clearLogs: 'Limpar registros' };

export class AppService {
  private diagnostics: ResourceDiagnostics;
  private telemetryRaw: Record<string, unknown> = {};
  private telemetryResources: ResourceReading[] = [];
  private telemetryMetadataAt = 0; private radios:import('../shared/monitoring').RadioReading[]=[];
  private demoEpoch = Date.now();
  private router: ManagedRouter;
  private featuresService: FeatureService;
  private session = 0;
  private scannedAt = 0;
  private uncertain = false;
  private pending = new Map<string, Pending>();
  private entries: AuditEntry[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  private logins = new Map<string, number[]>();
  constructor(private files: FileStore, private makeRouter: () => ManagedRouter = () => new RouterClient(), initialRouter?: ManagedRouter) {
    this.router = initialRouter ?? makeRouter(); this.featuresService = new FeatureService(this.router);
    this.diagnostics = new ResourceDiagnostics({ read: () => this.readCurrent(async router => (await router.readModules(['syschkInfo'])).syschkInfo), write: action => this.readCurrent(async router => { this.requireWritable(); await router.writeModules({ syschkInfo: { operation_name: 'check', operation_action: action } }); }) });
  }
  setResourceDiagnostics(enabled: boolean) { return this.exclusive(async () => {
    const primary = this.connection().demo ? { id: 'DEMO-RX27', online: true } : normalizeMesh(this.telemetryRaw).find(n => n.primary);
    if (enabled) {
      try { this.requireWritable(); if (!primary?.online) throw new AppError('UNSUPPORTED', 'Roteador principal indisponível.'); }
      catch { this.diagnostics.unavailable(); return; }
    }
    await this.diagnostics.configure(enabled, primary?.id ?? '');
  }); }
  suspendResourceDiagnostics() { this.diagnostics.invalidate(); }
  private audit(action: string, outcome: string) { this.entries.push({ time: new Date().toISOString(), action, outcome }); if (this.entries.length > 500) this.entries.shift(); }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const next = this.serial.then(fn, fn); this.serial = next.then(() => undefined, () => undefined); return next; }
  private invalidate() { this.diagnostics.invalidate(true); this.session++; this.telemetryRaw = {}; this.radios=[]; this.telemetryResources = []; this.telemetryMetadataAt = 0; this.demoEpoch = Date.now(); this.scannedAt = 0; this.uncertain = false; this.pending.clear(); this.files.clear(); this.featuresService.clear(); this.featuresService = new FeatureService(this.router); }
  private requireConnection() { if (!this.router.getConnection().connected) throw new AppError('AUTH', 'Conecte-se ao roteador para continuar.'); }
  private requireWritable() { this.requireConnection(); if (this.uncertain) throw new AppError('UNCERTAIN', 'Uma operação anterior ainda precisa ser verificada. Atualize a visão geral ou entre novamente antes de revisar outra alteração.'); const s = this.router.getConnection(); if (!s.demo && (!/RX27[_\s-]*PRO/i.test(s.model) || !/^V?16\.03\.28\.20(?:_|\(|$)/i.test(s.firmware))) throw new AppError('UNSUPPORTED', 'Esta versão do equipamento ainda não foi validada para alterações. As consultas permanecem disponíveis.'); }
  connection() { return this.router.getConnection(); }
  connect(input: { host: string; password: string }) { return this.exclusive(async () => {
    const now = Date.now(); const attempts = (this.logins.get(input.host) ?? []).filter(t => now - t < 60_000);
    if (attempts.length >= 4) throw new AppError('LOCKED', 'Aguarde um minuto antes de tentar entrar novamente.');
    attempts.push(now); this.logins.set(input.host, attempts); if (this.logins.size > 32) this.logins.delete(this.logins.keys().next().value!);
    this.invalidate(); await this.router.disconnect(); this.router = this.makeRouter(); this.featuresService = new FeatureService(this.router);
    try { const status = await this.router.connect(input.host, input.password); this.audit('Conexão', 'Autenticada'); return status; } catch (error) { this.audit('Conexão', 'Não concluída'); throw error; }
  }); }
  demo() { return this.exclusive(async () => { this.invalidate(); await this.router.disconnect(); this.router = new DemoRouter(); this.featuresService = new FeatureService(this.router); this.audit('Demonstração', 'Iniciada'); return this.connection(); }); }
  disconnect() { return this.exclusive(async () => { this.invalidate(); await this.router.disconnect(); this.audit('Sessão', 'Encerrada'); }); }
  async overview() { const result = await this.readCurrent(router => router.overview()); this.uncertain = false; return result; }
  private async readCurrent<T>(reader: (router: ManagedRouter) => Promise<T>): Promise<T> { this.requireConnection(); const session = this.session, router = this.router; const result = await reader(router); if (this.session !== session || this.router !== router) throw new AppError('AUTH', 'A sessão mudou durante a consulta. Entre novamente.'); return result; }
  async clients() { return this.readCurrent(router => router.clients()); }
  async mesh() { return this.readCurrent(router => router.mesh()); }
  async readMonitoring(topology: boolean, resources: boolean, radio = false): Promise<MonitorReading> {
    const telemetrySession = this.session;
    return this.readCurrent(async router => {
      const connection = router.getConnection();
      if (connection.demo) {
        const overview = await router.overview(), clients = deduplicateClients(await router.clients()), nodes = await router.mesh(), at = Date.now(), seconds = Math.floor((at - this.demoEpoch) / 1000);
        return { overview, clients, nodes, routerId: 'demo', radios: (['2.4 GHz','5 GHz','6 GHz'] as const).map((band,i)=>({band,sampledAt:at,configuredChannel:'auto',currentChannel:String([6,36,37][i]),configuredBandwidth:'auto',currentBandwidth:String([20,80,160][i])})),resources: this.diagnostics.reading(), diagnostic: this.diagnostics.snapshot(), resourceSample: this.diagnostics.latestSample(), counters: [{ id: 'wan', scope: 'internet', epoch: String(this.demoEpoch), upload: (BigInt(seconds) * 1200000n).toString(), download: (BigInt(seconds) * 9000000n).toString() }, ...clients.filter(d => d.online).map((d, i) => ({ id: d.mac, scope: 'device' as const, epoch: String(this.demoEpoch), upload: (BigInt(seconds) * BigInt((i + 1) * 2000)).toString(), download: (BigInt(seconds) * BigInt((i + 1) * 30000)).toString() }))] };
      }
      const metadata = topology || !this.telemetryMetadataAt;
      const data = await router.readModules(['wanStatus', 'deviceList', 'systemCfg', ...(radio ? ['wifiAdvCfg'] : []), ...(metadata ? ['meshTopo', 'wifiBasicCfg', 'apModeStatus', 'workMode', 'localhost', 'macFilter', 'deviceVersionList'] : [])]);
      if (telemetrySession !== this.session) throw new AppError('AUTH', 'A sessão mudou durante a coleta.');
      const rateInput = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)]).refine(v => Number(v) * 1024 <= 1e12);
      const wan = object(data.wanStatus); if (!rateInput.safeParse(wan.wanUpSpeed).success || !rateInput.safeParse(wan.wanDownSpeed).success) throw new AppError('ROUTER', 'O roteador retornou velocidades inválidas.');
      for (const node of Array.isArray(data.deviceList) ? data.deviceList : []) for (const key of ['onlineList', 'guestList']) for (const device of Array.isArray(object(node)[key]) ? object(node)[key] as unknown[] : []) { const row = object(device); if (!rateInput.safeParse(row.upSpeed).success || !rateInput.safeParse(row.downSpeed).success) throw new AppError('ROUTER', 'O roteador retornou velocidades de dispositivo inválidas.'); }
      const raw = { ...this.telemetryRaw, ...data }; const overview = normalizeOverview(raw, connection), clients = deduplicateClients(normalizeClients(raw));
      const validRate = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1e12;
      if (![overview.upload, overview.download, ...clients.flatMap(d => [d.upload, d.download])].every(validRate)) throw new AppError('ROUTER', 'O roteador retornou velocidades inválidas.');
      if (resources && !['running', 'uncertain'].includes(this.diagnostics.snapshot().status)) {
        try {
          const diagnostic = await router.readModules(['syschkInfo']);
          if (telemetrySession !== this.session) throw new AppError('AUTH', 'A sessão mudou durante a coleta.');
          this.diagnostics.passive(diagnostic.syschkInfo, overview.nodes.find(n => n.primary)?.id ?? '');
        } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'AUTH') throw error; }
      }
      if(radio){const advanced=object(data.wifiAdvCfg),field=(key:string)=>{const value=advanced[key];return typeof value==='string'&&/^[A-Za-z0-9+./_-]{1,16}$/.test(value)?value:null;};this.radios=([['2.4 GHz',''],['5 GHz','_5g'],['6 GHz','_6g']]as const).map(([band,suffix])=>({band,sampledAt:Date.now(),configuredChannel:field('wifiChannel'+suffix),currentChannel:field('wifiChannelCurrent'+suffix),configuredBandwidth:field('wifiBandwidth'+suffix),currentBandwidth:field('wifiBandwidthCurrent'+suffix)}));}
      this.telemetryResources = this.diagnostics.reading();
      this.telemetryRaw = raw; if (metadata) this.telemetryMetadataAt = Date.now();
      return { overview, clients, nodes: overview.nodes, radios:this.radios, resources: this.telemetryResources, diagnostic: this.diagnostics.snapshot(), resourceSample: this.diagnostics.latestSample(), counters: [], routerId: hash({ primary: overview.nodes.find(n => n.primary)?.id ?? connection.host, model: connection.model, hardware: connection.hardware }) };
    });
  }
  definitions() { this.requireConnection(); return this.featuresService.definitions(); }
  readFeature(input: { id: string }): Promise<FeatureSnapshot> { return this.readCurrent(() => this.featuresService.read(input.id)); }
  prepareChange(input: { id: string; values: Values; revision: string }) { this.requireWritable(); return this.readCurrent(() => this.featuresService.prepare(input)); }
  private addPending(session: number, router: ManagedRouter, title: string, summary: string[], risk: ChangePreview['risk'], details: Omit<Pending, 'preview' | 'session'>, warning?: string): ChangePreview {
    if (this.session !== session || this.router !== router) throw new AppError('AUTH', 'A sessão mudou durante a revisão. Prepare a alteração novamente.');
    for (const [id, item] of this.pending) if (Date.parse(item.preview.expiresAt) < Date.now()) this.pending.delete(id);
    if (this.pending.size >= 20) throw new AppError('LOCKED', 'Há muitas alterações aguardando confirmação. Cancele as anteriores.');
    const preview: ChangePreview = { id: `operation:${randomUUID()}`, title, summary, risk, expiresAt: new Date(Date.now() + 120_000).toISOString(), warning };
    this.pending.set(preview.id, { ...details, preview, session: this.session }); return structuredClone(preview);
  }
  async prepareClientChange(input: ClientChange): Promise<ChangePreview> {
    this.requireWritable(); const session = this.session, router = this.router; const change = clientChangeSchema.parse(input); const clients = await router.clients(); const current = clients.find(c => c.mac.toUpperCase() === change.mac && c.nodeId === change.nodeId);
    if (!current) throw new AppError('FORBIDDEN', 'O dispositivo não pertence ao nó selecionado ou não está mais disponível.');
    if (current.local && (change.blocked === true || (change.uploadLimit ?? 0) > 0 || (change.downloadLimit ?? 0) > 0)) throw new AppError('FORBIDDEN', 'O computador que administra a rede não pode ser bloqueado ou limitado por esta tela.');
    const accessData = await router.readModules(['macFilter', 'localhost']);
    const filter = accessData.macFilter;
    if (change.blocked === true || (change.uploadLimit ?? 0) > 0 || (change.downloadLimit ?? 0) > 0) {
      const localMac = object(accessData.localhost).mac;
      if (typeof localMac !== 'string' || !mac.safeParse(localMac).success || localMac.toUpperCase() === change.mac) throw new AppError('FORBIDDEN', 'Não é possível aplicar bloqueios sem identificar com segurança o computador administrador.');
    }
    if (change.blocked !== undefined && object(filter).curFilterMode !== 'deny' && object(filter).macFilterEn === true) throw new AppError('UNSUPPORTED', 'A rede está em modo de lista de permissão. Edite a política completa em Filtro MAC.');
    const summary = [`Dispositivo: ${current.name}`, ...(change.name !== undefined ? [`Nome: ${change.name}`] : []), ...(change.blocked !== undefined ? [`Acesso à rede: ${change.blocked ? 'bloquear' : 'permitir'}`] : []), ...(change.uploadLimit !== undefined ? [`Upload: ${change.uploadLimit || 'sem limite'}${change.uploadLimit ? ' KB/s' : ''}`] : []), ...(change.downloadLimit !== undefined ? [`Download: ${change.downloadLimit || 'sem limite'}${change.downloadLimit ? ' KB/s' : ''}`] : [])];
    return this.addPending(session, router, 'Alterar dispositivo', summary, change.blocked ? 'security' : 'normal', { client: change, revision: hash(clientIdentity(current)), filterRevision: hash(filter) });
  }
  async prepareAction(input: ActionRequest): Promise<ChangePreview> {
    this.requireWritable(); const session = this.session, router = this.router; const action = actionSchema.parse(input) as ActionRequest;
    if (action.action === 'clearLogs') throw new AppError('UNSUPPORTED', 'O painel deste firmware permite consultar e exportar registros, mas não documenta uma operação de limpeza.');
    if (action.action === 'changePassword' && (action.newPassword !== action.confirmPassword || action.oldPassword === action.newPassword)) throw new AppError('VALIDATION', 'Confirme uma nova senha diferente da senha atual.');
    const nodes = await router.mesh(); const targetId = 'nodeId' in action ? action.nodeId : undefined; const chosen = targetId ? nodes.find(n => n.id === targetId) : nodes.find(n => n.primary);
    if (targetId && !chosen) throw new AppError('FORBIDDEN', 'O nó selecionado não pertence à rede autenticada.');
    if (['reboot', 'reset', 'firmware'].includes(action.action) && (!chosen || !chosen.online)) throw new AppError('FORBIDDEN', 'Selecione um roteador online desta rede.');
    if (action.action === 'firmware' && !chosen?.primary) throw new AppError('UNSUPPORTED', 'O arquivo local verificado é exclusivo do RX27 Pro principal. Para os outros nós, utilize a atualização online.');
    if (action.action === 'upgradeOnline') await this.requireAvailableUpgrade(action.nodeId, router);
    const rebootTarget = action.action === 'reboot' ? await resolveRebootTarget(router, chosen!) : undefined;
    const summary: string[] = [!targetId && ['checkFirmware', 'upgradeOnline'].includes(action.action) ? 'Destino: todos os nós da rede' : chosen && ['reboot', 'reset', 'firmware', 'checkFirmware', 'upgradeOnline'].includes(action.action) ? `Destino: ${chosen.name}` : 'Destino: rede atual'];
    if ('nodeSerial' in action) summary.push(`Número de série: ${action.nodeSerial}`);
    if (rebootTarget) summary.push(`Identificação do nó: ${rebootTarget.id}`, `Papel: ${rebootTarget.primary ? 'Roteador principal' : 'Satélite Mesh'}`, ...(rebootTarget.mac ? [`MAC: ${rebootTarget.mac}`] : []), ...(rebootTarget.ip ? [`IP informado: ${rebootTarget.ip}`] : []));
    if ('fileId' in action) { const file = this.files.get(action.fileId); const expected = action.action === 'firmware' ? 'firmware' : 'configuration'; if (file.info.kind !== expected) throw new AppError('VALIDATION', 'O tipo do arquivo não corresponde à operação.'); summary.push(`Arquivo: ${file.info.name}`, `Tamanho: ${file.info.size.toLocaleString('pt-BR')} bytes`, `SHA-256: ${file.info.sha256}`); }
    if (action.action === 'changePassword') summary.push('A senha será substituída e será necessário entrar novamente.');
    const destructive = ['reset', 'restore'].includes(action.action); const disconnect = ['reboot', 'firmware', 'upgradeOnline', 'meshOptimize'].includes(action.action);
    const warning = rebootTarget ? rebootTarget.primary ? 'Reiniciar o roteador principal pode interromper temporariamente toda a rede. As configurações serão preservadas.' : 'Somente este nó receberá o comando. Seus clientes e os nós que dependem desse caminho podem perder conexão temporariamente. As configurações serão preservadas.' : destructive ? 'As configurações atuais serão substituídas. A conexão poderá ser perdida. Faça um backup antes de continuar.' : disconnect ? 'A rede poderá ficar indisponível durante a operação. Não desligue os roteadores durante atualizações.' : action.action === 'meshAdd' ? 'O novo nó passará a integrar sua rede. Confira o número de série do equipamento.' : undefined;
    return this.addPending(session, router, ACTION_TITLES[action.action], summary, destructive ? 'destructive' : disconnect ? 'disconnect' : action.action === 'changePassword' || action.action === 'meshAdd' ? 'security' : 'normal', { action: rebootTarget ? { action: 'reboot', nodeId: rebootTarget.id } : action, ...(rebootTarget ? { rebootTarget } : {}) }, warning);
  }
  applyChange(input: { id: string }): Promise<ApplyResult> { return this.exclusive(async () => {
    this.requireWritable();
    if (input.id.startsWith('feature:')) this.featuresService.assertPending(input.id);
    else { const pending = this.pending.get(input.id); if (!pending || pending.session !== this.session || Date.parse(pending.preview.expiresAt) < Date.now()) throw new AppError('CONFLICT', 'A revisao expirou ou ja foi usada.'); }
    const releaseDiagnostic = await this.diagnostics.maintenance();
    const actionName = input.id.startsWith('feature:') ? 'Configuração' : 'Manutenção';
    try {
      if (input.id.startsWith('feature:')) { const result = await this.featuresService.apply(input.id); this.audit(actionName, 'Aplicada'); if (result.reconnect) { await this.router.disconnect(); this.invalidate(); } return result; }
      const pending = this.pending.get(input.id); this.pending.delete(input.id);
      if (!pending || pending.session !== this.session || Date.parse(pending.preview.expiresAt) < Date.now()) throw new AppError('CONFLICT', 'A confirmação expirou ou já foi usada. Revise a alteração novamente.');
      let result: ApplyResult;
      if (pending.client) result = await this.applyClient(pending);
      else result = await this.applyAction(pending.action!, pending.rebootTarget);
      this.audit(pending.preview.title, 'Solicitação aceita');
      if (result.reconnect) { await this.router.disconnect(); this.invalidate(); }
      return result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'UNCERTAIN') { this.uncertain = true; this.pending.clear(); }
      this.audit(actionName, error && typeof error === 'object' && 'code' in error && error.code === 'UNCERTAIN' ? 'Resultado pendente de verificação; não repetir automaticamente' : 'Não concluída');
      throw error;
    } finally { releaseDiagnostic(); }
  }); }
  private async applyClient(pending: Pending): Promise<ApplyResult> {
    const change = pending.client!; const current = (await this.router.clients()).find(c => c.mac.toUpperCase() === change.mac && c.nodeId === change.nodeId);
    if (current?.local && (change.blocked === true || (change.uploadLimit ?? 0) > 0 || (change.downloadLimit ?? 0) > 0)) throw new AppError('FORBIDDEN', 'O computador administrador não pode ser bloqueado ou limitado.');
    if (!current || hash(clientIdentity(current)) !== pending.revision) throw new AppError('CONFLICT', 'O dispositivo mudou desde a revisão. Recarregue os dados.');
    const accessData = await this.router.readModules(['macFilter', 'localhost']); const filter = object(accessData.macFilter);
    if (change.blocked === true || (change.uploadLimit ?? 0) > 0 || (change.downloadLimit ?? 0) > 0) {
      const local = object(accessData.localhost).mac;
      if (current.local || typeof local !== 'string' || !mac.safeParse(local).success || local.toUpperCase() === change.mac) throw new AppError('FORBIDDEN', 'O computador administrador não pode ser bloqueado ou limitado.');
    }
    if (hash(filter) !== pending.filterRevision) throw new AppError('CONFLICT', 'A política de acesso mudou. Revise a alteração novamente.');
    const payload: Record<string, unknown> = {};
    if (change.name !== undefined || change.uploadLimit !== undefined || change.downloadLimit !== undefined) {
      const up = change.uploadLimit ?? current.uploadLimit; const down = change.downloadLimit ?? current.downloadLimit;
      payload.setDeviceInfo = { mac: change.mac, hostname: change.name ?? current.name, upLimit: String(up), downLimit: String(down), controlEn: up > 0 || down > 0 };
    }
    if (change.blocked !== undefined) {
      if (filter.macFilterEn && filter.curFilterMode !== 'deny') throw new AppError('UNSUPPORTED', 'Edite a lista de permissão completa em Filtro MAC.');
      const blackList = z.array(z.object({ mac, hostname: z.string().max(128) }).passthrough()).max(64).parse(filter.blackList ?? []).map(v => ({ mac: v.mac, hostname: v.hostname }));
      const list = blackList.filter(v => v.mac !== change.mac);
      if (change.blocked) list.push({ mac: change.mac, hostname: change.name ?? current.name });
      if (list.length > 64) throw new AppError('VALIDATION', 'A lista de bloqueio já atingiu o limite de 64 dispositivos.');
      payload.macFilter = { macFilterEn: change.blocked ? true : filter.macFilterEn === true, curFilterMode: 'deny', blackList: list };
    }
    await this.router.writeModules(payload);
    let after: ClientDevice | undefined;
    try { after = (await this.router.clients()).find(c => c.mac.toUpperCase() === change.mac); } catch { throw new AppError('UNCERTAIN', 'A alteração foi enviada, mas a consulta de confirmação falhou. Atualize a rede antes de repetir.'); }
    if (!after || (change.name !== undefined && after.name !== change.name) || (change.blocked !== undefined && after.blocked !== change.blocked) || (change.uploadLimit !== undefined && after.uploadLimit !== change.uploadLimit) || (change.downloadLimit !== undefined && after.downloadLimit !== change.downloadLimit)) throw new AppError('UNCERTAIN', 'O roteador recebeu a solicitação, mas o estado final ainda não foi confirmado. Atualize a lista antes de repetir.');
    return { message: 'Dispositivo atualizado e estado confirmado.', reconnect: false };
  }
  private async applyAction(action: ActionRequest, reviewedReboot?: RebootTarget): Promise<ApplyResult> {
    const nodes = await this.router.mesh(); const targetId = 'nodeId' in action ? action.nodeId : undefined; const node = targetId ? nodes.find(n => n.id === targetId) : nodes.find(n => n.primary);
    if (targetId && !node) throw new AppError('FORBIDDEN', 'O nó não pertence mais à rede atual.');
    if (['reboot', 'reset', 'firmware'].includes(action.action) && !node?.online) throw new AppError('CONFLICT', 'O nó não está mais online. Revise a operação.');
    switch (action.action) {
      case 'reboot': {
        if (!reviewedReboot || action.nodeId !== reviewedReboot.id) throw new AppError('CONFLICT', 'O destino da revisão não está mais disponível. Revise a reinicialização novamente.');
        const current = await resolveRebootTarget(this.router, node!);
        if (hash(current) !== hash(reviewedReboot)) throw new AppError('CONFLICT', 'A identificação ou o papel do nó mudou. Revise a reinicialização novamente.');
        await this.router.writeModules({ systemReboot: current.primary ? { action: 'reboot' } : { action: 'reboot', sn: current.id, ip: current.ip!, mac: current.mac! } });
        return { message: `Reinicialização solicitada ao nó ${node!.name}. Aguarde o equipamento voltar à rede.`, reconnect: current.primary };
      }
      case 'reset': await this.router.writeModules({ systemReset: node!.primary ? { action: 'reset' } : { action: 'reset', sn: node!.id } }); return { message: 'Restauração de fábrica solicitada. O equipamento precisará ser reconfigurado.', reconnect: node!.primary };
      case 'meshOptimize': await this.router.writeModules({ meshOptimize: { action: 'optimize' } }); return { message: 'Otimização Mesh iniciada. As conexões podem oscilar.', reconnect: false };
      case 'meshScan': await this.router.scanMesh(); this.scannedAt = Date.now(); return { message: 'Busca de nós iniciada. Aguarde cerca de 15 segundos; os resultados aparecerão na manutenção.', reconnect: false };
      case 'meshAdd': await this.router.writeModules({ addNode: action.nodeSerial! }); return { message: 'Solicitação de inclusão enviada. Acompanhe a topologia para confirmar a entrada do nó.', reconnect: false };
      case 'checkFirmware': await this.router.writeModules({ deviceVersionList: { action: 'queryversion', ...(action.nodeId ? { sn: action.nodeId } : {}) } }); return { message: 'Verificação solicitada ao roteador. Consulte novamente em alguns segundos.', reconnect: false };
      case 'upgradeOnline': await this.requireAvailableUpgrade(action.nodeId); await this.router.writeModules({ deviceVersionList: { action: 'queryupgrade', ...(action.nodeId ? { sn: action.nodeId } : {}) } }); return { message: 'Atualização solicitada ao roteador. Não interrompa a alimentação; entre novamente após a conclusão.', reconnect: !action.nodeId || Boolean(node?.primary) };
      case 'changePassword': await this.router.writeModules({ systemPwd: { oldPassword: createHash('md5').update(action.oldPassword!).digest('hex').toUpperCase(), newPassword: createHash('md5').update(action.newPassword!).digest('hex').toUpperCase() } }); return { message: 'Senha de administração alterada. Entre com a nova senha.', reconnect: true };
      case 'firmware': {
        if (!node!.primary) throw new AppError('FORBIDDEN', 'O arquivo local é exclusivo do roteador principal.');
        const file = this.files.take(action.fileId!);
        try { if (file.info.kind !== 'firmware') throw new AppError('VALIDATION', 'Selecione um arquivo de firmware.'); await this.router.writeModules({ agentLocalUpgrade: { sn: node!.id } }); await this.router.upload('firmware', file.bytes, 'firmware.bin', { sn: node!.id }); }
        finally { file.bytes.fill(0); }
        return { message: 'Firmware enviado. Aguarde a atualização sem desligar o roteador.', reconnect: true };
      }
      case 'restore': { const file = this.files.take(action.fileId!); try { if (file.info.kind !== 'configuration') throw new AppError('VALIDATION', 'Selecione um arquivo de configuração.'); await this.router.upload('configuration', file.bytes, 'configuration.cfg'); } finally { file.bytes.fill(0); } return { message: 'Backup enviado para restauração. O IP e a senha poderão mudar; entre novamente após o reinício.', reconnect: true }; }
      default: throw new AppError('UNSUPPORTED', 'Operação não disponível neste firmware.');
    }
  }
  private async requireAvailableUpgrade(id?: string, router: ManagedRouter = this.router) {
    const data = await router.readModules(['deviceVersionList']); const rows = Array.isArray(data.deviceVersionList) ? data.deviceVersionList.map(object).filter(r => !id || r.sn === id) : [];
    if (!rows.some(r => object(r.versionInfo).hasNewSoftVersion === true && r.nodeStatus === 'normal')) throw new AppError('UNSUPPORTED', 'Não há atualização disponível confirmada para o destino. Verifique as versões antes de continuar.');
  }
  async maintenanceStatus(): Promise<MaintenanceStatus> {
    this.requireConnection(); const data = this.telemetryMetadataAt && Date.now() - this.telemetryMetadataAt < 10000 ? this.telemetryRaw : await this.router.readModules(['deviceVersionList']); const rows = Array.isArray(data.deviceVersionList) ? data.deviceVersionList.slice(0, 64) : [];
    const str = (v: unknown) => typeof v === 'string' ? v.slice(0, 256) : '';
    const firmware = rows.map(row => { const r = object(row); const v = object(r.versionInfo); return { nodeId: str(r.sn), name: str(r.nodeName), current: str(v.curSoftVersion) || str(r.softVersion) || this.connection().firmware, latest: str(v.newSoftVersion), available: v.hasNewSoftVersion === true, status: str(r.nodeStatus) }; });
    let discovered: MaintenanceStatus['discovered'] = [];
    if (this.scannedAt && Date.now() - this.scannedAt >= 15_000 && Date.now() - this.scannedAt < 5 * 60_000) { const result = await this.router.readScanResults(); const list = Array.isArray(result.scanNodeList) ? result.scanNodeList.slice(0, 64) : []; discovered = list.map(row => { const r = object(row); return { serial: str(r.sn), name: str(r.nodeName) || str(r.productName) || 'Novo nó' }; }).filter(r => /^[A-Za-z0-9-]{8,64}$/.test(r.serial)); }
    return { firmware, discovered };
  }
  cancelChange(input: { id: string }) { if (input.id.startsWith('feature:')) this.featuresService.cancel(input.id); else this.pending.delete(input.id); }
  async selectFile(input: { kind: 'firmware' | 'configuration' }) { this.requireWritable(); const session = this.session; const file = await this.files.select(input.kind); if (this.session !== session) { this.files.clear(); throw new AppError('AUTH', 'A sessão mudou durante a seleção do arquivo.'); } return file; }
  async backup() { this.requireConnection(); const data = await this.router.downloadConfig(); try { const saved = await this.files.saveBackup(data); if (saved) this.audit('Backup', 'Salvo pelo usuário'); return { saved }; } finally { data.fill(0); } }
  async logs() {
    this.requireConnection(); const data = await this.router.readModules(['systemLog']); const rows = object(data.systemLog).systemLogList;
    const router = (Array.isArray(rows) ? rows.slice(-500).map(row => { const r = object(row); const line = [r.time, r.type, r.log].filter(v => typeof v === 'string' || typeof v === 'number').join(' · '); return /\b(?:password|passwd|pwd|token|stok|authorization|cookie|secret|senha|bearer)\b|\bsign["']?\s*[:=]|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i.test(line) ? '[Evento com possível conteúdo sensível omitido]' : line; }).join('\n') : '').slice(0, 256_000);
    return { router, audit: structuredClone(this.entries) };
  }
  async shutdown() { this.invalidate(); await this.router.disconnect(); }
}
