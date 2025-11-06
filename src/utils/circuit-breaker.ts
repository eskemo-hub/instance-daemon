import logger from './logger';

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time in ms before attempting to close
  successThreshold: number; // Number of successes in half-open to close
  timeout: number; // Operation timeout in ms
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  successThreshold: 2,
  timeout: 30000
};

/**
 * Circuit breaker for protecting against cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit should be opened/closed
    this.updateState();

    if (this.state === 'open') {
      throw new Error('Circuit breaker is OPEN - operation rejected');
    }

    try {
      // Execute with timeout
      const result = await Promise.race([
        operation(),
        this.createTimeoutPromise()
      ]);

      // Success
      this.onSuccess();
      return result as T;
    } catch (error) {
      // Failure
      this.onFailure();
      throw error;
    }
  }

  /**
   * Update circuit state based on failures and time
   */
  private updateState(): void {
    const now = Date.now();

    if (this.state === 'open') {
      // Check if enough time has passed to try half-open
      if (now - this.lastFailureTime >= this.config.resetTimeout) {
        logger.info('Circuit breaker transitioning to HALF-OPEN');
        this.state = 'half-open';
        this.successes = 0;
      }
    } else if (this.state === 'half-open') {
      // Stay in half-open until success threshold or failure
      // State will be updated in onSuccess/onFailure
    } else {
      // Closed - normal operation
      // Reset failures if enough time has passed
      if (this.failures > 0 && now - this.lastFailureTime >= this.config.resetTimeout) {
        logger.debug('Resetting circuit breaker failures');
        this.failures = 0;
      }
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failures = 0;

    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        logger.info('Circuit breaker transitioning to CLOSED');
        this.state = 'closed';
        this.successes = 0;
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Any failure in half-open goes back to open
      logger.warn('Circuit breaker transitioning to OPEN (failure in half-open)');
      this.state = 'open';
      this.successes = 0;
    } else if (this.failures >= this.config.failureThreshold) {
      logger.warn({ failures: this.failures }, 'Circuit breaker transitioning to OPEN');
      this.state = 'open';
    }
  }

  /**
   * Create timeout promise
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
    });
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
  } {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime
    };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    logger.info('Circuit breaker reset');
  }
}

/**
 * Circuit breaker instances for different operation types
 */
export const dockerCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
  timeout: 30000
});

export const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 10,
  resetTimeout: 30000,
  timeout: 10000
});

export const composeCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 120000,
  timeout: 300000
});

