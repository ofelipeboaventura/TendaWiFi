import type { ObservationReport } from '../../shared/observability';
import { csv } from './metrics';
export function exportObservation(kind:'volumes'|'inventory'|'events',report:ObservationReport){
  if(kind==='inventory')return csv([['MAC','Nome','IP','No','Primeira observacao UTC','Ultima observacao UTC','Pico upload bytes/s','Pico download bytes/s','Upload medido bytes','Download medido bytes','Upload estimado bytes','Download estimado bytes','Origem','Cobertura ms'],...report.devices.map(d=>[d.mac,d.name,d.ip,d.nodeName,new Date(d.firstAt).toISOString(),new Date(d.lastAt).toISOString(),d.peakUpload,d.peakDownload,d.volume.measuredUp,d.volume.measuredDown,d.volume.estimatedUp,d.volume.estimatedDown,d.volume.basis,d.volume.coveredMs])]);
  if(kind==='events')return csv([['Horario UTC','Tipo','MAC','No','Evento'],...report.events.map(e=>[new Date(e.at).toISOString(),e.kind,e.mac,e.nodeId,e.message])]);
  return csv([['Inicio UTC','Fim UTC','Upload medido bytes','Download medido bytes','Upload estimado bytes','Download estimado bytes','Origem','Cobertura ms','Escopo'],...report.buckets.map(b=>[new Date(b.firstAt).toISOString(),new Date(b.lastAt).toISOString(),b.measuredUp,b.measuredDown,b.estimatedUp,b.estimatedDown,b.basis,b.coveredMs,report.scope])]);
}
