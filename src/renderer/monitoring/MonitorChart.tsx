import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChartSample, MonitoringPeriod, MonitorPoint, ResourceSample } from '../../shared/monitoring';
import { chartPeriods, nearestSample, niceMaximum } from '../../shared/chart';
import { makeSeries, prepareSeries, StableScale, type ChartKind, type PlotSeries } from './chart-model';

const numberFormat=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
const timeFormat=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'});
const longFormat=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const exactFormat=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const HEIGHT=230,LEFT=48,RIGHT=15,TOP=14,BOTTOM=28;
const labels={traffic:'Histórico de velocidades de download e upload',resources:'Histórico de CPU e memória',latency:'Histórico de latência'};
export interface MonitorChartProps {points:readonly MonitorPoint[];kind?:ChartKind;period?:MonitoringPeriod;live?:boolean;latencySamples?:readonly ChartSample[];resourceSamples?:readonly ResourceSample[];onPaint?:(milliseconds:number)=>void}

export const MonitorChart=memo(function MonitorChart({points,kind='traffic',period='5m',live=true,latencySamples,resourceSamples,onPaint}:MonitorChartProps){
  const series=useMemo(()=>makeSeries(points,kind,period,latencySamples,resourceSamples),[points,kind,period,latencySamples,resourceSamples]);
  const hasValues=useMemo(()=>series.some(s=>s.samples.some(p=>p.value!==null)),[series]);
  const stack=useRef<HTMLDivElement>(null),grid=useRef<HTMLCanvasElement>(null),lines=useRef<HTMLCanvasElement>(null),interaction=useRef<HTMLCanvasElement>(null),tooltip=useRef<HTMLDivElement>(null),range=useRef<HTMLInputElement>(null);
  const latest=useRef({series,kind,period,live,hasValues,onPaint});latest.current={series,kind,period,live,hasValues,onPaint};
  const controller=useRef<{update:()=>void;pointer:(x:number|null)=>void;select:(index:number)=>void}|null>(null);
  const [fallback,setFallback]=useState(false);
  useLayoutEffect(()=>{controller.current?.update();},[series,period,kind,live]);
  useEffect(()=>{
    if(fallback)return;
    const element=stack.current!,canvases=[grid.current!,lines.current!,interaction.current!],contexts=canvases.map(c=>c.getContext('2d'));
    if(contexts.some(c=>!c)){setFallback(true);return;}
    const [bg,plot,overlay]=contexts as CanvasRenderingContext2D[];
    let width=900,raf=0,lastDraw=-Infinity,dirty=true,rect:DOMRect|null=null,pointerFraction:number|null=null,selectedAt:number|null=null,prepared:PlotSeries[]=[],oldSeries:readonly PlotSeries[]|null=null,oldWidth=0,peakSecond=-1,peakTarget=1,gridKey='',tooltipKey='',freezeEnd=Date.now();
    let utc=Date.now(),mono=performance.now();const scale=new StableScale(),motion=matchMedia('(prefers-reduced-motion: reduce)');
    const now=()=>utc+(performance.now()-mono);
    const request=()=>{if(!raf&&!document.hidden)raf=requestAnimationFrame(tick);};
    const resize=()=>{width=Math.max(120,element.clientWidth);const dpr=Math.min(2,window.devicePixelRatio||1);for(let i=0;i<canvases.length;i++){canvases[i].width=Math.round(width*dpr);canvases[i].height=Math.round(HEIGHT*dpr);contexts[i]!.setTransform(dpr,0,0,dpr,0,0);}rect=null;gridKey='';dirty=true;request();};
    const draw=(at:number)=>{
      const started=performance.now(),data=latest.current,span=chartPeriods[data.period],end=data.live&&!motion.matches?now():freezeEnd,from=end-span,plotWidth=width-LEFT-RIGHT,plotHeight=HEIGHT-TOP-BOTTOM;
      if(oldSeries!==data.series||oldWidth!==width){prepared=prepareSeries(data.series,plotWidth);oldSeries=data.series;oldWidth=width;peakSecond=-1;}
      if(peakSecond!==Math.floor(end/1000)){peakSecond=Math.floor(end/1000);let peak=0;for(const series of data.series)for(const sample of series.samples)if(sample.at>=from&&sample.at<=end&&sample.value!==null)peak=Math.max(peak,sample.value);peakTarget=niceMaximum(Math.max(1,peak*1.12));}
      const maximum=data.kind==='resources'?100:scale.update(peakTarget,at);
      const x=(stamp:number)=>LEFT+(stamp-from)/span*plotWidth,y=(value:number)=>TOP+(1-value/maximum)*plotHeight;
      const unit=data.kind==='traffic'?'Mbps':data.kind==='resources'?'%':'ms';
      const nextGrid=`${width}:${maximum}:${data.kind}:${data.period}:${Math.floor(end/1000)}`;
      if(nextGrid!==gridKey){gridKey=nextGrid;bg.clearRect(0,0,width,HEIGHT);bg.font='10px sans-serif';bg.fillStyle='#8291a8';bg.strokeStyle='#2b3544';bg.lineWidth=1;bg.setLineDash([3,5]);for(const n of [0,.25,.5,.75,1]){bg.beginPath();bg.moveTo(LEFT,y(maximum*n));bg.lineTo(width-RIGHT,y(maximum*n));bg.stroke();bg.textAlign='right';bg.fillText(numberFormat.format(maximum*n),LEFT-10,y(maximum*n)+4);}bg.textAlign='left';bg.fillText(unit,3,10);for(const n of [0,.5,1]){bg.textAlign=n===0?'left':n===1?'right':'center';bg.fillText((span>86400000?longFormat:timeFormat).format(from+n*span),LEFT+n*plotWidth,HEIGHT-6);}}
      plot.clearRect(0,0,width,HEIGHT);plot.save();plot.beginPath();plot.rect(LEFT,TOP,plotWidth,plotHeight+1);plot.clip();plot.lineWidth=2.3;plot.lineJoin='round';plot.setLineDash([]);
      for(const s of prepared){plot.strokeStyle=s.color;plot.fillStyle=s.color;plot.beginPath();let connected=false,count=0,last:ChartSample|undefined;
        const dot=()=>{if(count===1&&last){plot.moveTo(x(last.at)+1.6,y(last.value!));plot.arc(x(last.at),y(last.value!),1.6,0,Math.PI*2);}count=0;};
        for(let i=0;i<s.samples.length;i++){const sample=s.samples[i];if(sample.at>end)break;if(sample.at<from&&s.samples[i+1]?.at<from)continue;if(sample.value===null){dot();connected=false;last=undefined;continue;}if(sample.breakBefore){dot();connected=false;}if(connected)plot.lineTo(x(sample.at),y(sample.value));else plot.moveTo(x(sample.at),y(sample.value));connected=true;count++;last=sample;}dot();plot.stroke();
      }plot.restore();
      overlay.clearRect(0,0,width,HEIGHT);const samples=data.series[0]?.samples??[];let index=-1;
      if(pointerFraction!==null)index=nearestSample(samples,from+pointerFraction*span);else if(selectedAt!==null)index=nearestSample(samples,selectedAt);
      const active=index>=0?samples[index]:undefined;
      if(active&&active.at>=from&&active.at<=end){overlay.strokeStyle='#c5d0df';overlay.lineWidth=1;overlay.setLineDash([3,3]);overlay.beginPath();overlay.moveTo(x(active.at),TOP);overlay.lineTo(x(active.at),HEIGHT-BOTTOM);overlay.stroke();
        const key=`${active.at}:${data.series.map(s=>s.samples[nearestSample(s.samples,active.at)]?.value).join(':')}`;
        if(key!==tooltipKey){tooltipKey=key;const tip=tooltip.current!;tip.querySelector('strong')!.textContent=exactFormat.format(active.at);data.series.forEach((s,i)=>{const row=tip.querySelectorAll('span')[i],sample=s.samples[nearestSample(s.samples,active.at)];if(row)row.textContent=`${s.name}: ${sample?.value==null?'Sem dado':numberFormat.format(sample.value)+' '+unit}`;});range.current?.setAttribute('aria-valuetext',exactFormat.format(active.at));if(range.current)range.current.value=String(index);}
        if(tooltip.current!.hidden)tooltip.current!.hidden=false;
      }else if(!tooltip.current!.hidden)tooltip.current!.hidden=true;
      if(lines.current!.dataset.painted!=='true')lines.current!.dataset.painted='true';data.onPaint?.(performance.now()-started);
    };
    function tick(at:number){raf=0;if(document.hidden)return;const data=latest.current,continuous=data.live&&data.hasValues&&!motion.matches;
      if((dirty||continuous)&&at-lastDraw>=1000/60){draw(at);dirty=false;lastDraw=at-(Math.max(0,at-lastDraw)%(1000/60)||0);}
      if(continuous||dirty)request();
    }
    let priorEmpty=false,priorKind=latest.current.kind,priorPeriod=latest.current.period;
    const update=()=>{const data=latest.current;if(priorEmpty&&!data.hasValues&&data.kind===priorKind&&data.period===priorPeriod)return;priorEmpty=!data.hasValues;priorKind=data.kind;priorPeriod=data.period;if(Math.abs(Date.now()-now())>3500){utc=Date.now();mono=performance.now();}freezeEnd=Date.now();dirty=true;request();};
    controller.current={update,pointer:(clientX)=>{if(!latest.current.hasValues)return;if(clientX===null){pointerFraction=null;selectedAt=null;}else{rect??=element.getBoundingClientRect();pointerFraction=Math.max(0,Math.min(1,(clientX-rect.left-LEFT)/(width-LEFT-RIGHT)));selectedAt=null;}dirty=true;request();},select:(index)=>{pointerFraction=null;selectedAt=latest.current.series[0]?.samples[index]?.at??null;dirty=true;request();}};
    const visibility=()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else{utc=Date.now();mono=performance.now();update();}};
    const scroll=()=>{rect=null;};const observer=new ResizeObserver(resize);observer.observe(element);document.addEventListener('visibilitychange',visibility);window.addEventListener('scroll',scroll,true);motion.addEventListener('change',update);resize();
    return()=>{cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('scroll',scroll,true);motion.removeEventListener('change',update);controller.current=null;};
  },[fallback]);
  const unit=kind==='traffic'?'Mbps':kind==='resources'?'%':'ms';
  if(fallback)return <StaticChart series={series} kind={kind} period={period}/>;
  return <div className="monitor-chart"><div className="monitor-canvas-stack" ref={stack} role="img" aria-label={`${labels[kind]}. Janela de ${chartPeriods[period]/60000} minutos; valores medidos e lacunas preservados.`} onMouseMove={e=>controller.current?.pointer(e.clientX)} onMouseLeave={()=>controller.current?.pointer(null)}><canvas ref={grid} aria-hidden="true" className="monitor-grid-layer"/><canvas ref={lines} aria-hidden="true" className="monitor-series-layer"/><canvas ref={interaction} aria-hidden="true" className="monitor-interaction-layer"/></div>{!hasValues&&<div className="monitor-chart-empty">{kind==='resources'?'Métricas contínuas não disponibilizadas pelo firmware':'Aguardando amostras válidas deste período'}</div>}<div className="monitor-chart-tooltip" ref={tooltip} hidden><strong/>{series.map(s=><span key={s.name} style={{color:s.color}}/>)}</div>{hasValues&&series[0]?.samples.length>0&&<input ref={range} className="monitor-chart-range" type="range" aria-label={`Explorar amostra do gráfico em ${unit}`} min={0} max={series[0].samples.length-1} defaultValue={series[0].samples.length-1} onFocus={()=>controller.current?.select(Number(range.current?.value??0))} onChange={e=>controller.current?.select(Number(e.target.value))}/>}</div>;
});

