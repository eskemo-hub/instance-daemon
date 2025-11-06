import { Request, Response, NextFunction } from 'express';
import { Cache, cacheKey } from '../utils/cache';
import logger from '../utils/logger';

/**
 * Cache middleware options
 */
interface CacheOptions {
  cache: Cache;
  ttl?: number;
  keyGenerator?: (req: Request) => string;
  skipCache?: (req: Request) => boolean;
  skipCacheHeader?: boolean; // Skip cache if header is present
}

/**
 * Create cache middleware
 */
export function createCacheMiddleware(options: CacheOptions) {
  const {
    cache,
    ttl,
    keyGenerator = (req) => cacheKey(req.method, req.path, JSON.stringify(req.query), JSON.stringify(req.params)),
    skipCache = () => false,
    skipCacheHeader = true
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip cache if requested via header
    if (skipCacheHeader && req.headers['cache-control'] === 'no-cache') {
      return next();
    }

    // Skip cache if custom skip function returns true
    if (skipCache(req)) {
      return next();
    }

    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = keyGenerator(req);
    const cached = cache.get<any>(key);

    if (cached) {
      logger.debug({ key, path: req.path }, 'Cache hit');
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to cache response
    res.json = function(body: any) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, body, ttl);
        logger.debug({ key, path: req.path }, 'Cache miss - stored');
        res.setHeader('X-Cache', 'MISS');
      } else {
        res.setHeader('X-Cache', 'SKIP');
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Invalidate cache entries matching pattern
 */
export function invalidateCache(cache: Cache, pattern: string): number {
  const stats = cache.getStats();
  let invalidated = 0;

  for (const key of stats.keys) {
    if (key.includes(pattern)) {
      cache.delete(key);
      invalidated++;
    }
  }

  if (invalidated > 0) {
    logger.debug({ pattern, invalidated }, 'Cache invalidated');
  }

  return invalidated;
}

