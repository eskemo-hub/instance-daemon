/**
 * Type definitions for the daemon service
 */

export interface ContainerConfig {
  name: string;
  port: number;
  volumeName: string;
  hostPath?: string; // Host path for bind mount (alternative to Docker volume)
  environment?: Record<string, string>;
  // Traefik configuration
  useTraefik?: boolean;
  domain?: string;
  subdomain?: string;
  // Template configuration
  image?: string;
  volumePath?: string;
  isDatabase?: boolean; // Flag to indicate database container (uses TCP routing)
  publicAccess?: boolean; // Whether database should be added to HAProxy
  isStackService?: boolean; // Flag to indicate container is part of a stack (uses internal networking)
}

export interface ContainerInfo {
  containerId: string;
  name: string;
  status: string;
  port: number;
  volumeName?: string;
  apiKey?: string;
}

export interface ContainerStatus {
  state: 'running' | 'stopped' | 'error';
  uptime?: number;
  restartCount: number;
}

export interface HealthMetrics {
  cpuUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  dockerStatus: boolean;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode?: number;
}

export interface ComposeStackConfig {
  name: string;
  composeFile: string;
  environment?: Record<string, string>;
  volumeName: string;
  volumePathTemplate?: string;
  useTraefik?: boolean;
  domain?: string;
  subdomain?: string;
  publicAccess?: boolean;
  port: number;
}

export interface ComposeStackInfo {
  name: string;
  status: string;
  services: Array<{
    name: string;
    status: 'running' | 'stopped' | 'error';
    ready: boolean;
  }>;
}
