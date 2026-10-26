import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { emptyVolume, volumeBytes, type InventoryDevice, type VolumeTotals, type VolumeSlice, type ObservationQuery, type ObservationReport, type NetworkEvent, type DeviceReport } from '../../shared/observability';
import type { StoredSample } from './database';
import { REPORT_ZONE, resolveRange, dayStart, retentionStart, previousRange } from './calendar';
import { AppError } from '../errors';

const bytes=z.string().regex(/^\d{1,40}$/),positive=z.number().int().nonnegative();
const sliceSchema=z.strictObject({entity:z.string().regex(/^(?:wan|(?:[A-F0-9]{2}:){5}[A-F0-9]{2})$/),basis:z.enum(['measured','estimated']),scope:z.enum(['internet','device']),from:positive,to:positive,coveredMs:positive,onlineMs:positive,measuredUp:bytes,measuredDown:bytes,estimatedUp:bytes,estimatedDown:bytes}).refine(v=>v.to>v.from&&v.to-v.from<=10000&&v.coveredMs<=v.to-v.from&&v.onlineMs<=v.coveredMs);
const totalSchema=z.object({measuredUp:bytes,measuredDown:bytes,estimatedUp:bytes,estimatedDown:bytes,coveredMs:positive,measuredMs:positive,estimatedMs:positive,onlineMs:positive,basis:z.enum(['measured','estimated','mixed','unavailable'])});
const eventSchema=z.object({id:z.string().uuid(),at:positive,kind:z.enum(['new','connected','disconnected','roaming']),mac:z.string().max(17),nodeId:z.string().max(128),message:z.string().max(512)});
const inventorySchema=z.strictObject({mac:z.string().regex(/^(?:[A-F0-9]{2}:){5}[A-F0-9]{2}$/),name:z.string().max(256),ip:z.string().max(256),nodeId:z.string().max(128),nodeName:z.string().max(256),connection:z.string().max(256),firstAt:positive,lastAt:positive,onlineSince:positive.nullable(),online:z.boolean(),ambiguous:z.boolean(),negotiatedMbps:z.number().finite().min(0).max(1e6).nullable(),rssi:z.string().max(32).nullable(),peakUpload:z.number().finite().nonnegative().max(1e12),peakDownload:z.number().finite().nonnegative().max(1e12),volume:totalSchema,misses:positive.optional()});
type Row={at:number;firstAt:number;lastAt:number;values:VolumeTotals};
function basis(v:VolumeTotals){v.basis=v.measuredMs&&v.estimatedMs?'mixed':v.measuredMs?'measured':v.estimatedMs?'estimated':'unavailable';return v;}
export function addVolume(a:VolumeTotals,b:VolumeTotals){for(const k of ['measuredUp','measuredDown','estimatedUp','estimatedDown']as const)a[k]=(BigInt(a[k])+BigInt(b[k])).toString();a.coveredMs+=b.coveredMs;a.onlineMs+=b.onlineMs;a.measuredMs+=b.measuredMs;a.estimatedMs+=b.estimatedMs;return basis(a);}
const decode=(value:unknown)=>totalSchema.parse(JSON.parse(String(value)));

export function migrateNetworkHistory(db:DatabaseSync){
  db.exec(`BEGIN;
    CREATE TABLE IF NOT EXISTS volume_rollups(profile TEXT NOT NULL,entity TEXT NOT NULL,resolution TEXT NOT NULL,bucket INTEGER NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile,entity,resolution,bucket));
    CREATE INDEX IF NOT EXISTS volume_time ON volume_rollups(profile,resolution,bucket);
    CREATE TABLE IF NOT EXISTS inventory(profile TEXT NOT NULL,mac TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile,mac));
    CREATE TABLE IF NOT EXISTS network_events(profile TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,mac TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile,id));
    CREATE INDEX IF NOT EXISTS network_event_time ON network_events(profile,at);
    CREATE TABLE IF NOT EXISTS observation_marks(profile TEXT NOT NULL,epoch TEXT NOT NULL,sequence INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(profile,epoch));
    CREATE TABLE IF NOT EXISTS observation_profiles(profile TEXT PRIMARY KEY,first_at INTEGER NOT NULL);
    PRAGMA user_version=3; COMMIT;`);
}

