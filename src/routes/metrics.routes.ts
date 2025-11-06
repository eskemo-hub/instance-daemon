import { Router, Request, Response } from 'express';
import { prometheusMetricsHandler } from '../services/metrics-exporter.service';

export const metricsRoutes = Router();

/**
 * GET /api/metrics/prometheus
 * Export metrics in Prometheus format
 */
metricsRoutes.get('/prometheus', prometheusMetricsHandler);

/**
 * GET /api/metrics
 * Get metrics in JSON format
 */
metricsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const { metricsExporter } = await import('../services/metrics-exporter.service');
    await metricsExporter.collectSystemMetrics();

    // Export as JSON
    const metrics: Record<string, any> = {};
    
    // Counters
    for (const [key, value] of metricsExporter['counters']) {
      metrics[key] = { type: 'counter', value };
    }

    // Gauges
    for (const [key, value] of metricsExporter['metrics']) {
      metrics[key] = { type: 'gauge', value };
    }

    // Histograms
    for (const [key, values] of metricsExporter['histograms']) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      metrics[key] = {
        type: 'histogram',
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)]
      };
    }

    res.status(200).json({
      success: true,
      data: metrics,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

