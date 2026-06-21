import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db';
import { ERR_TOKEN_REVOKED } from '../constants/errors';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const secret: string = JWT_SECRET;

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
    role: string;
  };
  tokenHash?: string;
  tokenExp?: number;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 401000, message: '缺少 Token' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, secret) as { userId: string; username: string; role: string; exp?: number };

    // Check blacklist
    const tokenHash = hashToken(token);
    const [rows]: any = await pool.execute(
      'SELECT 1 FROM jwt_blacklist WHERE token_hash = ? AND expires_at > NOW() LIMIT 1',
      [tokenHash]
    );
    if (rows.length > 0) {
      res.status(401).json({ code: ERR_TOKEN_REVOKED.code, message: ERR_TOKEN_REVOKED.message });
      return;
    }

    req.user = decoded;
    req.tokenHash = tokenHash;
    req.tokenExp = decoded.exp;
    next();
  } catch {
    res.status(401).json({ code: 401001, message: 'Token 无效或已过期' });
  }
}

export function generateToken(payload: { userId: string; username: string; role: string }): string {
  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN });
}
