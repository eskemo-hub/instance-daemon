import WebSocket from 'ws';
import axios from 'axios';
import { EventEmitter } from 'events';

interface PendingRequest {
  resolve: (response: any) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

interface QueuedMessage {
  type: string;
  payload: any;
  timestamp: number;
  retries: number;
}

/**
 * TunnelClient connects to the platform's tunnel server
 * Allows daemon behind NAT to receive commands from platform
 */
export class TunnelClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageQueue: QueuedMessage[] = [];
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly MAX_RECONNECT_DELAY = 60000; // 1 minute max
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly MAX_MESSAGE_RETRIES = 3;
  private reconnectAttempts = 0;
  private isConnecting = false;
  private shouldReconnect = true;

  constructor(
    private platformUrl: string,
    private serverId: string,
    private apiKey: string
  ) {
    super();
  }

  /**
   * Connect to platform tunnel server
   */
  async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      // Convert HTTP URL to WebSocket URL
      const wsUrl = this.platformUrl
        .replace('http://', 'ws://')
        .replace('https://', 'wss://');

      const url = `${wsUrl}/api/tunnel?serverId=${this.serverId}&apiKey=${encodeURIComponent(this.apiKey)}`;

      console.log('[TUNNEL-CLIENT] Connecting to platform tunnel server...');
      this.ws = new WebSocket(url);

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason));
      this.ws.on('error', (error) => this.handleError(error));
      this.ws.on('ping', () => this.handlePing());
      this.ws.on('pong', () => this.handlePong());

    } catch (error) {
      console.error('[TUNNEL-CLIENT] Connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from tunnel server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error('Tunnel disconnected'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Check if tunnel is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Handle connection open
   */
  private handleOpen(): void {
    console.log('[TUNNEL-CLIENT] Connected to platform tunnel server');
    this.isConnecting = false;
    this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
    this.emit('connected');

    // Start heartbeat
    this.startHeartbeat();

    // Flush queued messages
    this.flushMessageQueue();
  }

  /**
   * Handle incoming message from platform
   */
  private async handleMessage(data: WebSocket.Data): Promise<void> {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'welcome') {
        console.log('[TUNNEL-CLIENT] Received welcome:', message.message);
        console.log('[TUNNEL-CLIENT] Tunnel ID:', message.tunnelId);
      } else if (message.type === 'http-request') {
        // Handle HTTP request from platform
        await this.handleHttpRequest(message);
      } else if (message.type === 'heartbeat-ack') {
        // Heartbeat acknowledged
      }
    } catch (error) {
      console.error('[TUNNEL-CLIENT] Error handling message:', error);
    }
  }

  /**
   * Handle HTTP request from platform
   */
  private async handleHttpRequest(message: any): Promise<void> {
    const { requestId, method, path, body, headers } = message;

    try {
      // Make local HTTP request to daemon API
      const response = await axios({
        method,
        url: `http://localhost:${process.env.PORT || 3001}${path}`,
        data: body,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true, // Don't throw on any status
      });

      // Send response back through tunnel
      this.sendResponse(requestId, {
        status: response.status,
        data: response.data,
        headers: response.headers,
      });
    } catch (error: any) {
      console.error('[TUNNEL-CLIENT] Error processing HTTP request:', error);
      this.sendResponse(requestId, {
        status: 500,
        error: error.message || 'Internal server error',
      });
    }
  }

  /**
   * Send HTTP response back to platform
   */
  private sendResponse(requestId: string, response: any): void {
    const message = {
      type: 'http-response',
      requestId,
      ...response,
    };

    this.sendMessage(message);
  }

  /**
   * Send message with queuing support
   */
  private sendMessage(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message if not connected
      this.queueMessage(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[TUNNEL-CLIENT] Error sending message:', error);
      this.queueMessage(message);
    }
  }

  /**
   * Queue message for later sending
   */
  private queueMessage(message: any): void {
    if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
      console.warn('[TUNNEL-CLIENT] Message queue full, dropping oldest message');
      this.messageQueue.shift();
    }

    this.messageQueue.push({
      type: message.type,
      payload: message,
      timestamp: Date.now(),
      retries: 0
    });
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    if (!this.isConnected() || this.messageQueue.length === 0) {
      return;
    }

    const messages = [...this.messageQueue];
    this.messageQueue = [];

    for (const queued of messages) {
      try {
        this.ws!.send(JSON.stringify(queued.payload));
      } catch (error) {
        // Re-queue if send fails
        queued.retries++;
        if (queued.retries < this.MAX_MESSAGE_RETRIES) {
          this.messageQueue.push(queued);
        } else {
          console.error('[TUNNEL-CLIENT] Message dropped after max retries:', queued);
        }
      }
    }

    if (messages.length > 0) {
      console.log(`[TUNNEL-CLIENT] Flushed ${messages.length} queued messages`);
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(code: number, reason: Buffer): void {
    console.log(`[TUNNEL-CLIENT] Connection closed: ${code} - ${reason.toString()}`);
    this.isConnecting = false;
    this.emit('disconnected', { code, reason: reason.toString() });

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error('Tunnel closed'));
    }
    this.pendingRequests.clear();

    // Schedule reconnect if needed
    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle connection error
   */
  private handleError(error: Error): void {
    console.error('[TUNNEL-CLIENT] WebSocket error:', error);
    this.emit('error', error);
  }

  /**
   * Handle ping from server
   */
  private handlePing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.pong();
    }
  }

  /**
   * Handle pong from server
   */
  private handlePong(): void {
    // Connection is alive
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    connected: boolean;
    queueSize: number;
    pendingRequests: number;
    reconnectAttempts: number;
  } {
    return {
      connected: this.isConnected(),
      queueSize: this.messageQueue.length,
      pendingRequests: this.pendingRequests.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    // Exponential backoff with jitter
    const baseDelay = Math.min(
      this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      this.MAX_RECONNECT_DELAY
    );
    const jitter = Math.random() * 1000; // Add up to 1 second jitter
    const delay = baseDelay + jitter;

    this.reconnectAttempts++;

    console.log(`[TUNNEL-CLIENT] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Start sending heartbeats
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, this.HEARTBEAT_INTERVAL);
  }
}