function StaticChart({series,kind,period}:{series:PlotSeries[];kind:ChartKind;period:MonitoringPeriod}){
  const clipId=useId(),[index,setIndex]=useState<number|null>(null),end=Date.now(),span=chartPeriods[period],maximum=kind==='resources'?100:niceMaximum(Math.max(1,...series.flatMap(s=>s.samples.map(p=>p.value??0)))*1.12),x=(at:number)=>LEFT+(at-(end-span))/span*(900-LEFT-RIGHT),y=(v:number)=>TOP+(1-v/maximum)*(HEIGHT-TOP-BOTTOM),unit=kind==='traffic'?'Mbps':kind==='resources'?'%':'ms';
  return <div className="monitor-chart"><svg viewBox={`0 0 900 ${HEIGHT}`} role="img" aria-label={`${labels[kind]} — alternativa estática`} onMouseMove={e=>{const rect=e.currentTarget.getBoundingClientRect();setIndex(nearestSample(series[0]?.samples??[],end-span+Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*900-LEFT)/(900-LEFT-RIGHT)))*span));}}><defs><clipPath id={clipId}><rect x={LEFT} y={TOP} width={900-LEFT-RIGHT} height={HEIGHT-TOP-BOTTOM}/></clipPath></defs>{[0,.25,.5,.75,1].map(n=><g key={n}><line x1={LEFT} x2={900-RIGHT} y1={y(maximum*n)} y2={y(maximum*n)} stroke="#2b3544" strokeDasharray="3 5"/><text x={LEFT-10} y={y(maximum*n)+4} fill="#8291a8" fontSize="10" textAnchor="end">{numberFormat.format(maximum*n)}</text></g>)}<text x="3" y="10" fill="#8291a8" fontSize="9">{unit}</text><g clipPath={`url(#${clipId})`}>{series.map(s=><path key={s.name} d={s.samples.map((p,i)=>p.value===null?'':`${p.breakBefore||!i||s.samples[i-1].value===null?'M':'L'}${x(p.at)},${y(p.value)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.3"/>)}{kind==='resources'&&series.flatMap(s=>s.samples.filter(p=>p.value!==null).map(p=><circle key={s.name+p.at} cx={x(p.at)} cy={y(p.value!)} r={2.5} fill={s.color}/>))}</g>{[0,.5,1].map(n=><text key={n} x={LEFT+n*(900-LEFT-RIGHT)} y={HEIGHT-6} fill="#8291a8" fontSize="10" textAnchor={n===0?'start':n===1?'end':'middle'}>{timeFormat.format(end-span+n*span)}</text>)}</svg>{!series.some(s=>s.samples.some(p=>p.value!==null))&&<div className="monitor-chart-empty">Métricas não disponibilizadas pelo firmware</div>}{index!==null&&series[0]?.samples[index]&&<div className="monitor-chart-tooltip"><strong>{exactFormat.format(series[0].samples[index].at)}</strong>{series.map(s=><span key={s.name}>{s.name}: {s.samples[index]?.value==null?'Sem dado':numberFormat.format(s.samples[index].value!)} {unit}</span>)}</div>}{series[0]?.samples.length>1&&<input className="monitor-chart-range" type="range" aria-label="Explorar amostra do gráfico" min={0} max={series[0].samples.length-1} value={index??series[0].samples.length-1} onFocus={()=>setIndex(index??series[0].samples.length-1)} onChange={e=>setIndex(Number(e.target.value))}/>}</div>;
}
