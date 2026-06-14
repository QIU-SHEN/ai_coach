import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { pool, parseJsonRows } from '../db';
import { ERR_MISSING_PARAMS, ERR_RECORD_NOT_FOUND, ERR_INTERNAL_SERVER } from '../constants/errors';
import type { ApiResponse } from '../types';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/permission';
import { aiSummarizeProduct, saveSummaries } from '../services/ai-summarize';
import { aiClassifyRawTexts, aiTagClassified } from '../services/ai-classify';
import { aiExtractTexts } from '../services/ai-extract-texts';
import { callOpenAIChat } from '../services/openai-chat';
import { generateProductDescription } from '../services/ai-generate-description';
import { saveUpload, deleteFile } from '../services/storage';

const router = Router();

const upload = multer({ dest: path.resolve(process.cwd(), 'uploads/tmp') });

// Helper: pool.query returns [rows, fields] for mysql2
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}

// Product Lines
router.get('/product-lines', authMiddleware, async (req, res) => {
  try {
    const { level, parent_id } = req.query;
    let where = "WHERE status = 'active'";
    const params: unknown[] = [];
    if (level) {
      where += ' AND level = ?';
      params.push(level);
    }
    if (parent_id) {
      where += ' AND parent_id = ?';
      params.push(parent_id);
    }
    const rows = await query(
      `SELECT product_line_id, parent_id, name, description, level, sort_order, status, cover_image_asset_id, created_at FROM product_lines ${where} ORDER BY sort_order ASC, created_at DESC`,
      params
    );
    res.json({ code: 0, data: { list: rows, total: rows.length } } as ApiResponse);
  } catch (err) {
    console.error('Product lines error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /product-lines/tree — 返回嵌套树形结构（支持 3 层：大类 → 系列 → 产品）
router.get('/product-lines/tree', authMiddleware, async (_req, res) => {
  try {
    const rows = await query(
      "SELECT product_line_id, parent_id, name, description, level, sort_order, status, created_at FROM product_lines WHERE status = 'active' ORDER BY level ASC, sort_order ASC"
    );
    const level1 = rows.filter((r: any) => r.level === 1);
    const level2 = rows.filter((r: any) => r.level === 2);
    const level3 = rows.filter((r: any) => r.level === 3);

    const buildNode = (node: any) => ({
      product_line_id: node.product_line_id,
      name: node.name,
      status: node.status,
      level: node.level,
      sort_order: node.sort_order,
      parent_id: node.parent_id,
      description: node.description,
      created_at: node.created_at,
      children: [] as any[],
    });

    const tree = level1.map((cat: any) => {
      const catNode = buildNode(cat);
      const seriesList = level2.filter((s: any) => s.parent_id === cat.product_line_id);
      catNode.children = seriesList.map((series: any) => {
        const seriesNode = buildNode(series);
        const products = level3.filter((p: any) => p.parent_id === series.product_line_id);
        seriesNode.children = products.map(buildNode);
        return seriesNode;
      });
      return catNode;
    });

    // Also include orphaned level-2 nodes (no level-1 parent)
    const orphanedSeries = level2.filter((s: any) => !s.parent_id || !level1.some((c: any) => c.product_line_id === s.parent_id));
    if (orphanedSeries.length > 0) {
      tree.push({
        product_line_id: 'uncategorized',
        name: '未分类',
        status: 'active',
        level: 1,
        sort_order: 999,
        parent_id: null,
        description: null,
        created_at: null,
        children: orphanedSeries.map((series: any) => {
          const seriesNode = buildNode(series);
          const products = level3.filter((p: any) => p.parent_id === series.product_line_id);
          seriesNode.children = products.map(buildNode);
          return seriesNode;
        }),
      });
    }

    res.json({ code: 0, data: { tree, total: rows.length } } as ApiResponse);
  } catch (err) {
    console.error('Product lines tree error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Create product line
router.post('/product-lines', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  const { name, description, parent_id, level, sort_order = 0 } = req.body;
  if (!name) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 name' } as ApiResponse);
  }
  try {
    let finalLevel = level;
    if (finalLevel === undefined || finalLevel === null) {
      if (parent_id) {
        const parentRows = await query('SELECT level FROM product_lines WHERE product_line_id = ?', [parent_id]);
        finalLevel = parentRows.length > 0 ? parentRows[0].level + 1 : 2;
      } else {
        finalLevel = 1;
      }
    }
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO product_lines (product_line_id, parent_id, name, description, level, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, parent_id || null, name, description || null, finalLevel, sort_order, 'active']
    );
    const rows = await query('SELECT product_line_id, parent_id, name, description, level, sort_order, status, created_at FROM product_lines WHERE product_line_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '产品线名称已存在' } as ApiResponse);
    }
    console.error('Create product line error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Update product line
router.put('/product-lines/:product_line_id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id } = req.params;
  const { name, description, status, parent_id, level, sort_order, cover_image_asset_id } = req.body;
  try {
    const [result] = await pool.execute(
      'UPDATE product_lines SET name = ?, description = ?, status = ?, parent_id = ?, level = ?, sort_order = ?, cover_image_asset_id = ? WHERE product_line_id = ?',
      [name, description || null, status || 'active', parent_id || null, level || 2, sort_order || 0, cover_image_asset_id || null, product_line_id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const rows = await query('SELECT product_line_id, parent_id, name, description, level, sort_order, status, cover_image_asset_id, created_at FROM product_lines WHERE product_line_id = ?', [product_line_id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '产品线名称已存在' } as ApiResponse);
    }
    console.error('Update product line error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Set product cover image
router.put('/product-lines/:product_line_id/cover-image', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  const { product_line_id } = req.params;
  const { asset_id } = req.body as { asset_id?: string };
  if (!asset_id) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 asset_id' } as ApiResponse);
  }
  try {
    // Verify asset exists and belongs to this product line
    const assetRows = await query(
      'SELECT asset_id, file_path FROM product_assets WHERE asset_id = ? AND product_line_id = ? AND status = ?',
      [asset_id, product_line_id, 'active']
    );
    if (assetRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '素材不存在或不属于该产品' } as ApiResponse);
    }
    await pool.execute(
      'UPDATE product_lines SET cover_image_asset_id = ? WHERE product_line_id = ?',
      [asset_id, product_line_id]
    );
    res.json({ code: 0, data: { cover_image_asset_id: asset_id, file_path: assetRows[0].file_path } } as ApiResponse);
  } catch (err) {
    console.error('Set cover image error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Delete product line
router.delete('/product-lines/:product_line_id', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  const { product_line_id } = req.params;
  try {
    // If deleting a category, unlink its children first
    await pool.execute('UPDATE product_lines SET parent_id = NULL WHERE parent_id = ?', [product_line_id]);
    const [result] = await pool.execute('DELETE FROM product_lines WHERE product_line_id = ?', [product_line_id]);
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Delete product line error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Product Knowledge
router.get('/knowledge', authMiddleware, async (req, res) => {
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

    const countRows = await query(`SELECT COUNT(*) as total FROM product_knowledge ${where}`, params);
    params.push(parseInt(limit as string, 10), offset);
    const listRows = await query(
      `SELECT knowledge_id, product_line_id, title, content, category, tags, status, created_at, updated_at
       FROM product_knowledge ${where}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      code: 0,
      data: { list: listRows, total: parseInt(countRows[0].total, 10) },
    } as ApiResponse);
  } catch (err) {
    console.error('Knowledge list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.get('/knowledge/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await query(
      `SELECT knowledge_id, product_line_id, title, content, category, tags, status, created_at, updated_at
       FROM product_knowledge WHERE knowledge_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Knowledge get error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/knowledge', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, title, content, category, tags } = req.body;
  if (!title || !content) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 title 或 content' } as ApiResponse);
  }
  try {
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO product_knowledge (knowledge_id, product_line_id, title, content, category, tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, product_line_id || null, title, content, category || null, tags && tags.length > 0 ? JSON.stringify(tags) : null]
    );
    const rows = await query('SELECT * FROM product_knowledge WHERE knowledge_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Knowledge create error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.put('/knowledge/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, title, content, category, tags, status } = req.body;
  try {
    const [result] = await pool.execute(
      `UPDATE product_knowledge
       SET product_line_id = ?, title = ?, content = ?, category = ?, tags = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE knowledge_id = ?`,
      [product_line_id || null, title, content, category || null, tags && tags.length > 0 ? JSON.stringify(tags) : null, status || 'active', id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const rows = await query('SELECT * FROM product_knowledge WHERE knowledge_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Knowledge update error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.delete('/knowledge/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute('DELETE FROM product_knowledge WHERE knowledge_id = ?', [id]);
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Knowledge delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Sales Scripts
router.get('/scripts/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await query(
      `SELECT script_id, product_line_id, title, scene, content, tags, status, created_at, updated_at
       FROM sales_scripts WHERE script_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Script get error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.get('/scripts', authMiddleware, async (req, res) => {
  const { product_line_id, scene, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  try {
    let where = "WHERE status = 'active'";
    const params: unknown[] = [];
    if (product_line_id) {
      params.push(product_line_id);
      where += ' AND product_line_id = ?';
    }
    if (scene) {
      params.push(scene);
      where += ' AND scene = ?';
    }

    const countRows = await query(`SELECT COUNT(*) as total FROM sales_scripts ${where}`, params);
    params.push(parseInt(limit as string, 10), offset);
    const listRows = await query(
      `SELECT script_id, product_line_id, title, scene, content, tags, status, created_at, updated_at
       FROM sales_scripts ${where}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      code: 0,
      data: { list: listRows, total: parseInt(countRows[0].total, 10) },
    } as ApiResponse);
  } catch (err) {
    console.error('Scripts list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/scripts', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, title, scene, content, tags } = req.body;
  if (!title || !content) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 title 或 content' } as ApiResponse);
  }
  try {
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO sales_scripts (script_id, product_line_id, title, scene, content, tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, product_line_id || null, title, scene || null, content, tags && tags.length > 0 ? JSON.stringify(tags) : null]
    );
    const rows = await query('SELECT * FROM sales_scripts WHERE script_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Scripts create error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.put('/scripts/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { product_line_id, title, scene, content, tags, status } = req.body;
  try {
    const [result] = await pool.execute(
      `UPDATE sales_scripts
       SET product_line_id = ?, title = ?, scene = ?, content = ?, tags = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE script_id = ?`,
      [product_line_id || null, title, scene || null, content, tags && tags.length > 0 ? JSON.stringify(tags) : null, status || 'active', id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const rows = await query('SELECT * FROM sales_scripts WHERE script_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Scripts update error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.delete('/scripts/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute('DELETE FROM sales_scripts WHERE script_id = ?', [id]);
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Scripts delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Training Materials
router.get('/materials/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await query(
      `SELECT material_id, title, type, duration, file_url, description, tags, status, product_line_id, created_at
       FROM training_materials WHERE material_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Material get error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.get('/materials', authMiddleware, async (req, res) => {
  const { type, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  try {
    let where = "WHERE status = 'active'";
    const params: unknown[] = [];
    if (type) {
      params.push(type);
      where += ' AND type = ?';
    }

    const countRows = await query(`SELECT COUNT(*) as total FROM training_materials ${where}`, params);
    params.push(parseInt(limit as string, 10), offset);
    const listRows = await query(
      `SELECT material_id, title, type, duration, file_url, description, tags, status, created_at
       FROM training_materials ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      code: 0,
      data: { list: listRows, total: parseInt(countRows[0].total, 10) },
    } as ApiResponse);
  } catch (err) {
    console.error('Materials list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.post('/materials', authMiddleware, requireRole('manager', 'admin'), upload.single('file'), async (req, res) => {
  const { title, type, duration, description, tags } = req.body;
  const file = req.file;

  if (!title || !type) {
    if (file) fs.unlinkSync(file.path);
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 title 或 type' } as ApiResponse);
  }

  let fileUrl: string | null = null;
  if (file) {
    try {
      // 本地存储：将 multer 临时文件移动到 uploads/materials/
      const ext = path.extname(file.originalname).slice(1) || 'bin';
      const destDir = path.resolve(process.cwd(), 'uploads/materials');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destName = `${uuidv4()}.${ext}`;
      const destPath = path.join(destDir, destName);
      fs.renameSync(file.path, destPath);
      fileUrl = `/uploads/materials/${destName}`;
    } catch (err) {
      console.error('Material file save error:', err);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: '文件保存失败' } as ApiResponse);
    }
  }

  try {
    const id = uuidv4();
    const tagArray = tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [];
    await pool.execute(
      `INSERT INTO training_materials (material_id, title, type, duration, file_url, description, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, title, type, duration || null, fileUrl, description || null, tagArray.length > 0 ? JSON.stringify(tagArray) : null]
    );
    const rows = await query('SELECT * FROM training_materials WHERE material_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Materials create error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.put('/materials/:id', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { title, type, duration, file_url, description, tags, status } = req.body;
  try {
    const [result] = await pool.execute(
      `UPDATE training_materials
       SET title = ?, type = ?, duration = ?, file_url = ?, description = ?, tags = ?, status = ?
       WHERE material_id = ?`,
      [title, type, duration || null, file_url || null, description || null, tags && tags.length > 0 ? JSON.stringify(tags) : null, status || 'active', id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const rows = await query('SELECT * FROM training_materials WHERE material_id = ?', [id]);
    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Materials update error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.delete('/materials/:id', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  const { id } = req.params;
  try {
    // 先获取文件路径，以便删除本地文件
    const rows = await query('SELECT file_url FROM training_materials WHERE material_id = ?', [id]);
    if (rows.length > 0 && rows[0].file_url) {
      await deleteFile(rows[0].file_url).catch(err => console.warn('Failed to delete file:', err));
    }
    await pool.execute('DELETE FROM training_materials WHERE material_id = ?', [id]);
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Materials delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Download training material file
router.get('/materials/:id/download', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await query('SELECT title, type, file_url FROM training_materials WHERE material_id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const material = rows[0];
    if (!material.file_url) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '文件不存在' } as ApiResponse);
    }

    // If it's an OSS URL, stream through the server
    if (material.file_url.startsWith('http://') || material.file_url.startsWith('https://')) {
      const response = await fetch(material.file_url);
      if (!response.ok) {
        return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: '无法获取文件' } as ApiResponse);
      }
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(material.title)}"`);
      if (response.body) {
        const reader = response.body.getReader();
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
            res.end();
          } catch (err) {
            console.error('Stream error:', err);
            if (!res.headersSent) res.status(500).end();
          }
        };
        pump();
        return;
      }
      return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: '无法读取文件流' } as ApiResponse);
    }

    // Local file fallback
    const filePath = path.resolve(process.cwd(), material.file_url.replace(/\\/g, '/').replace(/^\//, ''));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '文件不存在' } as ApiResponse);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = { '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
    const mimeType = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(material.title + ext)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Material download error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Product Assets (read-only)
const PRODUCT_DATA_ROOT = path.resolve(process.cwd(), '../辅助员工提升销售能力AI员工/产品资料');

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};

router.get('/product-assets', authMiddleware, async (req, res) => {
  const { product_line_id, asset_type, page = '1', limit = '20' } = req.query;
  const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
  try {
    let where = "WHERE status = 'active'";
    const params: unknown[] = [];
    if (product_line_id) {
      params.push(product_line_id);
      where += ' AND product_line_id = ?';
    }
    if (asset_type) {
      params.push(asset_type);
      where += ' AND asset_type = ?';
    }

    const countRows = await query(`SELECT COUNT(*) as total FROM product_assets ${where}`, params);
    params.push(parseInt(limit as string, 10), offset);
    const listRows = await query(
      `SELECT asset_id, product_line_id, title, asset_type, file_path, file_url, description, sort_order, status, created_at
       FROM product_assets ${where}
       ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      code: 0,
      data: {
        list: listRows,
        total: parseInt(countRows[0].total, 10),
        page: parseInt(page as string, 10),
        limit: parseInt(limit as string, 10),
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Product assets list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

router.get('/product-assets/:asset_id/file', async (req, res) => {
  const { asset_id } = req.params;
  try {
    const rows = await query('SELECT file_path, title FROM product_assets WHERE asset_id = ?', [asset_id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const dbPath = rows[0].file_path;

    // If it's an OSS URL, redirect to it
    if (dbPath.startsWith('http://') || dbPath.startsWith('https://')) {
      return res.redirect(dbPath);
    }

    // New uploads store path like "uploads/assets/...", old assets store relative to PRODUCT_DATA_ROOT
    const filePath = dbPath.startsWith('uploads/') || dbPath.startsWith('uploads\\')
      ? path.resolve(process.cwd(), dbPath)
      : path.join(PRODUCT_DATA_ROOT, dbPath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '文件不存在' } as ApiResponse);
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_MAP[ext] || 'application/octet-stream';
    const displayFilename = rows[0].title + ext;
    const asciiFallback = displayFilename.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(displayFilename)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Asset file read error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Upload single product asset
router.post('/product-assets/upload', authMiddleware, requireRole('manager', 'admin'), upload.single('file'), async (req, res) => {
  const { product_line_id, asset_type, title } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 file' } as ApiResponse);
  }
  if (!product_line_id || !asset_type) {
    // clean up uploaded temp file
    fs.unlinkSync(file.path);
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 product_line_id 或 asset_type' } as ApiResponse);
  }

  const validTypes = ['brochure', 'detail_page', 'image', 'video', 'manual', 'packaging', 'banner'];
  if (!validTypes.includes(asset_type)) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: `asset_type 无效，可选: ${validTypes.join('/')}` } as ApiResponse);
  }

  try {
    const assetId = uuidv4();
    // multer on Windows encodes originalname as Latin1, re-decode to UTF-8
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf-8');
    const ext = path.extname(originalName) || path.extname(file.filename || '') || '';

    // Upload to OSS
    const ossUrl = await saveUpload(file.path, assetId, ext.replace('.', ''), 'assets');

    const assetTitle = title || path.basename(originalName, ext);

    await pool.execute(
      `INSERT INTO product_assets (asset_id, product_line_id, title, asset_type, file_path, file_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [assetId, product_line_id, assetTitle, asset_type, ossUrl, ossUrl]
    );

    const rows = await query(
      `SELECT asset_id, product_line_id, title, asset_type, file_path, status, created_at FROM product_assets WHERE asset_id = ?`,
      [assetId]
    );

    res.json({ code: 0, data: rows[0] } as ApiResponse);
  } catch (err) {
    console.error('Asset upload error:', err);
    // clean up on failure
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Delete single product asset
router.delete('/product-assets/:asset_id', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  const { asset_id } = req.params;
  try {
    const rows = await query('SELECT file_path FROM product_assets WHERE asset_id = ?', [asset_id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    // delete from storage (OSS or local)
    if (rows[0].file_path) {
      await deleteFile(rows[0].file_path).catch(err => console.warn('Failed to delete file:', err));
    }

    await pool.execute('DELETE FROM product_assets WHERE asset_id = ?', [asset_id]);
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Asset delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Batch delete product assets
router.post('/product-assets/batch-delete', authMiddleware, requireRole('admin'), async (req, res) => {
  const { asset_ids } = req.body;
  if (!asset_ids || !Array.isArray(asset_ids) || asset_ids.length === 0) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 asset_ids 数组' } as ApiResponse);
  }

  try {
    const placeholders = asset_ids.map(() => '?').join(',');
    const rows = await query(
      `SELECT asset_id, file_path FROM product_assets WHERE asset_id IN (${placeholders})`,
      asset_ids
    );

    // delete from storage (OSS or local)
    for (const row of rows) {
      if (row.file_path) {
        await deleteFile(row.file_path).catch(err => console.warn('Failed to delete file:', err));
      }
    }

    const [result] = await pool.execute(
      `DELETE FROM product_assets WHERE asset_id IN (${placeholders})`,
      asset_ids
    );
    res.json({ code: 0, data: { deleted_count: (result as any).affectedRows } } as ApiResponse);
  } catch (err) {
    console.error('Asset batch delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// AI Summarize product assets
router.post('/product-lines/:product_line_id/ai-summarize', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id } = req.params;
  try {
    const result = await aiSummarizeProduct(product_line_id);
    res.json({ code: 0, data: result } as ApiResponse);
  } catch (err) {
    console.error('AI summarize error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

// Save AI summaries to product_knowledge
router.post('/product-lines/:product_line_id/save-summaries', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id } = req.params;
  const { summaries, mode } = req.body as { summaries?: Array<{ category: string; title: string; content: string; tags: string[] }>; mode?: 'full' | 'append' };
  if (!summaries || !Array.isArray(summaries) || summaries.length === 0) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 summaries 数组' } as ApiResponse);
  }
  try {
    const count = await saveSummaries(product_line_id, summaries, mode);
    res.json({ code: 0, data: { saved_count: count, mode: mode || 'full' } } as ApiResponse);
  } catch (err) {
    console.error('Save summaries error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Step 2: AI classify raw texts
router.post('/product-lines/:product_line_id/ai-classify', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id } = req.params;
  const { asset_ids } = req.body as { asset_ids?: string[] };
  try {
    const result = await aiClassifyRawTexts(product_line_id, asset_ids);
    res.json({ code: 0, data: result } as ApiResponse);
  } catch (err) {
    console.error('AI classify error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

// Step 3: AI tag classified items
router.post('/product-lines/:product_line_id/ai-tag', authMiddleware, requireRole('admin'), async (req, res) => {
  const { categories } = req.body;
  if (!categories || !Array.isArray(categories)) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 categories 数组' } as ApiResponse);
  }
  try {
    const result = await aiTagClassified(categories);
    res.json({ code: 0, data: { categories: result } } as ApiResponse);
  } catch (err) {
    console.error('AI tag error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

// Step 1 (new): AI Vision extract texts from product assets
router.post('/product-lines/:product_line_id/ai-extract-texts', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id } = req.params;
  const force = req.query.force === 'true' || req.body?.force === true;
  const { asset_ids } = req.body as { asset_ids?: string[] };
  try {
    const result = await aiExtractTexts(product_line_id, force, asset_ids);
    res.json({ code: 0, data: result } as ApiResponse);
  } catch (err) {
    console.error('AI extract texts error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

// AI Generate product description from assets
router.post('/product-lines/:product_line_id/generate-description', authMiddleware, requireRole('admin', 'manager'), async (req, res) => {
  const { product_line_id } = req.params;
  const { asset_ids } = req.body as { asset_ids?: string[] };
  try {
    const description = await generateProductDescription(product_line_id, asset_ids);
    res.json({ code: 0, data: { description } } as ApiResponse);
  } catch (err) {
    console.error('Generate description error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

// Query extracted texts for a product line (Step 1 results)
router.get('/product-lines/:product_line_id/asset-texts', authMiddleware, async (req, res) => {
  const { product_line_id } = req.params;
  try {
    const plRows = await query('SELECT name FROM product_lines WHERE product_line_id = ?', [product_line_id]);
    if (plRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const textRows = await query(
      `SELECT id, file_path, file_type, raw_text, created_at
       FROM product_asset_texts WHERE product_line_id = ? ORDER BY created_at ASC`,
      [product_line_id]
    );

    res.json({
      code: 0,
      data: {
        product_line_id,
        product_name: plRows[0].name,
        total: textRows.length,
        texts: textRows,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Asset texts query error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// AI Dedup — find semantically duplicate entries
const DEDUP_TABLES: Record<string, { id_col: string; label: string; title_col: string; content_col: string }> = {
  selling_points: { id_col: 'point_id', label: '卖点', title_col: 'title', content_col: 'description' },
  product_knowledge: { id_col: 'knowledge_id', label: '产品知识', title_col: 'title', content_col: 'content' },
  sales_scripts: { id_col: 'script_id', label: '销售话术', title_col: 'title', content_col: 'content' },
  product_specs: { id_col: 'spec_id', label: '规格', title_col: 'spec_name', content_col: "CONCAT(spec_name, ': ', spec_value)" },
  sales_scenarios: { id_col: 'scenario_id', label: '场景案例', title_col: 'title', content_col: 'content' },
};

router.post('/knowledge/dedup', authMiddleware, requireRole('admin'), async (req, res) => {
  const { product_line_id, tables } = req.body;
  if (!product_line_id || !tables || !Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 product_line_id 或 tables' } as ApiResponse);
  }

  const validTables = tables.filter((t: string) => DEDUP_TABLES[t]);
  if (validTables.length === 0) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: 'tables 无有效值' } as ApiResponse);
  }

  try {
    const groups: Array<{
      table: string;
      items: Array<{ id: string; title: string; keep: boolean }>;
      reason: string;
    }> = [];

    for (const table of validTables) {
      const cfg = DEDUP_TABLES[table];
      const rows = await query(
        `SELECT ${cfg.id_col} as id, ${cfg.title_col} as title, ${cfg.content_col} as content FROM ${table} WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)`,
        [product_line_id]
      );

      if (rows.length < 2) continue;

      const itemsList = rows.map((r: { id: string; title: string; content: string }) =>
        `ID:${r.id} | ${r.title} | ${r.content?.substring(0, 200)}`
      ).join('\n');

      const prompt = `你是一名知识库管理员。以下是某产品线的「${cfg.label}」列表，请找出语义重复或高度相似的条目。

## 条目列表
${itemsList}

## 要求
1. 找出语义重复或高度相似的条目，归为同一组
2. 每组选择最完整、最清晰的一条作为"建议保留"（keep: true）
3. 完全不重复的条目不需要列出
4. 如果没有重复，返回空数组

返回 JSON：
{"groups":[{"items":[{"id":"uuid","title":"标题","keep":true}],"reason":"原因"}]}

只返回 JSON。`;

      const responseText = await callOpenAIChat(prompt, '请扫描上述列表，找出重复条目。');
      const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.groups && Array.isArray(parsed.groups)) {
        for (const g of parsed.groups) {
          groups.push({ table, items: g.items, reason: g.reason });
        }
      }
    }

    const totalDuplicates = groups.reduce((sum, g) => sum + g.items.filter(i => !i.keep).length, 0);
    res.json({ code: 0, data: { groups, total_groups: groups.length, total_duplicates: totalDuplicates } } as ApiResponse);
  } catch (err) {
    console.error('Dedup error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

// Batch delete — remove items across multiple tables
router.post('/knowledge/batch-delete', authMiddleware, requireRole('admin'), async (req, res) => {
  const { items } = req.body as { items: Array<{ table: string; id: string }> };
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 items 数组' } as ApiResponse);
  }

  try {
    let deletedCount = 0;
    for (const item of items) {
      const cfg = DEDUP_TABLES[item.table];
      if (!cfg) continue;
      const [result] = await pool.execute(`DELETE FROM ${item.table} WHERE ${cfg.id_col} = ?`, [item.id]);
      deletedCount += (result as any).affectedRows || 0;
    }
    res.json({ code: 0, data: { deleted_count: deletedCount } } as ApiResponse);
  } catch (err) {
    console.error('Batch delete error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

export default router;
