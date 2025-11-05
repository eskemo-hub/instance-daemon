import WebSocket from 'ws';
import axios from 'axios';
import { EventEmitter } from 'events';

interface PendingRequest {
  resolve: (response: any) => void;
  reject: (error: Error) => void;
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
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
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
    this.emit('connected');

    // Start heartbeat
    this.startHeartbeat();
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[TUNNEL-CLIENT] Cannot send response, tunnel not connected');
      return;
    }

    const message = {
      type: 'http-response',
      requestId,
      ...response,
    };

    this.ws.send(JSON.stringify(message));
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
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    console.log(`[TUNNEL-CLIENT] Reconnecting in ${this.RECONNECT_DELAY}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.RECONNECT_DELAY);
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
