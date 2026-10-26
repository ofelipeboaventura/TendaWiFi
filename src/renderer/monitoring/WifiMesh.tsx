import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Wifi, Network, Globe2, ArrowDown, ArrowUp, Users, ChevronDown, Search, Clock3 } from 'lucide-react';
import type { MeshNode, ClientDevice } from '../../shared/types';
import type { MonitoringState, NodeHealth, RadioReading } from '../../shared/monitoring';
import type { QualityReport } from '../../shared/observability';
import { CardTitle, StatusDot, formatDuration } from '../components';
import { stamp } from './Consumption';
import { qualityMetrics } from '../../shared/quality';
import { connectionLabel, filterMeshClients, meshNumber, meshRate, meshView, nodeQuality, parentName, radioValue, type MeshClientSort } from './wifi-mesh-model';
import './wifi-mesh.css';

interface HistoryState { data: QualityReport | null; loading: boolean; error: string }
function useQuality() {
  const [value, setValue] = useState<HistoryState>({ data: null, loading: true, error: '' });
  useEffect(() => {
    let disposed = false, pending = false, startedAt = 0;
    const load = async () => {
      if (document.hidden || pending || Date.now() - startedAt < 30000) return;
      pending = true; startedAt = Date.now();
      try {
        const result = await window.tenda.observationQuality({ range: 'today' });
        if (!disposed) setValue(previous => result.ok ? { data: result.data, loading: false, error: '' } : { ...previous, loading: false, error: 'Não foi possível consultar o histórico da malha. A consulta será repetida automaticamente.' });
      } catch {
        if (!disposed) setValue(previous => ({ ...previous, loading: false, error: 'Histórico temporariamente indisponível. A consulta será repetida automaticamente.' }));
      } finally { pending = false; }
    };
    void load(); const timer = setInterval(() => void load(), 30000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return value;
}

// DNS keeps its existing layout and semantics on the Quality tab.
export function DnsQuality({ state }: { state: MonitoringState }) {
  const rows = (state.extraQuality ?? []).filter(r => r.kind === 'dns'), targets = [...new Set(rows.map(r => r.target))];
  return <section className="card monitor-pad"><CardTitle title="Resposta DNS" subtitle="Consulta A fixa a example.com, deste computador, a cada 30 segundos" icon={<Globe2 size={18} />} /><div className="wifi-mesh-grid">{targets.map(target => {
    const samples = rows.filter(r => r.target === target), metric = qualityMetrics(samples, [target])[0], fresh = Date.now() - (samples.at(-1)?.at ?? 0) < 65000;
    return <article className="card monitor-pad" key={target}><h3>{target === '1.1.1.1' ? 'DNS Cloudflare' : 'DNS pelo roteador'}</h3><p>{target}</p><strong>{fresh && metric?.mean != null ? metric.mean.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' ms' : 'Indisponível'}</strong><p>{metric?.received ?? 0}/{samples.length} respostas · {samples.filter(r => r.status === 'timeout').length} timeouts · {samples.filter(r => r.status === 'error').length} erros</p></article>;
  })}{!targets.length && <p>Aguardando sondas DNS. Indisponibilidade não comprova queda de Internet.</p>}</div><p className="monitor-note">O resolvedor pode responder por cache. Essas consultas não equivalem a medir o DNS dentro do roteador.</p></section>;
}

function FullName({ text }: { text: string }) { return <span className="wm-name" title={text} tabIndex={0}>{text}</span>; }
function Value({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`wm-value ${tone}`}>{children}</span>; }
function Quality({ node }: { node: MeshNode }) {
  const quality = nodeQuality(node);
  return <span className={`wm-badge ${quality.tone}`} title={quality.note}>{quality.label}</span>;
}
function Radio({ radio, now }: { radio: RadioReading; now: number }) {
  const stale = now - radio.sampledAt > 65000;
  return <article className="wm-radio" data-band={radio.band}>
    <header><span className="wm-radio-band"><Wifi size={17} />{connectionLabel(radio.band)}</span><span className={`wm-badge ${stale ? 'warning' : 'muted'}`}>{stale ? 'Desatualizado' : 'Última leitura'}</span></header>
    <div className="wm-radio-current"><div><span>Canal atual</span><strong>{radioValue(radio.currentChannel)}</strong></div><div><span>Largura atual</span><strong>{radioValue(radio.currentBandwidth, true)}</strong></div></div>
    <dl className="wm-radio-config"><div><dt>Canal configurado</dt><dd>{radioValue(radio.configuredChannel, false, true)}</dd></div><div><dt>Largura configurada</dt><dd>{radioValue(radio.configuredBandwidth, true, true)}</dd></div></dl>
    <footer><Clock3 size={12} /><time dateTime={new Date(radio.sampledAt).toISOString()}>{stamp(radio.sampledAt)}</time></footer>
  </article>;
}

function NodeClients({ clients, nodeName }: { clients: ClientDevice[]; nodeName: string }) {
  const [search, setSearch] = useState(''), [connection, setConnection] = useState('all'), [sort, setSort] = useState<MeshClientSort>('name'), [page, setPage] = useState(0);
  const options = useMemo(() => [...new Set(clients.map(client => connectionLabel(client.connection)))].sort(), [clients]);
  const rows = useMemo(() => filterMeshClients(clients, search, connection, sort), [clients, search, connection, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / 20)), currentPage = Math.min(page, pages - 1);
  return <section className="wm-clients" aria-label={`Dispositivos associados a ${nodeName}`}>
    <div className="wm-clients-heading"><h4>Dispositivos associados <span>{clients.length}</span></h4><p>Tráfego atual e taxa do enlace são métricas diferentes.</p></div>
    {clients.length > 0 && <>
      <div className="wm-filters"><label className="wm-search"><Search size={15} /><input type="search" aria-label="Buscar dispositivo neste nó" placeholder="Nome, IP ou MAC" maxLength={128} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
        <label><span>Conexão</span><select aria-label="Filtrar conexão neste nó" value={connection} onChange={event => { setConnection(event.target.value); setPage(0); }}><option value="all">Todas</option>{options.map(option => <option key={option}>{option}</option>)}{connection !== 'all' && !options.includes(connection) && <option value={connection}>{connection} (sem clientes)</option>}</select></label>
        <label><span>Ordenar por</span><select aria-label="Ordenar dispositivos neste nó" value={sort} onChange={event => { setSort(event.target.value as MeshClientSort); setPage(0); }}><option value="name">Nome</option><option value="download">Maior download</option><option value="upload">Maior upload</option></select></label>
      </div>
      <div className="wm-table-scroll" role="region" aria-label={`Tabela de dispositivos de ${nodeName}`} tabIndex={0}><table className="wm-table wm-client-table"><caption className="wm-sr-only">Clientes online com associação não ambígua a {nodeName}</caption><colgroup><col className="wm-client-name-col" /><col className="wm-client-connection-col" /><col /><col /><col className="wm-negotiated-col" /><col className="wm-rssi-col" /></colgroup><thead><tr><th scope="col">Dispositivo / IP / MAC</th><th scope="col">Conexão</th><th scope="col" className="wm-numeric">Download</th><th scope="col" className="wm-numeric">Upload</th><th scope="col" className="wm-numeric">Taxa negociada</th><th scope="col" className="wm-numeric">RSSI informado</th></tr></thead><tbody>
        {rows.slice(currentPage * 20, currentPage * 20 + 20).map(client => <tr key={client.mac} data-client-mac={client.mac}><td><FullName text={client.name} /><small className="wm-client-address">{client.ip || 'IP não informado'}<br /><span>{client.mac}</span></small></td><td><span className="wm-badge muted">{connectionLabel(client.connection)}</span></td><td className="wm-numeric"><Value tone="download">{meshRate(client.download)}</Value></td><td className="wm-numeric"><Value tone="upload">{meshRate(client.upload)}</Value></td><td className="wm-numeric"><Value>{client.negotiatedMbps != null ? `${meshNumber(client.negotiatedMbps)} Mbps` : '—'}</Value></td><td className="wm-numeric"><Value>{client.rssi?.trim() ? client.rssi : '—'}</Value></td></tr>)}
      </tbody></table></div>
      {!rows.length && <p className="wm-empty">Nenhum dispositivo corresponde aos filtros.</p>}
      <div className="wm-pagination"><span>{rows.length} {rows.length === 1 ? 'dispositivo' : 'dispositivos'} · página {currentPage + 1} de {pages}</span><div><button className="btn secondary small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="btn secondary small" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Próxima</button></div></div>
    </>}
    {!clients.length && <p className="wm-empty">Nenhum dispositivo online com associação confirmada a este nó.</p>}
    <p className="wm-footnote">Taxa negociada não é velocidade de tráfego. RSSI é o valor bruto informado pelo firmware, sem unidade ou conversão presumida. “—” indica dado indisponível.</p>
  </section>;
}

function NodeDetails({ node, state, health, clients, historyPending }: { node: MeshNode; state: MonitoringState; health?: NodeHealth; clients: ClientDevice[]; historyPending: boolean }) {
  const ping = useMemo(() => {
    if (node.primary) return state.quality.find(sample => node.ip ? sample.target === node.ip : sample.target !== '1.1.1.1' && sample.target !== '8.8.8.8');
    if (!node.ip) return undefined;
    return qualityMetrics((state.extraQuality ?? []).filter(sample => sample.kind === 'node'), [node.ip])[0];
  }, [state.quality, state.extraQuality, node.ip, node.primary]);
  const pingFresh = ping?.lastAt != null && Date.now() - ping.lastAt <= (node.primary ? 12500 : 65000);
  const pingText = ping?.lastAt == null ? 'Indisponível' : !pingFresh ? 'Desatualizado' : ping.lastLatency === null ? 'Sem resposta' : ping.mean != null ? `${meshNumber(ping.mean)} ms` : 'Indisponível';
  return <div className="wm-node-details">
    <header><Network size={20} /><div><h3>{node.name}</h3><p>{node.primary ? 'Roteador principal' : 'Nó Mesh'}{node.model ? ` · ${node.model}` : ''}</p></div></header>
    <dl className="wm-detail-grid"><div><dt>Conexão informada</dt><dd>{connectionLabel(node.band)}</dd></div><div><dt>Endereço IP</dt><dd>{node.ip || 'Não informado'}</dd></div><div><dt>Tempo online observado</dt><dd><Value>{health ? formatDuration(health.observedOnlineMs / 1000) : historyPending ? 'Aguardando histórico' : 'Indisponível'}</Value></dd></div><div><dt>Mudanças observadas</dt><dd><Value>{health?.changes != null ? meshNumber(health.changes) : '—'}</Value></dd></div><div><dt>Ping deste computador</dt><dd><Value>{pingText}</Value>{ping?.lastAt != null && <small>Última sonda: {stamp(ping.lastAt)}</small>}</dd></div><div><dt>Velocidade do backhaul</dt><dd>Não disponibilizada</dd></div></dl>
    <p className="wm-footnote">Tempo online e mudanças são acumulados desde a primeira observação local{health ? ` (${stamp(health.firstAt)})` : ''}; não representam o uptime do equipamento. Ping mostra a média das respostas disponíveis, quando a sonda é atual. Uma sonda sem resposta não comprova queda da Internet.</p>
    <NodeClients clients={clients} nodeName={node.name} />
  </div>;
}

export function WifiMesh({ state }: { state: MonitoringState }) {
  const history = useQuality(), [expanded, setExpanded] = useState<string | null>(null), detailsId = useId();
  const view = useMemo(() => meshView(state.nodes, state.clients), [state.nodes, state.clients]);
  const now = Date.now(), available = state.sampledAt !== null && state.nodes.length > 0;
  const summaries = [
    { label: 'Nós online', value: `${view.online} / ${view.rows.length}`, icon: <Network size={18} />, tone: 'green', note: 'Estado da última topologia' },
    { label: 'Clientes associados', value: meshNumber(view.clients), icon: <Users size={18} />, tone: 'purple', note: 'Online, com nó identificado' },
    { label: 'Download dos clientes', value: meshRate(view.download), icon: <ArrowDown size={18} />, tone: 'download', note: 'Tráfego dos clientes associados' },
    { label: 'Upload dos clientes', value: meshRate(view.upload), icon: <ArrowUp size={18} />, tone: 'upload', note: 'Tráfego dos clientes associados' },
  ];
  return <div className="wifi-mesh-page">
    <div className="wm-summary">{summaries.map(summary => <section className="card wm-summary-card" key={summary.label}><div><span className={`wm-summary-icon ${summary.tone}`}>{summary.icon}</span><h2>{summary.label}</h2></div><strong className={`wm-value ${summary.tone}`}>{available ? summary.value : '—'}</strong><p>{available ? summary.note : 'Aguardando topologia e coleta'}</p></section>)}</div>
    <p className="wm-scope">O tráfego dos clientes pode incluir rede local. Não é uma medição do backhaul nem é somado novamente ao total WAN.</p>
    {(view.ambiguous > 0 || view.unassigned > 0) && <p className="wm-exclusions" role="status">Fora das somas por nó: {view.ambiguous} em roaming ou associação ambígua · {view.unassigned} sem nó identificado.</p>}
    <section className="card wm-section"><CardTitle title="Rádios do roteador principal" subtitle="Estado atual em destaque; configuração desejada logo abaixo" icon={<Wifi size={18} />} /><div className="wm-radios">{state.radios?.map(radio => <Radio key={radio.band} radio={radio} now={now} />)}</div>{!state.radios?.length && <p className="wm-empty">Informações dos rádios ainda não disponibilizadas pelo firmware.</p>}</section>
    <section className="card wm-section wm-nodes"><CardTitle title="Roteadores da malha" subtitle="Compare os nós e abra os detalhes para consultar seus dispositivos" icon={<Network size={18} />} />
      <div className="wm-table-scroll" role="region" aria-label="Comparação dos roteadores Mesh" tabIndex={0}><table className="wm-table wm-node-table"><caption className="wm-sr-only">Estado e tráfego dos clientes associados a cada roteador</caption><colgroup><col className="wm-node-name-col" /><col className="wm-status-col" /><col className="wm-parent-col" /><col className="wm-count-col" /><col className="wm-rate-col" /><col className="wm-rate-col" /><col className="wm-quality-col" /><col className="wm-action-col" /></colgroup><thead><tr><th scope="col">Roteador</th><th scope="col">Estado</th><th scope="col">Ligado a</th><th scope="col" className="wm-numeric">Clientes</th><th scope="col" className="wm-numeric">Download</th><th scope="col" className="wm-numeric">Upload</th><th scope="col">Qualidade</th><th scope="col"><span className="wm-sr-only">Detalhes</span></th></tr></thead><tbody>
        {view.rows.map((row, index) => { const node = row.node, open = expanded === node.id, id = `${detailsId}-node-${index}`; return <Fragment key={node.id}>
          <tr className={`wm-node-row ${open ? 'selected' : ''}`} data-node-id={node.id}><th scope="row"><FullName text={node.name} /><small>{node.primary ? 'Principal' : node.model || 'Nó Mesh'}</small></th><td><span className={`wm-status ${node.online ? 'online' : 'offline'}`}><StatusDot online={node.online} />{node.online ? 'Online' : 'Offline'}</span></td><td><FullName text={parentName(node, state.nodes)} /></td><td className="wm-numeric"><Value>{meshNumber(row.clients.length)}</Value></td><td className="wm-numeric"><Value tone="download">{meshRate(row.download)}</Value></td><td className="wm-numeric"><Value tone="upload">{meshRate(row.upload)}</Value></td><td><Quality node={node} /></td><td><button className="wm-expand" aria-label={`${open ? 'Ocultar' : 'Ver'} detalhes de ${node.name}`} aria-expanded={open} aria-controls={id} onClick={() => setExpanded(open ? null : node.id)}>Detalhes<ChevronDown size={14} /></button></td></tr>
          <tr className="wm-expansion-row" hidden={!open}><td colSpan={8}><div id={id} hidden={!open}>{open && <NodeDetails key={node.id} node={node} state={state} health={history.data?.nodes.find(health => health.id === node.id) ?? state.nodeHealth?.find(health => health.id === node.id)} clients={row.clients} historyPending={history.loading} />}</div></td></tr>
        </Fragment>; })}
      </tbody></table></div>
      {!view.rows.length && <p className="wm-empty">Nenhum roteador foi disponibilizado na última topologia.</p>}
      <p className="wm-footnote wm-table-note">Qualidade é a classificação do firmware para enlaces sem fio, quando disponível. Interferência, temperatura e utilização das interfaces não têm métricas comprovadas neste firmware.</p>
    </section>
    <section className="card wm-section wm-history" aria-label="Histórico da malha hoje"><CardTitle title="Histórico da malha hoje" subtitle="Estados observados pela coleta local" icon={<Clock3 size={18} />} />
      {history.loading && <p className="wm-empty" role="status">Carregando histórico da malha…</p>}
      {history.error && <p className="wm-history-error" role="status">{history.error}{history.data ? ' Os registros anteriores foram preservados.' : ''}</p>}
      {history.data?.events.length ? <ol>{history.data.events.map(event => <li key={event.id}><time dateTime={new Date(event.at).toISOString()}>{stamp(event.at)}</time><span>{event.message}</span></li>)}</ol> : !history.loading && !history.error && <p className="wm-empty">Nenhuma mudança observada hoje.</p>}
      {history.data?.limited && <p className="wm-footnote">Consulta limitada às 2.000 sondas mais recentes deste período.</p>}
    </section>
  </div>;
}
