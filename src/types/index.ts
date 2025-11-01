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
