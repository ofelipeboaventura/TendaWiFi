import type { MonitorExport, MonitoringHistory } from '../../shared/monitoring';
import { csv } from './metrics';
export function exportHistory(query: MonitorExport, history: MonitoringHistory) {
  const iso = (n: number) => new Date(n).toISOString();
  if (query.kind === 'resources') return csv([['Horário UTC de observação', 'Nó', 'CPU %', 'Memória %', 'Origem'], ...(history.resources ?? []).map(r=>[iso(r.at),r.nodeId,r.cpu,r.memory,'Diagnóstico do roteador'])]);
  if (query.kind === 'events') return csv([['Horário UTC', 'Categoria', 'Severidade', 'Estado', 'Destino', 'Evento', 'Duração ms'], ...history.events.map(e => [iso(e.at), e.category, e.severity, e.state, e.target, e.message, e.durationMs])]);
  if (query.kind === 'devices') return csv([['MAC', 'Nome', 'Amostras', 'Upload médio bytes/s', 'Download médio bytes/s', 'Pico upload bytes/s', 'Pico download bytes/s', 'Upload medido bytes', 'Download medido bytes', 'Escopo'], ...history.devices.map(d => [d.mac, d.name, d.samples, d.meanUpload, d.meanDownload, d.peakUpload, d.peakDownload, d.uploadBytes ?? 'Indisponível', d.downloadBytes ?? 'Indisponível', d.scope])]);
  if (query.kind === 'quality') return csv([['Destino', 'Sondas', 'Respostas', 'Latência média ms', 'p95 ms', 'Variação ms', 'Perda ICMP %'], ...history.quality.map(q => [q.target, q.samples, q.received, q.mean, q.p95, q.jitter, q.loss])]);
  return csv([['Horário UTC', 'Upload bytes/s', 'Download bytes/s', 'Internet', 'Uptime segundos', 'CPU %', 'Memória %', 'Latência ms'], ...history.points.map(p => [iso(p.at), p.upload, p.download, p.online ? 'Conectada' : 'Desconectada', p.uptime, p.cpu, p.memory, p.latency])]);
}
