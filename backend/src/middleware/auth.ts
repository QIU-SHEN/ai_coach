import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const secret: string = JWT_SECRET;

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
    role: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 401000, message: '缺少 Token' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, secret) as { userId: string; username: string; role: string };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ code: 401001, message: 'Token 无效或已过期' });
  }
}

export function generateToken(payload: { userId: string; username: string; role: string }): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}
