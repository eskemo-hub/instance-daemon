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

/**
 * Docker container stats structure from Docker API
 */
export interface DockerContainerStats {
  cpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage?: number[];
    };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: {
      total_usage: number;
    };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
  };
  networks?: Record<string, {
    rx_bytes: number;
    tx_bytes: number;
  }>;
  blkio_stats?: {
    io_service_bytes_recursive?: Array<{
      major: number;
      minor: number;
      op: string;
      value: number;
    }>;
    io_serviced_recursive?: Array<{
      major: number;
      minor: number;
      op: string;
      value: number;
    }>;
  };
  pids_stats?: {
    current: number;
  };
}

/**
 * Docker Compose file structure
 */
export interface ComposeFileData {
  version?: string;
  services?: Record<string, ComposeService>;
  networks?: Record<string, ComposeNetwork>;
  volumes?: Record<string, ComposeVolume>;
}

export interface ComposeService {
  image?: string;
  build?: string | { context: string; dockerfile?: string };
  ports?: string[] | Array<{ target: number; published: number; protocol?: string }>;
  environment?: string[] | Record<string, string>;
  env_file?: string | string[];
  volumes?: string[] | Array<{ type: string; source: string; target: string }>;
  networks?: string[] | Record<string, ComposeNetworkConfig>;
  labels?: Record<string, string>;
  deploy?: {
    resources?: {
      limits?: {
        cpus?: string | number;
        memory?: string;
      };
      reservations?: {
        memory?: string;
      };
    };
  };
  restart?: string;
  depends_on?: string[] | Record<string, { condition: string }>;
  [key: string]: unknown;
}

export interface ComposeNetwork {
  driver?: string;
  external?: boolean;
  name?: string;
  [key: string]: unknown;
}

export interface ComposeVolume {
  driver?: string;
  external?: boolean;
  name?: string;
  [key: string]: unknown;
}

export interface ComposeNetworkConfig {
  aliases?: string[];
  [key: string]: unknown;
}
