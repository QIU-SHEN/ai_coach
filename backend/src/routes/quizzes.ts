import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/permission';
import { ERR_MISSING_PARAMS, ERR_RECORD_NOT_FOUND, ERR_INTERNAL_SERVER } from '../constants/errors';
import type { ApiResponse } from '../types';
import { generateQuizzesForProduct, generateQuizzesForMaterial } from '../services/quiz-generator';

const router = Router();

async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

// POST /api/v1/product-lines/:id/generate-quizzes — 为产品生成题目（manager/admin）
router.post('/product-lines/:id/generate-quizzes', authMiddleware, requireRole('manager', 'admin'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const result = await generateQuizzesForProduct(id);
    res.json({ code: 0, data: result } as ApiResponse);
  } catch (err: any) {
    console.error('Generate quizzes error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: err.message || ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /api/v1/quizzes — 获取题目列表（可按产品或资料筛选）
router.get('/quizzes', authMiddleware, async (req: AuthRequest, res) => {
  const productLineId = req.query.product_line_id as string | undefined;
  const materialId = req.query.material_id as string | undefined;
  const userId = req.user!.userId;
  try {
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

    // Fetch user's attempts
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
  } catch (err) {
    console.error('Quiz list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /api/v1/quizzes/:id/attempt — 提交答案
router.post('/quizzes/:id/attempt', authMiddleware, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const { selected_index } = req.body;

  if (selected_index === undefined || selected_index === null) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 selected_index' } as ApiResponse);
  }

  try {
    const rows = await query('SELECT quiz_id, correct_index FROM product_quizzes WHERE quiz_id = ? AND status = "active"', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '题目不存在' } as ApiResponse);
    }

    const isCorrect = rows[0].correct_index === selected_index;

    // Upsert attempt
    await pool.execute(
      `INSERT INTO quiz_attempts (attempt_id, user_id, quiz_id, selected_index, is_correct)
       VALUES (UUID(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE selected_index = VALUES(selected_index), is_correct = VALUES(is_correct), attempt_at = CURRENT_TIMESTAMP`,
      [userId, id, selected_index, isCorrect]
    );

    res.json({ code: 0, data: { is_correct: isCorrect, correct_index: rows[0].correct_index } } as ApiResponse);
  } catch (err) {
    console.error('Quiz attempt error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /api/v1/quizzes/progress — 获取员工答题进度和正确率
router.get('/quizzes/progress', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const productLineId = req.query.product_line_id as string | undefined;

  try {
    let where = 'WHERE q.status = "active"';
    let attemptWhere = 'WHERE a.user_id = ?';
    const params: any[] = [];

    if (productLineId) {
      where += ' AND q.product_line_id = ?';
      params.push(productLineId);
    }

    const totalRows = await query(
      `SELECT COUNT(*) as total FROM product_quizzes q ${where}`,
      params
    );

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
  } catch (err) {
    console.error('Quiz progress error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /api/v1/training-materials/:material_id/quizzes — 获取某资料下的题目列表
router.get('/training-materials/:material_id/quizzes', authMiddleware, async (req: AuthRequest, res) => {
  const { material_id } = req.params;
  try {
    const rows = await query(
      `SELECT q.quiz_id, q.product_line_id, q.question, q.options, q.correct_index, q.explanation, q.difficulty, q.category, q.status, pl.name as product_line_name
       FROM product_quizzes q
       LEFT JOIN product_lines pl ON q.product_line_id = pl.product_line_id
       WHERE q.material_id = ? AND q.status = 'active'
       ORDER BY q.created_at DESC`,
      [material_id]
    );

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
    }));

    res.json({ code: 0, data: { list } } as ApiResponse);
  } catch (err) {
    console.error('Material quizzes list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /api/v1/training-materials/:material_id/generate-quizzes — 基于单份资料生成题目
router.post('/training-materials/:material_id/generate-quizzes', authMiddleware, requireRole('manager', 'admin'), async (req: AuthRequest, res) => {
  const { material_id } = req.params;
  try {
    const result = await generateQuizzesForMaterial(material_id);
    res.json({ code: 0, data: result } as ApiResponse);
  } catch (err: any) {
    console.error('Generate material quizzes error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: err.message || ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// DELETE /api/v1/quizzes/:id — 删除题目（manager/admin）
router.delete('/quizzes/:id', authMiddleware, requireRole('manager', 'admin'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const [result]: any = await pool.execute(
      'UPDATE product_quizzes SET status = ? WHERE quiz_id = ?',
      ['deleted', id]
    );
    console.log('Quiz delete result:', { id, affectedRows: result?.affectedRows, resultType: typeof result, resultKeys: result ? Object.keys(result) : null });
    const affected = Number(result?.affectedRows ?? 0);
    if (affected === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Quiz delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

export default router;
