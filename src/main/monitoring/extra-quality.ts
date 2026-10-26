import { Resolver } from 'node:dns/promises';
import type { ExtraQualitySample } from '../../shared/monitoring';
import type { MeshNode } from '../../shared/types';
import { WindowsProbes } from './probes';
import { validateRouterHost } from '../router/transport';
export interface ExtraProvider { start(host:string,nodes:MeshNode[],callback:(samples:ExtraQualitySample[])=>void):void; updateNodes(host:string,nodes:MeshNode[]):void; stop():void }
export class ExtraQuality implements ExtraProvider {
  private generation=0;private timer?:ReturnType<typeof setTimeout>;private mesh=new WindowsProbes(30000);private key='';private callback?:(samples:ExtraQualitySample[])=>void;private resolvers=new Set<Resolver>();
  constructor(private resolve?: (target:string)=>Promise<void>){}
  start(host:string,nodes:MeshNode[],callback:(samples:ExtraQualitySample[])=>void){this.stop();validateRouterHost(host);this.callback=callback;this.updateNodes(host,nodes);const generation=this.generation;const cycle=async()=>{const started=performance.now();const samples=await Promise.all([host,'1.1.1.1'].map(async target=>{const time=performance.now();try{if(this.resolve)await this.resolve(target);else{const resolver=new Resolver({timeout:1000,tries:1});resolver.setServers([target]);this.resolvers.add(resolver);try{await resolver.resolve4('example.com');}finally{this.resolvers.delete(resolver);}}return{kind:'dns' as const,target,at:Date.now(),latency:Math.round((performance.now()-time)*100)/100,status:'success' as const};}catch(error){return{kind:'dns' as const,target,at:Date.now(),latency:null,status:error&&typeof error==='object'&&'code'in error&&['ETIMEOUT','ECANCELLED'].includes(String(error.code))?'timeout' as const:'error' as const};}}));if(generation!==this.generation)return;callback(samples);this.timer=setTimeout(()=>void cycle(),Math.max(0,30000-(performance.now()-started)));};void cycle();}
  updateNodes(host:string,nodes:MeshNode[]){if(!this.callback)return;const addresses=nodes.filter(n=>n.online&&!n.primary&&n.ip).map(n=>n.ip).sort(),key=host+addresses.join(',');if(key===this.key)return;this.key=key;const generation=this.generation;this.mesh.startMesh(host,addresses,(rows)=>{if(generation!==this.generation)return;this.callback?.(rows.map(row=>({kind:'node',target:row.target,at:row.at,latency:row.latency,status:row.status})));});}
  stop(){this.generation++;if(this.timer)clearTimeout(this.timer);for(const resolver of this.resolvers)resolver.cancel();this.resolvers.clear();this.mesh.stop();this.callback=undefined;this.key='';}
}
