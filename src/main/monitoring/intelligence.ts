import type { TrafficBaseline,BottleneckInsight } from '../../shared/observability';
import type { MonitoringState } from '../../shared/monitoring';
export function median(values:number[]){const sorted=values.slice().sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length?(sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2):0;}
export function baseline(up:number[],down:number[],days:number,at:number):TrafficBaseline{const medianUp=median(up),medianDown=median(down);return{ready:days>=7&&up.length>0&&down.length>0,days,medianUp,medianDown,madUp:median(up.map(v=>Math.abs(v-medianUp))),madDown:median(down.map(v=>Math.abs(v-medianDown))),sampledAt:at};}
export function isAnomaly(value:number,reference:TrafficBaseline,direction:'up'|'down'){if(!reference.ready||!Number.isFinite(value))return null;const m=direction==='up'?reference.medianUp:reference.medianDown,mad=direction==='up'?reference.madUp:reference.madDown;return value>=1250000&&value>m*2&&value>m+6*mad;}
export class BottleneckTracker {
  private candidate?:{kind:'local'|'saturation';since:number;last:number};
  clear(){this.candidate=undefined;}
  observe(state:MonitoringState,at:number,maxGap:number):BottleneckInsight[]{
    const fresh=state.status==='collecting'&&state.sampledAt!==null&&at-state.sampledAt<=maxGap;if(!fresh){this.clear();return[];}
    const s=state.settings,o=state.overview;if(!o)return[];
    const saturation=(s.downloadMbps!==null&&o.download*8/(s.downloadMbps*1e6)*100>s.saturationPercent)||(s.uploadMbps!==null&&o.upload*8/(s.uploadMbps*1e6)*100>s.saturationPercent);
    const outside=state.quality.filter(q=>['1.1.1.1','8.8.8.8'].includes(q.target)&&q.lastAt!==null&&at-q.lastAt<15000),gateway=state.quality.find(q=>!['1.1.1.1','8.8.8.8'].includes(q.target));
    const degraded=outside.some(q=>q.mean!==null&&q.mean>s.latencyMs||q.samples>=30&&q.loss!==null&&q.loss>s.lossPercent),local=!!gateway?.lastAt&&at-gateway.lastAt<15000&&gateway.mean!==null&&gateway.mean>10;
    const kind=local&&degraded?'local':saturation&&degraded?'saturation':null;if(!kind){this.clear();return[];}
    if(!this.candidate||this.candidate.kind!==kind||at-this.candidate.last>maxGap)this.candidate={kind,since:at,last:at};this.candidate.last=at;if(at-this.candidate.since<30000)return[];
    const devices=state.clients.filter(d=>d.online&&!d.ambiguous).sort((a,b)=>b.upload+b.download-a.upload-a.download).slice(0,3).map(d=>({mac:d.mac,name:d.name,upload:d.upload,download:d.download}));
    return[{kind,since:this.candidate.since,message:kind==='local'?'Indícios de atraso na rede local, coincidentes com degradação externa.':'Indícios de saturação do link coincidentes com aumento de latência ou perda.',evidence:[local?'Latência até o roteador acima de 10 ms.':'Latência/perda externa acima dos limites configurados.',saturation?'Utilização próxima da capacidade contratada.':'A capacidade contratada não indica saturação.'],devices}];
  }
}
