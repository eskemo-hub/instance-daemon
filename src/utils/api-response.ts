/**
 * API response utilities for consistent response formatting
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

/**
 * Create a successful API response
 */
export function apiSuccess<T>(data?: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create an error API response
 */
export function apiError(message: string): ApiResponse {
  return {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };
}