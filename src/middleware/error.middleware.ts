import { Request, Response, NextFunction } from 'express';

/**
 * Custom error classes
 */
export class ValidationError extends Error {
  statusCode = 400;
  
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class DockerError extends Error {
  statusCode = 500;
  
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'DockerError';
  }
}

/**
 * Log error with context
 */
function logError(error: Error, req: Request): void {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  
  console.error(`[${timestamp}] [ERROR] ${method} ${path}`);
  console.error('Error:', error.message);
  
  if (process.env.NODE_ENV === 'development' && error.stack) {
    console.error('Stack:', error.stack);
  }
}

/**
 * Global error handling middleware
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log the error
  logError(err, req);

  // Determine status code
  let statusCode = 500;
  if ('statusCode' in err && typeof (err as any).statusCode === 'number') {
    statusCode = (err as any).statusCode;
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
  } else if (err.message.includes('No such container')) {
    statusCode = 404;
    err.name = 'NotFoundError';
    err.message = 'Container not found';
  } else if (err.message.includes('no such volume') || 
             (err.message.includes('Volume') && err.message.includes('not found'))) {
    statusCode = 404;
    err.name = 'NotFoundError';
    // Keep the detailed message from the service
  } else if (err.message.includes('in use') && err.message.includes('Volume')) {
    statusCode = 409;
    err.name = 'ConflictError';
    // Keep the detailed message from the service
  } else if (err.message.includes('port is already allocated')) {
    statusCode = 409;
    err.name = 'ConflictError';
    err.message = 'Port is already in use';
  } else if (err.message.includes('Permission denied')) {
    statusCode = 403;
    err.name = 'ForbiddenError';
    // Keep the detailed message from the service
  } else if (err.message.includes('Cannot connect to the Docker daemon')) {
    statusCode = 503;
    err.name = 'ServiceUnavailableError';
    err.message = 'Docker daemon is not available';
  }

  // Build error response
  const errorResponse: any = {
    error: err.name || 'Error',
    message: err.message || 'Internal server error',
    statusCode,
  };
  
  // Ensure we always have a meaningful error name
  if (!errorResponse.error || errorResponse.error === 'Error') {
    errorResponse.error = err.constructor.name || 'Error';
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development' && err.stack) {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};
