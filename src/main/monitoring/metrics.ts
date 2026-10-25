import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { defaultMonitorSettings, monitoringPeriods, type CounterDelta, type MonitorEvent, type MonitorSettings, type ProbeSample, type QualityMetric, type RealCounter } from '../../shared/monitoring';
import type { ClientDevice } from '../../shared/types';

export const settingsSchema = z.strictObject({ downloadMbps: z.number().min(.1).max(100000).nullable(), uploadMbps: z.number().min(.1).max(100000).nullable(), alerts: z.boolean(), muted: z.boolean(), latencyMs: z.number().min(1).max(10000), lossPercent: z.number().min(.1).max(100), cpuPercent: z.number().min(1).max(100), memoryPercent: z.number().min(1).max(100), saturationPercent: z.number().min(1).max(100) });
export const querySchema = z.strictObject({ period: z.enum(monitoringPeriods), deviceMac: z.string().regex(/^(?:[A-F0-9]{2}:){5}[A-F0-9]{2}$/).optional() });
export const exportSchema = querySchema.extend({ kind: z.enum(['traffic', 'devices', 'events', 'quality']) });
export const pauseSchema = z.strictObject({ paused: z.boolean() });
export const periodMs = { '5m': 300000, '15m': 900000, '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
const uint64 = z.string().refine(s => /^(?:0|[1-9]\d{0,19})$/.test(s) && BigInt(s) <= 18446744073709551615n);
export const counterSchema = z.strictObject({ id: z.string().min(1).max(128), scope: z.enum(['internet', 'device']), epoch: z.string().min(1).max(128), upload: uint64, download: uint64 });
export const probeSchema = z.strictObject({ target: z.string().max(15), at: z.number().finite().nonnegative(), latency: z.number().finite().min(0).max(60000).nullable(), status: z.enum(['success', 'timeout', 'error']) });

/** A missing/ambiguous roaming record is not another device and must not double its traffic. */
export function deduplicateClients(clients: ClientDevice[]): ClientDevice[] {
  const chosen = new Map<string, ClientDevice>();
  for (const device of clients.slice(0, 4096)) {
    const mac = device.mac.toUpperCase(), previous = chosen.get(mac);
    if (!previous || device.online && !previous.online) chosen.set(mac, { ...device, mac });
  }
  return [...chosen.values()].slice(0, 256);
}

export class CounterTracker {
  private previous = new Map<string, { counter: RealCounter; at: number }>();
  clear() { this.previous.clear(); }
  update(input: RealCounter[], at: number): CounterDelta[] {
    const result: CounterDelta[] = [], next = new Map<string, { counter: RealCounter; at: number }>();
    const duplicate = new Set(input.filter((x, i) => input.findIndex(y => y.id === x.id) !== i).map(x => x.id));
    for (const item of input.slice(0, 257)) {
      const parsed = counterSchema.safeParse(item); if (!parsed.success || duplicate.has(item.id)) continue;
      const current = parsed.data, previous = this.previous.get(current.id); next.set(current.id, { counter: current, at });
      if (!previous || previous.counter.epoch !== current.epoch || previous.counter.scope !== current.scope || at <= previous.at || at - previous.at > 2500) continue;
      const up = BigInt(current.upload) - BigInt(previous.counter.upload), down = BigInt(current.download) - BigInt(previous.counter.download);
      if (up < 0n || down < 0n) continue; // Width/rollover semantics are not inferred.
      result.push({ id: current.id, scope: current.scope, upload: up.toString(), download: down.toString() });
    }
    this.previous = next; return result;
  }
}

export function qualityMetrics(samples: ProbeSample[], targets: string[]): QualityMetric[] {
  return targets.map(target => {
    const rows = samples.filter(s => s.target === target && s.status !== 'error').sort((a, b) => a.at - b.at), ok = rows.filter(s => s.status === 'success' && s.latency !== null), values = ok.map(s => s.latency!).sort((a, b) => a - b);
    const changes: number[] = []; for (let i = 1; i < rows.length; i++) if (rows[i].latency !== null && rows[i - 1].latency !== null && rows[i].at - rows[i - 1].at <= 10000) changes.push(Math.abs(rows[i].latency! - rows[i - 1].latency!));
    const last = rows.at(-1);
    return { target, samples: rows.length, received: ok.length, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, p95: values.length ? values[Math.max(0, Math.ceil(values.length * .95) - 1)] : null, jitter: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null, loss: rows.length ? (rows.length - ok.length) / rows.length * 100 : null, lastAt: last?.at ?? null, lastLatency: last?.latency ?? null };
  });
}

export class AlertEngine {
  private conditions = new Map<string, { since: number; last: number; opened: boolean; message: string; category: MonitorEvent['category']; target?: string }>();
  clear() { this.conditions.clear(); }
  observe(key: string, bad: boolean | null, at: number, duration: number, message: string, category: MonitorEvent['category'], target?: string): MonitorEvent[] {
    const prior = this.conditions.get(key);
    if (bad === null) { if (prior && !prior.opened) this.conditions.delete(key); return []; }
    if (!bad) {
      this.conditions.delete(key);
      return prior?.opened ? [{ id: randomUUID(), at, category, severity: 'info', state: 'resolved', message: `Recuperado: ${prior.message}`, target, durationMs: at - prior.since }] : [];
    }
    const condition = prior && at - prior.last <= 20000 ? prior : { since: at, last: at, opened: false, message, category, target }; condition.last = at; this.conditions.set(key, condition);
    if (condition.opened || at - condition.since < duration) return [];
    condition.opened = true;
    return [{ id: randomUUID(), at, category, severity: category === 'connection' ? 'critical' : 'warning', state: 'opened', message, target }];
  }
}
export function csvCell(value: unknown) { const raw = String(value ?? ''); return `"${(/^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? "'" : '') + raw.replaceAll('"', '""')}"`; }
export function csv(rows: unknown[][]) { return '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'; }
export function safeSettings(value: unknown): MonitorSettings { const parsed = settingsSchema.safeParse(value); return parsed.success ? parsed.data : { ...defaultMonitorSettings }; }
