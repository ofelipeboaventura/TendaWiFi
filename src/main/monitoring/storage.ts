import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import type { MonitorEvent, MonitorQuery, MonitorSettings, MonitoringHistory } from '../../shared/monitoring';
import type { StoredSample, StorageHealth } from './database';
export interface MonitorStore {
  settings(profile: string): Promise<MonitorSettings>; saveSettings(profile: string, value: MonitorSettings): Promise<void>;
  append(profile: string, value: StoredSample): Promise<StorageHealth>; event(profile: string, value: MonitorEvent): Promise<void>;
  history(profile: string, value: MonitorQuery): Promise<MonitoringHistory>; close(): Promise<void>;
}
export class WorkerStore implements MonitorStore {
  private worker: Worker; private sequence = 0; private closed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private ready: Promise<void>;
  constructor(filename: string) {
    this.worker = new Worker(resolve(__dirname, 'monitoring-worker.cjs'), { workerData: { filename }, env: {} });
    this.ready = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Storage initialization timeout')), 10000); this.pending.set(0, { resolve, reject, timer }); });
    this.worker.on('message', message => { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); clearTimeout(pending.timer); if (message.ok) pending.resolve(message.value); else pending.reject(Error('Não foi possível acessar o histórico local.')); });
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
  history(profile: string, value: MonitorQuery) { return this.call<MonitoringHistory>('history', [profile, value]); }
  async close() { if (!this.closed) { try { await this.call<void>('close', []); } catch { /* worker failure already surfaced */ } await this.worker.terminate(); this.closed = true; } }
}
