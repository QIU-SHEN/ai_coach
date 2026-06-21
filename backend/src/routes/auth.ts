import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { pool } from '../db';
import { query } from '../db/query';
import { generateToken, authMiddleware, type AuthRequest } from '../middleware/auth';
import { AppError, ERR_MISSING_PARAMS, ERR_RECORD_NOT_FOUND, ERR_INTERNAL_SERVER, ERR_WEAK_PASSWORD } from '../constants/errors';
import type { ApiResponse } from '../types';
import { sendPasswordResetEmail } from '../services/mail';
import { logger } from '../services/logger';

const router = Router();

async function blacklistToken(req: AuthRequest): Promise<void> {
  const expiresAt = req.tokenExp
    ? new Date(req.tokenExp * 1000)
    : new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await pool.execute(
    'INSERT INTO jwt_blacklist (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [req.tokenHash!, req.user!.userId, expiresAt]
  );
}

function validatePasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new AppError(400, ERR_WEAK_PASSWORD.code, ERR_WEAK_PASSWORD.message);
  }
  if (!/[a-zA-Z]/.test(password)) {
    throw new AppError(400, ERR_WEAK_PASSWORD.code, '密码必须包含至少一个字母');
  }
  if (!/[0-9]/.test(password)) {
    throw new AppError(400, ERR_WEAK_PASSWORD.code, '密码必须包含至少一个数字');
  }
}

