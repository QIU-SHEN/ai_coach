import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { query } from '../db/query';
import { AppError, ERR_MISSING_PARAMS, ERR_RECORD_NOT_FOUND } from '../constants/errors';
import type { ApiResponse } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/permission';
import { aiParseTrainingDoc } from '../services/ai-parse-training';

const router = Router();

// ==================== Selling Points ====================
router.get('/selling-points', authMiddleware, async (req, res) => {
  const { product_line_id, category, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  let where = "WHERE status = 'active'";
  const params: unknown[] = [];

  if (product_line_id) { params.push(product_line_id); where += ' AND product_line_id = ?'; }
  if (category) { params.push(category); where += ' AND category = ?'; }

  const countRows = await query(`SELECT COUNT(*) as total FROM selling_points ${where}`, params);
  params.push(parseInt(limit as string, 10), offset);
  const listRows = await query(
    `SELECT point_id, product_line_id, title, description, category, keywords, priority, status, created_at
     FROM selling_points ${where} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`,
    params
  );

  res.json({ code: 0, data: { list: listRows, total: parseInt(countRows[0].total, 10) } } as ApiResponse);
});

router.post('/selling-points', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, title, description, category, keywords, priority } = req.body;
  if (!title || !description) throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少 title 或 description');

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO selling_points (point_id, product_line_id, title, description, category, keywords, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, product_line_id || null, title, description, category || null, keywords?.length > 0 ? JSON.stringify(keywords) : null, priority || 5]
  );
  const rows = await query('SELECT * FROM selling_points WHERE point_id = ?', [id]);
  res.json({ code: 0, data: rows[0] } as ApiResponse);
});

router.put('/selling-points/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, title, description, category, keywords, priority, status } = req.body;
  const [result] = await pool.execute(
    `UPDATE selling_points SET product_line_id = ?, title = ?, description = ?, category = ?, keywords = ?, priority = ?, status = ? WHERE point_id = ?`,
    [product_line_id || null, title, description, category || null, keywords?.length > 0 ? JSON.stringify(keywords) : null, priority || 5, status || 'active', id]
  );
  if ((result as any).affectedRows === 0) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);
  const rows = await query('SELECT * FROM selling_points WHERE point_id = ?', [id]);
  res.json({ code: 0, data: rows[0] } as ApiResponse);
});

router.delete('/selling-points/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.execute('DELETE FROM selling_points WHERE point_id = ?', [req.params.id]);
  res.json({ code: 0, message: '删除成功' } as ApiResponse);
});

