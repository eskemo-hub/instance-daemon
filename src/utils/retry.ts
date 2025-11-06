import logger from './logger';

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true
};

/**
 * Retry operation with exponential backoff and jitter
 */
export async function retry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | unknown;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === retryConfig.maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt);
      
      // Apply max delay cap
      delay = Math.min(delay, retryConfig.maxDelay);

      // Add jitter to prevent thundering herd
      if (retryConfig.jitter) {
        const jitterAmount = delay * 0.1; // 10% jitter
        delay = delay + (Math.random() * 2 - 1) * jitterAmount;
      }

      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries: retryConfig.maxRetries,
          delay: Math.round(delay),
          error: error instanceof Error ? error.message : String(error)
        },
        'Operation failed, retrying'
      );

      await sleep(delay);
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Retry with custom error predicate
 * Only retries if the error matches the predicate
 */
export async function retryIf<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | unknown;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!shouldRetry(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === retryConfig.maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt);
      delay = Math.min(delay, retryConfig.maxDelay);

      // Add jitter
      if (retryConfig.jitter) {
        const jitterAmount = delay * 0.1;
        delay = delay + (Math.random() * 2 - 1) * jitterAmount;
      }

      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries: retryConfig.maxRetries,
          delay: Math.round(delay),
          error: error instanceof Error ? error.message : String(error)
        },
        'Operation failed, retrying'
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  
  // Network errors
  if (
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('timeout')
  ) {
    return true;
  }

  // Docker errors that might be transient
  if (
    message.includes('connection reset') ||
    message.includes('socket hang up') ||
    message.includes('temporary failure')
  ) {
    return true;
  }

  // HTTP 5xx errors (server errors)
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true;
  }

  return false;
}