router.post('/register', async (req, res) => {
  const { username, password, name, role, employee_id, manager_id } = req.body;

  if (!username || !password || !name || !role) {
    throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少必要字段');
  }
  if (username.length < 3 || username.length > 50) {
    throw new AppError(400, 400006, '用户名长度应为 3-50 字符');
  }
  validatePasswordStrength(password);
  if (!['employee', 'manager', 'admin'].includes(role)) {
    throw new AppError(400, 400008, '角色必须是 employee / manager / admin');
  }

  const existing = await query('SELECT 1 FROM users WHERE username = ?', [username]);
  if (existing.length > 0) {
    throw new AppError(409, 409000, '用户名已存在');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = uuidv4();
  await pool.execute(
    `INSERT INTO users (user_id, username, password_hash, name, role, employee_id, manager_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [userId, username, passwordHash, name, role, employee_id || null, manager_id || null]
  );

  res.json({
    code: 0,
    data: { user_id: userId, username, name, role },
  } as ApiResponse);
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少用户名或密码');
  }

  const rows = await query("SELECT * FROM users WHERE username = ? AND status = 'active'", [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 401002, '用户名或密码错误');
  }

  const token = generateToken({ userId: user.user_id, username: user.username, role: user.role });

  res.json({
    code: 0,
    data: {
      user_id: user.user_id, username: user.username, name: user.name, role: user.role,
      employee_id: user.employee_id, department: user.department, avatar_url: user.avatar_url,
      phone: user.phone, email: user.email, token,
    },
  } as ApiResponse);
});

router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  const rows = await query(
    'SELECT user_id, username, name, role, employee_id, department, avatar_url, phone, email FROM users WHERE user_id = ?',
    [req.user!.userId]
  );
  if (!rows[0]) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);
  res.json({ code: 0, data: rows[0] } as ApiResponse);
});

router.post('/logout', authMiddleware, async (req: AuthRequest, res) => {
  await blacklistToken(req);
  res.json({ code: 0, message: '已成功退出登录' } as ApiResponse);
});

router.post('/change-password', authMiddleware, async (req: AuthRequest, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少旧密码或新密码');
  }
  validatePasswordStrength(new_password);

  const rows = await query('SELECT password_hash FROM users WHERE user_id = ?', [req.user!.userId]);
  if (!rows[0]) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);

  const valid = await bcrypt.compare(old_password, rows[0].password_hash);
  if (!valid) {
    res.json({ code: 1, message: '旧密码错误' } as ApiResponse);
    return;
  }

  const newHash = await bcrypt.hash(new_password, 10);
  await pool.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, req.user!.userId]);

  await blacklistToken(req); // Invalidate current token after password change

  res.json({ code: 0, message: '密码修改成功' } as ApiResponse);
});

router.post('/update-email', authMiddleware, async (req: AuthRequest, res) => {
  const { email } = req.body;
  if (!email) throw new AppError(400, ERR_MISSING_PARAMS.code, '请输入邮箱地址');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 400013, '邮箱格式不正确');
  }

  const existing = await query('SELECT user_id FROM users WHERE email = ? AND user_id != ?', [email, req.user!.userId]);
  if (existing.length > 0) throw new AppError(409, 409001, '该邮箱已被其他账号绑定');

  await pool.execute('UPDATE users SET email = ? WHERE user_id = ?', [email, req.user!.userId]);
  res.json({ code: 0, message: '邮箱修改成功' } as ApiResponse);
});

router.get('/users', authMiddleware, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    throw new AppError(403, 403000, '权限不足');
  }

  const { keyword, role } = req.query as { keyword?: string; role?: string };
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (user.role === 'manager') {
    conditions.push("(role = 'manager' AND user_id = ?) OR (role = 'employee' AND manager_id = ?)");
    params.push(user.userId, user.userId);
  }
  if (keyword) {
    conditions.push('(name LIKE ? OR employee_id LIKE ? OR username LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }

  const where = conditions.join(' AND ');
  const countRows = await query(`SELECT COUNT(*) as total FROM users WHERE ${where}`, params);
  const listRows = await query(
    `SELECT user_id, username, name, role, employee_id, department, status, created_at, manager_id
     FROM users WHERE ${where}
     ORDER BY FIELD(role, 'manager', 'admin', 'employee'), created_at DESC`,
    params
  );

  res.json({
    code: 0,
    data: {
      list: listRows.map((row: any) => ({
        ...row,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      })),
      total: parseInt(countRows[0].total, 10),
    },
  } as ApiResponse);
});

router.post('/users/batch-assign-manager', authMiddleware, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'admin') throw new AppError(403, 403000, '仅管理员可访问');

  const { user_ids, manager_id } = req.body as { user_ids?: string[]; manager_id?: string | null };
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少用户列表');
  }

  const placeholders = user_ids.map(() => '?').join(',');
  const targetRows = await query(`SELECT user_id, role FROM users WHERE user_id IN (${placeholders})`, user_ids);
  if (targetRows.length !== user_ids.length) throw new AppError(400, 400009, '存在无效的用户ID');
  if (targetRows.find((r: any) => r.role !== 'employee')) throw new AppError(400, 400010, '只能为员工分配主管');

  if (manager_id) {
    const managerRows = await query("SELECT 1 FROM users WHERE user_id = ? AND role = 'manager' AND status = 'active'", [manager_id]);
    if (managerRows.length === 0) throw new AppError(400, 400011, '无效的主管ID');
  }

  await pool.execute(`UPDATE users SET manager_id = ? WHERE user_id IN (${placeholders})`, [manager_id || null, ...user_ids]);
  res.json({ code: 0, message: '分配成功' } as ApiResponse);
});

router.post('/users/:id/reset-password', authMiddleware, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'admin') throw new AppError(403, 403000, '仅管理员可访问');

  const { id } = req.params;
  const { new_password } = req.body;
  validatePasswordStrength(new_password);

  const rows = await query('SELECT 1 FROM users WHERE user_id = ?', [id]);
  if (rows.length === 0) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);

  const newHash = await bcrypt.hash(new_password, 10);
  await pool.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, id]);
  res.json({ code: 0, message: '密码重置成功' } as ApiResponse);
});

// Forgot password flow — these still need try/catch for specific error semantics
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) throw new AppError(400, ERR_MISSING_PARAMS.code, '请输入邮箱地址');

  try {
    const users = await query("SELECT user_id, email FROM users WHERE email = ? AND status = 'active'", [email]);
    if (users.length === 0) {
      return res.json({ code: 0, message: '如果该邮箱已注册，我们将发送一封密码重置邮件' } as ApiResponse);
    }

    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await pool.execute(
      'INSERT INTO password_reset_tokens (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)',
      [user.user_id, user.email, token, expiresAt]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    await sendPasswordResetEmail(user.email, `${frontendUrl}/reset-password?token=${token}`);

    res.json({ code: 0, message: '如果该邮箱已注册，我们将发送一封密码重置邮件' } as ApiResponse);
  } catch (err) {
    logger.error('Forgot password error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.get('/reset-password/verify', async (req, res) => {
  const { token } = req.query as { token?: string };
  if (!token) throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少令牌');

  const rows = await query(
    'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
    [token]
  );
  if (rows.length === 0) throw new AppError(400, 400012, '令牌无效或已过期');
  res.json({ code: 0, data: { email: rows[0].email } } as ApiResponse);
});

router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少令牌或新密码');
  validatePasswordStrength(new_password);

  const rows = await query(
    'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
    [token]
  );
  if (rows.length === 0) throw new AppError(400, 400012, '令牌无效或已过期');

  const resetRecord = rows[0];
  const newHash = await bcrypt.hash(new_password, 10);
  await pool.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, resetRecord.user_id]);
  await pool.execute('UPDATE password_reset_tokens SET used = 1 WHERE token_id = ?', [resetRecord.token_id]);

  res.json({ code: 0, message: '密码重置成功' } as ApiResponse);
});

export default router;
