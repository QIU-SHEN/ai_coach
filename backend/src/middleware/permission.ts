import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { ERR_FORBIDDEN } from '../constants/errors';
import type { ApiResponse } from '../types';

/**
 * Require specific role(s)
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ code: ERR_FORBIDDEN.code, message: '权限不足' } as ApiResponse);
    }
    next();
  };
}

/**
 * Require owner access OR specific role(s)
 * Used for resources that belong to a user (e.g. practice records, debrief records)
 */
export function requireOwnerOrRole(userIdField: string, allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(403).json({ code: ERR_FORBIDDEN.code, message: '未登录' } as ApiResponse);
    }
    // Admin and manager can access any record
    if (allowedRoles.includes(user.role)) {
      return next();
    }
    // Employee can only access their own
    const resourceUserId = req.body[userIdField] || req.params[userIdField];
    if (resourceUserId && resourceUserId !== user.userId) {
      return res.status(403).json({ code: ERR_FORBIDDEN.code, message: '无权访问该记录' } as ApiResponse);
    }
    next();
  };
}

/**
 * Filter user_id for list queries
 * Returns the user_id that should be used in the SQL query
 * - Employee: always their own userId
 * - Manager/Admin: can query specific user_id or all (when user_id not provided)
 */
export function getQueryUserId(req: AuthRequest): string | undefined {
  const user = req.user;
  if (!user) return undefined;
  if (user.role === 'employee') {
    return user.userId;
  }
  // Admin can pass user_id param to filter, or omit to see all
  if (user.role === 'admin') {
    const paramUserId = req.query.user_id as string | undefined;
    return paramUserId;
  }
  // Manager: return special marker for downstream to handle
  return '__MANAGER_SUBORDINATES__';
}
