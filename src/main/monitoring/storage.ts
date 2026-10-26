import type { ObservationQuery,ObservationReport,DeviceReport } from '../../shared/observability';
import { AppError } from '../errors';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import type { MonitorEvent, MonitorQuery, MonitorSettings, MonitoringHistory } from '../../shared/monitoring';
import type { StoredSample, StorageHealth } from './database';
export interface MonitorStore {
  intelligence?(profile:string,query:ObservationQuery,at?:number):Promise<import('../../shared/observability').IntelligenceReport>; reportsList?(profile:string):Promise<import('../../shared/observability').SavedReport[]>; reportGet?(profile:string,id:string):Promise<import('../../shared/observability').SavedReport>; layout?(profile:string):Promise<import('../../shared/observability').WidgetLayout>; saveLayout?(profile:string,value:import('../../shared/observability').WidgetLayout):Promise<import('../../shared/observability').WidgetLayout>;
  extraQuality?(profile:string,rows:import('../../shared/monitoring').ExtraQualitySample[]):Promise<void>; qualityReport?(profile:string,query:ObservationQuery,at?:number):Promise<import('../../shared/observability').QualityReport>;
  observation?(profile:string,query:ObservationQuery,at?:number):Promise<ObservationReport>; device?(profile:string,query:ObservationQuery&{deviceMac:string},at?:number):Promise<DeviceReport>;
  settings(profile: string): Promise<MonitorSettings>; saveSettings(profile: string, value: MonitorSettings): Promise<void>;
  append(profile: string, value: StoredSample): Promise<StorageHealth>; event(profile: string, value: MonitorEvent): Promise<void>;
  probes?(profile: string, values: import('../../shared/monitoring').ProbeSample[]): Promise<void>;
  history(profile: string, value: MonitorQuery, at?: number): Promise<MonitoringHistory>; close(): Promise<void>;
}
export class WorkerStore implements MonitorStore {
  private worker: Worker; private sequence = 0; private closed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private ready: Promise<void>;
  constructor(filename: string) {
    this.worker = new Worker(resolve(__dirname, 'monitoring-worker.cjs'), { workerData: { filename }, env: {} });
    this.ready = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Storage initialization timeout')), 10000); this.pending.set(0, { resolve, reject, timer }); });
    this.worker.on('message', message => { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); clearTimeout(pending.timer); if (message.ok) pending.resolve(message.value); else if(message.error&&['FORBIDDEN','VALIDATION','UNSUPPORTED'].includes(message.error.code)&&typeof message.error.message==='string')pending.reject(new AppError(message.error.code,message.error.message.slice(0,800))); else pending.reject(Error('Não foi possível acessar o histórico local.')); });
    const fail = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('O histórico local está indisponível.')); } this.pending.clear(); this.closed = true; };
    this.worker.on('error', fail); this.worker.on('exit', fail); void this.ready.catch(() => undefined);
  }
  private async call<T>(method: string, args: unknown[]): Promise<T> {
    await this.ready; if (this.closed || this.pending.size >= 16) throw Error('Histórico ocupado ou indisponível.');
    return new Promise((resolve, reject) => { const id = ++this.sequence; const timer = setTimeout(() => { this.pending.delete(id); reject(Error('O histórico demorou para responder.')); }, 15000); this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, method, args }); });
  }
  settings(profile: string) { return this.call<MonitorSettings>('settings', [profile]); }
  saveSettings(profile: string, value: MonitorSettings) { return this.call<void>('saveSettings', [profile, value]); }
  append(profile: string, value: StoredSample) { return this.call<StorageHealth>('append', [profile, value]); }
  event(profile: string, value: MonitorEvent) { return this.call<void>('event', [profile, value]); }
  probes(profile: string, values: import('../../shared/monitoring').ProbeSample[]) { return this.call<void>('probes', [profile, values]); }
  history(profile: string, value: MonitorQuery, at?: number) { return this.call<MonitoringHistory>('history', [profile, value, at]); }
  intelligence(profile:string,query:ObservationQuery,at?:number){return this.call<import('../../shared/observability').IntelligenceReport>('intelligence',[profile,query,at]);}
  reportsList(profile:string){return this.call<import('../../shared/observability').SavedReport[]>('reportsList',[profile]);}
  reportGet(profile:string,id:string){return this.call<import('../../shared/observability').SavedReport>('reportGet',[profile,id]);}
  layout(profile:string){return this.call<import('../../shared/observability').WidgetLayout>('layout',[profile]);}
  saveLayout(profile:string,value:import('../../shared/observability').WidgetLayout){return this.call<import('../../shared/observability').WidgetLayout>('saveLayout',[profile,value]);}
  extraQuality(profile:string,rows:import('../../shared/monitoring').ExtraQualitySample[]){return this.call<void>('extraQuality',[profile,rows]);}
  qualityReport(profile:string,query:ObservationQuery,at?:number){return this.call<import('../../shared/observability').QualityReport>('qualityReport',[profile,query,at]);}
  observation(profile:string,query:ObservationQuery,at?:number){return this.call<ObservationReport>('observation',[profile,query,at]);}
  device(profile:string,query:ObservationQuery&{deviceMac:string},at?:number){return this.call<DeviceReport>('device',[profile,query,at]);}
  async close() { if (!this.closed) { try { await this.call<void>('close', []); } catch { /* worker failure already surfaced */ } await this.worker.terminate(); this.closed = true; } }
}
