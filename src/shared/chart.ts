import type { ChartSample, MonitoringPeriod } from './monitoring';
export const chartPeriods: Record<MonitoringPeriod, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };

/** Keep chronological extrema, not averages. A reduced partial bucket never bridges missing data. */
export function reduceSamples(samples: readonly ChartSample[], buckets: number): ChartSample[] {
  buckets = Math.max(1, Math.floor(buckets));
  if (samples.length <= buckets * 4) return samples.slice();
  const start = samples[0].at, span = Math.max(1, samples.at(-1)!.at - start + 1), groups = new Map<number, ChartSample[]>();
  for (const sample of samples) { const key = Math.min(buckets - 1, Math.floor((sample.at - start) / span * buckets)); const group = groups.get(key) ?? []; group.push(sample); groups.set(key, group); }
  const result: ChartSample[] = [];
  for (const group of groups.values()) {
    const valid = group.filter(s => s.value !== null);
    const min = valid.reduce<ChartSample | undefined>((p, s) => !p || s.value! < p.value! ? s : p, undefined), max = valid.reduce<ChartSample | undefined>((p, s) => !p || s.value! > p.value! ? s : p, undefined);
    const partial = group.some((s, i) => s.value === null || i > 0 && s.breakBefore);
    const selected = [...new Set([group[0], min, max, group.at(-1)].filter((s): s is ChartSample => Boolean(s)))].sort((a, b) => a.at - b.at);
    result.push(...selected.map(s => partial ? { ...s, breakBefore: true } : s));
  }
  return result;
}
export function nearestSample(samples: readonly ChartSample[], at: number): number {
  if (!samples.length) return -1; let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (samples[mid].at < at) lo = mid + 1; else hi = mid; }
  return lo && Math.abs(samples[lo - 1].at - at) <= Math.abs(samples[lo].at - at) ? lo - 1 : lo;
}
export function niceMaximum(value: number) { if (!Number.isFinite(value) || value <= 0) return 1; const power = 10 ** Math.floor(Math.log10(value)); return [1, 2, 5, 10].find(n => n * power >= value)! * power; }
