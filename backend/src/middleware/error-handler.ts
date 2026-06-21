import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../constants/errors';
import type { ApiResponse } from '../types';
import { logger } from '../services/logger';
import { captureException } from '../services/sentry';
import { pushError } from '../services/error-ring';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      code: err.code,
      message: err.message,
    } as ApiResponse);
    return;
  }

  captureException(err, {
    path: _req.path,
    method: _req.method,
  });

  pushError({
    time: new Date().toISOString(),
    message: err.message,
    path: _req.path,
    method: _req.method,
  });

  logger.error('Unhandled error:', err);
  res.status(500).json({
    code: 500000,
    message: '系统暂时无法处理，请稍后重试',
  } as ApiResponse);
}
