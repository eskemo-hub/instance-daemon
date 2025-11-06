import { Request, Response } from 'express';
import logger from '../utils/logger';
import { getPerformanceStats } from '../middleware/performance.middleware';
import { gracefulDegradation } from '../middleware/graceful-degradation.middleware';
import { jobQueueService } from '../services/job-queue.service';
import { eventBus } from '../services/event-bus.service';
import { resourceCleanupService } from '../services/resource-cleanup.service';
import { dockerManager } from '../utils/docker-manager';

/**
 * Prometheus Metrics Exporter Service
 * Exports metrics in Prometheus format
 */
export class MetricsExporterService {
  private metrics: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  /**
   * Increment a counter
   */
  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + 1);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    this.metrics.set(key, value);
  }

  /**
   * Record a histogram value
   */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    // Keep only last 1000 values
    if (values.length > 1000) {
      values.shift();
    }
    this.histograms.set(key, values);
  }

  /**
   * Format metric key with labels
   */
  private formatKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    // Export counters
    for (const [key, value] of this.counters) {
      lines.push(`# TYPE ${this.getName(key)} counter`);
      lines.push(`${key} ${value}`);
    }

    // Export gauges
    for (const [key, value] of this.metrics) {
      lines.push(`# TYPE ${this.getName(key)} gauge`);
      lines.push(`${key} ${value}`);
    }

    // Export histograms
    for (const [key, values] of this.histograms) {
      if (values.length === 0) continue;
      
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;
      const avg = sum / count;
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];

      const baseName = this.getName(key);
      lines.push(`# TYPE ${baseName} histogram`);
      lines.push(`${baseName}_sum ${sum}`);
      lines.push(`${baseName}_count ${count}`);
      lines.push(`${baseName}_avg ${avg}`);
      lines.push(`${baseName}_min ${min}`);
      lines.push(`${baseName}_max ${max}`);
      lines.push(`${baseName}_p50 ${p50}`);
      lines.push(`${baseName}_p95 ${p95}`);
      lines.push(`${baseName}_p99 ${p99}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Extract metric name from key
   */
  private getName(key: string): string {
    const match = key.match(/^([^{]+)/);
    return match ? match[1] : key;
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics(): Promise<void> {
    try {
      // Performance metrics
      const perf = getPerformanceStats({ limit: 100 });
      this.setGauge('daemon_performance_avg_duration_ms', perf.averageDuration);
      this.setGauge('daemon_performance_min_duration_ms', perf.minDuration);
      this.setGauge('daemon_performance_max_duration_ms', perf.maxDuration);
      this.setGauge('daemon_performance_request_count', perf.requestCount);
      this.setGauge('daemon_performance_slow_queries', perf.slowQueries);

      // Job queue metrics
      const jobStats = jobQueueService.getStats();
      this.setGauge('daemon_jobs_pending', jobStats.pending);
      this.setGauge('daemon_jobs_processing', jobStats.processing);
      this.setGauge('daemon_jobs_completed', jobStats.completed);
      this.setGauge('daemon_jobs_failed', jobStats.failed);

      // Degradation mode
      const mode = gracefulDegradation.getMode();
      const modeValue = mode === 'normal' ? 0 : mode === 'read-only' ? 1 : mode === 'degraded' ? 2 : 3;
      this.setGauge('daemon_degradation_mode', modeValue);

      // Service health
      const health = gracefulDegradation.getServiceHealth();
      this.setGauge('daemon_service_health_docker', health.docker ? 1 : 0);
      this.setGauge('daemon_service_health_database', health.database ? 1 : 0);
      this.setGauge('daemon_service_health_disk', health.disk ? 1 : 0);

      // Docker connection
      const dockerConnected = await dockerManager.testConnection();
      this.setGauge('daemon_docker_connected', dockerConnected ? 1 : 0);

      // Event bus subscriptions
      const subscriptions = eventBus.getAllSubscriptions();
      this.setGauge('daemon_event_subscriptions', subscriptions.length);

    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to collect system metrics'
      );
    }
  }

  /**
   * Start metrics collection
   */
  start(intervalSeconds: number = 30): void {
    // Collect immediately
    this.collectSystemMetrics();

    // Then collect at intervals
    setInterval(() => {
      this.collectSystemMetrics();
    }, intervalSeconds * 1000);
  }
}

export const metricsExporter = new MetricsExporterService();

/**
 * Prometheus metrics endpoint handler
 */
export function prometheusMetricsHandler(req: Request, res: Response): void {
  try {
    // Collect latest metrics
    metricsExporter.collectSystemMetrics().then(() => {
      const metrics = metricsExporter.exportPrometheus();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.send(metrics);
    }).catch(error => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to export Prometheus metrics'
      );
      res.status(500).send('# Error collecting metrics\n');
    });
  } catch (error) {
    res.status(500).send('# Error collecting metrics\n');
  }
}