export class NetworkHistory {
  constructor(private db:DatabaseSync){}
  seen(profile:string,epoch:string,sequence:number){return Number(this.db.prepare('SELECT sequence FROM observation_marks WHERE profile=? AND epoch=?').get(profile,epoch)?.sequence??-1)>=sequence;}
  append(profile:string,sample:StoredSample){
    const {reading,at}=sample,epoch=sample.appendKey?.epoch??'legacy',sequence=sample.appendKey?.sequence??at;
    const mark=this.db.prepare('SELECT sequence FROM observation_marks WHERE profile=? AND epoch=?').get(profile,epoch);
    if(mark&&Number(mark.sequence)>=sequence)return;
    this.db.prepare('INSERT INTO observation_marks(profile,epoch,sequence,at) VALUES(?,?,?,?) ON CONFLICT(profile,epoch) DO UPDATE SET sequence=excluded.sequence,at=excluded.at').run(profile,epoch,sequence,at);
    const first=!this.db.prepare('SELECT first_at FROM observation_profiles WHERE profile=?').get(profile);
    this.db.prepare('INSERT OR IGNORE INTO observation_profiles(profile,first_at) VALUES(?,?)').run(profile,at);
    const get=this.db.prepare('SELECT first_at,last_at,data FROM volume_rollups WHERE profile=? AND entity=? AND resolution=? AND bucket=?');
    const put=this.db.prepare('INSERT INTO volume_rollups(profile,entity,resolution,bucket,first_at,last_at,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(profile,entity,resolution,bucket) DO UPDATE SET first_at=excluded.first_at,last_at=excluded.last_at,data=excluded.data');
    for(const raw of (sample.volumes??[]).slice(0,257)){
      const v=sliceSchema.parse(raw);
      for(const resolution of ['minute','hour','day']as const){
        let cursor=v.from,assigned=emptyVolume();
        while(cursor<v.to){
          const bucket=resolution==='day'?dayStart(cursor):Math.floor(cursor/(resolution==='hour'?3600000:60000))*(resolution==='hour'?3600000:60000);
          const end=Math.min(v.to,bucket+(resolution==='day'?86400000:resolution==='hour'?3600000:60000)),duration=end-cursor,whole=v.to-v.from,last=end===v.to;
          const part=emptyVolume();
          for(const key of ['measuredUp','measuredDown','estimatedUp','estimatedDown']as const)part[key]=(last?BigInt(v[key])-BigInt(assigned[key]):BigInt(v[key])*BigInt(duration)/BigInt(whole)).toString();
          part.coveredMs=last?v.coveredMs-assigned.coveredMs:Math.floor(v.coveredMs*duration/whole);part.onlineMs=last?v.onlineMs-assigned.onlineMs:Math.floor(v.onlineMs*duration/whole);part.measuredMs=v.basis==='measured'?part.coveredMs:0;part.estimatedMs=v.basis==='estimated'?part.coveredMs:0;basis(part);addVolume(assigned,part);
          const old=get.get(profile,v.entity,resolution,bucket),values=old?decode(old.data):emptyVolume();addVolume(values,part);
          put.run(profile,v.entity,resolution,bucket,Math.min(Number(old?.first_at??cursor),cursor),Math.max(Number(old?.last_at??end),end),JSON.stringify(values));cursor=end;
        }
      }
    }
    const known=this.db.prepare('SELECT mac,data FROM inventory WHERE profile=?').all(profile),previous=new Map(known.map(r=>[String(r.mac),inventorySchema.parse(JSON.parse(String(r.data)))]));
    const observed=new Map(reading.clients.map(d=>[d.mac,d]));
    const upsert=this.db.prepare('INSERT INTO inventory(profile,mac,data) VALUES(?,?,?) ON CONFLICT(profile,mac) DO UPDATE SET data=excluded.data');
    const event=(kind:NetworkEvent['kind'],d:InventoryDevice,message:string)=>{const value:NetworkEvent={id:randomUUID(),at,kind,mac:d.mac,nodeId:d.nodeId,message:message.slice(0,512)};this.db.prepare('INSERT INTO network_events(profile,id,at,mac,data) VALUES(?,?,?,?,?)').run(profile,value.id,at,d.mac,JSON.stringify(value));};
    for(const mac of new Set([...previous.keys(),...observed.keys()])){
      const p=previous.get(mac),d=observed.get(mac),online=d?.online===true;
      if(!d&&!p)continue;
      const next:InventoryDevice&{misses:number}={mac,name:d?.name??p!.name,ip:d?.ip||p?.ip||'',nodeId:d?.nodeId||p?.nodeId||'',nodeName:d?.nodeName||p?.nodeName||'',connection:d?.connection??p!.connection,firstAt:p?.firstAt??at,lastAt:online?at:p?.lastAt??at,onlineSince:online?p?.online?p.onlineSince:at:null,online,ambiguous:d?.ambiguous===true,negotiatedMbps:d?.negotiatedMbps??p?.negotiatedMbps??null,rssi:d?.rssi??p?.rssi??null,peakUpload:Math.max(p?.peakUpload??0,online?d!.upload:0),peakDownload:Math.max(p?.peakDownload??0,online?d!.download:0),volume:emptyVolume(),misses:online?0:(p?.misses??0)+1};
      if(!online&&p?.online&&next.misses<2){next.online=true;next.onlineSince=p.onlineSince;}
      if(!first&&!p&&online)event('new',next,`Novo dispositivo observado: ${next.name}`);
      else if(p?.online&&!next.online)event('disconnected',next,`Dispositivo desconectado: ${next.name}`);
      else if(p&&!p.online&&online)event('connected',next,`Dispositivo reconectado: ${next.name}`);
      else if(p?.online&&online&&!next.ambiguous&&!p.ambiguous&&p.nodeId!==next.nodeId)event('roaming',next,`Mudança de nó observada: ${next.name}`);
      upsert.run(profile,mac,JSON.stringify(inventorySchema.parse(next)));
    }
  }
  private rows(profile:string,entity:string,resolution:string,from:number,to:number):Row[]{return this.db.prepare('SELECT bucket,first_at,last_at,data FROM volume_rollups WHERE profile=? AND entity=? AND resolution=? AND bucket>=? AND bucket<? ORDER BY bucket LIMIT 50000').all(profile,entity,resolution,Math.floor(from/(resolution==='day'?86400000:resolution==='hour'?3600000:60000))*(resolution==='day'?86400000:resolution==='hour'?3600000:60000)-86400000,to).filter(r=>Number(r.first_at)>=from&&Number(r.last_at)<=to).map(r=>({at:Number(r.bucket),firstAt:Number(r.first_at),lastAt:Number(r.last_at),values:decode(r.data)}));}
  report(profile:string,input:ObservationQuery,now:number,compare=true):ObservationReport{
    const {from,to}=resolveRange(input,now),age=now-from,resolution=age<=30*86400000&&to-from<=86400000?'minute':age<=90*86400000?'hour':'day',entity=input.deviceMac??'wan';
    if(input.deviceMac&&!this.db.prepare('SELECT mac FROM inventory WHERE profile=? AND mac=?').get(profile,input.deviceMac))throw new AppError('FORBIDDEN','O dispositivo não pertence ao histórico deste roteador.');
    const rows=this.rows(profile,entity,resolution,from,to),totals=rows.reduce((sum,r)=>addVolume(sum,r.values),emptyVolume());
    const inventoryRows=input.deviceMac?this.db.prepare('SELECT data FROM inventory WHERE profile=? AND mac=?').all(profile,input.deviceMac):this.db.prepare('SELECT data FROM inventory WHERE profile=? LIMIT 4096').all(profile);
    const inventory=inventoryRows.map(r=>{const d=inventorySchema.parse(JSON.parse(String(r.data)));const v=this.rows(profile,d.mac,resolution,from,to).reduce((sum,r)=>addVolume(sum,r.values),emptyVolume());return{...d,volume:v};}).sort((a,b)=>volumeBytes(a.volume)>volumeBytes(b.volume)?-1:volumeBytes(a.volume)<volumeBytes(b.volume)?1:a.mac.localeCompare(b.mac));
    let comparison:ObservationReport['comparison']=null;
    const prior=previousRange(input,from,to);
    if(compare&&prior.from>=retentionStart(now)){
      const previous=this.report(profile,{range:'custom',from:prior.from,to:prior.to,...(input.deviceMac?{deviceMac:input.deviceMac}:{})},now,false),coverage=previous.coverage,currentCoverage=Math.min(100,totals.coveredMs/(to-from)*100),denominator=volumeBytes(previous.totals);
      comparison={from:previous.from,to:previous.to,totals:previous.totals,coverage,percent:to-from===prior.to-prior.from&&coverage>=90&&currentCoverage>=90&&denominator>0n?Number((volumeBytes(totals)-denominator)*10000n/denominator)/100:null};
    }
    const eventRows=input.deviceMac?this.db.prepare('SELECT data FROM network_events WHERE profile=? AND mac=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 500').all(profile,input.deviceMac,from,to):this.db.prepare('SELECT data FROM network_events WHERE profile=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 500').all(profile,from,to);
    const events=eventRows.map(r=>eventSchema.parse(JSON.parse(String(r.data))));
    // Bound chart payload by resolution while preserving exact totals and extrema within each bucket.
    const stride=Math.max(1,Math.ceil(rows.length/800)),buckets=[];
    for(let i=0;i<rows.length;i+=stride){const group=rows.slice(i,i+stride),v=group.reduce((sum,r)=>addVolume(sum,r.values),emptyVolume());buckets.push({at:group[0].at,firstAt:group[0].firstAt,lastAt:group.at(-1)!.lastAt,...v});}
    return{scope:input.deviceMac?'device':'internet',from,to,timeZone:REPORT_ZONE,resolution,firstCollectedAt:Number(this.db.prepare('SELECT first_at FROM observation_profiles WHERE profile=?').get(profile)?.first_at)||null,totals,buckets,devices:inventory,events,coverage:Math.min(100,totals.coveredMs/(to-from)*100),unknownMs:Math.max(0,to-from-totals.coveredMs),comparison};
  }
  device(profile:string,query:ObservationQuery&{deviceMac:string},now:number):DeviceReport{const report=this.report(profile,query,now),device=report.devices.find(d=>d.mac===query.deviceMac);if(!device)throw new AppError('FORBIDDEN','Dispositivo não encontrado neste roteador.');return{device,events:report.events,report};}
  maintain(now:number){this.db.prepare("DELETE FROM volume_rollups WHERE (resolution='minute' AND bucket<?) OR (resolution='hour' AND bucket<?) OR (resolution='day' AND bucket<?)").run(now-30*86400000,now-90*86400000,retentionStart(now));this.db.prepare('DELETE FROM network_events WHERE at<?').run(retentionStart(now));this.db.prepare('DELETE FROM observation_marks WHERE at<?').run(now-30*86400000);}
  trimOldest():boolean{for(const resolution of ['minute','hour','day']){const row=this.db.prepare('SELECT MIN(bucket) AS at FROM volume_rollups WHERE resolution=?').get(resolution);if(row?.at!==null&&row?.at!==undefined){this.db.prepare('DELETE FROM volume_rollups WHERE resolution=? AND bucket<?').run(resolution,Number(row.at)+86400000);return true;}}return false;}
}
