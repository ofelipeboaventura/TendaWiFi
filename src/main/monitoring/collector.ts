import { randomUUID } from 'node:crypto';
import { TRAFFIC_GAP_MS, PROBE_GAP_MS, type ChartFrame } from '../../shared/monitoring';
import { AppError } from '../errors';
import { defaultMonitorSettings, type MonitorEvent, type MonitorQuery, type MonitorReading, type MonitorSettings, type MonitoringHistory, type MonitoringState, type ProbeSample, type MonitorPoint } from '../../shared/monitoring';
import { AlertEngine, CounterTracker, deduplicateClients, periodMs, qualityMetrics, querySchema, settingsSchema } from './metrics';
import type { MonitorStore } from './storage';
import type { ProbeProvider } from './probes';

export interface MonitorSource { connected(): boolean; demo(): boolean; host(): string; read(topology: boolean, resources: boolean): Promise<MonitorReading>; diagnostics?(enabled: boolean): Promise<void>; suspendDiagnostics?(): void }
const storageInitial = { healthy: true, message: '', earliestAt: null, bytes: 0 };
export class MonitoringCollector {
  private generation = 0; private timer?: ReturnType<typeof setTimeout>; private busy = false; private suspended = false; private failures = 0;
  private profile = ''; private store?: MonitorStore; private lastTopology = 0; private lastResources = 0; private lastSample = 0; private lastUptime = 0; private lastNotify = -Infinity; private offlineSince = 0;
  private historyCache = new Map<string, { at: number; value: MonitoringHistory }>();
  private pendingWrites = 0; private stateRevision = 0;
  private sessionEpoch = 0;
  private chartEpoch = randomUUID(); private chartSequence = 0; private breakNext = true; private breakProbes = true;
  private probeRing: ProbeSample[] = [];
  private counters = new CounterTracker(); private alerts = new AlertEngine(); private probes: ProbeSample[] = []; private pendingProbes: ProbeSample[] = [];
  private resourceRing: import('../../shared/monitoring').ResourceSample[] = [];
  private lastResourceId = ''; private diagnosticEventKey = '';
  private ring: { point: MonitorPoint; devices: Map<string, MonitorPoint>; deltas?: import('../../shared/monitoring').CounterDelta[] }[] = [];
  private listeners = new Set<(state: MonitoringState) => void>();
  private state: MonitoringState = this.empty();
  constructor(private source: MonitorSource, private stores: (demo: boolean) => MonitorStore, private probeProvider: ProbeProvider, private notification: (event: MonitorEvent) => void = () => undefined, private now = () => Date.now()) {}
  private empty(): MonitoringState { return { status: 'starting', sampledAt: null, settings: { ...defaultMonitorSettings }, overview: null, clients: [], nodes: [], resources: [], quality: [], recentEvents: [], consumptionSupported: false, storage: { ...storageInitial }, probeAvailable: false }; }
  onUpdate(listener: (state: MonitoringState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish() { this.state.revision = ++this.stateRevision; for (const listener of this.listeners) listener(this.snapshot()); }
  private frame(value: Omit<ChartFrame, 'epoch' | 'sequence' | 'at'>) { this.state.chart = { epoch: this.chartEpoch, sequence: ++this.chartSequence, at: this.now(), ...value }; }
  private acceptProbes(samples: ProbeSample[], available: boolean) {
    const at = this.now(); this.state.probeAvailable = available;
    const rows = samples.map(sample => { const prior = this.probeRing.slice().reverse().find(p => p.target === sample.target); return { ...sample, breakBefore: this.breakProbes || !prior || sample.at - prior.at > PROBE_GAP_MS || sample.at <= prior.at }; });
    if (rows.length) this.breakProbes = false; else if (!available) this.breakProbes = true;
    this.probeRing = [...this.probeRing, ...rows].filter(p => p.at >= at - 900000).slice(-600);
    this.probes = this.probeRing.filter(p => p.at >= at - 300000);
    this.pendingProbes = [...this.pendingProbes, ...rows].slice(-200);
    const store=this.store;if(this.profile&&store?.probes&&rows.length)void store.probes(this.profile,rows).catch(()=>{if(this.store===store)this.storageFailure();});
    this.state.quality = qualityMetrics(this.probes, [this.source.host(), '1.1.1.1', '8.8.8.8']);
    this.frame({ probes: rows });
  }
  private requireConnection() { if (!this.source.connected()) throw new AppError('AUTH', 'Conecte-se ao roteador para acessar o monitoramento.'); }
  snapshot() { return structuredClone(this.state); }
  status() { this.requireConnection(); return this.snapshot(); }
  identity() { this.requireConnection(); return `${this.sessionEpoch}:${this.profile}`; }
  assertIdentity(identity: string) { if (this.identity() !== identity) throw new AppError('AUTH', 'A sessão mudou durante a operação.'); }
  async start() {
    await this.stop(); const generation = this.generation; this.state = {...this.empty(),demo:this.source.demo()}; this.lastTopology = 0; this.lastResources = 0; this.lastSample = 0; this.lastUptime = 0; this.failures = 0; this.offlineSince = 0; this.ring = []; this.probes = []; this.pendingProbes = []; this.historyCache.clear(); this.counters.clear(); this.alerts.clear(); this.suspended = false;
    this.chartEpoch = randomUUID(); this.chartSequence = 0; this.breakNext = true; this.breakProbes = true; this.probeRing = [];
    this.pendingWrites = 0; this.resourceRing = []; this.lastResourceId = ''; this.diagnosticEventKey = ''; this.store = this.stores(this.source.demo());
    await this.tick(generation);
    if (generation !== this.generation) return;
    if (this.source.connected() && this.state.status !== 'paused') this.startProbes();
  }
  private startProbes() {
    if (this.source.demo()) return;
    const generation = this.generation;
    this.probeProvider.start(this.source.host(), (samples, available) => {
      if (generation !== this.generation || this.suspended || this.state.status === 'paused' || !this.source.connected()) return;
      this.acceptProbes(samples, available); this.publish();
    });
  }
  private async event(event: MonitorEvent) {
    this.state.recentEvents = [event, ...this.state.recentEvents].slice(0, 100);
    const store = this.store; if (this.profile && store) void store.event(this.profile, event).catch(() => { if (this.store === store) this.storageFailure(); });
    if (event.state === 'opened' && this.state.settings.alerts && !this.state.settings.muted && !this.source.demo() && event.at - this.lastNotify >= 300000) { this.lastNotify = event.at; this.notification(event); }
  }
  private info(message: string, category: MonitorEvent['category'] = 'collector') { return this.event({ id: randomUUID(), at: this.now(), severity: 'info', state: 'info', category, message }); }
  private storageFailure() { if (this.state.storage.healthy) this.state.recentEvents = [{ id: randomUUID(), at: this.now(), category: 'storage' as const, severity: 'warning' as const, state: 'opened' as const, message: 'Histórico local indisponível. A coleta ao vivo continua.' }, ...this.state.recentEvents].slice(0, 100); this.state.storage = { ...this.state.storage, healthy: false, message: 'Histórico local indisponível. A coleta ao vivo continua; verifique o espaço em disco e os arquivos do aplicativo.' }; }
  private async tick(generation: number) {
    if (generation !== this.generation || this.suspended || this.state.status === 'paused' || !this.source.connected()) return;
    if (this.busy) { this.timer = setTimeout(() => void this.tick(generation), 200); return; }
    this.busy = true; const started = this.now(), monotonicStart = performance.now();
    try {
      const topology = !this.lastTopology || started - this.lastTopology >= 10000, resources = !this.lastResources || started - this.lastResources >= 15000;
      const reading = await this.source.read(topology, resources); if (generation !== this.generation) return;
      if (this.source.demo() && (!this.probes.length || started - this.probes.at(-1)!.at >= 5000)) { const samples = [this.source.host(), '1.1.1.1', '8.8.8.8'].map((target, i) => ({ target, at: started, latency: i === 0 ? 1 : 12 + i * 5 + Math.sin(started / 6000) * 3, status: 'success' as const })); this.acceptProbes(samples, false); this.publish(); }
      reading.clients = deduplicateClients(reading.clients); reading.overview.clientCount = reading.clients.filter(d => d.online).length;
      const at = this.now(); if (topology) this.lastTopology = at; if (resources) this.lastResources = at;
      if (!this.profile) { this.profile = reading.routerId; try { this.state.settings = await this.store!.settings(this.profile); } catch { this.storageFailure(); } if (generation !== this.generation) return; await this.configureDiagnostics(this.state.settings.resourceDiagnosticsEnabled); }
      const breakBefore = this.breakNext || !this.lastSample || at - this.lastSample > TRAFFIC_GAP_MS || at <= this.lastSample;
      if (this.lastSample && (at - this.lastSample > TRAFFIC_GAP_MS || at <= this.lastSample)) { this.counters.clear(); this.alerts.clear(); await this.info('Lacuna na coleta. O período sem amostras não foi preenchido.'); }
      if (this.lastUptime && reading.overview.uptime + 2 < this.lastUptime) { this.counters.clear(); await this.info('Reinicialização ou reinício do contador de atividade detectado.', 'connection'); }
      const recovered = this.state.status === 'offline'; this.failures = 0; this.lastUptime = reading.overview.uptime; this.lastSample = at;
      this.state = { ...this.state, status: 'collecting', sampledAt: at, overview: reading.overview, clients: reading.clients, nodes: reading.nodes, resources: reading.resources, diagnostic: reading.diagnostic, consumptionSupported: reading.counters.some(c => c.id === 'wan') };
      if (recovered) await this.event({ id: randomUUID(), at, category: 'connection', severity: 'info', state: 'resolved', durationMs: this.offlineSince ? at - this.offlineSince : undefined, message: 'Comunicação com o roteador restabelecida.' });
      const sample = reading.resourceSample;
      const newResources = sample && sample.id !== this.lastResourceId ? [sample] : [];
      if (newResources.length) { this.lastResourceId = sample!.id; this.resourceRing = [...this.resourceRing, ...newResources].filter(r => r.at >= at - 900000).slice(-128); this.historyCache.clear(); }

      if (newResources.length) await this.info('Nova medi\u00e7\u00e3o de CPU e mem\u00f3ria confirmada pelo diagn\u00f3stico.', 'resources');
      const diagnosticKey = reading.diagnostic ? reading.diagnostic.status + ':' + reading.diagnostic.message : '';
      if (diagnosticKey !== this.diagnosticEventKey && ['unavailable','uncertain'].includes(reading.diagnostic?.status ?? '')) await this.info(reading.diagnostic!.message, 'resources');
      this.diagnosticEventKey = diagnosticKey;
      const latestProbe = this.state.quality.find(q => q.target === '1.1.1.1');
      const point: MonitorPoint = { at, upload: reading.overview.upload, download: reading.overview.download, online: reading.overview.internet, uptime: reading.overview.uptime, cpu: null, memory: null, latency: latestProbe?.lastAt && at - latestProbe.lastAt < 15000 ? latestProbe.lastLatency : null, breakBefore };
      this.breakNext = false;
      this.ring.push({ point, devices: new Map(reading.clients.map(d => [d.mac, { ...point, upload: d.online ? d.upload : 0, download: d.online ? d.download : 0, online: d.online, cpu: null, memory: null, latency: null }])) }); this.ring = this.ring.filter(r => at - r.point.at <= 900000).slice(-901);
      const probes = this.pendingProbes.splice(0); const deltas = this.counters.update(reading.counters, at); this.ring[this.ring.length-1].deltas = deltas;
      this.frame({ point, devices: reading.clients.map(d => ({ mac: d.mac, upload: d.online ? d.upload : 0, download: d.online ? d.download : 0, online: d.online })), deltas, resources: newResources, topologyUpdated: topology, resourcesUpdated: true });
      const store = this.store!;
      // A historical query or a slow/full disk must never hold up live sampling.
      if (this.pendingWrites >= 8) this.storageFailure();
      else { this.pendingWrites++; void store.append(this.profile, { reading, at, deltas, probes, breakBefore }).then(health => { if (this.store === store) this.state.storage = health; }).catch(() => { if (this.store === store) this.storageFailure(); }).finally(() => { if (this.store === store) this.pendingWrites--; }); }
      if (generation !== this.generation) return;
      const s = this.state.settings, observations: [string, boolean | null, number, string, MonitorEvent['category'], string?][] = [
        ['wan', !reading.overview.internet, 5000, 'O roteador informou Internet desconectada.', 'connection'],
        ['download', s.downloadMbps === null ? null : reading.overview.download * 8 / (s.downloadMbps * 1e6) * 100 > s.saturationPercent, 30000, 'Download próximo da capacidade contratada.', 'resources'],
        ['upload', s.uploadMbps === null ? null : reading.overview.upload * 8 / (s.uploadMbps * 1e6) * 100 > s.saturationPercent, 30000, 'Upload próximo da capacidade contratada.', 'resources'],
      ];
      for (const q of this.state.quality) { const fresh = q.lastAt !== null && at - q.lastAt < 15000; observations.push([`latency:${q.target}`, fresh && q.lastLatency !== null ? q.lastLatency > s.latencyMs : null, 30000, 'Latência acima do limite configurado.', 'quality', q.target], [`loss:${q.target}`, fresh && q.samples >= 30 ? q.loss! > s.lossPercent : null, 0, 'Perda de respostas ICMP acima do limite configurado.', 'quality', q.target]); }
      if (s.alerts) for (const [key, bad, duration, message, category, target] of observations) for (const event of this.alerts.observe(key, bad, at, duration, message, category, target)) await this.event(event);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof Error && 'code' in error && error.code === 'AUTH') { this.state.status = 'auth-required'; this.source.suspendDiagnostics?.(); this.probeProvider.stop(); this.counters.clear(); this.alerts.clear(); await this.info('Sessão expirada. Entre novamente para continuar a coleta.', 'connection'); }
      else { this.failures++; if (this.state.status !== 'offline') { this.offlineSince = this.now(); this.state.status = 'offline'; await this.event({ id: randomUUID(), at: this.now(), category: 'connection', severity: 'critical', state: 'opened', message: 'Sem comunicação com o roteador; os dados anteriores foram preservados.' }); } }
    } finally {
      this.busy = false;
      if (generation === this.generation) { this.publish(); if (!this.suspended && !['paused', 'auth-required'].includes(this.state.status) && this.source.connected()) { const delay = this.failures ? [2000, 5000, 15000][Math.min(2, this.failures - 1)] : Math.max(0, 1000 - (performance.now() - monotonicStart)); this.timer = setTimeout(() => void this.tick(generation), delay); } }
    }
  }
  async history(input: MonitorQuery): Promise<MonitoringHistory> {
    this.requireConnection(); if (!this.profile) throw new AppError('OFFLINE', 'Aguardando a primeira coleta.');
    const query = querySchema.parse(input), generation = this.sessionEpoch, at = this.now(), sequence = this.chartSequence, epoch = this.chartEpoch;
    const short = periodMs[query.period] <= 900000, from = at - periodMs[query.period];
    const points = this.ring.filter(r => r.point.at >= from && r.point.at <= at).flatMap(r => { const point = query.deviceMac ? r.devices.get(query.deviceMac) : r.point; return point ? [structuredClone(point)] : []; });
    const deltaHistory = this.ring.filter(r=>r.point.at>=from&&r.point.at<=at&&r.deltas?.length).map(r=>({at:r.point.at,values:structuredClone(r.deltas!)}));
    const snapshotProbes = structuredClone(this.probeRing.filter(p=>p.at>=from&&p.at<=at));
    const snapshotResources = structuredClone(this.resourceRing.filter(r=>r.at>=from&&r.at<=at));
    const latency = this.probeRing.filter(p => p.target === '1.1.1.1' && p.at >= from && p.at <= at).map(p=>({at:p.at,value:p.status==='success'?p.latency:null,breakBefore:Boolean(p.breakBefore)}));
    const key = JSON.stringify(query), cache = this.historyCache.get(key); let result: MonitoringHistory;
    try {
      if (!short && cache && at-cache.at<30000) result=structuredClone(cache.value);
      else {
        result=await this.store!.history(this.profile,query,at);
        result.chart={epoch,sequence,latency:short?latency:result.chart?.latency??[],probes:short?snapshotProbes:[],deltas:short?deltaHistory:[]};
        if(short)result.quality=qualityMetrics(snapshotProbes,[this.source.host(),'1.1.1.1','8.8.8.8']);
        if(short) { result.points=points; result.resources=[...new Map([...(result.resources??[]),...snapshotResources].map(r=>[r.id,r])).values()].sort((a,b)=>a.at-b.at); }
        if(generation===this.sessionEpoch&&!short){if(this.historyCache.size>=12)this.historyCache.delete(this.historyCache.keys().next().value!);this.historyCache.set(key,{at,value:structuredClone(result)});}
      }
    } catch { throw new AppError('INTERNAL', 'Histórico local indisponível; a coleta ao vivo continua.'); }
    if(generation!==this.sessionEpoch)throw new AppError('AUTH','A sessão mudou durante a consulta.');
    result.storage=this.state.storage; return result;
  }
  async saveSettings(input: MonitorSettings) { this.requireConnection(); if (!this.profile) throw new AppError('OFFLINE', 'Aguardando a primeira coleta.'); const value = settingsSchema.parse(input), generation = this.sessionEpoch; try { await this.store!.saveSettings(this.profile, value); } catch { throw new AppError('INTERNAL', 'Não foi possível salvar as preferências de monitoramento.'); } if (generation !== this.sessionEpoch) throw new AppError('AUTH', 'A sessão mudou.'); this.state.settings = value; await this.configureDiagnostics(value.resourceDiagnosticsEnabled && this.state.status !== 'paused' && !this.suspended); this.alerts.clear(); this.publish(); return value; }
  private async configureDiagnostics(enabled: boolean) {
    try { await this.source.diagnostics?.(enabled); }
    catch { if (enabled) this.state.diagnostic = { status: 'unavailable', progress: null, nextAt: null, message: 'Diagnostico nao disponivel para este equipamento ou estado.' }; }
  }
  async pause(paused: boolean) { this.requireConnection(); this.breakNext = true; this.breakProbes = true; this.generation++; if (this.timer) clearTimeout(this.timer); this.probeProvider.stop(); this.counters.clear(); this.alerts.clear(); this.state.status = paused ? 'paused' : 'collecting'; await this.configureDiagnostics(!paused && this.state.settings.resourceDiagnosticsEnabled); await this.info(paused ? 'Coleta pausada pelo usuário.' : 'Coleta retomada pelo usuário.'); this.publish(); if (!paused) { this.startProbes(); void this.tick(this.generation); } }
  suspend() { this.breakNext = true; this.breakProbes = true; this.generation++; this.suspended = true; this.source.suspendDiagnostics?.(); if (this.timer) clearTimeout(this.timer); this.probeProvider.stop(); this.counters.clear(); this.alerts.clear(); void this.info('Windows suspenso; coleta interrompida.'); }
  resume() { if (!this.suspended) return; this.suspended = false; this.lastTopology = 0; this.lastResources = 0; if (this.source.connected() && this.state.status !== 'paused') { void this.configureDiagnostics(this.state.settings.resourceDiagnosticsEnabled); this.startProbes(); void this.tick(this.generation); } }
  async stop() { this.generation++; this.sessionEpoch++; if (this.timer) clearTimeout(this.timer); this.probeProvider.stop(); await this.configureDiagnostics(false); this.profile = ''; const store = this.store; this.store = undefined; if (store) await store.close(); }
}
