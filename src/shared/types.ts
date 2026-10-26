import type { ObservabilityCommands } from './observability';
import type { MonitoringCommands } from './monitoring';
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Values = Record<string, JsonValue>;
export type ErrorCode = 'VALIDATION' | 'AUTH' | 'LOCKED' | 'OFFLINE' | 'TIMEOUT' | 'UNCERTAIN' | 'CONFLICT' | 'UNSUPPORTED' | 'ROUTER' | 'FORBIDDEN' | 'INTERNAL';
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };
export interface ConnectionStatus { connected: boolean; demo: boolean; host: string; model: string; firmware: string; hardware: string; mode: string; capabilities: string[] }
export interface MeshNode { id: string; name: string; model: string; ip: string; parentId: string | null; online: boolean; primary: boolean; clients: number; quality: string; band: string }
export interface ClientDevice { ambiguous?: boolean; negotiatedMbps?: number | null; rssi?: string | null; id: string; mac: string; name: string; ip: string; nodeId: string; nodeName: string; online: boolean; guest: boolean; blocked: boolean; local: boolean; connection: string; upload: number; download: number; uploadLimit: number; downloadLimit: number; uptime: number }
export interface Overview { internet: boolean; wanIp: string; connectionType: string; upload: number; download: number; uptime: number; clientCount: number; nodeCount: number; wifiNames: string[]; nodes: MeshNode[]; sampledAt: string; model: string; firmware: string; mode: string }
export type FieldKind = 'text' | 'password' | 'number' | 'switch' | 'select' | 'textarea';
export interface FieldDefinition { key: string; label: string; type: FieldKind; description?: string; placeholder?: string; options?: { label: string; value: string }[]; min?: number; max?: number; required?: boolean; section?: string; readonly?: boolean }
export interface TableDefinition { key: string; label: string; fields: FieldDefinition[]; maxRows: number }
export interface FeatureDefinition { id: string; title: string; description: string; group: 'wifi' | 'network' | 'security' | 'system'; icon: string; risk: 'normal' | 'disconnect' | 'security'; fields: FieldDefinition[]; tables?: TableDefinition[]; readonly?: boolean; available?: boolean; unavailableReason?: string }
export interface FeatureSnapshot { id: string; values: Values; revision: string; sampledAt: string }
export interface ChangePreview { id: string; title: string; summary: string[]; risk: 'normal' | 'disconnect' | 'security' | 'destructive'; expiresAt: string; warning?: string }
export interface ApplyResult { message: string; reconnect: boolean; uncertain?: boolean }
export interface SelectedFile { id: string; name: string; size: number; sha256: string; kind: 'firmware' | 'configuration' }
export interface AuditEntry { time: string; action: string; outcome: string }
export interface MaintenanceStatus { firmware: { nodeId: string; name: string; current: string; latest: string; available: boolean; status: string }[]; discovered: { serial: string; name: string }[] }
export type MaintenanceAction = 'reboot' | 'reset' | 'meshOptimize' | 'meshScan' | 'meshAdd' | 'checkFirmware' | 'upgradeOnline' | 'restore' | 'firmware' | 'changePassword' | 'clearLogs';
export type ActionRequest =
  | { action: 'reboot' | 'reset' | 'checkFirmware' | 'upgradeOnline'; nodeId?: string }
  | { action: 'firmware'; fileId: string; nodeId?: string }
  | { action: 'meshOptimize' | 'meshScan' | 'clearLogs' }
  | { action: 'meshAdd'; nodeSerial: string }
  | { action: 'restore'; fileId: string }
  | { action: 'changePassword'; oldPassword: string; newPassword: string; confirmPassword: string };
/** Only these actions accept a selected mesh node. Global requests must have no extra fields. */
export function withMaintenanceTarget(input: ActionRequest, selectedNodeId?: string): ActionRequest {
  switch (input.action) {
    case 'reboot': case 'reset': case 'checkFirmware': case 'upgradeOnline': case 'firmware':
      return input.nodeId !== undefined || !selectedNodeId ? input : { ...input, nodeId: selectedNodeId };
    default: return input;
  }
}
export interface ClientChange { mac: string; nodeId: string; name?: string; blocked?: boolean; uploadLimit?: number; downloadLimit?: number }
export interface DesktopAPI extends MonitoringCommands, ObservabilityCommands {
  connect(input: { host: string; password: string }): Promise<Result<ConnectionStatus>>;
  demo(): Promise<Result<ConnectionStatus>>;
  disconnect(): Promise<Result<void>>;
  connection(): Promise<Result<ConnectionStatus>>;
  overview(): Promise<Result<Overview>>;
  clients(): Promise<Result<ClientDevice[]>>;
  mesh(): Promise<Result<MeshNode[]>>;
  features(): Promise<Result<FeatureDefinition[]>>;
  readFeature(input: { id: string }): Promise<Result<FeatureSnapshot>>;
  prepareChange(input: { id: string; values: Values; revision: string }): Promise<Result<ChangePreview>>;
  prepareClientChange(input: ClientChange): Promise<Result<ChangePreview>>;
  prepareAction(input: ActionRequest): Promise<Result<ChangePreview>>;
  applyChange(input: { id: string }): Promise<Result<ApplyResult>>;
  cancelChange(input: { id: string }): Promise<Result<void>>;
  selectFile(input: { kind: 'firmware' | 'configuration' }): Promise<Result<SelectedFile | null>>;
  backup(): Promise<Result<{ saved: boolean }>>;
  logs(): Promise<Result<{ router: string; audit: AuditEntry[] }>>;
  maintenanceStatus(): Promise<Result<MaintenanceStatus>>;
  onMonitoringUpdate(listener: (state: import('./monitoring').MonitoringState) => void): () => void;
}
export type DesktopCommand = Exclude<keyof DesktopAPI, 'onMonitoringUpdate'>;
declare global { interface Window { tenda: DesktopAPI } }
