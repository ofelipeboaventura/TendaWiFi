import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="fatal-screen"><div className="brand-mark">t</div><h1>Não foi possível exibir esta tela</h1><p>Reabra o aplicativo para estabelecer uma nova sessão com o roteador.</p><button className="btn primary" onClick={() => window.location.reload()}>Reabrir painel</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
