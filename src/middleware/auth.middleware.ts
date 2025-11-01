import { Request, Response, NextFunction } from 'express';

/**
 * Authentication middleware that validates API key from request headers
 * Requirement 11.3: Daemon SHALL authenticate commands from the Platform using credentials or tokens
 * Requirement 12.2: Platform SHALL authenticate to Daemons using API keys
 * Requirement 12.3: Daemon SHALL reject commands that fail authentication
 */
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const apiKey = req.headers['x-api-key'] as string;
  const expectedApiKey = process.env.API_KEY;

  if (!expectedApiKey) {
    res.status(500).json({
      error: 'Configuration Error',
      message: 'API key not configured on daemon',
    });
    return;
  }

  if (!apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'API key is required',
    });
    return;
  }

  if (apiKey !== expectedApiKey) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key',
    });
    return;
  }

  next();
};
