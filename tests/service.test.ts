import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppService, actionSchema, clientChangeSchema } from '../src/main/service';
import { DemoRouter } from '../src/main/demo';
import { AppError } from '../src/main/errors';
import type { FileStore } from '../src/main/files';
import type { ClientDevice, ConnectionStatus, MeshNode, SelectedFile, Values } from '../src/shared/types';

class MemoryFiles implements FileStore {
  records = new Map<string, { info: SelectedFile; bytes: Buffer }>();
  clearCount = 0;
  selected: SelectedFile | null = null;
  async select(_kind: SelectedFile['kind']): Promise<SelectedFile | null> { return this.selected; }
  add(kind: SelectedFile['kind']) {
    const bytes = Buffer.alloc(36, 7); if (kind === 'firmware') bytes.writeUInt32BE(32, 0);
    const info: SelectedFile = { id: randomUUID(), name: kind === 'firmware' ? 'approved.bin' : 'backup.cfg', kind, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const value = { info, bytes }; this.records.set(info.id, value); return value;
  }
  get(id: string) { const file = this.records.get(id); if (!file) throw new AppError('CONFLICT', 'Synthetic expired file'); return file; }
  take(id: string) { const file = this.get(id); this.records.delete(id); return file; }
  clear() { this.clearCount++; for (const file of this.records.values()) file.bytes.fill(0); this.records.clear(); }
  async saveBackup(_bytes: Buffer) { return true; }
}

class TestRouter extends DemoRouter {
  clientsView?: ClientDevice[];
  nodesView?: MeshNode[];
  overrides: Record<string, unknown> = {};
  status: Partial<ConnectionStatus> = {};
  writeError?: Error;
  overviewError?: Error;
  failVerification = false;
  writeCalls: Record<string, unknown>[] = [];
  uploads: { kind: string; bytes: Buffer; filename: string; fields?: Record<string, string> }[] = [];
  scanCalls = 0;
  getConnection() { return { ...super.getConnection(), ...this.status }; }
  async clients() {
    if (this.failVerification && this.writeCalls.length) throw new AppError('OFFLINE', 'Synthetic post-write read failure');
    return this.clientsView ? structuredClone(this.clientsView) : super.clients();
  }
  async mesh() { return this.nodesView ? structuredClone(this.nodesView) : super.mesh(); }
  async readModules(modules: string[], params?: Record<string, string>) { return { ...await super.readModules(modules, params), ...structuredClone(this.overrides) }; }
  async writeModules(payload: Record<string, unknown>) {
    this.writeCalls.push(structuredClone(payload));
    if (this.writeError) throw this.writeError;
    return super.writeModules(payload);
  }
  async externalChange(payload: Record<string, unknown>) { return super.writeModules(payload); }
  async overview() { if (this.overviewError) throw this.overviewError; return super.overview(); }
  async scanMesh() { this.scanCalls++; return super.scanMesh(); }
  async upload(kind: 'firmware' | 'configuration', bytes: Buffer, filename: string, fields?: Record<string, string>) { this.uploads.push({ kind, bytes: Buffer.from(bytes), filename, fields: fields ? { ...fields } : undefined }); return super.upload(kind, bytes, filename, fields); }
}

function setup() { const files = new MemoryFiles(), router = new TestRouter(); return { files, router, service: new AppService(files, () => new TestRouter(), router) }; }
const editable = async (router: TestRouter) => (await router.clients()).find(client => !client.local && !client.blocked)!;
const deferred = <T>() => { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function featurePreview(service: AppService, id: string, changes: Values) { const snapshot = await service.readFeature({ id }); return service.prepareChange({ id, revision: snapshot.revision, values: { ...snapshot.values, ...changes } }); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('trusted service input and ownership boundaries', () => {
  it('rejects unknown client fields, invalid limits and overlong UTF-8 names', () => {
    const base = { mac: '02:00:00:00:00:01', nodeId: 'node' };
    for (const input of [{ ...base, name: 'Client', command: 'execute' }, { ...base, uploadLimit: 1 }, { ...base, downloadLimit: 63 }, { ...base, uploadLimit: 128001 }, { ...base, name: 'á'.repeat(17) }, { ...base, blocked: 'true' }, base]) expect(clientChangeSchema.safeParse(input).success).toBe(false);
    expect(clientChangeSchema.parse({ ...base, name: 'Notebook', uploadLimit: 64 })).toMatchObject({ name: 'Notebook', uploadLimit: 64 });
  });
  it('rejects forged HTTP destinations and irrelevant fields in maintenance actions', () => {
    for (const input of [{ action: 'reboot', ip: '8.8.8.8' }, { action: 'reset', force: true }, { action: 'meshScan', url: '/goform/arbitrary' }, { action: 'firmware', fileId: randomUUID(), filename: '../../unknown.bin' }, { action: 'meshAdd', nodeSerial: 'x;reboot' }]) expect(actionSchema.safeParse(input).success).toBe(false);
  });
  it('requires matching client MAC and node ownership', async () => {
    const { router, service } = setup(); const client = await editable(router);
    await expect(service.prepareClientChange({ mac: client.mac, nodeId: 'FORGED-NODE', name: 'Renamed' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.prepareClientChange({ mac: '02:00:00:FF:FF:FF', nodeId: client.nodeId, name: 'Renamed' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('prevents blocking and rate-limiting the managing computer', async () => {
    const { router, service } = setup(); const client = (await router.clients()).find(item => item.local)!;
    for (const change of [{ blocked: true }, { uploadLimit: 64 }, { downloadLimit: 128 }]) await expect(service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, ...change })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('fails closed when the administrator identity cannot be verified', async () => {
    const { router, service } = setup(); const client = await editable(router); router.overrides.localhost = {};
    await expect(service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, blocked: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('refuses a quick block that would silently replace an allowlist policy', async () => {
    const { router, service } = setup(); const client = await editable(router); router.overrides.macFilter = { macFilterEn: true, curFilterMode: 'allow', blackList: [], whiteList: [] };
    await expect(service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, blocked: true })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
  it('allows read-only use but denies writes on unverified firmware', async () => {
    const { router, service } = setup(); router.status = { demo: false, firmware: 'V16.03.28.99_multi' };
    await expect(service.overview()).resolves.toHaveProperty('sampledAt');
    await expect(service.prepareAction({ action: 'meshOptimize' })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('limits repeated login attempts in the service independently of the transport', async () => {
    const makeRouter = vi.fn(() => new TestRouter()); const service = new AppService(new MemoryFiles(), makeRouter);
    for (let index = 0; index < 4; index++) await service.connect({ host: '192.168.0.1', password: 'synthetic' });
    const made = makeRouter.mock.calls.length;
    await expect(service.connect({ host: '192.168.0.1', password: 'synthetic' })).rejects.toMatchObject({ code: 'LOCKED' });
    expect(makeRouter.mock.calls).toHaveLength(made);
  });
});

describe('confirmation integrity and stale state', () => {
  it('consumes an action confirmation exactly once even on concurrent replay', async () => {
    const { router, service } = setup(); const preview = await service.prepareAction({ action: 'meshOptimize' });
    expect(router.writeCalls).toHaveLength(0);
    const outcomes = await Promise.allSettled([service.applyChange({ id: preview.id }), service.applyChange({ id: preview.id })]);
    expect(outcomes.map(item => item.status)).toEqual(['fulfilled', 'rejected']);
    expect(router.writeCalls).toEqual([{ meshOptimize: { action: 'optimize' } }]);
  });
  it('supports cancellation and expiration without sending a mutation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));
    const { router, service } = setup(); const cancelled = await service.prepareAction({ action: 'meshOptimize' }); service.cancelChange({ id: cancelled.id });
    await expect(service.applyChange({ id: cancelled.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    const expired = await service.prepareAction({ action: 'meshOptimize' }); vi.setSystemTime(Date.now() + 120001);
    await expect(service.applyChange({ id: expired.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('invalidates action and feature confirmations when the session changes', async () => {
    const { router, service } = setup(); const action = await service.prepareAction({ action: 'meshOptimize' }); const feature = await featurePreview(service, 'firewall', { 'firewallCfg.pingAntiEn': false });
    await service.demo();
    await expect(service.applyChange({ id: action.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.applyChange({ id: feature.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('does not issue a client confirmation from a previous in-flight session', async () => {
    const { router, service } = setup(); const before = await router.clients(), client = before.find(item => !item.local)!; const gate = deferred<void>(), started = deferred<void>();
    vi.spyOn(router, 'clients').mockImplementationOnce(async () => { started.resolve(); await gate.promise; return before; });
    const pending = service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, name: 'Another network' }); const assertion = expect(pending).rejects.toMatchObject({ code: 'AUTH' });
    await started.promise; await service.demo(); gate.resolve(); await assertion;
    expect(router.writeCalls).toHaveLength(0);
  });
  it('does not issue a maintenance confirmation from a previous in-flight session', async () => {
    const { router, service } = setup(); const nodes = await router.mesh(), gate = deferred<void>(), started = deferred<void>();
    vi.spyOn(router, 'mesh').mockImplementationOnce(async () => { started.resolve(); await gate.promise; return nodes; });
    const pending = service.prepareAction({ action: 'meshOptimize' }); const assertion = expect(pending).rejects.toMatchObject({ code: 'AUTH' });
    await started.promise; await service.demo(); gate.resolve(); await assertion;
    expect(router.writeCalls).toHaveLength(0);
  });
  it('rejects stale client names and current access policy before applying', async () => {
    const { router, service } = setup(); const client = await editable(router); const preview = await service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, name: 'Desired' });
    await router.externalChange({ setDeviceInfo: { mac: client.mac, hostname: 'Changed by another admin' } });
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    const next = await service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, name: 'Desired' }); const policy = (await router.readModules(['macFilter'])).macFilter as Record<string, unknown>;
    router.overrides.macFilter = { ...policy, changedSincePreview: true };
    await expect(service.applyChange({ id: next.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('rechecks administrator status immediately before blocking a client', async () => {
    const { router, service } = setup(); const clients = await router.clients(), client = clients.find(item => !item.local && !item.blocked)!;
    const preview = await service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, blocked: true });
    router.clientsView = clients.map(item => ({ ...item, local: item.mac === client.mac }));
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('rechecks fresh localhost data even if the client list has an outdated local flag', async () => {
    const { router, service } = setup(); const client = await editable(router); const preview = await service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, uploadLimit: 64 });
    router.overrides.localhost = { mac: client.mac };
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('rechecks a feature revision after review and prevents an outdated write', async () => {
    const { router, service } = setup(); const preview = await featurePreview(service, 'firewall', { 'firewallCfg.pingAntiEn': false });
    const config = (await router.readModules(['firewallCfg'])).firewallCfg as Record<string, unknown>;
    await router.externalChange({ firewallCfg: { ...config, tcpAntiEn: !config.tcpAntiEn } });
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'CONFLICT' }); expect(router.writeCalls).toHaveLength(0);
  });
});

describe('uncertain operations and recovery', () => {
  it('does not retry an uncertain action and requires a successful overview before more changes', async () => {
    const { router, service } = setup(); const preview = await service.prepareAction({ action: 'meshOptimize' }); router.writeError = new AppError('UNCERTAIN', 'Synthetic lost acknowledgement');
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'UNCERTAIN' });
    await expect(service.prepareAction({ action: 'meshOptimize' })).rejects.toMatchObject({ code: 'UNCERTAIN' });
    router.overviewError = new AppError('OFFLINE', 'Synthetic offline');
    await expect(service.overview()).rejects.toMatchObject({ code: 'OFFLINE' });
    await expect(service.prepareAction({ action: 'meshOptimize' })).rejects.toMatchObject({ code: 'UNCERTAIN' });
    router.overviewError = undefined; router.writeError = undefined;
    await service.overview(); await expect(service.prepareAction({ action: 'meshOptimize' })).resolves.toHaveProperty('id');
    expect(router.writeCalls).toHaveLength(1);
  });
  it('classifies a failed post-write verification as uncertain and blocks subsequent writes', async () => {
    const { router, service } = setup(); const client = await editable(router), preview = await service.prepareClientChange({ mac: client.mac, nodeId: client.nodeId, name: 'Updated' }); router.failVerification = true;
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'UNCERTAIN' });
    await expect(service.prepareAction({ action: 'meshOptimize' })).rejects.toMatchObject({ code: 'UNCERTAIN' });
    expect(router.writeCalls).toHaveLength(1);
  });
});

describe('firmware and maintenance safeguards', () => {
  it('rejects forged and offline targets before issuing a confirmation', async () => {
    const { router, service } = setup(); const offline = (await router.mesh()).find(node => !node.online)!;
    await expect(service.prepareAction({ action: 'reset', nodeId: 'FOREIGN' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.prepareAction({ action: 'reboot', nodeId: offline.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(router.writeCalls).toHaveLength(0);
  });
  it('denies local RX27 firmware for a satellite and rejects the wrong file kind', async () => {
    const { files, router, service } = setup(); const satellite = (await router.mesh()).find(node => !node.primary && node.online)!; const firmware = files.add('firmware'), config = files.add('configuration');
    await expect(service.prepareAction({ action: 'firmware', nodeId: satellite.id, fileId: firmware.info.id })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(service.prepareAction({ action: 'firmware', fileId: config.info.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(router.uploads).toHaveLength(0); expect(router.writeCalls).toHaveLength(0);
  });
  it('rechecks the primary role at apply time and never uploads to a new secondary', async () => {
    const { files, router, service } = setup(); const nodes = await router.mesh(), primary = nodes.find(node => node.primary)!, file = files.add('firmware'); const preview = await service.prepareAction({ action: 'firmware', nodeId: primary.id, fileId: file.info.id });
    router.nodesView = nodes.map(node => ({ ...node, primary: node.id !== primary.id && node.online }));
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(router.uploads).toHaveLength(0); expect(router.writeCalls).toHaveLength(0);
  });
  it('requires a confirmed available online upgrade and rechecks availability before applying', async () => {
    const { router, service } = setup(); const primary = (await router.mesh()).find(node => node.primary)!;
    await expect(service.prepareAction({ action: 'upgradeOnline', nodeId: primary.id })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    const check = await service.prepareAction({ action: 'checkFirmware', nodeId: primary.id }); await service.applyChange({ id: check.id });
    const preview = await service.prepareAction({ action: 'upgradeOnline', nodeId: primary.id }); const versions = (await router.readModules(['deviceVersionList'])).deviceVersionList as Record<string, unknown>[];
    router.overrides.deviceVersionList = versions.map(row => ({ ...row, versionInfo: { ...(row.versionInfo as Record<string, unknown>), hasNewSoftVersion: false } })); router.writeCalls.length = 0;
    await expect(service.applyChange({ id: preview.id })).rejects.toMatchObject({ code: 'UNSUPPORTED' }); expect(router.writeCalls).toHaveLength(0);
  });
  it('primes only the authenticated controller before upload and clears file bytes afterwards', async () => {
    const { files, router, service } = setup(); const primary = (await router.mesh()).find(node => node.primary)!, file = files.add('firmware'), original = Buffer.from(file.bytes); const preview = await service.prepareAction({ action: 'firmware', nodeId: primary.id, fileId: file.info.id });
    expect(router.uploads).toHaveLength(0);
    await expect(service.applyChange({ id: preview.id })).resolves.toMatchObject({ reconnect: true });
    expect(router.writeCalls).toEqual([{ agentLocalUpgrade: { sn: primary.id } }]);
    expect(router.uploads).toHaveLength(1); expect(router.uploads[0]).toMatchObject({ kind: 'firmware', filename: 'firmware.bin', fields: { sn: primary.id } });
    expect(router.uploads[0].bytes.equals(original)).toBe(true); expect(file.bytes.every(byte => byte === 0)).toBe(true); expect(service.connection().connected).toBe(false);
  });
  it('does not scan Mesh before confirmation and delays scan-result queries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));
    const { router, service } = setup(); const results = vi.spyOn(router, 'readScanResults'), preview = await service.prepareAction({ action: 'meshScan' });
    await service.maintenanceStatus(); expect(router.scanCalls).toBe(0); expect(results).not.toHaveBeenCalled();
    await service.applyChange({ id: preview.id }); await service.maintenanceStatus(); expect(router.scanCalls).toBe(1); expect(results).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 15001); await service.maintenanceStatus(); expect(results).toHaveBeenCalledTimes(1);
  });
  it('does not expose new administrator passwords in confirmation or audit output', async () => {
    const { service } = setup(); const secret = 'Synthetic-New-Secret1'; const preview = await service.prepareAction({ action: 'changePassword', oldPassword: 'Synthetic-Old1', newPassword: secret, confirmPassword: secret });
    expect(JSON.stringify(preview)).not.toContain(secret); expect(JSON.stringify(await service.logs())).not.toContain(secret);
    await expect(service.prepareAction({ action: 'changePassword', oldPassword: 'old', newPassword: secret, confirmPassword: 'different-secret' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('redacts complete secret-bearing log records, including quoted JSON and Bearer headers', async () => {
    const { router, service } = setup(); const secrets = ['JSON-password-value', 'JSON-token-value', 'Bearer-token-value', 'URL-stok-value'];
    router.overrides.systemLog = { systemLogList: [
      { log: JSON.stringify({ password: secrets[0], token: secrets[1] }) },
      { log: `Authorization: Bearer ${secrets[2]}` },
      { log: `GET /;stok=${secrets[3]}/goform/getModules` },
      { log: 'Network connected' },
    ] };
    const output = JSON.stringify(await service.logs());
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).toContain('Network connected');
  });
});
