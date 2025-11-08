import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import logger from '../utils/logger';

/**
 * General API rate limiter
 * Allows 100 requests per 15 minutes per IP
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'TooManyRequests',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
      method: req.method
    }, 'Rate limit exceeded');
    
    res.status(429).json({
      error: 'TooManyRequests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  },
  skip: (req: Request) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  }
});

/**
 * Strict rate limiter for resource-intensive operations
 * Allows 20 requests per minute per identifier (API key or IP)
 * Use for: container creation, stack deployment, backups
 * 
 * For authenticated requests: Uses API key hash as identifier (allows more requests per user)
 * For unauthenticated requests: Uses IP address as identifier
 */
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Increased from 10 to 20 requests per minute
  keyGenerator: (req: Request) => {
    // Use API key as identifier for authenticated requests (more permissive)
    // This allows different users/API keys to have separate rate limits
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      // Use a hash of the API key to avoid exposing it in logs
      // Simple hash for rate limiting purposes
      return `api-key:${Buffer.from(apiKey).toString('base64').substring(0, 16)}`;
    }
    // Fall back to IP for unauthenticated requests
    return req.ip || 'unknown';
  },
  message: {
    error: 'TooManyRequests',
    message: 'Too many resource-intensive requests, please try again later.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'] as string;
    logger.warn({
      ip: req.ip,
      path: req.path,
      method: req.method,
      hasApiKey: !!apiKey
    }, 'Strict rate limit exceeded');
    
    res.status(429).json({
      error: 'TooManyRequests',
      message: 'Too many resource-intensive requests, please try again later.',
      retryAfter: '1 minute'
    });
  }
});

/**
 * Very strict rate limiter for critical operations
 * Allows 5 requests per 5 minutes per IP
 * Use for: updates, certificate operations
 */
export const criticalRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Limit each IP to 5 requests per 5 minutes
  message: {
    error: 'TooManyRequests',
    message: 'Too many critical requests, please try again later.',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
      method: req.method
    }, 'Critical rate limit exceeded');
    
    res.status(429).json({
      error: 'TooManyRequests',
      message: 'Too many critical requests, please try again later.',
      retryAfter: '5 minutes'
    });
  }
});

