import { EventEmitter } from 'events';
import axios from 'axios';
import logger from '../utils/logger';
import { databaseService } from './database.service';

/**
 * Event types
 */
export type EventType =
  | 'container.created'
  | 'container.started'
  | 'container.stopped'
  | 'container.deleted'
  | 'compose.created'
  | 'compose.started'
  | 'compose.stopped'
  | 'compose.deleted'
  | 'backup.created'
  | 'backup.completed'
  | 'backup.failed'
  | 'job.completed'
  | 'job.failed'
  | 'health.degraded'
  | 'resource.limit_exceeded'
  | 'security.alert';

/**
 * Event data
 */
export interface EventData {
  type: EventType;
  timestamp: number;
  source: string;
  data: any;
  metadata?: Record<string, any>;
}

/**
 * Event subscription
 */
export interface EventSubscription {
  id: string;
  eventTypes: EventType[];
  webhookUrl?: string;
  callback?: (event: EventData) => void;
  enabled: boolean;
  createdAt: number;
}

/**
 * Event Bus Service
 * Manages events, subscriptions, and webhook notifications
 */
export class EventBusService extends EventEmitter {
  private subscriptions: Map<string, EventSubscription> = new Map();
  private eventHistory: EventData[] = [];
  private readonly maxHistorySize: number = 10000;

  constructor() {
    super();
    this.loadSubscriptions();
  }

  /**
   * Emit an event
   */
  emitEvent(type: EventType, source: string, data: any, metadata?: Record<string, any>): void {
    const event: EventData = {
      type,
      timestamp: Date.now(),
      source,
      data,
      metadata
    };

    // Add to history
    this.addToHistory(event);

    // Emit to local listeners
    this.emit(type, event);
    this.emit('*', event); // Wildcard listener

    // Notify subscribers
    this.notifySubscribers(event);

    logger.debug({ type, source }, 'Event emitted');
  }

  /**
   * Subscribe to events
   */
  subscribe(subscription: Omit<EventSubscription, 'id' | 'createdAt'>): string {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullSubscription: EventSubscription = {
      ...subscription,
      id,
      createdAt: Date.now()
    };

    this.subscriptions.set(id, fullSubscription);
    this.saveSubscriptions();

    logger.info({ id, eventTypes: subscription.eventTypes }, 'Event subscription created');

    return id;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(id: string): boolean {
    const deleted = this.subscriptions.delete(id);
    if (deleted) {
      this.saveSubscriptions();
      logger.info({ id }, 'Event subscription removed');
    }
    return deleted;
  }

  /**
   * Get subscription
   */
  getSubscription(id: string): EventSubscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * Get all subscriptions
   */
  getAllSubscriptions(): EventSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Notify subscribers about an event
   */
  private async notifySubscribers(event: EventData): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.enabled) {
        continue;
      }

      // Check if subscription matches event type
      if (!subscription.eventTypes.includes(event.type) && !subscription.eventTypes.includes('*' as EventType)) {
        continue;
      }

      // Call callback if provided
      if (subscription.callback) {
        try {
          subscription.callback(event);
        } catch (error) {
          logger.error(
            { subscriptionId: subscription.id, error: error instanceof Error ? error.message : String(error) },
            'Event callback failed'
          );
        }
      }

      // Send webhook if configured
      if (subscription.webhookUrl) {
        this.sendWebhook(subscription, event).catch(error => {
          logger.error(
            { subscriptionId: subscription.id, error: error instanceof Error ? error.message : String(error) },
            'Webhook notification failed'
          );
        });
      }
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(subscription: EventSubscription, event: EventData): Promise<void> {
    try {
      await axios.post(
        subscription.webhookUrl!,
        event,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Source': 'n8n-daemon',
            'X-Subscription-Id': subscription.id
          },
          timeout: 10000
        }
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add event to history
   */
  private addToHistory(event: EventData): void {
    this.eventHistory.push(event);

    // Limit history size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Store in database
    this.storeEvent(event);
  }

  /**
   * Store event in database
   */
  private storeEvent(event: EventData): void {
    try {
      const db = databaseService.getDatabase();
      db.prepare(`
        INSERT INTO audit_log (timestamp, operation, success, metadata)
        VALUES (?, ?, ?, ?)
      `).run(
        event.timestamp,
        `EVENT: ${event.type}`,
        1,
        JSON.stringify({
          source: event.source,
          data: event.data,
          metadata: event.metadata
        })
      );
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to store event'
      );
    }
  }

  /**
   * Get event history
   */
  getEventHistory(options: {
    type?: EventType;
    startTime?: number;
    endTime?: number;
    limit?: number;
  } = {}): EventData[] {
    let events = [...this.eventHistory];

    if (options.type) {
      events = events.filter(e => e.type === options.type);
    }

    if (options.startTime) {
      events = events.filter(e => e.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      events = events.filter(e => e.timestamp <= options.endTime!);
    }

    // Sort by timestamp descending
    events.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) {
      events = events.slice(0, options.limit);
    }

    return events;
  }

  /**
   * Load subscriptions from database
   */
  private loadSubscriptions(): void {
    // In a full implementation, this would load from database
    // For now, subscriptions are in-memory only
  }

  /**
   * Save subscriptions to database
   */
  private saveSubscriptions(): void {
    // In a full implementation, this would save to database
    // For now, subscriptions are in-memory only
  }
}

export const eventBus = new EventBusService();

