import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { callOpenAIChat } from './openai-chat';

const PRODUCT_DATA_ROOT = path.resolve(process.cwd(), '../辅助员工提升销售能力AI员工/产品资料');

const SYSTEM_PROMPT = `你是一个产品知识提取专家。请根据以下产品资料，提取结构化的产品知识。

请按以下 JSON 格式返回：
{
  "summaries": [
    {
      "category": "分类名称",
      "title": "一句话标题",
      "content": "具体内容（尽可能详细，可直接用于销售培训）",
      "tags": ["标签1", "标签2"]
    }
  ]
}

参考分类（不要求全部出现，根据实际素材内容灵活选择）：
- 核心卖点：产品的独特优势和亮点
- 规格参数：关键技术参数、尺寸、容量等
- 竞品对比：与竞品的差异化优势
- 适用场景：推荐的使用场景和客户类型
- 常见问题：客户常见疑问及标准回答
- 产品功能：产品的具体功能和使用方式
- 技术原理：核心技术或工作原理
- 目标客户：适合的用户画像

重要原则：
1. 只提取素材中确实存在的信息，不要编造或推测
2. 素材内容多就多提取，内容少就少提取
3. 如果素材只有图片没有文字说明，就描述图片中能直接看到的内容
4. 如果某个分类在素材中完全找不到依据，就不要生成该分类的条目
5. content 要具体、可直接用于销售培训，避免空泛的描述
6. tags 用于后续搜索匹配，要有代表性和区分度

只返回 JSON，不要有其他文字。`;

interface SummaryItem {
  category: string;
  title: string;
  content: string;
  tags: string[];
}

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

export async function aiSummarizeProduct(productLineId: string): Promise<{
  product_line_id: string;
  product_name: string;
  asset_count: number;
  summaries: SummaryItem[];
}> {
  // 1. Get product info
  const plRows = await query('SELECT name FROM product_lines WHERE product_line_id = ?', [productLineId]);
  if (plRows.length === 0) throw new Error('产品线不存在');
  const productName = plRows[0].name;

  // 2. Get assets
  const assetsRows = await query(
    `SELECT asset_id, title, asset_type, file_path FROM product_assets
     WHERE product_line_id = ? AND status = 'active' ORDER BY sort_order ASC`,
    [productLineId]
  );
  if (assetsRows.length === 0) throw new Error('该产品没有素材');

  // 3. Build message content
  const contentParts: import('./openai-chat').ContentPart[] = [];

  contentParts.push({
    type: 'text',
    text: `产品名称：${productName}\n以下是该产品的所有素材资料，请提取结构化知识：`,
  });

  let pdfTextCount = 0;
  let imageCount = 0;

  for (const asset of assetsRows) {
    const filePath = path.join(PRODUCT_DATA_ROOT, asset.file_path);
    if (!fs.existsSync(filePath)) continue;

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
      try {
        const pdfText = await extractPdfTextWithVision(filePath);
        if (pdfText && pdfText.trim().length > 0) {
          pdfTextCount++;
          contentParts.push({
            type: 'text',
            text: `[${asset.title} - PDF文本内容]\n${pdfText.substring(0, 8000)}`,
          });
        }
      } catch (err) {
        console.error(`PDF vision extract error for ${asset.file_path}:`, err);
      }
    } else if (/\.(jpg|jpeg|png|webp)$/i.test(ext)) {
      if (imageCount < 10) {
        try {
          const imageBuffer = fs.readFileSync(filePath);
          const base64 = imageBuffer.toString('base64');
          const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
          contentParts.push({
            type: 'text',
            text: `[${asset.title}]`,
          });
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          });
          imageCount++;
        } catch (err) {
          console.error(`Image read error for ${asset.file_path}:`, err);
        }
      }
    } else if (ext === '.mp4') {
      contentParts.push({
        type: 'text',
        text: `[${asset.title} - 视频文件，无法提取文本]`,
      });
    }
  }

  console.log(`[AI-Summarize] ${productName}: ${pdfTextCount} PDFs, ${imageCount} images sent`);

  // 4. Call OpenAI
  const responseText = await callOpenAIChat(SYSTEM_PROMPT, contentParts);

  // 5. Parse response
  let summaries: SummaryItem[];
  try {
    const cleaned = responseText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gi, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    summaries = parsed.summaries || [];
  } catch (err) {
    console.error('Failed to parse AI response:', responseText.substring(0, 500));
    throw new Error('AI 返回格式解析失败，请重试');
  }

  return {
    product_line_id: productLineId,
    product_name: productName,
    asset_count: assetsRows.length,
    summaries,
  };
}

export async function saveSummaries(productLineId: string, summaries: SummaryItem[], mode: 'full' | 'append' = 'full'): Promise<number> {
  // full mode: replace all AI-generated records; append mode: only add new ones
  if (mode === 'full') {
    await pool.execute(
      "DELETE FROM product_knowledge WHERE product_line_id = ? AND source = 'ai'",
      [productLineId]
    );
  }

  let count = 0;
  for (const s of summaries) {
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO product_knowledge (knowledge_id, product_line_id, title, content, category, tags, source)
       VALUES (?, ?, ?, ?, ?, ?, 'ai')`,
      [id, productLineId, s.title, s.content, s.category, s.tags && s.tags.length > 0 ? JSON.stringify(s.tags) : null]
    );
    count++;
  }
  return count;
}

async function extractPdfTextWithVision(filePath: string): Promise<string> {
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

    const pageText = await callOpenAIChat(
      `请完整提取这张图片中的所有文字内容。
要求：
1. 原文照搬，不要总结、改写或精简
2. 保持原有的文字内容和结构
3. 如果有表格，用文字形式还原表格内容
4. 如果图片中没有文字，返回空字符串
5. 只返回提取的文字内容，不要添加任何解释`,
      contentParts
    );
    pageTexts.push(pageText.trim());
    console.log(`[AI-Summarize] PDF page ${i}/${doc.numPages}: ${pageText.trim().length} chars`);
  }

  return pageTexts.join('\n\n');
}
