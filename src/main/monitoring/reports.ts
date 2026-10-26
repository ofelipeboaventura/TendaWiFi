import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { widgetIds,defaultLayout,emptyVolume,volumeBytes,type WidgetLayout,type ObservationQuery,type IntelligenceReport,type HeatCell,type SavedReport,type VolumeTotals } from '../../shared/observability';
import { NetworkHistory } from './network-history';
import { civil,localTime,dayStart,resolveRange,retentionStart } from './calendar';
import { baseline } from './intelligence';
import { AppError } from '../errors';
export const layoutSchema=z.strictObject({order:z.array(z.enum(widgetIds)).length(widgetIds.length).refine(v=>new Set(v).size===widgetIds.length),hidden:z.array(z.enum(widgetIds)).max(widgetIds.length).refine(v=>new Set(v).size===v.length)});
export const savedIdSchema=z.strictObject({id:z.string().regex(/^(week|month)-\d{10,16}$/)});
const byteString=z.string().regex(/^\d{1,40}$/),num=z.number().finite().nonnegative();
const totalsSchema=z.strictObject({measuredUp:byteString,measuredDown:byteString,estimatedUp:byteString,estimatedDown:byteString,coveredMs:num,measuredMs:num,estimatedMs:num,onlineMs:num,basis:z.enum(['measured','estimated','mixed','unavailable'])});
const savedSchema=z.strictObject({id:z.string().max(32),kind:z.enum(['week','month']),from:num,to:num,createdAt:num,coverage:num.max(100),totals:totalsSchema,availability:num.max(100).nullable(),top:z.array(z.strictObject({mac:z.string().max(17),name:z.string().max(256),bytes:byteString,basis:z.enum(['measured','estimated','mixed','unavailable'])})).max(10),days:z.array(totalsSchema.extend({at:num,firstAt:num,lastAt:num})).max(32)});
const decode=(raw:unknown)=>totalsSchema.parse(JSON.parse(String(raw)));
export function migrateReports(db:DatabaseSync){db.exec(`BEGIN;CREATE TABLE IF NOT EXISTS saved_reports(profile TEXT NOT NULL,id TEXT NOT NULL,from_at INTEGER NOT NULL,to_at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile,id));CREATE TABLE IF NOT EXISTS widget_layout(profile TEXT PRIMARY KEY,data TEXT NOT NULL);PRAGMA user_version=5;COMMIT;`);}
function weekStart(at:number){const p=civil(at),weekday=new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay();return localTime(p.year,p.month,p.day-(weekday+6)%7);}
export class ReportEngine {
  constructor(private db:DatabaseSync,private network:NetworkHistory){}
  private rows(profile:string,entity:string,resolution:string,from:number,to:number){return this.db.prepare('SELECT bucket,first_at,last_at,data FROM volume_rollups WHERE profile=? AND entity=? AND resolution=? AND bucket>=? AND bucket<? ORDER BY bucket').all(profile,entity,resolution,from,to).map(r=>({at:Number(r.bucket),firstAt:Number(r.first_at),lastAt:Number(r.last_at),values:decode(r.data)}));}
  intelligence(profile:string,query:ObservationQuery,now:number):IntelligenceReport{
    const report=this.network.report(profile,query,now,false),entity=query.deviceMac??'wan',today=dayStart(now),p=civil(now),monthFrom=localTime(p.year,p.month,1),monthTo=localTime(p.year,p.month+1,1);
    const reference=this.rows(profile,'wan','day',today-7*86400000,today),days=reference.filter(r=>r.values.coveredMs>=86400000*.8).length;
    const minutes=this.rows(profile,'wan','minute',today-7*86400000,today),groups=new Map<number,{covered:number;up:bigint;down:bigint}>();
    for(const row of minutes){const key=Math.floor(row.at/300000)*300000,g=groups.get(key)??{covered:0,up:0n,down:0n};g.covered+=row.values.coveredMs;g.up+=BigInt(row.values.measuredUp)+BigInt(row.values.estimatedUp);g.down+=BigInt(row.values.measuredDown)+BigInt(row.values.estimatedDown);groups.set(key,g);}
    const valid=[...groups.values()].filter(g=>g.covered>=240000),referenceStats=baseline(valid.map(g=>Number(g.up)/(g.covered/1000)),valid.map(g=>Number(g.down)/(g.covered/1000)),days,now);
    const hours=this.rows(profile,entity,'hour',Math.max(Math.floor(report.from/3600000)*3600000,now-90*86400000),report.to),heatmap=new Map<string,HeatCell>();
    for(const row of hours){if(row.firstAt<report.from||row.lastAt>report.to)continue;const c=civil(row.at),weekday=(new Date(Date.UTC(c.year,c.month-1,c.day)).getUTCDay()+6)%7,key=weekday+':'+c.hour,cell=heatmap.get(key)??{weekday,hour:c.hour,bytes:'0',coveredMs:0,measuredBytes:'0',estimatedBytes:'0'};cell.bytes=(BigInt(cell.bytes)+volumeBytes(row.values)).toString();cell.measuredBytes=(BigInt(cell.measuredBytes)+BigInt(row.values.measuredUp)+BigInt(row.values.measuredDown)).toString();cell.estimatedBytes=(BigInt(cell.estimatedBytes)+BigInt(row.values.estimatedUp)+BigInt(row.values.estimatedDown)).toString();cell.coveredMs+=row.values.coveredMs;heatmap.set(key,cell);}
    const eligible=this.rows(profile,entity,'day',monthFrom,today).filter(r=>r.values.coveredMs>=86400000*.9),observed=this.rows(profile,entity,'day',dayStart(report.from),report.to).filter(r=>r.firstAt>=report.from&&r.lastAt<=report.to&&r.values.coveredMs>0),sum=eligible.reduce((n,r)=>n+volumeBytes(r.values),0n);
    return{scope:report.scope,baseline:referenceStats,heatmap:[...heatmap.values()],heatmapFrom:Math.max(report.from,now-90*86400000),dailyMeanBytes:observed.length?(observed.reduce((n,r)=>n+volumeBytes(r.values),0n)/BigInt(observed.length)).toString():null,projection:{eligibleDays:eligible.length,monthlyBytes:eligible.length>=7?(sum*BigInt(Math.round((monthTo-monthFrom)/86400000))/BigInt(eligible.length)).toString():null,monthFrom,monthTo}};
  }
  layout(profile:string){const row=this.db.prepare('SELECT data FROM widget_layout WHERE profile=?').get(profile);return row?layoutSchema.parse(JSON.parse(String(row.data))):defaultLayout();}
  saveLayout(profile:string,input:WidgetLayout){const layout=layoutSchema.parse(input);this.db.prepare('INSERT INTO widget_layout(profile,data) VALUES(?,?) ON CONFLICT(profile) DO UPDATE SET data=excluded.data').run(profile,JSON.stringify(layout));return layout;}
  list(profile:string){return this.db.prepare('SELECT data FROM saved_reports WHERE profile=? ORDER BY to_at DESC LIMIT 160').all(profile).map(r=>savedSchema.parse(JSON.parse(String(r.data))));}
  get(profile:string,id:string){savedIdSchema.parse({id});const row=this.db.prepare('SELECT data FROM saved_reports WHERE profile=? AND id=?').get(profile,id);if(!row)throw new AppError('FORBIDDEN','O relatório não pertence a este roteador.');return savedSchema.parse(JSON.parse(String(row.data)));}
  generate(profile:string,now:number){
    const first=this.db.prepare('SELECT first_at FROM observation_profiles WHERE profile=?').get(profile);if(!first)return;
    const start=Math.max(Number(first.first_at),retentionStart(now)),p=civil(start),periods:{kind:'week'|'month';from:number;to:number}[]=[];
    for(let from=weekStart(start),i=0;i<110;i++,from+=7*86400000){const to=from+7*86400000;if(to>now)break;if(to>Number(first.first_at))periods.push({kind:'week',from,to});}
    for(let i=0;i<25;i++){const from=localTime(p.year,p.month+i,1),to=localTime(p.year,p.month+i+1,1);if(to>now)break;if(to>Number(first.first_at))periods.push({kind:'month',from,to});}
    let created=0;
    for(const period of periods.sort((a,b)=>b.to-a.to)){if(created>=4)break;const id=period.kind+'-'+period.from;if(period.from<retentionStart(now)||this.db.prepare('SELECT id FROM saved_reports WHERE profile=? AND id=?').get(profile,id))continue;const report=this.network.report(profile,{range:'custom',from:period.from,to:period.to},now,false);if(!report.totals.coveredMs)continue;
      const days=this.rows(profile,'wan','day',period.from,period.to).map(r=>({at:r.at,firstAt:r.firstAt,lastAt:r.lastAt,...r.values}));
      const value:SavedReport={id,...period,createdAt:now,coverage:report.coverage,totals:report.totals,availability:report.totals.coveredMs?report.totals.onlineMs/report.totals.coveredMs*100:null,top:report.devices.filter(d=>d.volume.coveredMs>0).slice(0,10).map(d=>({mac:d.mac,name:d.name,bytes:volumeBytes(d.volume).toString(),basis:d.volume.basis})),days};
      this.db.prepare('INSERT OR IGNORE INTO saved_reports(profile,id,from_at,to_at,data) VALUES(?,?,?,?,?)').run(profile,id,period.from,period.to,JSON.stringify(savedSchema.parse(value)));created++;
    }
  }
  maintain(now:number){this.db.prepare('DELETE FROM saved_reports WHERE to_at<?').run(retentionStart(now));}
}
