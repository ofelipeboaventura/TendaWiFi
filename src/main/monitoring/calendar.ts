import { z } from 'zod';
import { reportRanges, type ObservationQuery } from '../../shared/observability';
import { AppError } from '../errors';
export const REPORT_ZONE='America/Bahia' as const;
export const observationSchema=z.strictObject({range:z.enum(reportRanges),from:z.number().int().nonnegative().optional(),to:z.number().int().nonnegative().optional(),deviceMac:z.string().regex(/^(?:[A-F0-9]{2}:){5}[A-F0-9]{2}$/).optional()}).superRefine((v,c)=>{if(v.range==='custom'?v.from===undefined||v.to===undefined:v.from!==undefined||v.to!==undefined)c.addIssue({code:'custom',message:'Informe limites apenas para um intervalo personalizado.'});});
export { civil,localTime } from '../../shared/report-time';
import { civil,localTime } from '../../shared/report-time';
export function dayStart(at:number){const p=civil(at);return localTime(p.year,p.month,p.day);}
export function retentionStart(at:number){const p=civil(at);return localTime(p.year,p.month-24,1);}
export function previousRange(query:ObservationQuery,from:number,to:number){const p=civil(from),duration=to-from;switch(query.range){case'today':case'yesterday':return{from:localTime(p.year,p.month,p.day-1),to:localTime(p.year,p.month,p.day-1)+duration};case'month':case'lastMonth':{const start=localTime(p.year,p.month-1,1);return{from:start,to:Math.min(from,start+duration)};}case'year':{const start=localTime(p.year-1,1,1);return{from:start,to:Math.min(from,start+duration)};}default:return{from:from-duration,to:from};}}
export function resolveRange(input:ObservationQuery,now:number){const query=observationSchema.parse(input),p=civil(now),today=dayStart(now);let from:number,to=now;
  switch(query.range){case'today':from=today;break;case'yesterday':from=localTime(p.year,p.month,p.day-1);to=today;break;case'7d':from=now-7*86400000;break;case'month':from=localTime(p.year,p.month,1);break;case'lastMonth':from=localTime(p.year,p.month-1,1);to=localTime(p.year,p.month,1);break;case'year':from=localTime(p.year,1,1);break;case'custom':from=query.from!;to=query.to!;break;}
  if(!Number.isFinite(from)||to<=from||to>now||from<retentionStart(now)||to-from>733*86400000)throw new AppError('VALIDATION','O intervalo deve estar nos últimos 24 meses, terminar até agora e ter duração positiva.');
  return{from,to};
}
