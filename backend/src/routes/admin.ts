import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../db';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/permission';
import { getErrors } from '../services/error-ring';
import type { ApiResponse } from '../types';

const router = Router();

// All admin routes require admin role
router.use(authMiddleware, requireRole('admin'));

// ─── Dashboard Summary ───────────────────────────────────────

router.get('/dashboard', async (_req: AuthRequest, res) => {
  // Users
  const [userRows]: any[] = await pool.execute(
    `SELECT role, status, COUNT(*) as cnt FROM users GROUP BY role, status`
  );
  const users = { total: 0, active: 0, admin: 0, manager: 0, employee: 0 };
  for (const r of userRows) {
    const n = Number(r.cnt);
    users.total += n;
    if (r.status === 'active') users.active += n;
    if (r.role === 'admin') users.admin += n;
    else if (r.role === 'manager') users.manager += n;
    else if (r.role === 'employee') users.employee += n;
  }

  // Debriefs
  const [debriefRows]: any[] = await pool.execute(
    `SELECT status, COUNT(*) as cnt FROM debrief_records GROUP BY status`
  );
  const debriefs = { total: 0, completed: 0, analyzing: 0, failed: 0 };
  for (const r of debriefRows) {
    const n = Number(r.cnt);
    debriefs.total += n;
    if (r.status === 'completed') debriefs.completed = n;
    else if (r.status === 'analyzing') debriefs.analyzing = n;
    else if (r.status === 'failed') debriefs.failed = n;
  }

  // Knowledge
  const [knowledgeRows]: any[] = await pool.execute(`
    SELECT 'product_lines' as kind, COUNT(*) as cnt FROM product_lines
    UNION ALL SELECT 'knowledge_items', COUNT(*) FROM product_knowledge
    UNION ALL SELECT 'scripts', COUNT(*) FROM sales_scripts
    UNION ALL SELECT 'materials', COUNT(*) FROM training_materials
    UNION ALL SELECT 'assets', COUNT(*) FROM product_assets
  `);
  const knowledge: Record<string, number> = {};
  for (const r of knowledgeRows) knowledge[r.kind] = Number(r.cnt);

  // Quizzes
  const [quizRows]: any[] = await pool.execute(`SELECT COUNT(*) as total FROM product_quizzes`);
  const [attemptRows]: any[] = await pool.execute(
    `SELECT COUNT(*) as total, ROUND(AVG(is_correct) * 100, 1) as avg_correct_rate FROM quiz_attempts`
  );

  // AI calls (estimated from debriefs with analysis)
  const [aiRows]: any[] = await pool.execute(
    `SELECT COUNT(*) as total FROM debrief_records WHERE analysis IS NOT NULL`
  );

  res.json({
    code: 0,
    data: {
      users,
      debriefs,
      knowledge: {
        product_lines: knowledge.product_lines ?? 0,
        items: knowledge.knowledge_items ?? 0,
        scripts: knowledge.scripts ?? 0,
        materials: knowledge.materials ?? 0,
        assets: knowledge.assets ?? 0,
      },
      quizzes: {
        total: Number(quizRows[0]?.total ?? 0),
        attempts: Number(attemptRows[0]?.total ?? 0),
        avg_correct_rate: Number(attemptRows[0]?.avg_correct_rate ?? 0),
      },
      ai_calls: {
        total: Number(aiRows[0]?.total ?? 0),
      },
    },
  } as ApiResponse);
});

// ─── Daily Stats ─────────────────────────────────────────────

router.get('/stats/daily', async (req: AuthRequest, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days)) || 7, 1), 30);

  const [userRows]: any[] = await pool.execute(
    `SELECT DATE(created_at) as date, COUNT(*) as cnt
     FROM users
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY date`,
    [days]
  );

  const [debriefRows]: any[] = await pool.execute(
    `SELECT DATE(created_at) as date, COUNT(*) as cnt
     FROM debrief_records
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY date`,
    [days]
  );

  const [quizRows]: any[] = await pool.execute(
    `SELECT DATE(attempt_at) as date, COUNT(*) as cnt
     FROM quiz_attempts
     WHERE attempt_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(attempt_at)
     ORDER BY date`,
    [days]
  );

  // Build date-indexed maps
  const userMap = new Map<string, number>();
  const debriefMap = new Map<string, number>();
  const quizMap = new Map<string, number>();
  for (const r of userRows) userMap.set(isoDate(r.date), Number(r.cnt));
  for (const r of debriefRows) debriefMap.set(isoDate(r.date), Number(r.cnt));
  for (const r of quizRows) quizMap.set(isoDate(r.date), Number(r.cnt));

  // Fill all days in range
  const result: Array<{ date: string; new_users: number; new_debriefs: number; new_quizzes: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    result.push({
      date,
      new_users: userMap.get(date) ?? 0,
      new_debriefs: debriefMap.get(date) ?? 0,
      new_quizzes: quizMap.get(date) ?? 0,
    });
  }

  res.json({ code: 0, data: { days: result } } as ApiResponse);
});

function isoDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

// ─── Recent Errors ───────────────────────────────────────────

router.get('/errors', (_req: AuthRequest, res) => {
  res.json({
    code: 0,
    data: { errors: getErrors() },
  } as ApiResponse);
});

// ─── Backup Status ───────────────────────────────────────────

router.get('/backup', (_req: AuthRequest, res) => {
  const backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups');

  let files: Array<{ name: string; fullPath: string; size: number; mtime: Date }> = [];
  try {
    if (fs.existsSync(backupDir)) {
      files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz'))
        .map(f => {
          const fullPath = path.join(backupDir, f);
          const stat = fs.statSync(fullPath);
          return { name: f, fullPath, size: stat.size, mtime: stat.mtime };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    }
  } catch {
    // Ignore permission errors on backup dir
  }

  const latest = files[0]
    ? { filename: files[0].name, size_bytes: files[0].size, created_at: files[0].mtime.toISOString() }
    : null;

  res.json({
    code: 0,
    data: {
      latest,
      total_count: files.length,
      total_size_bytes: files.reduce((sum, f) => sum + f.size, 0),
    },
  } as ApiResponse);
});

export default router;
