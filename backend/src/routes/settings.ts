import { Router } from 'express';
import { pool } from '../db';
import { query } from '../db/query';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { AppError, ERR_MISSING_PARAMS } from '../constants/errors';
import type { ApiResponse } from '../types';

const router = Router();

router.get('/', authMiddleware, async (_req: AuthRequest, res) => {
  const rows = await query('SELECT setting_key, setting_value FROM settings');
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.setting_key] = row.setting_value;
  }
  res.json({ code: 0, data: settings } as ApiResponse);
});

router.put('/', authMiddleware, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'admin') {
    throw new AppError(403, 403000, '仅管理员可修改设置');
  }

  const settings = req.body as Record<string, string>;
  if (!settings || typeof settings !== 'object') {
    throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少设置参数');
  }

  for (const [key, value] of Object.entries(settings)) {
    await pool.execute(
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
      [key, value, value]
    );
  }
  res.json({ code: 0, message: '设置已保存' } as ApiResponse);
});

export default router;
