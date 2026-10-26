// Synthetic UI fixture. Excluded from the application and portable package.
import {createRoot}from'react-dom/client';
import {flushSync}from'react-dom';
import type{DesktopAPI,ClientDevice,MeshNode}from'../src/shared/types';
import type{MonitoringState}from'../src/shared/monitoring';
import {defaultMonitorSettings}from'../src/shared/monitoring';
import type{QualityReport}from'../src/shared/observability';
import {WifiMesh}from'../src/renderer/monitoring/WifiMesh';
import'../src/renderer/styles.css';
import'../src/renderer/monitoring.css';
import'../src/renderer/monitoring/professional.css';
const root=createRoot(document.getElementById('root')!);
const nodes=():MeshNode[]=>[
 {id:'main',name:'RX27 PRO',model:'RX27 PRO',ip:'192.168.0.1',parentId:null,primary:true,online:true,clients:25,quality:'good',band:''},
 {id:'third',name:'RX12L Pro 03',model:'RX12L Pro',ip:'192.168.0.3',parentId:'main',primary:false,online:true,clients:1,quality:'normal',band:'5G'},
 {id:'first',name:'RX12L Pro 01',model:'RX12L Pro',ip:'',parentId:'third',primary:false,online:true,clients:0,quality:'unknown',band:''},
 {id:'second',name:'RX12L Pro 02',model:'RX12L Pro',ip:'192.168.0.4',parentId:'third',primary:false,online:false,clients:0,quality:'bad',band:'5G'},
];
const device=(index:number,extra:Partial<ClientDevice>={}):ClientDevice=>({id:String(index),mac:'02:00:00:00:00:'+index.toString(16).toUpperCase().padStart(2,'0'),name:index===0?'<img src=x onerror=window.fixtureXss=true>':index===1?'Dispositivo com nome extremamente longo para validar a leitura completa sem quebrar a tabela ou alterar suas colunas':'Dispositivo '+String(index).padStart(2,'0'),ip:'192.168.0.'+(index+10),nodeId:'main',nodeName:'RX27 PRO',online:true,guest:false,blocked:false,local:false,connection:index%3===0?'wire':index%2===0?'2.4G':'5G',upload:3000+index*20,download:10000+index*300,uploadLimit:0,downloadLimit:0,uptime:3600,negotiatedMbps:index%2===0?null:1201,rssi:index%2===0?'0':null,...extra});
function initial():MonitoringState{const at=Date.now();return{status:'collecting',sampledAt:at,settings:defaultMonitorSettings,overview:null,nodes:nodes(),clients:[...Array.from({length:25},(_,i)=>device(i)),device(25,{nodeId:'third',connection:'5G'}),device(26,{ambiguous:true}),device(27,{nodeId:'missing'})],resources:[],quality:[{target:'192.168.0.1',samples:2,received:2,mean:0,p95:0,jitter:0,loss:0,lastAt:at,lastLatency:0}],recentEvents:[],consumptionSupported:false,storage:{healthy:true,message:'',earliestAt:null,bytes:0},probeAvailable:true,radios:[{band:'2.4 GHz',sampledAt:at,currentChannel:'8',configuredChannel:'auto',currentBandwidth:'20',configuredBandwidth:'auto'},{band:'5 GHz',sampledAt:at,currentChannel:'40',configuredChannel:'auto',currentBandwidth:'160',configuredBandwidth:'auto'},{band:'6 GHz',sampledAt:at-120000,currentChannel:'37',configuredChannel:'auto',currentBandwidth:'160',configuredBandwidth:'auto'}],extraQuality:[{kind:'node',target:'192.168.0.3',at,latency:3.8,status:'success'}]};}
const history=():QualityReport=>({samples:[],nodes:nodes().map(n=>({id:n.id,firstAt:Date.now()-600000,lastAt:Date.now(),observedOnlineMs:300000,onlineSince:Date.now()-600000,changes:0})),events:[],limited:false});
let calls=0,mode='pending',epoch=0,state=initial();const waiters:(()=>void)[]=[];
window.tenda={observationQuality:async()=>{calls++;if(mode==='pending')await new Promise<void>(resolve=>waiters.push(resolve));return mode==='error'?{ok:false,error:{code:'OFFLINE',message:'synthetic error'}}:{ok:true,data:history()};}}as DesktopAPI;
function render(){flushSync(()=>root.render(<div className="app-shell"><aside className="sidebar"><div style={{padding:24,color:'#ff985f',fontSize:22}}>tenda<small style={{display:'block',fontSize:10,color:'#91a7c5'}}>WiFi Desktop · Simulador</small></div><p style={{padding:22}}>Monitoramento<br/><br/>Wi-Fi/Mesh</p></aside><main className="main-shell"><div className="page-content"><div style={{marginBottom:24}}><p className="eyebrow">MONITORAMENTO · DADOS SINTÉTICOS</p><h1 style={{fontSize:27,marginTop:8}}>Wi-Fi/Mesh</h1></div><WifiMesh key={epoch} state={state}/></div></main></div>));}
const api={
 calls:()=>calls,
 resolve:()=>{mode='ready';for(const resolve of waiters.splice(0))resolve();},
 update:()=>{state={...state,sampledAt:Date.now(),clients:state.clients.map(d=>({...d,download:d.download+100,upload:d.upload+10}))};render();},
 reset:(next='ready')=>{mode=next;epoch++;state=initial();render();},
 offline:()=>{state={...state,nodes:state.nodes.map(n=>n.id==='main'?{...n,online:false}:n),clients:state.clients.map(d=>d.nodeId==='main'?{...d,online:false}:d)};render();},
 empty:()=>{state={...state,nodes:[],clients:[],radios:[],sampledAt:null};render();},
};
Object.assign(window,{wifiMeshTest:api});render();
