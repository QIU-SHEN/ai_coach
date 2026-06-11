import { pool } from '../db';
import { callOpenAIChat } from './openai-chat';
import { aiExtractTexts } from './ai-extract-texts';
import { aiSummarizeProduct } from './ai-summarize';

const DESCRIPTION_PROMPT = `你是一位专业的产品文案撰写专家。请根据以下产品资料，撰写一段全面、流畅、有吸引力的产品介绍。

要求：
1. 字数在300-800字之间
2. 语言流畅自然，像专业的产品宣传文案
3. 涵盖产品的核心卖点、主要功能、适用场景
4. 不要罗列条目，要写成连贯的段落式文章
5. 可以适当加入对目标客户的价值描述
6. 不要编造素材中没有的信息

只返回产品介绍正文，不要有任何前缀说明或JSON格式。`;

async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

export async function generateProductDescription(productLineId: string, assetIds?: string[]): Promise<string> {
  // 1. Get product name
  const plRows = await query('SELECT name FROM product_lines WHERE product_line_id = ?', [productLineId]);
  if (plRows.length === 0) throw new Error('产品线不存在');
  const productName = plRows[0].name;

  // 2. Extract texts from selected assets only
  let extractedTexts: string[] = [];
  try {
    if (assetIds && assetIds.length > 0) {
      // Only extract selected images
      await aiExtractTexts(productLineId, true, assetIds);
      const textRows = await query(
        `SELECT raw_text FROM product_asset_texts
         WHERE product_line_id = ? AND asset_id IN (${assetIds.map(() => '?').join(',')})
         AND raw_text IS NOT NULL AND raw_text != ''`,
        [productLineId, ...assetIds]
      );
      extractedTexts = textRows.map((r: any) => r.raw_text).filter(Boolean);
    } else {
      // Fallback: extract all assets
      await aiExtractTexts(productLineId, true);
      const textRows = await query(
        'SELECT raw_text FROM product_asset_texts WHERE product_line_id = ? AND raw_text IS NOT NULL AND raw_text != \'\'',
        [productLineId]
      );
      extractedTexts = textRows.map((r: any) => r.raw_text).filter(Boolean);
    }
  } catch (err) {
    console.warn('[AI-Description] Text extraction failed or no texts found:', err);
  }

  // 3. Build prompt for description generation
  const parts: string[] = [];
  parts.push(`产品名称：${productName}`);

  if (extractedTexts.length > 0) {
    parts.push('\n--- 从图片中提取的原始文字 ---');
    extractedTexts.slice(0, 10).forEach((text, i) => {
      parts.push(`[图片${i + 1}]\n${text.substring(0, 2000)}`);
    });
  }

  if (extractedTexts.length === 0) {
    throw new Error('没有可用的素材来生成产品介绍');
  }

  parts.push('\n请基于以上图片提取的文字，撰写一段专业的产品介绍。');

  // 4. Call OpenAI to generate description
  const description = await callOpenAIChat(DESCRIPTION_PROMPT, parts.join('\n'));

  // 5. Save to database
  await pool.execute(
    'UPDATE product_lines SET description = ? WHERE product_line_id = ?',
    [description.trim(), productLineId]
  );

  return description.trim();
}
