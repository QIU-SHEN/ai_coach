import { callOpenAIChat } from './openai-chat';
import { pool } from '../db';

const QUIZ_GENERATOR_PROMPT = `你是一位产品知识培训专家。请基于以下产品资料，为该产品生成 10 道选择题，用于考核销售人员对产品知识的掌握程度。

产品资料：
"""
{{materials}}
"""

要求：
1. 每道题 4 个选项，只有 1 个正确答案
2. 题目难度分布：简单 30%、中等 50%、困难 20%
3. 题目类别应覆盖：卖点、参数规格、使用场景、竞品对比
4. 答案解析要详细说明为什么正确、其他选项为什么错误
5. 选项内容不要过长，每选项控制在 30 字以内

输出严格 JSON 数组，不要包含 markdown 代码块标记：
[
  {
    "question": "题目内容",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "correct_index": 0,
    "explanation": "答案解析",
    "difficulty": "easy|medium|hard",
    "category": "卖点|参数|场景|竞品"
  }
]`;

export async function generateQuizzesForProduct(productLineId: string) {
  // Gather product materials
  const [knowledgeRows]: any = await pool.execute(
    'SELECT title, content FROM product_knowledge WHERE product_line_id = ? AND status = "active"',
    [productLineId]
  );
  const [specRows]: any = await pool.execute(
    'SELECT spec_name, spec_value, unit, common_mistake FROM product_specs WHERE product_line_id = ? AND status = "active"',
    [productLineId]
  );
  const [pointRows]: any = await pool.execute(
    'SELECT title, description FROM selling_points WHERE product_line_id = ? AND status = "active"',
    [productLineId]
  );
  const [scriptRows]: any = await pool.execute(
    'SELECT title, content FROM sales_scripts WHERE product_line_id = ? AND status = "active"',
    [productLineId]
  );
  const [assetTextRows]: any = await pool.execute(
    'SELECT raw_text FROM product_asset_texts WHERE product_line_id = ? LIMIT 3',
    [productLineId]
  );

  const materials: string[] = [];

  for (const r of knowledgeRows) {
    materials.push(`【知识】${r.title}: ${r.content}`);
  }
  for (const r of specRows) {
    materials.push(`【参数】${r.spec_name}: ${r.spec_value}${r.unit || ''}${r.common_mistake ? '（常见错误：' + r.common_mistake + '）' : ''}`);
  }
  for (const r of pointRows) {
    materials.push(`【卖点】${r.title}: ${r.description}`);
  }
  for (const r of scriptRows) {
    materials.push(`【话术】${r.title}: ${r.content}`);
  }
  for (const r of assetTextRows) {
    if (r.raw_text) materials.push(`【资料】${r.raw_text.substring(0, 500)}`);
  }

  if (materials.length === 0) {
    throw new Error('该产品暂无可用资料，无法生成题目');
  }

  const prompt = QUIZ_GENERATOR_PROMPT.replace('{{materials}}', materials.join('\n'));
  const response = await callOpenAIChat(prompt, '请严格按照 JSON 数组格式输出题目。');
  const jsonText = response.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  const quizzes = JSON.parse(jsonText);

  if (!Array.isArray(quizzes)) {
    throw new Error('AI 返回的题目格式不正确');
  }

  // Insert into DB
  const insertedIds: string[] = [];
  for (const q of quizzes) {
    const [result]: any = await pool.execute(
      `INSERT INTO product_quizzes (product_line_id, question, options, correct_index, explanation, difficulty, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productLineId, q.question, JSON.stringify(q.options), q.correct_index, q.explanation, q.difficulty, q.category]
    );
    insertedIds.push(result.insertId);
  }

  return { count: insertedIds.length, quizzes };
}

export async function generateQuizzesForMaterial(materialId: string) {
  const [materialRows]: any = await pool.execute(
    'SELECT title, description, file_url, product_line_id, type FROM training_materials WHERE material_id = ?',
    [materialId]
  );
  if (materialRows.length === 0) {
    throw new Error('培训资料不存在');
  }
  const material = materialRows[0];

  const materials: string[] = [];
  materials.push(`【培训资料标题】${material.title}`);
  materials.push(`【培训资料描述】${material.description || ''}`);

  // Gather related product knowledge for richer context
  const productLineId = material.product_line_id;
  if (productLineId) {
    const [knowledgeRows]: any = await pool.execute(
      'SELECT title, content FROM product_knowledge WHERE product_line_id = ? AND status = "active" LIMIT 5',
      [productLineId]
    );
    for (const r of knowledgeRows) {
      materials.push(`【知识】${r.title}: ${r.content}`);
    }
    const [pointRows]: any = await pool.execute(
      'SELECT title, description FROM selling_points WHERE product_line_id = ? AND status = "active" LIMIT 5',
      [productLineId]
    );
    for (const r of pointRows) {
      materials.push(`【卖点】${r.title}: ${r.description}`);
    }
    const [specRows]: any = await pool.execute(
      'SELECT spec_name, spec_value, unit FROM product_specs WHERE product_line_id = ? AND status = "active" LIMIT 5',
      [productLineId]
    );
    for (const r of specRows) {
      materials.push(`【参数】${r.spec_name}: ${r.spec_value}${r.unit || ''}`);
    }
  }

  const prompt = `你是一位产品知识培训专家。请基于以下培训资料，生成 10 道选择题：

资料标题：${material.title}
资料描述：${material.description || ''}

辅助产品知识：
${materials.join('\n')}

要求：
1. 每道题 4 个选项，只有 1 个正确答案
2. 题目难度分布：简单 30%、中等 50%、困难 20%
3. 题目类别应覆盖：卖点、参数规格、使用场景、竞品对比
4. 答案解析要详细说明为什么正确、其他选项为什么错误
5. 选项内容不要过长，每选项控制在 30 字以内

输出严格 JSON 数组，不要包含 markdown 代码块标记：
[
  {
    "question": "题目内容",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "correct_index": 0,
    "explanation": "答案解析",
    "difficulty": "easy|medium|hard",
    "category": "卖点|参数|场景|竞品"
  }
]`;

  const response = await callOpenAIChat(prompt, '请严格按照 JSON 数组格式输出题目。');
  const jsonText = response.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  const quizzes = JSON.parse(jsonText);

  if (!Array.isArray(quizzes)) {
    throw new Error('AI 返回的题目格式不正确');
  }

  const insertedIds: string[] = [];
  for (const q of quizzes) {
    const [result]: any = await pool.execute(
      `INSERT INTO product_quizzes (product_line_id, material_id, question, options, correct_index, explanation, difficulty, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [productLineId || null, materialId, q.question, JSON.stringify(q.options), q.correct_index, q.explanation, q.difficulty, q.category]
    );
    insertedIds.push(result.insertId);
  }

  return { count: insertedIds.length, quizzes };
}
