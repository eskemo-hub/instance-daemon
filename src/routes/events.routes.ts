import { Router, Request, Response, NextFunction } from 'express';
import { eventBus, EventType } from '../services/event-bus.service';
import { ValidationError } from '../middleware/error.middleware';
import { authMiddleware } from '../middleware/auth.middleware';

export const eventsRoutes = Router();

/**
 * POST /api/events/subscribe
 * Subscribe to events
 */
eventsRoutes.post('/subscribe', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventTypes, webhookUrl, enabled = true } = req.body;

    if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      throw new ValidationError('eventTypes must be a non-empty array');
    }

    // Validate event types
    const validTypes: EventType[] = [
      'container.created', 'container.started', 'container.stopped', 'container.deleted',
      'compose.created', 'compose.started', 'compose.stopped', 'compose.deleted',
      'backup.created', 'backup.completed', 'backup.failed',
      'job.completed', 'job.failed',
      'health.degraded', 'resource.limit_exceeded', 'security.alert'
    ];

    for (const type of eventTypes) {
      if (!validTypes.includes(type) && type !== '*') {
        throw new ValidationError(`Invalid event type: ${type}`);
      }
    }

    const subscriptionId = eventBus.subscribe({
      eventTypes,
      webhookUrl,
      enabled
    });

    return res.status(201).json({
      success: true,
      data: {
        subscriptionId,
        eventTypes,
        webhookUrl,
        enabled
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/events/subscribe/:id
 * Unsubscribe from events
 */
eventsRoutes.delete('/subscribe/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const deleted = eventBus.unsubscribe(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription removed'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/events/subscribe
 * Get all subscriptions
 */
eventsRoutes.get('/subscribe', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subscriptions = eventBus.getAllSubscriptions();
    return res.status(200).json({
      success: true,
      data: subscriptions
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/events/history
 * Get event history
 */
eventsRoutes.get('/history', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = req.query.type as EventType | undefined;
    const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined;
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    const events = eventBus.getEventHistory({
      type,
      startTime,
      endTime,
      limit
    });

    return res.status(200).json({
      success: true,
      data: events,
      count: events.length
    });
  } catch (error) {
    next(error);
  }
});

