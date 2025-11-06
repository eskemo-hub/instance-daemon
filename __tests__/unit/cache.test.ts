/**
 * Unit tests for cache service
 */

import { Cache } from '../../src/utils/cache';

describe('Cache Service', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache(1000); // 1 second TTL
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Basic Operations', () => {
    it('should set and get values', () => {
      cache.set('test', 'value');
      expect(cache.get('test')).toBe('value');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should delete values', () => {
      cache.set('test', 'value');
      cache.delete('test');
      expect(cache.get('test')).toBeNull();
    });

    it('should check if key exists', () => {
      cache.set('test', 'value');
      expect(cache.has('test')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });
  });

  describe('TTL Expiration', () => {
    it('should expire values after TTL', (done) => {
      cache.set('test', 'value', 100); // 100ms TTL
      expect(cache.get('test')).toBe('value');
      
      setTimeout(() => {
        expect(cache.get('test')).toBeNull();
        done();
      }, 150);
    });
  });

  describe('Statistics', () => {
    it('should return cache statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });
  });
});

