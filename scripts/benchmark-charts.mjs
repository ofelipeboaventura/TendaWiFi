// Synthetic renderer benchmark. No router, credentials or production profile.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';
const name = process.argv.includes('--baseline') ? 'before' : process.argv.includes('--empty') ? 'empty' : process.argv.includes('--fallback') ? 'fallback' : 'after';
const directory = path.resolve('artifacts/chart-performance'); fs.mkdirSync(directory, { recursive: true });
const fixture = `
import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{MonitorChart}from'./src/renderer/Monitoring';import'./src/renderer/styles.css';
const paints=[],paintTimes=[],intervals=[],tasks=[];let previous=0,frames=0;
new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({at:entry.startTime,duration:entry.duration})}).observe({type:'longtask',buffered:true});
function measure(at){if(previous)intervals.push(at-previous);previous=at;frames++;requestAnimationFrame(measure)}requestAnimationFrame(measure);
const sample=(at,i)=>({at,upload:1e6+Math.sin(i/13)*3e5,download:i%57===0?42e6:9e6+Math.sin(i/17)*4e6,online:true,uptime:900+i,cpu:null,memory:null,latency:i%35===0?null:30+Math.sin(i/9)*5});
${process.argv.includes('--fallback')?'HTMLCanvasElement.prototype.getContext=()=>null;':''}
function Fixture(){const[points,setPoints]=useState(()=>Array.from({length:900},(_,i)=>sample(Date.now()-(899-i)*1000,i)));const[devices,setDevices]=useState(0);useEffect(()=>{let i=900;const timer=setInterval(()=>{setPoints(old=>[...old.slice(-899),sample(Date.now(),i++)]);setDevices(n=>n+1)},1000);return()=>clearInterval(timer)},[]);return <main style={{padding:30,color:'#dce8f5',background:'#101721',minHeight:'100vh'}}><h2>Monitoramento — teste sintético</h2><p>900 amostras · {devices} atualizações de dispositivos</p><section className='card'><MonitorChart points={points} period='15m' live={true} kind='${process.argv.includes('--empty')?'resources':'traffic'}' onPaint={ms=>{paints.push(ms);paintTimes.push(performance.now())}}/></section></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);
let movement=0;setTimeout(()=>{const element=document.querySelector('.monitor-chart');let i=0;window.mouseTimer=setInterval(()=>{const rect=element.getBoundingClientRect();const target=element.querySelector('canvas,svg')||element;target.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.left+70+(i++%120)/120*(rect.width-100),clientY:rect.top+80}));movement++},16)},1500);
const percentile=(list,p)=>{const sorted=[...list].sort((a,b)=>a-b);return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null};
window.result=()=>({frames,frameP95:percentile(intervals.slice(60),.95),meanFps:1000/(intervals.slice(60).reduce((a,b)=>a+b,0)/Math.max(1,intervals.length-60)),paintP95:percentile(paints,.95),paintCount:paints.length,firstPaintAt:paintTimes[0],measuredAt:performance.now(),paintFps:paintTimes.filter(t=>t>Math.max(2000,(paintTimes[0]??0)+1000)).length/Math.max(.001,(performance.now()-Math.max(2000,(paintTimes[0]??0)+1000))/1000),fallbackSVG:!!document.querySelector('.monitor-chart svg'),longTasksOver50ms:tasks.filter(n=>n.at>2000&&n.duration>50).length,startupLongTasks:tasks.filter(n=>n.at<=2000&&n.duration>50).length,maxLongTask:Math.max(0,...tasks.filter(n=>n.at>2000).map(n=>n.duration)),mouseEvents:movement,visible:!document.hidden});
`;
await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(directory, name + '.js'), define: { 'process.env.NODE_ENV': '"production"' } });
fs.writeFileSync(path.join(directory, name + '.html'), `<html><head><meta charset="utf-8"><link rel="stylesheet" href="${name}.css"></head><body style="margin:0"><div id="root"></div><script src="${name}.js"></script></body></html>`);
const runner = `const{app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(path.join(directory,'profile-'+name))});app.whenReady().then(async()=>{const win=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.webContents.setBackgroundThrottling(false);await win.loadFile(${JSON.stringify(path.join(directory,name+'.html'))});win.webContents.beginFrameSubscription(()=>{});await new Promise(r=>setTimeout(r,12000));const result=await win.webContents.executeJavaScript('window.result()');fs.writeFileSync(${JSON.stringify(path.join(directory,name+'.json'))},JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));app.exit(0)});`;
fs.writeFileSync(path.join(directory,name+'.cjs'),runner);
const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.TENDA_ROUTER_PASSWORD;
const child=spawn(electron,[path.join(directory,name+'.cjs')],{windowsHide:true,stdio:'inherit',env});child.on('exit',code=>process.exit(code??1));
