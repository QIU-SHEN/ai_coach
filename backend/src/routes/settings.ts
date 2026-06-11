import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { ERR_MISSING_PARAMS, ERR_INTERNAL_SERVER } from '../constants/errors';
import type { ApiResponse } from '../types';

const router = Router();

async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

// Get all settings (any authenticated user can read)
router.get('/settings', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const rows = await query('SELECT setting_key, setting_value FROM settings');
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }
    res.json({ code: 0, data: settings } as ApiResponse);
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Update settings (admin only)
router.put('/settings', authMiddleware, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ code: 403000, message: '仅管理员可修改设置' } as ApiResponse);
  }

  const settings = req.body as Record<string, string>;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少设置参数' } as ApiResponse);
  }

  try {
    for (const [key, value] of Object.entries(settings)) {
      await pool.execute(
        'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        [key, value, value]
      );
    }
    res.json({ code: 0, message: '设置已保存' } as ApiResponse);
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

export default router;
