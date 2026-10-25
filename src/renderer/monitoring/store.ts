import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { chartPeriods } from '../../shared/chart';
import { qualityMetrics } from '../../shared/quality';
import { TRAFFIC_GAP_MS, type ChartFrame, type MonitorQuery, type MonitoringHistory, type MonitoringState, type MonitorPoint } from '../../shared/monitoring';

export function appendHistory(history: MonitoringHistory, frame: ChartFrame, query: MonitorQuery): MonitoringHistory {
  if (!history.chart || history.chart.epoch !== frame.epoch || frame.sequence <= history.chart.sequence) return history;
  const short = chartPeriods[query.period] <= 900000, from = frame.at - chartPeriods[query.period];
  const points = history.points.filter(p => p.at >= from); let point: MonitorPoint | undefined = frame.point;
  if (point && query.deviceMac) { const device = frame.devices?.find(d => d.mac === query.deviceMac); point = device ? { ...point, upload: device.upload, download: device.download, online: device.online, cpu: null, memory: null, latency: null } : undefined; }
  if (point && !points.some(p => p.at === point!.at)) points.push({ ...point, breakBefore: Boolean(point.breakBefore || points.length && point.at - points.at(-1)!.at > TRAFFIC_GAP_MS) });
  const recent = points.filter(p => p.at >= frame.at - 900000).slice(-901), older = short ? [] : points.filter(p => p.at < frame.at - 900000).slice(-800);
  const latency = [...history.chart.latency, ...(frame.probes ?? []).filter(p => p.target === '1.1.1.1').map(p => ({ at: p.at, value: p.status === 'success' ? p.latency : null, breakBefore: Boolean(p.breakBefore) }))].filter(p => p.at >= from);
  const uniqueLatency = !frame.probes?.length && !(history.chart.latency[0]?.at < from) ? history.chart.latency : [...new Map(latency.map(p => [p.at, p])).values()].sort((a, b) => a.at - b.at).slice(-900);
  const deltas = [...(history.chart.deltas ?? []), ...(frame.point && frame.deltas?.length ? [{ at: frame.point.at, values: frame.deltas }] : [])].filter(d => d.at >= from).slice(-901);
  const probes = [...(history.chart.probes ?? []), ...(frame.probes ?? [])].filter(p => p.at >= from).slice(-600);
  let summary = history.summary;
  if (short) {
    const id = query.deviceMac ?? 'wan', values = deltas.flatMap(d => d.values.filter(v => v.id === id));
    summary = { ...summary, samples: recent.length, meanUpload: recent.length ? recent.reduce((n, p) => n + p.upload, 0) / recent.length : 0, meanDownload: recent.length ? recent.reduce((n, p) => n + p.download, 0) / recent.length : 0, peakUpload: Math.max(0, ...recent.map(p => p.upload)), peakDownload: Math.max(0, ...recent.map(p => p.download)), availability: recent.length ? recent.filter(p => p.online).length / recent.length * 100 : null, coverage: Math.min(100, recent.length / (chartPeriods[query.period] / 1000) * 100), firstAt: recent[0]?.at ?? null, lastAt: recent.at(-1)?.at ?? null,
      uploadBytes: values.length ? values.reduce((n, d) => n + BigInt(d.upload), 0n).toString() : null, downloadBytes: values.length ? values.reduce((n, d) => n + BigInt(d.download), 0n).toString() : null };
  }
  const devices = short ? history.devices.map(device => { const values = deltas.flatMap(d => d.values.filter(v => v.id === device.mac)); return { ...device, uploadBytes: values.length ? values.reduce((n,d)=>n+BigInt(d.upload),0n).toString() : null, downloadBytes: values.length ? values.reduce((n,d)=>n+BigInt(d.download),0n).toString() : null }; }) : history.devices;
  const nextPoints = !point && !(history.points[0]?.at < from) ? history.points : [...older,...recent];
  return { ...history, devices, quality: short && frame.probes?.length ? qualityMetrics(probes,[...new Set(probes.map(p=>p.target))]) : history.quality, from: short ? from : history.from, to: short ? frame.at : history.to, points: nextPoints, summary, chart: { ...history.chart, sequence: frame.sequence, latency: uniqueLatency, probes, deltas } };
}

function emptyHistory(query: MonitorQuery, state: MonitoringState): MonitoringHistory { const now = Date.now(); return { partial: true, period: query.period, from: now-chartPeriods[query.period], to: now, chart: {epoch:state.chart!.epoch,sequence:0,latency:[],probes:[],deltas:[]}, points:[],devices:[],events:state.recentEvents,quality:[],summary:{samples:0,meanUpload:0,meanDownload:0,peakUpload:0,peakDownload:0,availability:null,uploadBytes:null,downloadBytes:null,firstAt:null,lastAt:null,coverage:0},storage:state.storage }; }
const visible = () => typeof document === 'undefined' || !document.hidden;

