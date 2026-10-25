import { Cpu, HardDrive, Clock3, Database, Network } from 'lucide-react';
import type { ReactNode } from 'react';
import { RESOURCE_STALE_MS, type MonitoringHistory, type MonitoringState, type MonitorPoint, type ResourceSample } from '../../shared/monitoring';
import { Badge, CardTitle, formatDuration } from '../components';
import { MonitorChart } from './MonitorChart';

const decimal = (n: number | null | undefined, suffix = '') => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + suffix;
const EMPTY_POINTS: readonly MonitorPoint[] = [];
const EMPTY_RESOURCES: readonly ResourceSample[] = [];
const date = (at: number) => new Date(at).toLocaleString('pt-BR');
const age = (at: number) => Date.now()-at<60000 ? `${Math.max(0,Math.floor((Date.now()-at)/1000))} s` : formatDuration((Date.now()-at)/1000);
export function MonitorResources({ state, history, live }: { state: MonitoringState; history: MonitoringHistory | null; live: boolean }) {
  const primary = state.nodes.find(n=>n.primary), resource = state.resources.find(r=>r.nodeId===primary?.id);
  const note = (r: typeof resource) => !r || r.cpu === null && r.memory === null ? 'Aguardando medição por diagnóstico' : r.sampledAt === null ? 'Último diagnóstico · atualidade desconhecida' : `Diagnóstico · ${date(r.sampledAt)} · há ${age(r.sampledAt)}${!r.current || Date.now()-r.sampledAt>RESOURCE_STALE_MS ? ' · desatualizado' : ''}`;
  const metric = (icon: ReactNode, label: string, value: string, description: string, tone: string) => <section className={`card monitor-stat ${tone}`}><div><span className={`metric-icon ${tone}`}>{icon}</span><span>{label}</span></div><strong>{value}</strong><p>{description}</p></section>;
  return <>
    <div className="notice"><Cpu size={17}/><p>{state.diagnostic?.message ?? 'Aguardando informações do diagnóstico.'}{state.diagnostic?.status==='running' && state.diagnostic.progress!==null ? ` ${decimal(state.diagnostic.progress,'%')}` : ''} Coleta automática a cada 5 minutos quando habilitada.</p></div>
    <div className="monitor-metrics">
      {metric(<Cpu/>, 'CPU do roteador', decimal(resource?.cpu,'%'), note(resource), 'orange')}
      {metric(<HardDrive/>, 'Memória do roteador', decimal(resource?.memory,'%'), note(resource), 'blue')}
      {metric(<Clock3/>, 'Tempo de atividade', state.overview ? formatDuration(state.overview.uptime) : '—', 'Informado pelo roteador principal', 'green')}
      {metric(<Database/>, 'Histórico local', decimal(state.storage.bytes/1048576,' MiB'), 'Retenção de até 30 dias · limite de 512 MiB', 'purple')}
    </div>
    <section className="card"><CardTitle icon={<Cpu size={17}/>} title="CPU e memória" subtitle="Medições pontuais por diagnóstico; os intervalos não são preenchidos"/><MonitorChart points={EMPTY_POINTS} resourceSamples={history?.resources ?? EMPTY_RESOURCES} kind="resources" period={history?.period ?? '5m'} live={live}/><p className="monitor-note">CPU laranja · Memória azul · Horário de observação da conclusão neste computador.</p></section>
    <section className="card monitor-pad"><CardTitle icon={<Network size={17}/>} title="Recursos por nó" subtitle="O diagnóstico confirmado mede o roteador principal"/>
      {state.nodes.map(node=>{ const r=state.resources.find(r=>r.nodeId===node.id);return <div className="monitor-node-resource" key={node.id}><div><strong>{node.name}</strong><span>{node.model || (node.primary?'Roteador principal':'Nó Mesh')} · {node.ip || 'IP não informado'}</span></div><Badge tone={node.online?'green':'muted'}>{node.online?'Online':'Offline'}</Badge><div><span>CPU</span><b>{decimal(r?.cpu,'%')}</b></div><div><span>Memória</span><b>{decimal(r?.memory,'%')}</b></div><small>{node.primary?note(r):'Diagnóstico individual indisponível'}</small></div>;})}
      <p className="monitor-note">O diagnóstico também verifica Wi-Fi, WAN, ping, DNS e IPv6. As medições não representam os recursos deste computador. Amostras a cada 5 minutos não comprovam uso elevado contínuo por 60 segundos.</p>
    </section>
  </>;
}
