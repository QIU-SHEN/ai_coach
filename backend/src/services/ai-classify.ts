import { pool } from '../db';
import { callOpenAIChat } from './openai-chat';

const CLASSIFY_SYSTEM_PROMPT = `你是一个产品知识整理专家。以下是某产品所有素材中提取的原始文字。

请将以上内容整理分类。要求：
1. 将相关内容归入同一类别，参考分类：核心卖点、规格参数、竞品对比、适用场景、常见问题、产品功能、技术原理、目标客户
2. 如果内容不适合以上分类，可以自定义新分类
3. 同一分类下可能有多条内容
4. **必须保留原文，不要删改、总结或精简文字**，只做归类和去重（完全相同的文字只保留一条）
5. 每条内容标注来源文件名（source_file）
6. 如果不同素材中有互补信息（比如一个说功率 2200W，另一个说额定电压 220V/50Hz），保留两条，不要合并

只返回 JSON，格式：
{"categories":[{"category":"分类名称","items":[{"title":"一句话概括","content":"原文内容（完整保留）","source_file":"来源文件名"}]}]}`;

const TAG_SYSTEM_PROMPT = `你是产品知识标注专家。请为以下每条产品知识添加标签。

要求：
1. 每条添加 3-5 个标签
2. 标签要有代表性，方便后续搜索匹配
3. 标签要简短（2-4 个字），如：净热一体、免安装、3秒出热水
4. 不同条目的标签可以有重叠

返回相同 JSON 结构，每条增加 tags 字段。只返回 JSON。`;

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

export async function aiClassifyRawTexts(productLineId: string, assetIds?: string[]) {
  const plRows = await query('SELECT name FROM product_lines WHERE product_line_id = ?', [productLineId]);
  if (plRows.length === 0) throw new Error('产品线不存在');
  const productName = plRows[0].name;

  let textsRows;
  if (assetIds && assetIds.length > 0) {
    const placeholders = assetIds.map(() => '?').join(',');
    textsRows = await query(
      `SELECT file_path, file_type, raw_text FROM product_asset_texts WHERE product_line_id = ? AND asset_id IN (${placeholders})`,
      [productLineId, ...assetIds]
    );
  } else {
    textsRows = await query(
      'SELECT file_path, file_type, raw_text FROM product_asset_texts WHERE product_line_id = ?',
      [productLineId]
    );
  }
  if (textsRows.length === 0) throw new Error('该产品没有提取文字，请先运行 Step 1');

  const allTexts = textsRows
    .filter((r: { raw_text: string }) => r.raw_text && r.raw_text.trim())
    .map((r: { file_path: string; raw_text: string }) => `--- 文件: ${r.file_path} ---\n${r.raw_text}`)
    .join('\n\n');

  const userContent = `产品名称：${productName}\n\n原始文字内容：\n${allTexts}`;

  const responseText = await callOpenAIChat(CLASSIFY_SYSTEM_PROMPT, userContent);

  const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').replace(/[\x00-\x1f]/g, c => c === '\n' || c === '\r' || c === '\t' ? c : '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    product_line_id: productLineId,
    product_name: productName,
    source_file_count: textsRows.length,
    categories: parsed.categories || [],
  };
}

export async function aiTagClassified(categories: Array<{ category: string; items: Array<{ title: string; content: string; source_file: string }> }>): Promise<Array<{ category: string; items: Array<{ title: string; content: string; source_file: string; tags: string[] }> }>> {
  const userContent = JSON.stringify({ categories }, null, 2);
  const responseText = await callOpenAIChat(TAG_SYSTEM_PROMPT, userContent);

  const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').replace(/[\x00-\x1f]/g, c => c === '\n' || c === '\r' || c === '\t' ? c : '').trim();
  const parsed = JSON.parse(cleaned);
  return parsed.categories || [];
}
