import { useEffect, useState } from 'react';
import { monitorStore } from './store';
import { emptyVolume, type ObservationQuery, type ObservationReport, type VolumeTotals } from '../../shared/observability';
import type { ChartFrame } from '../../shared/monitoring';

function sum(a:VolumeTotals,b:VolumeTotals){const v={...a};for(const k of ['measuredUp','measuredDown','estimatedUp','estimatedDown']as const)v[k]=(BigInt(v[k])+BigInt(b[k])).toString();v.coveredMs+=b.coveredMs;v.onlineMs+=b.onlineMs;v.measuredMs+=b.measuredMs;v.estimatedMs+=b.estimatedMs;v.basis=v.measuredMs&&v.estimatedMs?'mixed':v.measuredMs?'measured':v.estimatedMs?'estimated':'unavailable';return v;}
export function appendObservation(report:ObservationReport,frame:ChartFrame,query:ObservationQuery):ObservationReport{
  if(!report.watermark||frame.epoch!==report.watermark.epoch||frame.sequence<=report.watermark.sequence)return report;
  if(!['today','month','year'].includes(query.range)||!frame.volumes?.length)return{...report,watermark:{epoch:frame.epoch,sequence:frame.sequence}};
  const to=Math.max(report.to,frame.point?.at??frame.at),entity=query.deviceMac??'wan';
  let totals=report.totals,buckets=report.buckets.slice(),devices=report.devices;
  for(const slice of frame.volumes){if(slice.from<report.from||slice.to>to)continue;const value:VolumeTotals={...emptyVolume(),...slice,measuredMs:slice.basis==='measured'?slice.coveredMs:0,estimatedMs:slice.basis==='estimated'?slice.coveredMs:0};
    if(slice.entity===entity){totals=sum(totals,value);const last=buckets.at(-1);if(last&&slice.from>=last.firstAt&&slice.from-last.at<60000){buckets[buckets.length-1]={...sum(last,value),at:last.at,firstAt:last.firstAt,lastAt:slice.to};}else buckets.push({...value,at:Math.floor(slice.from/60000)*60000,firstAt:slice.from,lastAt:slice.to});}
    if(slice.entity!=='wan')devices=devices.map(d=>d.mac===slice.entity?{...d,volume:sum(d.volume,value)}:d);
  }
  return{...report,to,totals,devices,buckets:buckets.slice(-800),coverage:Math.min(100,totals.coveredMs/Math.max(1,to-report.from)*100),unknownMs:Math.max(0,to-report.from-totals.coveredMs),watermark:{epoch:frame.epoch,sequence:frame.sequence}};
}
export function useObservation(query:ObservationQuery){
  const key=JSON.stringify(query),[view,setView]=useState<{key:string;report:ObservationReport|null;error:string}>({key,report:null,error:''});
  useEffect(()=>{
    let disposed=false,busy=false,current:ObservationReport|null=null,timer:ReturnType<typeof setTimeout>;
    const publish=()=>{if(!disposed&&!document.hidden)setView({key,report:current,error:''});};
    const update=()=>{const frame=monitorStore.getSnapshot()?.chart;if(current&&frame&&frame.epoch===current.watermark?.epoch){const next=appendObservation(current,frame,query);if(next!==current){current=next;if(frame.volumes?.length)publish();}}};
    const load=async()=>{if(disposed||busy||document.hidden)return;busy=true;try{const result=await window.tenda.observationReport(query);if(!disposed){if(!result.ok){setView({key,report:current,error:result.error.message});return;}if(result.data.watermark?.epoch!==monitorStore.getSnapshot()?.chart?.epoch)return;current=result.data;for(const f of monitorStore.framesAfter(current.watermark!))current=appendObservation(current,f,query);publish();}}catch{if(!disposed)setView({key,report:current,error:'Não foi possível consultar o histórico.'});}finally{busy=false;}};
    const visible=()=>{if(!document.hidden)void load();};const unsubscribe=monitorStore.subscribe(update);void load();timer=setInterval(()=>void load(),30000);document.addEventListener('visibilitychange',visible);
    return()=>{disposed=true;clearInterval(timer);unsubscribe();document.removeEventListener('visibilitychange',visible);};
  },[key]);
  return view.key===key?view:{key,report:null,error:''};
}
