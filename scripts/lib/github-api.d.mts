import type {Readable} from 'node:stream';
export declare const repository: 'ofelipeboaventura/TendaWiFi';
export interface GitHubRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  json?: unknown;
  stream?: Readable;
  size?: number;
  contentType?: string;
  upload?: boolean;
  allow404?: boolean;
}
export declare function githubClient(): (route: string, options?: GitHubRequestOptions) => Promise<unknown>;
