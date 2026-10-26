export const reportRanges = ['today','yesterday','7d','month','lastMonth','year','custom'] as const;
export type ReportRange = typeof reportRanges[number];
export interface ObservationQuery { range: ReportRange; from?: number; to?: number; deviceMac?: string }
export interface VolumeSlice {
  entity: string; basis: 'measured'|'estimated'; scope: 'internet' | 'device'; from: number; to: number; coveredMs: number;
  measuredUp: string; measuredDown: string; estimatedUp: string; estimatedDown: string;
  onlineMs: number;
}
export interface VolumeTotals {
  measuredUp: string; measuredDown: string; estimatedUp: string; estimatedDown: string;
  coveredMs: number; measuredMs:number; estimatedMs:number; onlineMs: number; basis: 'measured'|'estimated'|'mixed'|'unavailable';
}
export interface VolumeBucket extends VolumeTotals { at: number; firstAt: number; lastAt: number }
export interface InventoryDevice {
  mac: string; name: string; ip: string; nodeId: string; nodeName: string; connection: string;
  firstAt: number; lastAt: number; onlineSince: number | null; online: boolean; ambiguous: boolean;
  negotiatedMbps: number | null; rssi: string | null; peakUpload: number; peakDownload: number;
  volume: VolumeTotals;
}
export interface NetworkEvent { id: string; at: number; kind: 'new'|'connected'|'disconnected'|'roaming'; mac: string; nodeId: string; message: string }
export interface ObservationReport { scope:'internet'|'device'; watermark?: {epoch:string;sequence:number};
  from: number; to: number; timeZone: 'America/Bahia'; resolution: 'minute'|'hour'|'day';
  firstCollectedAt: number | null; totals: VolumeTotals; buckets: VolumeBucket[];
  devices: InventoryDevice[]; events: NetworkEvent[]; coverage: number; unknownMs: number;
  comparison: { from: number; to: number; totals: VolumeTotals; percent: number | null; coverage: number } | null;
}
export interface DeviceReport { device: InventoryDevice; events: NetworkEvent[]; report: ObservationReport }
export interface NodeEvent { id:string;at:number;nodeId:string;kind:'offline'|'online'|'parent'|'quality';message:string }
export interface QualityReport { samples:import('./monitoring').ExtraQualitySample[]; nodes:import('./monitoring').NodeHealth[]; events:NodeEvent[]; limited:boolean }
export const widgetIds=['summary','traffic','capacity','insights','events'] as const;
export type WidgetId=typeof widgetIds[number];
export interface WidgetLayout { order:WidgetId[]; hidden:WidgetId[] }
export const defaultLayout=():WidgetLayout=>({order:[...widgetIds],hidden:[]});
export interface TrafficBaseline { ready:boolean; days:number; medianUp:number;medianDown:number;madUp:number;madDown:number; sampledAt:number }
export interface HeatCell { weekday:number;hour:number;bytes:string;coveredMs:number;measuredBytes:string;estimatedBytes:string }
export interface IntelligenceReport { baseline:TrafficBaseline; heatmap:HeatCell[]; heatmapFrom:number; dailyMeanBytes:string|null; projection:{eligibleDays:number;monthlyBytes:string|null;monthFrom:number;monthTo:number}; scope:'internet'|'device' }
export interface SavedReport { id:string;kind:'week'|'month';from:number;to:number;createdAt:number;coverage:number;totals:VolumeTotals;availability:number|null;top:{mac:string;name:string;bytes:string;basis:VolumeTotals['basis']}[];days:VolumeBucket[] }
export interface BottleneckInsight { kind:'local'|'saturation';message:string;evidence:string[];devices:{mac:string;name:string;upload:number;download:number}[];since:number }
export interface ObservabilityCommands {
  observationIntelligence(query:ObservationQuery):Promise<import('./types').Result<IntelligenceReport>>;
  observationReports():Promise<import('./types').Result<SavedReport[]>>;
  observationLayout():Promise<import('./types').Result<WidgetLayout>>;
  saveObservationLayout(input:WidgetLayout):Promise<import('./types').Result<WidgetLayout>>;
  exportSavedReport(input:{id:string}):Promise<import('./types').Result<{saved:boolean}>>;
  observationQuality(query:ObservationQuery):Promise<import('./types').Result<QualityReport>>;
  observationReport(query: ObservationQuery): Promise<import('./types').Result<ObservationReport>>;
  observationDevice(query: ObservationQuery & { deviceMac: string }): Promise<import('./types').Result<DeviceReport>>;
  exportObservation(query: ObservationQuery & { kind: 'volumes'|'inventory'|'events' }): Promise<import('./types').Result<{saved:boolean}>>;
  desktopStartup(): Promise<import('./types').Result<{enabled:boolean;supported:boolean}>>;
  desktopSetStartup(input:{enabled:boolean}): Promise<import('./types').Result<{enabled:boolean;supported:boolean}>>;
}
export const emptyVolume = (): VolumeTotals => ({measuredUp:'0',measuredDown:'0',estimatedUp:'0',estimatedDown:'0',coveredMs:0,measuredMs:0,estimatedMs:0,onlineMs:0,basis:'unavailable'});
export const volumeBytes = (v: VolumeTotals) => BigInt(v.measuredUp)+BigInt(v.measuredDown)+BigInt(v.estimatedUp)+BigInt(v.estimatedDown);
