import type { MonitorReading, CounterDelta } from '../../shared/monitoring';
import type { VolumeSlice } from '../../shared/observability';

export const trafficGap = (intervalMs: number) => Math.max(3500,intervalMs*1.5);
interface Rate { up:number; down:number; online:boolean; ambiguous:boolean; scope:'internet'|'device' }
interface Previous { wall:number; mono:number; rates:Map<string,Rate> }
/** Integrate only two authenticated, valid observations. Never extrapolate missing time. */
export class VolumeTracker {
  private previous?:Previous;
  private remainders=new Map<string,bigint>();
  clear(){this.previous=undefined;this.remainders.clear();}
  update(reading:MonitorReading,wall:number,mono:number,intervalMs:number,allowEstimates:boolean,deltas:CounterDelta[]):VolumeSlice[]{
    const rates=new Map<string,Rate>([['wan',{up:reading.overview.upload,down:reading.overview.download,online:reading.overview.internet,ambiguous:false,scope:'internet'}],...reading.clients.map(d=>[d.mac,{up:d.upload,down:d.download,online:d.online,ambiguous:d.ambiguous===true,scope:'device'}] as [string,Rate])]);
    const previous=this.previous;this.previous={wall,mono,rates};if(!previous)return[];
    const dt=Math.round(mono-previous.mono),wallDt=wall-previous.wall;
    if(dt<=0||wallDt<=0||dt>trafficGap(intervalMs)||Math.abs(dt-wallDt)>1000){this.remainders.clear();return[];}
    const result:VolumeSlice[]=[];
    for(const[entity,rate]of rates){const before=previous.rates.get(entity);if(!before||rate.ambiguous||before.ambiguous||rate.online!==before.online||entity!=='wan'&&!rate.online)continue;
      if(![before.up,before.down,rate.up,rate.down].every(v=>Number.isFinite(v)&&v>=0&&v<=1e12))continue;
      const real=deltas.find(d=>d.id===entity&&d.scope===rate.scope);
      if(!real&&!allowEstimates)continue;
      const estimate=(key:'up'|'down')=>{const id=entity+':'+key,denominator=2000000n;const value=(BigInt(Math.round(before[key]*1000))+BigInt(Math.round(rate[key]*1000)))*BigInt(dt)+(this.remainders.get(id)??0n);this.remainders.set(id,value%denominator);return(value/denominator).toString();};
      if(real){this.remainders.delete(entity+':up');this.remainders.delete(entity+':down');}
      result.push({entity,basis:real?'measured':'estimated',scope:rate.scope,from:previous.wall,to:wall,coveredMs:Math.min(dt,wallDt),onlineMs:rate.online?Math.min(dt,wallDt):0,measuredUp:real?.upload??'0',measuredDown:real?.download??'0',estimatedUp:real?'0':estimate('up'),estimatedDown:real?'0':estimate('down')});
    }
    return result;
  }
}
