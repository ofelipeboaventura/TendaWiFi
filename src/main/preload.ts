import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, DesktopCommand } from '../shared/types';
const invoke = (name: DesktopCommand, value?: unknown) => ipcRenderer.invoke(`tenda:${name}`, value);
const api: DesktopAPI = {
  connect: input => invoke('connect', input), demo: () => invoke('demo'), disconnect: () => invoke('disconnect'), connection: () => invoke('connection'),
  overview: () => invoke('overview'), clients: () => invoke('clients'), mesh: () => invoke('mesh'), features: () => invoke('features'),
  readFeature: input => invoke('readFeature', input), prepareChange: input => invoke('prepareChange', input), prepareClientChange: input => invoke('prepareClientChange', input), prepareAction: input => invoke('prepareAction', input),
  applyChange: input => invoke('applyChange', input), cancelChange: input => invoke('cancelChange', input), selectFile: input => invoke('selectFile', input), backup: () => invoke('backup'), logs: () => invoke('logs'), maintenanceStatus: () => invoke('maintenanceStatus'),
  monitoringStatus: () => invoke('monitoringStatus'), monitoringHistory: input => invoke('monitoringHistory', input), monitoringSaveSettings: input => invoke('monitoringSaveSettings', input), monitoringPause: input => invoke('monitoringPause', input), exportMonitoring: input => invoke('exportMonitoring', input),
  onMonitoringUpdate: listener => { const handler = (_event: Electron.IpcRendererEvent, value: import('../shared/monitoring').MonitoringState) => listener(value); ipcRenderer.on('tenda:monitoring-update', handler); return () => { ipcRenderer.removeListener('tenda:monitoring-update', handler); }; },
};
contextBridge.exposeInMainWorld('tenda', Object.freeze(api));
