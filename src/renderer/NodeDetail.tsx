import { useCallback, useEffect, useRef, useState } from 'react';
import { Power, Router, Users, Wrench } from 'lucide-react';
import type { ChangePreview, MeshNode } from '../shared/types';
import type { Request } from './FeatureEditor';
import { Badge, Modal, Spinner, StatusDot } from './components';
import './node-detail.css';

export function NodeDetail({ node, available, request, onClose, onClients, onMaintenance, onPreview }: {
  node: MeshNode; available: boolean; request: Request; onClose: () => void; onClients: () => void; onMaintenance: () => void; onPreview: (preview: ChangePreview) => void;
}) {
  const [preparing, setPreparing] = useState(false), busy = useRef(false);
  const lifecycle = useRef({ alive: true, closed: false }), latest = useRef({ node, available });
  latest.current = { node, available };
  useEffect(() => { lifecycle.current.alive = true; return () => { lifecycle.current.alive = false; }; }, []);
  const close = useCallback(() => { lifecycle.current.closed = true; onClose(); }, [onClose]);
  const restart = async () => {
    if (busy.current || !available || !node.online || lifecycle.current.closed) return;
    busy.current = true; setPreparing(true);
    const selected = { id: node.id, primary: node.primary };
    try {
      const preview = await request(window.tenda.prepareAction({ action: 'reboot', nodeId: selected.id }));
      const current = latest.current;
      if (!lifecycle.current.alive || lifecycle.current.closed || !current.available || !current.node.online || current.node.id !== selected.id || current.node.primary !== selected.primary) {
        await window.tenda.cancelChange({ id: preview.id }).catch(() => undefined); return;
      }
      close(); onPreview(preview);
    } catch { /* The shared request handler displays safe backend errors. */ }
    finally { busy.current = false; if (lifecycle.current.alive && !lifecycle.current.closed) setPreparing(false); }
  };
  const leave = (action: () => void) => { close(); action(); };
  return <Modal title={node.name} subtitle={node.primary ? 'Roteador principal' : 'Nó da rede Mesh'} onClose={close}>
    <div className="modal-body"><div className="node-detail-icon"><Router size={42} strokeWidth={1.4} /><Badge tone={available && node.online ? 'green' : 'muted'}><StatusDot online={available && node.online} />{!available ? 'Indisponível' : node.online ? 'Online' : 'Offline'}</Badge></div>
      <dl className="info-list"><div><dt>Modelo</dt><dd>{node.model || '—'}</dd></div><div><dt>Endereço IP</dt><dd className="mono">{node.ip || '—'}</dd></div><div><dt>Dispositivos</dt><dd>{node.clients}</dd></div><div><dt>Qualidade da conexão</dt><dd>{node.quality || (node.primary ? 'Roteador principal' : '—')}</dd></div><div><dt>Conexão com a malha</dt><dd>{node.band || (node.primary ? 'Principal' : '—')}</dd></div></dl>
      {(!available || !node.online) && <p className="node-reboot-hint" role="status">{!available ? 'Este nó não está disponível na topologia atual. Aguarde uma atualização antes de reiniciar.' : 'O nó está offline. A reinicialização fica disponível quando ele estiver online.'}</p>}
    </div>
    <div className="modal-footer node-detail-footer"><button className="btn secondary" onClick={() => leave(onMaintenance)}><Wrench size={15} />Manutenção</button><button className="btn secondary" disabled={!available || !node.online || preparing} onClick={() => void restart()}>{preparing ? <Spinner small /> : <Power size={15} />}{preparing ? 'Preparando…' : 'Reiniciar nó'}</button><button className="btn primary" onClick={() => leave(onClients)}><Users size={15} />Ver dispositivos</button></div>
  </Modal>;
}