interface View { snapshot: MonitoringHistory | null; query: MonitorQuery; listeners: Set<() => void> }
export class MonitorClientStore {
  private state: MonitoringState | null = null;
  private listeners = new Set<() => void>(); private views = new Map<string, View>(); private frames: ChartFrame[] = [];
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  notifyVisible() { for(const view of this.views.values())for(const listener of view.listeners)listener();for(const listener of this.listeners)listener(); }
  clear() { this.state = null; this.frames = []; for (const view of this.views.values()) { view.snapshot = null; for (const listener of view.listeners) listener(); } for (const listener of this.listeners) listener(); }
  push(incoming: MonitoringState): boolean {
    const previous = this.state, old = previous?.chart, frame = incoming.chart;
    if (previous && frame?.epoch === old?.epoch && incoming.revision !== undefined && incoming.revision < (previous.revision ?? 0)) return false;
    if (old && frame && old.epoch !== frame.epoch) { this.frames = []; for (const view of this.views.values()) { view.snapshot = null; } }
    const fresh = Boolean(frame && (frame.epoch !== old?.epoch || frame.sequence > (old?.sequence ?? -1)));
    const traffic = fresh && frame?.point;
    const settingsSame = previous && Object.keys(incoming.settings).every(k => incoming.settings[k as keyof typeof incoming.settings] === previous.settings[k as keyof typeof incoming.settings]);
    this.state = { ...incoming, overview: traffic || !previous ? incoming.overview : previous.overview, clients: traffic || !previous ? incoming.clients : previous.clients, nodes: traffic && frame?.topologyUpdated || !previous ? incoming.nodes : previous.nodes, resources: traffic && frame?.resourcesUpdated || !previous ? incoming.resources : previous.resources, quality: fresh && frame?.probes || !previous ? incoming.quality : previous.quality, settings: settingsSame ? previous!.settings : incoming.settings, recentEvents: previous && incoming.recentEvents.length === previous.recentEvents.length && incoming.recentEvents[0]?.id === previous.recentEvents[0]?.id ? previous.recentEvents : incoming.recentEvents };
    if (fresh && frame) {
      this.frames = [...this.frames, frame].slice(-128);
      for (const view of this.views.values()) if (view.listeners.size) { view.snapshot = appendHistory(view.snapshot ?? emptyHistory(view.query,this.state), frame, view.query); if(visible())for (const listener of view.listeners) listener(); }
    }
    if(visible())for (const listener of this.listeners) listener(); return true;
  }
  private view(key: string): View {
    let view = this.views.get(key); if (view) return view;
    if (this.views.size >= 12) { const removable = [...this.views].find(([, v]) => !v.listeners.size); if (removable) this.views.delete(removable[0]); }
    const query: MonitorQuery = JSON.parse(key); let snapshot: MonitoringHistory | null = null;
    if(this.state?.chart){snapshot=emptyHistory(query,this.state);for(const frame of this.frames)snapshot=appendHistory(snapshot,frame,query);}
    view = { snapshot, query, listeners: new Set() }; this.views.set(key, view); return view;
  }
  viewSnapshot = (key: string) => this.view(key).snapshot;
  subscribeView(key: string, listener: () => void) { const view = this.view(key); view.listeners.add(listener); return () => { view.listeners.delete(listener); }; }
  install(key: string, snapshot: MonitoringHistory): boolean {
    const chart = snapshot.chart; if (chart && this.state?.chart && chart.epoch !== this.state.chart.epoch) return false;
    const view = this.view(key); let next = snapshot;
    for (const frame of this.frames) next = appendHistory(next, frame, view.query);
    view.snapshot = next; for (const listener of view.listeners) listener(); return true;
  }
}
export const monitorStore = new MonitorClientStore();
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden)monitorStore.notifyVisible();});
export function useMonitoringSelector<T>(selector: (state: MonitoringState | null) => T): T {
  const snapshot = useCallback(() => selector(monitorStore.getSnapshot()), [selector]);
  return useSyncExternalStore(monitorStore.subscribe, snapshot, snapshot);
}
export function useMonitoringHistory(query: MonitorQuery) {
  const key = JSON.stringify(query), get = useCallback(() => monitorStore.viewSnapshot(key), [key]), subscribe = useCallback((listener: () => void) => monitorStore.subscribeView(key, listener), [key]);
  const history = useSyncExternalStore(subscribe, get, get);
  useEffect(() => {
    let disposed = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (disposed || busy || document.hidden) return; busy = true;
      try { const result = await window.tenda.monitoringHistory(query); if (!disposed && result.ok) monitorStore.install(key, result.data); }
      catch { /* Keep the last valid chart; live events are independent of historical storage. */ }
      finally { busy = false; if (!disposed && chartPeriods[query.period]>900000) { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 30000); } }
    };
    const visibility = () => { if (document.hidden) { if (timer) clearTimeout(timer); } else void load(); };
    void load(); document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [key]);
  return history;
}
