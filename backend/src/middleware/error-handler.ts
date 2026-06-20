import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../constants/errors';
import type { ApiResponse } from '../types';
import { logger } from '../services/logger';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      code: err.code,
      message: err.message,
    } as ApiResponse);
    return;
  }

  logger.error('Unhandled error:', err);
  res.status(500).json({
    code: 500000,
    message: '系统暂时无法处理，请稍后重试',
  } as ApiResponse);
}
