import { Router } from 'express';
import { pool } from '../db';
import { query } from '../db/query';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/permission';
import { AppError, ERR_MISSING_PARAMS, ERR_RECORD_NOT_FOUND } from '../constants/errors';
import type { ApiResponse } from '../types';

const router = Router();

// GET / — 获取题目列表（可按产品或资料筛选）
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const productLineId = req.query.product_line_id as string | undefined;
  const materialId = req.query.material_id as string | undefined;
  const userId = req.user!.userId;

  let sqlStr = `SELECT q.quiz_id, q.product_line_id, q.material_id, q.question, q.options, q.correct_index, q.explanation, q.difficulty, q.category, q.status, pl.name as product_line_name
    FROM product_quizzes q
    JOIN product_lines pl ON q.product_line_id = pl.product_line_id
    WHERE q.status = 'active'`;
  const params: any[] = [];

  if (materialId) {
    sqlStr += ' AND q.material_id = ?';
    params.push(materialId);
  } else if (productLineId) {
    sqlStr += ' AND q.product_line_id = ?';
    params.push(productLineId);
  }
  sqlStr += ' ORDER BY q.created_at DESC';
  const rows = await query(sqlStr, params);

  const quizIds = rows.map((r: any) => r.quiz_id);
  let attempts: any[] = [];
  if (quizIds.length > 0) {
    const [attemptRows]: any = await pool.execute(
      `SELECT quiz_id, selected_index, is_correct FROM quiz_attempts WHERE user_id = ? AND quiz_id IN (${quizIds.map(() => '?').join(',')})`,
      [userId, ...quizIds]
    );
    attempts = attemptRows;
  }
  const attemptMap = new Map(attempts.map((a: any) => [a.quiz_id, a]));

  const list = rows.map((r: any) => ({
    quiz_id: r.quiz_id,
    product_line_id: r.product_line_id,
    product_line_name: r.product_line_name,
    question: r.question,
    options: typeof r.options === 'string' ? JSON.parse(r.options) : r.options,
    correct_index: r.correct_index,
    explanation: r.explanation,
    difficulty: r.difficulty,
    category: r.category,
    my_attempt: attemptMap.has(r.quiz_id) ? {
      selected_index: attemptMap.get(r.quiz_id).selected_index,
      is_correct: attemptMap.get(r.quiz_id).is_correct,
    } : null,
  }));

  res.json({ code: 0, data: { list } } as ApiResponse);
});

// POST /:id/attempt — 提交答案
router.post('/:id/attempt', authMiddleware, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const { selected_index } = req.body;

  if (selected_index === undefined || selected_index === null) {
    throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少 selected_index');
  }

  const rows = await query('SELECT quiz_id, correct_index FROM product_quizzes WHERE quiz_id = ? AND status = "active"', [id]);
  if (rows.length === 0) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);

  const isCorrect = rows[0].correct_index === selected_index;

  await pool.execute(
    `INSERT INTO quiz_attempts (attempt_id, user_id, quiz_id, selected_index, is_correct)
     VALUES (UUID(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE selected_index = VALUES(selected_index), is_correct = VALUES(is_correct), attempt_at = CURRENT_TIMESTAMP`,
    [userId, id, selected_index, isCorrect]
  );

  res.json({ code: 0, data: { is_correct: isCorrect, correct_index: rows[0].correct_index } } as ApiResponse);
});

// GET /progress — 获取答题进度和正确率
router.get('/progress', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const productLineId = req.query.product_line_id as string | undefined;

  let where = 'WHERE q.status = "active"';
  const params: any[] = [];

  if (productLineId) {
    where += ' AND q.product_line_id = ?';
    params.push(productLineId);
  }

  const totalRows = await query(`SELECT COUNT(*) as total FROM product_quizzes q ${where}`, params);

  const attemptWhere = 'WHERE a.user_id = ?';
  const attemptParams = productLineId ? [userId, productLineId] : [userId];
  const attemptRows = await query(
    `SELECT COUNT(*) as attempted, SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as correct
     FROM quiz_attempts a
     JOIN product_quizzes q ON a.quiz_id = q.quiz_id
     ${attemptWhere}${productLineId ? ' AND q.product_line_id = ?' : ''}`,
    attemptParams
  );

  res.json({
    code: 0,
    data: {
      total: totalRows[0].total,
      attempted: attemptRows[0].attempted,
      correct: attemptRows[0].correct || 0,
      accuracy: attemptRows[0].attempted > 0 ? Math.round((attemptRows[0].correct / attemptRows[0].attempted) * 100) : 0,
    },
  } as ApiResponse);
});

// DELETE /:id — 删除题目（manager/admin）
router.delete('/:id', authMiddleware, requireRole('manager', 'admin'), async (req: AuthRequest, res) => {
  const [result]: any = await pool.execute('UPDATE product_quizzes SET status = ? WHERE quiz_id = ?', ['deleted', req.params.id]);
  if (Number(result?.affectedRows ?? 0) === 0) {
    throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);
  }
  res.json({ code: 0, message: '删除成功' } as ApiResponse);
});

export default router;
