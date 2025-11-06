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
  // Resource limits
  cpuLimit?: number; // CPU cores (e.g., 0.5, 1, 2)
  memoryLimit?: string; // Memory limit (e.g., "512m", "1g", "2g")
  memoryReservation?: string; // Memory reservation/soft limit (e.g., "256m", "512m")
  storageLimit?: string; // Storage limit (e.g., "10g", "50g") - Note: Docker doesn't directly support this, but can be used for monitoring
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
  // Traefik service configuration from template
  // _main has special structure: { serviceName: string; internalPort: number }
  // Other services have: { internalPort: number; enabled: boolean }
  traefikConfig?: Record<string, { internalPort: number; enabled?: boolean; serviceName?: string }>;
  // Resource limits (applied to main service or all services)
  cpuLimit?: number;
  memoryLimit?: string;
  memoryReservation?: string;
  storageLimit?: string;
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
