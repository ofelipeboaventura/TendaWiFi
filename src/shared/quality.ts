import type { ProbeSample, QualityMetric } from './monitoring';
export function qualityMetrics(samples: ProbeSample[], targets: string[]): QualityMetric[] {
  return targets.map(target => {
    const rows = samples.filter(s => s.target === target && s.status !== 'error').sort((a, b) => a.at - b.at), ok = rows.filter(s => s.status === 'success' && s.latency !== null), values = ok.map(s => s.latency!).sort((a, b) => a - b);
    const changes: number[] = []; for (let i = 1; i < rows.length; i++) if (rows[i].latency !== null && rows[i - 1].latency !== null && rows[i].at - rows[i - 1].at <= 10000) changes.push(Math.abs(rows[i].latency! - rows[i - 1].latency!));
    const last = rows.at(-1);
    return { target, samples: rows.length, received: ok.length, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, p95: values.length ? values[Math.max(0, Math.ceil(values.length * .95) - 1)] : null, jitter: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null, loss: rows.length ? (rows.length - ok.length) / rows.length * 100 : null, lastAt: last?.at ?? null, lastLatency: last?.latency ?? null };
  });
}

