/**
 * Unit tests for circuit breaker
 */

import { CircuitBreaker } from '../../src/utils/circuit-breaker';

describe('Circuit Breaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      successThreshold: 2,
      timeout: 5000
    });
  });

  describe('State Management', () => {
    it('should start in closed state', () => {
      expect(circuitBreaker.getState()).toBe('closed');
    });

    it('should open after threshold failures', async () => {
      // Simulate failures
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(() => Promise.reject(new Error('Test error')));
        } catch (error) {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe('open');
    });

    it('should reject operations when open', async () => {
      // Force open state
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(() => Promise.reject(new Error('Test error')));
        } catch (error) {
          // Expected
        }
      }

      await expect(
        circuitBreaker.execute(() => Promise.resolve('success'))
      ).rejects.toThrow('Circuit breaker is OPEN');
    });
  });

  describe('Success Handling', () => {
    it('should execute successful operations', async () => {
      const result = await circuitBreaker.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });

    it('should reset failures on success', async () => {
      // Cause one failure
      try {
        await circuitBreaker.execute(() => Promise.reject(new Error('Test error')));
      } catch (error) {
        // Expected
      }

      // Success should reset
      await circuitBreaker.execute(() => Promise.resolve('success'));
      const stats = circuitBreaker.getStats();
      expect(stats.failures).toBe(0);
    });
  });
});

