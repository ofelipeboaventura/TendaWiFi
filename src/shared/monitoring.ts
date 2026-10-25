import type { ClientDevice, MeshNode, Overview } from './types';

export const monitoringPeriods = ['5m', '15m', '1h', '24h', '7d', '30d'] as const;
export type MonitoringPeriod = typeof monitoringPeriods[number];
export interface MonitorSettings {
  resourceDiagnosticsEnabled: boolean;
  downloadMbps: number | null; uploadMbps: number | null; alerts: boolean; muted: boolean;
  latencyMs: number; lossPercent: number; cpuPercent: number; memoryPercent: number; saturationPercent: number;
}
export const defaultMonitorSettings: MonitorSettings = { resourceDiagnosticsEnabled: true, downloadMbps: null, uploadMbps: null, alerts: true, muted: false, latencyMs: 100, lossPercent: 5, cpuPercent: 80, memoryPercent: 90, saturationPercent: 90 };
export interface RealCounter { id: string; scope: 'internet' | 'device'; epoch: string; upload: string; download: string }
export interface CounterDelta { id: string; scope: 'internet' | 'device'; upload: string; download: string }
export interface ResourceReading { nodeId: string; cpu: number | null; memory: number | null; source: 'diagnostic'; sampledAt: number | null; current: boolean }
export interface ResourceSample { id: string; nodeId: string; at: number; cpu: number | null; memory: number | null; breakBefore: boolean }
export interface DiagnosticStatus { status: 'disabled' | 'waiting' | 'running' | 'external' | 'uncertain' | 'unavailable'; progress: number | null; nextAt: number | null; message: string }
export const RESOURCE_INTERVAL_MS = 300000;
export const RESOURCE_STALE_MS = 360000;
export const TRAFFIC_GAP_MS = 3500;
export const PROBE_GAP_MS = 12500;
export interface ChartSample { at: number; value: number | null; breakBefore: boolean }
export interface ChartFrame { epoch: string; sequence: number; at: number; point?: MonitorPoint; devices?: { mac: string; upload: number; download: number; online: boolean }[]; probes?: ProbeSample[]; resources?: ResourceSample[]; deltas?: CounterDelta[]; topologyUpdated?: boolean; resourcesUpdated?: boolean }
export interface ChartHistory { epoch: string; sequence: number; latency: ChartSample[]; probes?: ProbeSample[]; deltas?: { at: number; values: CounterDelta[] }[] }
export interface ProbeSample { target: string; at: number; latency: number | null; status: 'success' | 'timeout' | 'error'; breakBefore?: boolean }
export interface QualityMetric { target: string; samples: number; received: number; mean: number | null; p95: number | null; jitter: number | null; loss: number | null; lastAt: number | null; lastLatency: number | null }
export interface MonitorEvent { id: string; at: number; category: 'connection' | 'quality' | 'resources' | 'collector' | 'storage'; severity: 'info' | 'warning' | 'critical'; state: 'opened' | 'resolved' | 'info'; message: string; target?: string; durationMs?: number }
export interface MonitorReading { overview: Overview; clients: ClientDevice[]; nodes: MeshNode[]; resources: ResourceReading[]; diagnostic?: DiagnosticStatus; resourceSample?: ResourceSample; counters: RealCounter[]; routerId: string }
export interface MonitorPoint { at: number; upload: number; download: number; online: boolean; uptime: number; cpu: number | null; memory: number | null; latency: number | null; breakBefore?: boolean }
export interface DeviceHistory { mac: string; name: string; samples: number; meanUpload: number; meanDownload: number; peakUpload: number; peakDownload: number; uploadBytes: string | null; downloadBytes: string | null; scope: 'internet' | 'device' | null }
export interface MonitoringHistory {
  resources?: ResourceSample[];
  partial?: boolean;
  chart?: ChartHistory;
  period: MonitoringPeriod; from: number; to: number; points: MonitorPoint[]; devices: DeviceHistory[]; events: MonitorEvent[]; quality: QualityMetric[];
  summary: { samples: number; meanUpload: number; meanDownload: number; peakUpload: number; peakDownload: number; availability: number | null; uploadBytes: string | null; downloadBytes: string | null; firstAt: number | null; lastAt: number | null; coverage: number };
  storage: { healthy: boolean; message: string; earliestAt: number | null; bytes: number };
}
export interface MonitoringState {
  diagnostic?: DiagnosticStatus;
  demo?: boolean;
  revision?: number;
  chart?: ChartFrame;
  status: 'collecting' | 'paused' | 'offline' | 'auth-required' | 'starting'; sampledAt: number | null; settings: MonitorSettings;
  overview: Overview | null; clients: ClientDevice[]; nodes: MeshNode[]; resources: ResourceReading[]; quality: QualityMetric[]; recentEvents: MonitorEvent[];
  consumptionSupported: boolean; storage: MonitoringHistory['storage']; probeAvailable: boolean;
}
export interface MonitorQuery { period: MonitoringPeriod; deviceMac?: string }
export interface MonitorExport extends MonitorQuery { kind: 'traffic' | 'devices' | 'events' | 'quality' | 'resources' }
export interface MonitoringCommands {
  monitoringStatus(): Promise<import('./types').Result<MonitoringState>>;
  monitoringHistory(input: MonitorQuery): Promise<import('./types').Result<MonitoringHistory>>;
  monitoringSaveSettings(input: MonitorSettings): Promise<import('./types').Result<MonitorSettings>>;
  monitoringPause(input: { paused: boolean }): Promise<import('./types').Result<void>>;
  exportMonitoring(input: MonitorExport): Promise<import('./types').Result<{ saved: boolean }>>;
}
