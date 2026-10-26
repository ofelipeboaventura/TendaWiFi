import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { z } from 'zod';
import { TRAFFIC_GAP_MS, PROBE_GAP_MS } from '../../shared/monitoring';
import { ReportEngine,migrateReports } from './reports';
import { QualityHistory,migrateQuality } from './quality-history';
import { NetworkHistory, migrateNetworkHistory } from './network-history';
import type { ObservationQuery } from '../../shared/observability';
import { reduceSamples } from '../../shared/chart';
import type { ResourceSample } from '../../shared/monitoring';
import { defaultMonitorSettings, type CounterDelta, type DeviceHistory, type MonitorEvent, type MonitorPoint, type MonitorQuery, type MonitorReading, type MonitorSettings, type MonitoringHistory, type ProbeSample } from '../../shared/monitoring';
import { periodMs, qualityMetrics, safeSettings, probeSchema } from './metrics';

interface Minute {
  breakBefore?: boolean;
  at: number; lastAt: number; mac: string; name: string; samples: number; sumUp: number; sumDown: number; peakUp: number; peakDown: number;
  online: number; uptime: number; cpuSum: number; cpuN: number; memorySum: number; memoryN: number; latencySum: number; latencyN: number;
  uploadBytes: string | null; downloadBytes: string | null; scope: 'internet' | 'device' | null;
}
const finite = z.number().finite().nonnegative(), byteTotal = z.string().regex(/^\d{1,40}$/).nullable();
const minuteSchema = z.strictObject({ breakBefore: z.boolean().optional(), at: finite, lastAt: finite, mac: z.string().regex(/^(?:wan|(?:[A-F0-9]{2}:){5}[A-F0-9]{2})$/), name: z.string().max(256), samples: z.number().int().min(1).max(10000), sumUp: finite, sumDown: finite, peakUp: finite, peakDown: finite, online: finite, uptime: finite, cpuSum: finite, cpuN: finite, memorySum: finite, memoryN: finite, latencySum: finite, latencyN: finite, uploadBytes: byteTotal, downloadBytes: byteTotal, scope: z.enum(['internet', 'device']).nullable() });
const eventSchema = z.strictObject({ id: z.string().uuid(), at: finite, category: z.enum(['connection', 'quality', 'resources', 'collector', 'storage']), severity: z.enum(['info', 'warning', 'critical']), state: z.enum(['opened', 'resolved', 'info']), message: z.string().max(1000), target: z.string().max(128).optional(), durationMs: finite.optional() });
const readMinute = (raw: unknown): Minute => minuteSchema.parse(JSON.parse(String(raw)));
const readProbes = (raw: unknown) => z.array(probeSchema).max(24).parse(JSON.parse(String(raw)));
export const resourceSampleSchema = z.strictObject({ id: z.string().uuid(), nodeId: z.string().min(1).max(128).refine(v => !/[\x00-\x1f\x7f]/.test(v)), at: z.number().int().nonnegative(), cpu: z.number().finite().min(0).max(100).nullable(), memory: z.number().finite().min(0).max(100).nullable(), breakBefore: z.boolean() });
export interface StoredSample { volumes?: import('../../shared/observability').VolumeSlice[]; appendKey?: {epoch:string;sequence:number}; topologyUpdated?:boolean; reading: MonitorReading; at: number; deltas: CounterDelta[]; probes: ProbeSample[]; breakBefore?: boolean }
export type StorageHealth = MonitoringHistory['storage'];
export class MonitorDatabase {
  private db: DatabaseSync; private network!:NetworkHistory; private quality!:QualityHistory; private reports!:ReportEngine; private lastMaintenance = 0;
  private health: StorageHealth = { healthy: true, message: '', earliestAt: null, bytes: 0 };
  constructor(private filename: string, private maxBytes = 512 * 1024 * 1024) {
    this.db = new DatabaseSync(filename, { enableForeignKeyConstraints: true, allowExtension: false });
    try {
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA wal_autocheckpoint=256;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > 5) { this.db.close(); throw Error('Unsupported monitoring schema'); }
    if (!version) this.db.exec(`BEGIN; CREATE TABLE settings(profile TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE minutes(profile TEXT NOT NULL, mac TEXT NOT NULL, bucket INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(profile,mac,bucket)); CREATE INDEX minute_time ON minutes(profile,bucket); CREATE TABLE probes(profile TEXT NOT NULL, target TEXT NOT NULL, bucket INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(profile,target,bucket)); CREATE TABLE events(profile TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(profile,id)); CREATE INDEX event_time ON events(profile,at); PRAGMA user_version=1; COMMIT;`);
    if (version < 2) this.db.exec('BEGIN; CREATE TABLE resource_samples(profile TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile,id)); CREATE INDEX resource_time ON resource_samples(profile,at); PRAGMA user_version=2; COMMIT;');
    if (version < 3) migrateNetworkHistory(this.db);
    if(version<4)migrateQuality(this.db);
    this.network = new NetworkHistory(this.db);this.quality=new QualityHistory(this.db);if(version<5)migrateReports(this.db);this.reports=new ReportEngine(this.db,this.network);
    if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') { this.db.close(); throw Error('Corrupt monitoring database'); }
    } catch (error) { try { this.db.close(); } catch { /* constructor must release even a corrupt database */ } throw error; }
  }
  settings(profile: string): MonitorSettings { const row = this.db.prepare('SELECT data FROM settings WHERE profile=?').get(profile); return row ? safeSettings(JSON.parse(String(row.data))) : { ...defaultMonitorSettings }; }
  saveSettings(profile: string, settings: MonitorSettings) { this.db.prepare('INSERT INTO settings(profile,data) VALUES(?,?) ON CONFLICT(profile) DO UPDATE SET data=excluded.data').run(profile, JSON.stringify(settings)); }
  event(profile: string, event: MonitorEvent) { this.db.prepare('INSERT OR IGNORE INTO events(profile,id,at,data) VALUES(?,?,?,?)').run(profile, event.id, event.at, JSON.stringify(event)); }
  private fileBytes() { return this.filename === ':memory:' ? 0 : ['', '-wal', '-shm'].reduce((n, suffix) => { try { return n + statSync(this.filename + suffix).size; } catch { return n; } }, 0); }
  append(profile: string, sample: StoredSample): StorageHealth {
    if(sample.appendKey&&this.network.seen(profile,sample.appendKey.epoch,sample.appendKey.sequence))return this.health;
    const { reading, at, deltas, probes } = sample, bucket = Math.floor(at / 60000) * 60000;
    if (at - this.lastMaintenance >= 60000 || this.fileBytes() > this.maxBytes) this.maintain(at,profile);
    const goodProbe = probes.find(p => p.status === 'success' && p.target === '1.1.1.1');
    const entries = [{ mac: 'wan', name: 'Internet (WAN)', upload: reading.overview.upload, download: reading.overview.download, online: reading.overview.internet }, ...reading.clients.map(d => ({ mac: d.mac, name: d.name, upload: d.online ? d.upload : 0, download: d.online ? d.download : 0, online: d.online }))];
    this.db.exec('BEGIN');
    try {
      const get = this.db.prepare('SELECT data FROM minutes WHERE profile=? AND mac=? AND bucket=?'), put = this.db.prepare('INSERT INTO minutes(profile,mac,bucket,data) VALUES(?,?,?,?) ON CONFLICT(profile,mac,bucket) DO UPDATE SET data=excluded.data');
      for (const item of entries) {
        const previous = get.get(profile, item.mac, bucket);
        const row: Minute = previous ? readMinute(previous.data) : { at, lastAt: at, mac: item.mac, name: item.name, samples: 0, sumUp: 0, sumDown: 0, peakUp: 0, peakDown: 0, online: 0, uptime: 0, cpuSum: 0, cpuN: 0, memorySum: 0, memoryN: 0, latencySum: 0, latencyN: 0, uploadBytes: null, downloadBytes: null, scope: null };
        row.at = Math.min(row.at, at); row.lastAt = Math.max(row.lastAt, at); row.name = item.name; row.samples++; row.sumUp += item.upload; row.sumDown += item.download; row.peakUp = Math.max(row.peakUp, item.upload); row.peakDown = Math.max(row.peakDown, item.download); row.online += Number(item.online); row.uptime = reading.overview.uptime;
        const delta = deltas.find(d => d.id === item.mac); if (delta) { row.uploadBytes = (BigInt(row.uploadBytes ?? '0') + BigInt(delta.upload)).toString(); row.downloadBytes = (BigInt(row.downloadBytes ?? '0') + BigInt(delta.download)).toString(); row.scope = row.scope && row.scope !== delta.scope ? 'device' : delta.scope; }
        if (item.mac === 'wan' && goodProbe?.latency != null) { row.latencySum += goodProbe.latency; row.latencyN++; }
        put.run(profile, item.mac, bucket, JSON.stringify(row));
      }
      const getProbe = this.db.prepare('SELECT data FROM probes WHERE profile=? AND target=? AND bucket=?'), putProbe = this.db.prepare('INSERT INTO probes(profile,target,bucket,data) VALUES(?,?,?,?) ON CONFLICT(profile,target,bucket) DO UPDATE SET data=excluded.data');
      for (const probe of probes) { const b = Math.floor(probe.at / 60000) * 60000, old = getProbe.get(profile, probe.target, b); const rows: ProbeSample[] = old ? readProbes(old.data) : []; if (!rows.some(r => r.at === probe.at)) rows.push({target:probe.target,at:probe.at,latency:probe.latency,status:probe.status}); putProbe.run(profile, probe.target, b, JSON.stringify(rows.slice(-24))); }
      if (reading.resourceSample) {
        const resource = resourceSampleSchema.parse(reading.resourceSample);
        if (resource.at <= at && at - resource.at <= periodMs['30d']) this.db.prepare('INSERT OR IGNORE INTO resource_samples(profile,id,at,data) VALUES(?,?,?,?)').run(profile,resource.id,resource.at,JSON.stringify(resource));
      }
      this.network.append(profile,sample);this.quality.nodes(profile,sample);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    if (this.fileBytes() > this.maxBytes) this.maintain(at);
    else this.health.bytes = this.fileBytes();
    return this.health;
  }
  maintain(now: number,profile?:string) {
    this.lastMaintenance = now; this.network.maintain(now);this.quality.maintain(now);this.reports.maintain(now);const active=profile??String(this.db.prepare('SELECT profile FROM observation_profiles ORDER BY first_at DESC LIMIT 1').get()?.profile??'');if(active)this.reports.generate(active,now); const cutoff = now - periodMs['30d'];
    for (const table of ['minutes', 'probes'] as const) this.db.prepare(`DELETE FROM ${table} WHERE bucket<?`).run(cutoff);
    this.db.prepare('DELETE FROM events WHERE at<?').run(cutoff);
    this.db.prepare('DELETE FROM resource_samples WHERE at<?').run(cutoff);
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum(4096);');
    let bytes = this.fileBytes(), trimmed = false;
    for (let i = 0; bytes > this.maxBytes && i < 100; i++) {
      const oldest=this.db.prepare('SELECT MIN(bucket) AS at FROM minutes').get()?.at;
      const earliest = Number(oldest ?? now); const end = earliest + 86400000;
      if (oldest === null || oldest === undefined) this.network.trimOldest();
      this.db.prepare('DELETE FROM minutes WHERE bucket<?').run(end); this.db.prepare('DELETE FROM probes WHERE bucket<?').run(end); this.db.prepare('DELETE FROM events WHERE at<?').run(end);
      this.db.prepare('DELETE FROM resource_samples WHERE at<?').run(end);
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum;'); bytes = this.fileBytes(); trimmed = true;
    }
    this.health = { healthy: bytes <= this.maxBytes, message: trimmed ? 'O limite de armazenamento reduziu a retenção efetiva.' : this.health.message, earliestAt: this.db.prepare('SELECT MIN(bucket) AS at FROM minutes').get()?.at as number | null ?? null, bytes };
  }
  probes(profile: string, samples: ProbeSample[]) {
    this.db.exec('BEGIN');
    try { for(const sample of samples.slice(0,200)){const probe=probeSchema.parse(sample),bucket=Math.floor(probe.at/60000)*60000;const old=this.db.prepare('SELECT data FROM probes WHERE profile=? AND target=? AND bucket=?').get(profile,probe.target,bucket);const rows=old?readProbes(old.data):[];if(!rows.some(r=>r.at===probe.at))rows.push({target:probe.target,at:probe.at,latency:probe.latency,status:probe.status});this.db.prepare('INSERT INTO probes(profile,target,bucket,data) VALUES(?,?,?,?) ON CONFLICT(profile,target,bucket) DO UPDATE SET data=excluded.data').run(profile,probe.target,bucket,JSON.stringify(rows.slice(-24)));}this.db.exec('COMMIT'); }
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  history(profile: string, query: MonitorQuery, now = Date.now()): MonitoringHistory {
    const from = now - periodMs[query.period], target = query.deviceMac ?? 'wan';
    const resources: ResourceSample[] = query.deviceMac ? [] : this.db.prepare('SELECT data FROM resource_samples WHERE profile=? AND at>=? AND at<=? ORDER BY at LIMIT 20000').all(profile,from,now).map(r=>resourceSampleSchema.parse(JSON.parse(String(r.data))));
    const rows: Minute[] = [...this.db.prepare('SELECT data FROM minutes WHERE profile=? AND mac=? AND bucket>=? AND bucket<=? ORDER BY bucket').iterate(profile, target, Math.ceil(from / 60000) * 60000, now)].map(r => readMinute(r.data));
    const point = (r: Minute): MonitorPoint => ({ at: r.at, upload: r.sumUp / r.samples, download: r.sumDown / r.samples, online: r.online > 0, uptime: r.uptime, cpu: r.cpuN ? r.cpuSum / r.cpuN : null, memory: r.memoryN ? r.memorySum / r.memoryN : null, latency: r.latencyN ? r.latencySum / r.latencyN : null });
    const points: MonitorPoint[] = []; const stride = Math.max(1, Math.ceil(rows.length / 800));
    for (let i = 0; i < rows.length; i += stride) { const slice = rows.slice(i, i + stride), samples = slice.reduce((n, r) => n + r.samples, 0); points.push({ ...point(slice[0]), upload: slice.reduce((n, r) => n + r.sumUp, 0) / samples, download: slice.reduce((n, r) => n + r.sumDown, 0) / samples }); }
    points.forEach((p, i) => { const r = rows[i * stride], prior = rows[i * stride - 1]; p.breakBefore = Boolean(r.breakBefore || prior && r.at - prior.lastAt > TRAFFIC_GAP_MS); });
    const devices = new Map<string, { row: DeviceHistory; up: number; down: number }>();
    for (const raw of this.db.prepare("SELECT data FROM minutes WHERE profile=? AND mac<>'wan' AND bucket>=? AND bucket<=?").iterate(profile, Math.ceil(from / 60000) * 60000, now)) {
      const r: Minute = readMinute(raw.data); const existing = devices.get(r.mac) ?? { row: { mac: r.mac, name: r.name, samples: 0, meanUpload: 0, meanDownload: 0, peakUpload: 0, peakDownload: 0, uploadBytes: null, downloadBytes: null, scope: null }, up: 0, down: 0 };
      const d = existing.row; d.samples += r.samples; existing.up += r.sumUp; existing.down += r.sumDown; d.peakUpload = Math.max(d.peakUpload, r.peakUp); d.peakDownload = Math.max(d.peakDownload, r.peakDown); if (r.uploadBytes !== null) { d.uploadBytes = (BigInt(d.uploadBytes ?? '0') + BigInt(r.uploadBytes)).toString(); d.downloadBytes = (BigInt(d.downloadBytes ?? '0') + BigInt(r.downloadBytes ?? '0')).toString(); d.scope = d.scope && d.scope !== r.scope ? 'device' : r.scope; } devices.set(r.mac, existing);
    }
    const samples = rows.reduce((n, r) => n + r.samples, 0), addBytes = (key: 'uploadBytes' | 'downloadBytes') => rows.some(r => r[key] !== null) ? rows.reduce((n, r) => n + BigInt(r[key] ?? '0'), 0n).toString() : null;
    const probes: ProbeSample[] = []; for (const r of this.db.prepare('SELECT data FROM probes WHERE profile=? AND bucket>=? AND bucket<=? ORDER BY bucket').iterate(profile, Math.ceil(from / 60000) * 60000, now)) probes.push(...readProbes(r.data));
    const latency = probes.filter(p => p.target === '1.1.1.1').sort((a,b)=>a.at-b.at).map((p,i,all)=>({at:p.at,value:p.status==='success'?p.latency:null,breakBefore:Boolean(p.breakBefore||i>0&&p.at-all[i-1].at>PROBE_GAP_MS)}));
    return { resources, chart: {epoch:'',sequence:0,latency:reduceSamples(latency,200)}, period: query.period, from, to: now, points, devices: [...devices.values()].map(d => ({ ...d.row, meanUpload: d.up / d.row.samples, meanDownload: d.down / d.row.samples })).sort((a, b) => b.meanDownload - a.meanDownload).slice(0, 1024), events: [...this.db.prepare('SELECT data FROM events WHERE profile=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 500').iterate(profile, from, now)].map(r => eventSchema.parse(JSON.parse(String(r.data)))), quality: qualityMetrics(probes, [...new Set(probes.map(p => p.target))]), summary: { samples, meanUpload: samples ? rows.reduce((n, r) => n + r.sumUp, 0) / samples : 0, meanDownload: samples ? rows.reduce((n, r) => n + r.sumDown, 0) / samples : 0, peakUpload: Math.max(0, ...rows.map(r => r.peakUp)), peakDownload: Math.max(0, ...rows.map(r => r.peakDown)), availability: samples ? rows.reduce((n, r) => n + r.online, 0) / samples * 100 : null, uploadBytes: addBytes('uploadBytes'), downloadBytes: addBytes('downloadBytes'), firstAt: rows[0]?.at ?? null, lastAt: rows.at(-1)?.lastAt ?? null, coverage: Math.min(100, samples / (periodMs[query.period] / 1000) * 100) }, storage: this.health };
  }
  intelligence(profile:string,query:ObservationQuery,now=Date.now()){return this.reports.intelligence(profile,query,now);}
  reportsList(profile:string){return this.reports.list(profile);}
  reportGet(profile:string,id:string){return this.reports.get(profile,id);}
  layout(profile:string){return this.reports.layout(profile);}
  saveLayout(profile:string,value:import('../../shared/observability').WidgetLayout){return this.reports.saveLayout(profile,value);}
  extraQuality(profile:string,rows:import('../../shared/monitoring').ExtraQualitySample[]){this.quality.samples(profile,rows);}
  qualityReport(profile:string,query:ObservationQuery,now=Date.now()){return this.quality.report(profile,query,now);}
  observation(profile:string,query:ObservationQuery,now=Date.now()){return this.network.report(profile,query,now);}
  device(profile:string,query:ObservationQuery&{deviceMac:string},now=Date.now()){return this.network.device(profile,query,now);}
  close() { this.db.close(); }
}
