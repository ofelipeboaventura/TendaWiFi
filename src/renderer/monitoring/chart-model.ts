import { PROBE_GAP_MS, TRAFFIC_GAP_MS, type ChartSample, type MonitorPoint, type MonitoringPeriod } from '../../shared/monitoring';
import { chartPeriods, reduceSamples } from '../../shared/chart';
export type ChartKind = 'traffic' | 'resources' | 'latency';
export interface PlotSeries { name: string; color: string; samples: readonly ChartSample[] }
export function makeSeries(points: readonly MonitorPoint[], kind: ChartKind, period: MonitoringPeriod, latency?: readonly ChartSample[]): PlotSeries[] {
  const short = chartPeriods[period] <= 900000;
  const values = (key: 'upload' | 'download' | 'cpu' | 'memory' | 'latency', scale = 1) => points.map((p,i)=>({at:p.at,value:p[key]===null?null:p[key]!*scale,breakBefore:p.breakBefore??Boolean(i&&short&&p.at-points[i-1].at>(key==='latency'?PROBE_GAP_MS:TRAFFIC_GAP_MS))}));
  if(kind==='traffic')return[{name:'Download',color:'#ff9254',samples:values('download',8/1e6)},{name:'Upload',color:'#79aaff',samples:values('upload',8/1e6)}];
  if(kind==='resources')return[{name:'CPU',color:'#ff9254',samples:values('cpu')},{name:'Memória',color:'#79aaff',samples:values('memory')}];
  return[{name:'Latência',color:'#6dd4b0',samples:latency??values('latency')}];
}
export function prepareSeries(series: readonly PlotSeries[], width: number): PlotSeries[] { return series.map(s=>({...s,samples:reduceSamples(s.samples,Math.max(1,Math.floor(width)))})); }
export class StableScale {
  private maximum = 1; private smallerSince: number | null = null;
  update(target: number, at: number): number {
    if(target>=this.maximum){this.maximum=target;this.smallerSince=null;}
    else if(target<=this.maximum*.7){this.smallerSince??=at;if(at-this.smallerSince>=10000){this.maximum=target;this.smallerSince=null;}}
    else this.smallerSince=null;
    return this.maximum;
  }
}