// ==================== Product Specs ====================
router.get('/product-specs', authMiddleware, async (req, res) => {
  const { product_line_id, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  let where = "WHERE status = 'active'";
  const params: unknown[] = [];
  if (product_line_id) { params.push(product_line_id); where += ' AND product_line_id = ?'; }

  const countRows = await query(`SELECT COUNT(*) as total FROM product_specs ${where}`, params);
  params.push(parseInt(limit as string, 10), offset);
  const listRows = await query(
    `SELECT spec_id, product_line_id, spec_name, spec_value, unit, common_mistake, keywords, status, created_at
     FROM product_specs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params
  );
  res.json({ code: 0, data: { list: listRows, total: parseInt(countRows[0].total, 10) } } as ApiResponse);
});

router.post('/product-specs', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, spec_name, spec_value, unit, common_mistake, keywords } = req.body;
  if (!spec_name || !spec_value) throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少 spec_name 或 spec_value');

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO product_specs (spec_id, product_line_id, spec_name, spec_value, unit, common_mistake, keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, product_line_id || null, spec_name, spec_value, unit || null, common_mistake || null, keywords?.length > 0 ? JSON.stringify(keywords) : null]
  );
  const rows = await query('SELECT * FROM product_specs WHERE spec_id = ?', [id]);
  res.json({ code: 0, data: rows[0] } as ApiResponse);
});

router.put('/product-specs/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, spec_name, spec_value, unit, common_mistake, keywords, status } = req.body;
  const [result] = await pool.execute(
    `UPDATE product_specs SET product_line_id = ?, spec_name = ?, spec_value = ?, unit = ?, common_mistake = ?, keywords = ?, status = ? WHERE spec_id = ?`,
    [product_line_id || null, spec_name, spec_value, unit || null, common_mistake || null, keywords?.length > 0 ? JSON.stringify(keywords) : null, status || 'active', id]
  );
  if ((result as any).affectedRows === 0) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);
  const rows = await query('SELECT * FROM product_specs WHERE spec_id = ?', [id]);
  res.json({ code: 0, data: rows[0] } as ApiResponse);
});

router.delete('/product-specs/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.execute('DELETE FROM product_specs WHERE spec_id = ?', [req.params.id]);
  res.json({ code: 0, message: '删除成功' } as ApiResponse);
});

// ==================== Sales Scenarios ====================
router.get('/sales-scenarios', authMiddleware, async (req, res) => {
  const { product_line_id, scene_type, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  let where = "WHERE status = 'active'";
  const params: unknown[] = [];
  if (product_line_id) { params.push(product_line_id); where += ' AND product_line_id = ?'; }
  if (scene_type) { params.push(scene_type); where += ' AND scene_type = ?'; }

  const countRows = await query(`SELECT COUNT(*) as total FROM sales_scenarios ${where}`, params);
  params.push(parseInt(limit as string, 10), offset);
  const listRows = await query(
    `SELECT scenario_id, product_line_id, title, scene_type, content, key_takeaway, keywords, status, created_at
     FROM sales_scenarios ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params
  );
  res.json({ code: 0, data: { list: listRows, total: parseInt(countRows[0].total, 10) } } as ApiResponse);
});

router.post('/sales-scenarios', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, title, scene_type, content, key_takeaway, keywords } = req.body;
  if (!title || !content) throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少 title 或 content');

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO sales_scenarios (scenario_id, product_line_id, title, scene_type, content, key_takeaway, keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, product_line_id || null, title, scene_type || null, content, key_takeaway || null, keywords?.length > 0 ? JSON.stringify(keywords) : null]
  );
  const rows = await query('SELECT * FROM sales_scenarios WHERE scenario_id = ?', [id]);
  res.json({ code: 0, data: rows[0] } as ApiResponse);
});

router.put('/sales-scenarios/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, title, scene_type, content, key_takeaway, keywords, status } = req.body;
  const [result] = await pool.execute(
    `UPDATE sales_scenarios SET product_line_id = ?, title = ?, scene_type = ?, content = ?, key_takeaway = ?, keywords = ?, status = ? WHERE scenario_id = ?`,
    [product_line_id || null, title, scene_type || null, content, key_takeaway || null, keywords?.length > 0 ? JSON.stringify(keywords) : null, status || 'active', id]
  );
  if ((result as any).affectedRows === 0) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, ERR_RECORD_NOT_FOUND.message);
  const rows = await query('SELECT * FROM sales_scenarios WHERE scenario_id = ?', [id]);
  res.json({ code: 0, data: rows[0] } as ApiResponse);
});

router.delete('/sales-scenarios/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.execute('DELETE FROM sales_scenarios WHERE scenario_id = ?', [req.params.id]);
  res.json({ code: 0, message: '删除成功' } as ApiResponse);
});

// ==================== AI Parse Training Material ====================
router.post('/training-materials/:material_id/ai-parse', authMiddleware, requireRole('admin'), async (req, res) => {
  const { material_id } = req.params;
  const { product_line_id, raw_text } = req.body;

  const materialRows = await query('SELECT title, file_url, type FROM training_materials WHERE material_id = ?', [material_id]);
  if (materialRows.length === 0) throw new AppError(404, ERR_RECORD_NOT_FOUND.code, '培训资料不存在');

  const material = materialRows[0];

  if (material.type === 'pdf' && material.file_url) {
    throw new AppError(400, ERR_MISSING_PARAMS.code, 'PDF 解析需要传入 raw_text，请先用 PDF 提取工具获取文本后传入');
  }

  const rawText = raw_text || '';
  if (!rawText || rawText.trim().length === 0) throw new AppError(400, ERR_MISSING_PARAMS.code, '缺少 raw_text');

  const result = await aiParseTrainingDoc(rawText, product_line_id);

  res.json({ code: 0, data: { material_id, material_title: material.title, parsed: result } } as ApiResponse);
});

export default router;
