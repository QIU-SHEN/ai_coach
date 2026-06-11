import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { callOpenAIChat } from './openai-chat';

const PRODUCT_DATA_ROOT = path.resolve(process.cwd(), '../辅助员工提升销售能力AI员工/产品资料');

const EXTRACT_PROMPT = `请完整提取这张图片（或PDF）中的所有文字内容。

要求：
1. 原文照搬，不要总结、改写或精简
2. 保持原有的文字内容和结构
3. 如果有表格，用文字形式还原表格内容
4. 如果图片中没有文字，返回空字符串
5. 只返回提取的文字内容，不要添加任何解释`;

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mov']);

interface ExtractedItem {
  file_path: string;
  file_type: string;
  char_count: number;
}

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

export async function aiExtractTexts(productLineId: string, force = false, assetIds?: string[]) {
  const plRows = await query('SELECT name FROM product_lines WHERE product_line_id = ?', [productLineId]);
  if (plRows.length === 0) throw new Error('产品线不存在');
  const productName = plRows[0].name;

  let assetsRows;
  if (assetIds && assetIds.length > 0) {
    const placeholders = assetIds.map(() => '?').join(',');
    assetsRows = await query(
      `SELECT asset_id, title, asset_type, file_path FROM product_assets
       WHERE product_line_id = ? AND status = 'active' AND asset_id IN (${placeholders}) ORDER BY sort_order ASC`,
      [productLineId, ...assetIds]
    );
  } else {
    assetsRows = await query(
      `SELECT asset_id, title, asset_type, file_path FROM product_assets
       WHERE product_line_id = ? AND status = 'active' ORDER BY sort_order ASC`,
      [productLineId]
    );
  }
  if (assetsRows.length === 0) throw new Error('该产品没有素材');

  if (force) {
    if (assetIds && assetIds.length > 0) {
      const placeholders = assetIds.map(() => '?').join(',');
      await pool.execute(
        `DELETE FROM product_asset_texts WHERE product_line_id = ? AND asset_id IN (${placeholders})`,
        [productLineId, ...assetIds]
      );
    } else {
      await pool.execute('DELETE FROM product_asset_texts WHERE product_line_id = ?', [productLineId]);
    }
  }

  const existingRows = await query(
    'SELECT file_path FROM product_asset_texts WHERE product_line_id = ?',
    [productLineId]
  );
  const existingPaths = new Set(existingRows.map((r: { file_path: string }) => r.file_path));

  const texts: ExtractedItem[] = [];

  for (const asset of assetsRows) {
    // Uploaded files use 'uploads/...' path relative to cwd, others use PRODUCT_DATA_ROOT
    const filePath = asset.file_path.startsWith('uploads/')
      ? path.resolve(process.cwd(), asset.file_path)
      : path.join(PRODUCT_DATA_ROOT, asset.file_path);
    if (!fs.existsSync(filePath)) {
      console.warn(`[AI-Extract] File not found: ${filePath}`);
      continue;
    }

    if (existingPaths.has(asset.file_path)) {
      texts.push({ file_path: asset.file_path, file_type: 'skipped', char_count: 0 });
      continue;
    }

    const ext = path.extname(filePath).toLowerCase();
    let rawText: string | null = null;
    let fileType = 'unknown';

    if (IMAGE_EXTS.has(ext)) {
      if (/长图/.test(asset.file_path)) {
        console.log(`[AI-Extract] Skip long image: ${asset.file_path}`);
        continue;
      }
      fileType = 'image';
      rawText = await extractFromImage(filePath);
    } else if (ext === '.pdf') {
      fileType = 'pdf';
      rawText = await extractFromPdf(filePath);
    } else if (VIDEO_EXTS.has(ext)) {
      fileType = 'video';
      rawText = null;
    } else {
      continue;
    }

    const id = uuidv4();
    await pool.execute(
      `INSERT INTO product_asset_texts (id, product_line_id, asset_id, file_path, file_type, raw_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, productLineId, asset.asset_id, asset.file_path, fileType, rawText]
    );

    texts.push({ file_path: asset.file_path, file_type: fileType, char_count: rawText ? rawText.length : 0 });
    console.log(`[AI-Extract] ${asset.file_path} (${fileType}): ${rawText ? rawText.length : 0} chars`);
  }

  return {
    product_line_id: productLineId,
    product_name: productName,
    extracted_count: texts.filter(t => t.file_type !== 'skipped').length,
    skipped_count: texts.filter(t => t.file_type === 'skipped').length,
    texts,
  };
}

async function extractFromImage(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const contentParts: import('./openai-chat').ContentPart[] = [
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
  ];

  const response = await callOpenAIChat(EXTRACT_PROMPT, contentParts);
  return response.trim();
}

async function extractFromPdf(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require('@napi-rs/canvas');

  const dataBuffer = fs.readFileSync(filePath);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const base64 = canvas.toBuffer('image/png').toString('base64');
    const contentParts: import('./openai-chat').ContentPart[] = [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
    ];
    const pageText = await callOpenAIChat(EXTRACT_PROMPT, contentParts);
    pageTexts.push(pageText.trim());
    console.log(`[AI-Extract] PDF page ${i}/${doc.numPages}: ${pageText.trim().length} chars`);
  }

  return pageTexts.join('\n\n');
}
