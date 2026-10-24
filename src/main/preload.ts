import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/types';
const invoke = (name: keyof DesktopAPI, value?: unknown) => ipcRenderer.invoke(`tenda:${name}`, value);
const api: DesktopAPI = {
  connect: input => invoke('connect', input), demo: () => invoke('demo'), disconnect: () => invoke('disconnect'), connection: () => invoke('connection'),
  overview: () => invoke('overview'), clients: () => invoke('clients'), mesh: () => invoke('mesh'), features: () => invoke('features'),
  readFeature: input => invoke('readFeature', input), prepareChange: input => invoke('prepareChange', input), prepareClientChange: input => invoke('prepareClientChange', input), prepareAction: input => invoke('prepareAction', input),
  applyChange: input => invoke('applyChange', input), cancelChange: input => invoke('cancelChange', input), selectFile: input => invoke('selectFile', input), backup: () => invoke('backup'), logs: () => invoke('logs'), maintenanceStatus: () => invoke('maintenanceStatus'),
};
contextBridge.exposeInMainWorld('tenda', Object.freeze(api));
