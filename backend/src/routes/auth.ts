import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { pool } from '../db';
import { generateToken, authMiddleware, type AuthRequest } from '../middleware/auth';
import { ERR_MISSING_PARAMS, ERR_RECORD_NOT_FOUND, ERR_INTERNAL_SERVER } from '../constants/errors';
import type { ApiResponse } from '../types';
import { sendPasswordResetEmail } from '../services/mail';

const router = Router();

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

router.post('/register', async (req, res) => {
  const { username, password, name, role, employee_id, manager_id } = req.body;

  if (!username || !password || !name || !role) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少必要字段' } as ApiResponse);
  }
  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ code: 400006, message: '用户名长度应为 3-50 字符' } as ApiResponse);
  }
  if (password.length < 6) {
    return res.status(400).json({ code: 400007, message: '密码长度不能少于 6 位' } as ApiResponse);
  }
  if (!['employee', 'manager', 'admin'].includes(role)) {
    return res.status(400).json({ code: 400008, message: '角色必须是 employee / manager / admin' } as ApiResponse);
  }

  try {
    const existing = await query('SELECT 1 FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ code: 409000, message: '用户名已存在' } as ApiResponse);
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
      data: {
        user_id: userId,
        username,
        name,
        role,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少用户名或密码' } as ApiResponse);
  }

  try {
    const rows = await query("SELECT * FROM users WHERE username = ? AND status = 'active'", [username]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ code: 401002, message: '用户名或密码错误' } as ApiResponse);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ code: 401002, message: '用户名或密码错误' } as ApiResponse);
    }

    const token = generateToken({
      userId: user.user_id,
      username: user.username,
      role: user.role,
    });

    res.json({
      code: 0,
      data: {
        user_id: user.user_id,
        username: user.username,
        name: user.name,
        role: user.role,
        employee_id: user.employee_id,
        department: user.department,
        avatar_url: user.avatar_url,
        phone: user.phone,
        email: user.email,
        token,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rows = await query(
      'SELECT user_id, username, name, role, employee_id, department, avatar_url, phone, email FROM users WHERE user_id = ?',
      [req.user!.userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '用户不存在' } as ApiResponse);
    }
    res.json({ code: 0, data: user } as ApiResponse);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/change-password', authMiddleware, async (req: AuthRequest, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少旧密码或新密码' } as ApiResponse);
  }
  if (new_password.length < 6) {
    return res.status(400).json({ code: 400007, message: '新密码长度不能少于 6 位' } as ApiResponse);
  }

  try {
    const rows = await query('SELECT password_hash FROM users WHERE user_id = ?', [req.user!.userId]);
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '用户不存在' } as ApiResponse);
    }

    const valid = await bcrypt.compare(old_password, user.password_hash);
    if (!valid) {
      return res.json({ code: 1, message: '旧密码错误' } as ApiResponse);
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, req.user!.userId]);

    res.json({ code: 0, message: '密码修改成功' } as ApiResponse);
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/update-email', authMiddleware, async (req: AuthRequest, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '请输入邮箱地址' } as ApiResponse);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ code: 400013, message: '邮箱格式不正确' } as ApiResponse);
  }

  try {
    // 检查邮箱是否已被其他用户使用
    const existing = await query('SELECT user_id FROM users WHERE email = ? AND user_id != ?', [email, req.user!.userId]);
    if (existing.length > 0) {
      return res.status(409).json({ code: 409001, message: '该邮箱已被其他账号绑定' } as ApiResponse);
    }

    await pool.execute('UPDATE users SET email = ? WHERE user_id = ?', [email, req.user!.userId]);
    res.json({ code: 0, message: '邮箱修改成功' } as ApiResponse);
  } catch (err) {
    console.error('Update email error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Admin/Manager: list users
router.get('/users', authMiddleware, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return res.status(403).json({ code: 403000, message: '权限不足' } as ApiResponse);
  }

  try {
    const { keyword, role } = req.query as { keyword?: string; role?: string };
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    // Manager can only see themselves and their subordinates
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

    const list = listRows.map((row: any) => ({
      user_id: row.user_id,
      username: row.username,
      name: row.name,
      role: row.role,
      employee_id: row.employee_id,
      department: row.department,
      status: row.status,
      manager_id: row.manager_id,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));

    res.json({ code: 0, data: { list, total: parseInt(countRows[0].total, 10) } } as ApiResponse);
  } catch (err) {
    console.error('User list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Admin: batch assign manager to employees
router.post('/users/batch-assign-manager', authMiddleware, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ code: 403000, message: '仅管理员可访问' } as ApiResponse);
  }

  const { user_ids, manager_id } = req.body as { user_ids?: string[]; manager_id?: string | null };

  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少用户列表' } as ApiResponse);
  }

  // Validate all target users are employees
  const placeholders = user_ids.map(() => '?').join(',');
  const targetRows = await query(
    `SELECT user_id, role FROM users WHERE user_id IN (${placeholders})`,
    user_ids
  );

  if (targetRows.length !== user_ids.length) {
    return res.status(400).json({ code: 400009, message: '存在无效的用户ID' } as ApiResponse);
  }

  const nonEmployee = targetRows.find((r: any) => r.role !== 'employee');
  if (nonEmployee) {
    return res.status(400).json({ code: 400010, message: '只能为员工分配主管' } as ApiResponse);
  }

  // Validate manager_id if provided
  if (manager_id) {
    const managerRows = await query(
      "SELECT 1 FROM users WHERE user_id = ? AND role = 'manager' AND status = 'active'",
      [manager_id]
    );
    if (managerRows.length === 0) {
      return res.status(400).json({ code: 400011, message: '无效的主管ID' } as ApiResponse);
    }
  }

  try {
    await pool.execute(
      `UPDATE users SET manager_id = ? WHERE user_id IN (${placeholders})`,
      [manager_id || null, ...user_ids]
    );

    res.json({ code: 0, message: '分配成功' } as ApiResponse);
  } catch (err) {
    console.error('Batch assign manager error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Admin: reset user password
router.post('/users/:id/reset-password', authMiddleware, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ code: 403000, message: '仅管理员可访问' } as ApiResponse);
  }

  const { id } = req.params;
  const { new_password } = req.body;

  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ code: 400007, message: '密码长度不能少于 6 位' } as ApiResponse);
  }

  try {
    const rows = await query('SELECT 1 FROM users WHERE user_id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, id]);

    res.json({ code: 0, message: '密码重置成功' } as ApiResponse);
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Forgot password: send reset link
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '请输入邮箱地址' } as ApiResponse);
  }

  try {
    const users = await query('SELECT user_id, email FROM users WHERE email = ? AND status = \'active\'', [email]);
    if (users.length === 0) {
      // 为了安全，即使邮箱不存在也返回成功，防止枚举攻击
      return res.json({ code: 0, message: '如果该邮箱已注册，我们将发送一封密码重置邮件' } as ApiResponse);
    }

    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 分钟

    await pool.execute(
      `INSERT INTO password_reset_tokens (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)`,
      [user.user_id, user.email, token, expiresAt]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    await sendPasswordResetEmail(user.email, resetLink);

    res.json({ code: 0, message: '如果该邮箱已注册，我们将发送一封密码重置邮件' } as ApiResponse);
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Verify reset token
router.get('/reset-password/verify', async (req, res) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少令牌' } as ApiResponse);
  }

  try {
    const rows = await query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ code: 400012, message: '令牌无效或已过期' } as ApiResponse);
    }
    res.json({ code: 0, data: { email: rows[0].email } } as ApiResponse);
  } catch (err) {
    console.error('Verify token error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少令牌或新密码' } as ApiResponse);
  }
  if (new_password.length < 6) {
    return res.status(400).json({ code: 400007, message: '密码长度不能少于 6 位' } as ApiResponse);
  }

  try {
    const rows = await query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ code: 400012, message: '令牌无效或已过期' } as ApiResponse);
    }

    const resetRecord = rows[0];
    const newHash = await bcrypt.hash(new_password, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, resetRecord.user_id]);
    await pool.execute('UPDATE password_reset_tokens SET used = 1 WHERE token_id = ?', [resetRecord.token_id]);

    res.json({ code: 0, message: '密码重置成功' } as ApiResponse);
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

export default router;
