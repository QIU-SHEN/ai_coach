import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool, parseJsonRows } from '../db';
import { ERR_MISSING_PARAMS, ERR_RECORD_NOT_FOUND, ERR_INTERNAL_SERVER } from '../constants/errors';
import type { ApiResponse } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/permission';
import { aiParseTrainingDoc } from '../services/ai-parse-training';

const router = Router();

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}

// ==================== Selling Points ====================
router.get('/selling-points', authMiddleware, async (req, res) => {
  const { product_line_id, category, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  try {
    let where = "WHERE status = 'active'";
    const params: unknown[] = [];
    if (product_line_id) {
      params.push(product_line_id);
      where += ' AND product_line_id = ?';
    }
    if (category) {
      params.push(category);
      where += ' AND category = ?';
    }

    const countRows = await query(`SELECT COUNT(*) as total FROM selling_points ${where}`, params);
    params.push(parseInt(limit as string, 10), offset);
    const listRows = await query(
      `SELECT point_id, product_line_id, title, description, category, keywords, priority, status, created_at
       FROM selling_points ${where}
       ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      code: 0,
      data: { list: listRows, total: parseInt(countRows[0].total, 10) },
    } as ApiResponse);
  } catch (err) {
    console.error('Selling points list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/selling-points', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, title, description, category, keywords, priority } = req.body;
  if (!title || !description) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 title 或 description' } as ApiResponse);
  }
  try {
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO selling_points (point_id, product_line_id, title, description, category, keywords, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, product_line_id || null, title, description, category || null, keywords && keywords.length > 0 ? JSON.stringify(keywords) : null, priority || 5]
    );
    const rows = await query('SELECT * FROM selling_points WHERE point_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Selling points create error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.put('/selling-points/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, title, description, category, keywords, priority, status } = req.body;
  try {
    const [result] = await pool.execute(
      `UPDATE selling_points
       SET product_line_id = ?, title = ?, description = ?, category = ?, keywords = ?, priority = ?, status = ?
       WHERE point_id = ?`,
      [product_line_id || null, title, description, category || null, keywords && keywords.length > 0 ? JSON.stringify(keywords) : null, priority || 5, status || 'active', id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const rows = await query('SELECT * FROM selling_points WHERE point_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Selling points update error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.delete('/selling-points/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute('DELETE FROM selling_points WHERE point_id = ?', [id]);
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Selling points delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// ==================== Product Specs ====================
router.get('/product-specs', authMiddleware, async (req, res) => {
  const { product_line_id, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  try {
    let where = "WHERE status = 'active'";
    const params: unknown[] = [];
    if (product_line_id) {
      params.push(product_line_id);
      where += ' AND product_line_id = ?';
    }

    const countRows = await query(`SELECT COUNT(*) as total FROM product_specs ${where}`, params);
    params.push(parseInt(limit as string, 10), offset);
    const listRows = await query(
      `SELECT spec_id, product_line_id, spec_name, spec_value, unit, common_mistake, keywords, status, created_at
       FROM product_specs ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      code: 0,
      data: { list: listRows, total: parseInt(countRows[0].total, 10) },
    } as ApiResponse);
  } catch (err) {
    console.error('Product specs list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/product-specs', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, spec_name, spec_value, unit, common_mistake, keywords } = req.body;
  if (!spec_name || !spec_value) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 spec_name 或 spec_value' } as ApiResponse);
  }
  try {
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO product_specs (spec_id, product_line_id, spec_name, spec_value, unit, common_mistake, keywords)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, product_line_id || null, spec_name, spec_value, unit || null, common_mistake || null, keywords && keywords.length > 0 ? JSON.stringify(keywords) : null]
    );
    const rows = await query('SELECT * FROM product_specs WHERE spec_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Product specs create error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.put('/product-specs/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, spec_name, spec_value, unit, common_mistake, keywords, status } = req.body;
  try {
    const [result] = await pool.execute(
      `UPDATE product_specs
       SET product_line_id = ?, spec_name = ?, spec_value = ?, unit = ?, common_mistake = ?, keywords = ?, status = ?
       WHERE spec_id = ?`,
      [product_line_id || null, spec_name, spec_value, unit || null, common_mistake || null, keywords && keywords.length > 0 ? JSON.stringify(keywords) : null, status || 'active', id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const rows = await query('SELECT * FROM product_specs WHERE spec_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Product specs update error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.delete('/product-specs/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute('DELETE FROM product_specs WHERE spec_id = ?', [id]);
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Product specs delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// ==================== Sales Scenarios ====================
router.get('/sales-scenarios', authMiddleware, async (req, res) => {
  const { product_line_id, scene_type, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  try {
    let where = "WHERE status = 'active'";
    const params: unknown[] = [];
    if (product_line_id) {
      params.push(product_line_id);
      where += ' AND product_line_id = ?';
    }
    if (scene_type) {
      params.push(scene_type);
      where += ' AND scene_type = ?';
    }

    const countRows = await query(`SELECT COUNT(*) as total FROM sales_scenarios ${where}`, params);
    params.push(parseInt(limit as string, 10), offset);
    const listRows = await query(
      `SELECT scenario_id, product_line_id, title, scene_type, content, key_takeaway, keywords, status, created_at
       FROM sales_scenarios ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      code: 0,
      data: { list: listRows, total: parseInt(countRows[0].total, 10) },
    } as ApiResponse);
  } catch (err) {
    console.error('Sales scenarios list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/sales-scenarios', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, title, scene_type, content, key_takeaway, keywords } = req.body;
  if (!title || !content) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 title 或 content' } as ApiResponse);
  }
  try {
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO sales_scenarios (scenario_id, product_line_id, title, scene_type, content, key_takeaway, keywords)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, product_line_id || null, title, scene_type || null, content, key_takeaway || null, keywords && keywords.length > 0 ? JSON.stringify(keywords) : null]
    );
    const rows = await query('SELECT * FROM sales_scenarios WHERE scenario_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Sales scenarios create error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.put('/sales-scenarios/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, title, scene_type, content, key_takeaway, keywords, status } = req.body;
  try {
    const [result] = await pool.execute(
      `UPDATE sales_scenarios
       SET product_line_id = ?, title = ?, scene_type = ?, content = ?, key_takeaway = ?, keywords = ?, status = ?
       WHERE scenario_id = ?`,
      [product_line_id || null, title, scene_type || null, content, key_takeaway || null, keywords && keywords.length > 0 ? JSON.stringify(keywords) : null, status || 'active', id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const rows = await query('SELECT * FROM sales_scenarios WHERE scenario_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Sales scenarios update error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.delete('/sales-scenarios/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute('DELETE FROM sales_scenarios WHERE scenario_id = ?', [id]);
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Sales scenarios delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// ==================== AI Parse Training Material ====================
router.post('/training-materials/:material_id/ai-parse', authMiddleware, requireRole('admin'), async (req, res) => {
  const { material_id } = req.params;
  const { product_line_id } = req.body;

  try {
    const materialRows = await query(
      'SELECT title, file_url, type FROM training_materials WHERE material_id = ?',
      [material_id]
    );
    if (materialRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '培训资料不存在' } as ApiResponse);
    }

    const material = materialRows[0];
    let rawText = '';

    if (material.type === 'pdf' && material.file_url) {
      return res.status(400).json({
        code: ERR_MISSING_PARAMS.code,
        message: 'PDF 解析需要传入 raw_text，请先用 PDF 提取工具获取文本后传入'
      } as ApiResponse);
    } else {
      rawText = req.body.raw_text || '';
    }

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 raw_text' } as ApiResponse);
    }

    const result = await aiParseTrainingDoc(rawText, product_line_id);

    res.json({
      code: 0,
      data: {
        material_id,
        material_title: material.title,
        parsed: result,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('AI parse training material error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

export default router;
