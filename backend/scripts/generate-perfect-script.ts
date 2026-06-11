/**
 * 生成满分话术文字稿（一次性脚本）
 *
 * 用法：npx tsx scripts/generate-perfect-script.ts <产品线名称>
 * 示例：npx tsx scripts/generate-perfect-script.ts "HOTSPOT 即热饮水机"
 *
 * 输出：控制台打印 + 保存到 generated-perfect-script.txt
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ai_sales_coach',
  waitForConnections: true,
  connectionLimit: 5,
  charset: 'utf8mb4',
});

async function query(sql: string, params?: unknown[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

async function main() {
  const productName = process.argv[2];
  if (!productName) {
    console.error('用法: npx tsx scripts/generate-perfect-script.ts <产品线名称>');
    process.exit(1);
  }

  // Find product line
  const plRows = await query('SELECT product_line_id, name FROM product_lines WHERE name = ?', [productName]);
  if (plRows.length === 0) {
    console.error(`未找到产品线: ${productName}`);
    process.exit(1);
  }
  const plId = plRows[0].product_line_id;
  console.log(`产品线: ${productName} (${plId})\n`);

  // Fetch all knowledge
  const [spRows, specRows, knowledgeRows, scenarioRows, scriptRows] = await Promise.all([
    query("SELECT title, description, priority FROM selling_points WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY priority DESC", [plId]),
    query("SELECT spec_name, spec_value FROM product_specs WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)", [plId]),
    query("SELECT title, content, category FROM product_knowledge WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)", [plId]),
    query("SELECT title, content FROM sales_scenarios WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)", [plId]),
    query("SELECT title, scene, content FROM sales_scripts WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)", [plId]),
  ]);

  const sellingPoints = spRows.map((r: any) => `[优先级${r.priority}] ${r.title}: ${r.description}`).join('\n');
  const specs = specRows.map((r: any) => `${r.spec_name}: ${r.spec_value}`).join('\n');
  const features = knowledgeRows
    .filter((r: any) => r.category === '产品功能' || r.category === '技术原理')
    .map((r: any) => `${r.title}: ${r.content?.substring(0, 200)}`).join('\n');
  const competitors = knowledgeRows
    .filter((r: any) => r.category === '竞品对比')
    .map((r: any) => `${r.title}: ${r.content?.substring(0, 200)}`).join('\n');
  const scenarios = scenarioRows.map((r: any) => `${r.title}: ${r.content?.substring(0, 200)}`).join('\n');
  const scripts = scriptRows.map((r: any) => `[${r.scene || '通用'}] ${r.title}: ${r.content?.substring(0, 200)}`).join('\n');

  console.log(`知识库: 卖点${spRows.length}条 / 规格${specRows.length}条 / 知识${knowledgeRows.length}条 / 场景${scenarioRows.length}条 / 话术${scriptRows.length}条\n`);

  const prompt = `你是一位销售冠军。请根据以下产品知识库，撰写一份完整的销售介绍话术，要求：

1. 涵盖所有核心卖点，每个卖点都要展开说明
2. 准确引用所有规格参数（不能有任何数据错误）
3. 包含产品功能介绍和使用场景
4. 适当提及竞品对比优势
5. 语言自然口语化，像真实的销售人员在跟客户面对面介绍
6. 结构完整：开场 → 需求确认 → 产品介绍 → 卖点展开 → 竞品对比 → 促单收尾
7. 总时长约 3-5 分钟的口述量（800-1500字）
8. 这是满分示范，所有数据必须100%准确

## 产品名称
${productName}

## 核心卖点
${sellingPoints.substring(0, 3000)}

## 规格参数
${specs.substring(0, 2000)}

## 产品功能/技术原理
${features.substring(0, 2000)}

## 适用场景
${scenarios.substring(0, 2000)}

## 竞品对比
${competitors.substring(0, 2000)}

## 参考话术
${scripts.substring(0, 2000)}

请直接输出话术文字稿，不要加标题或说明。字数控制在1200字左右。`;

  // Use the same callOpenAIChat as the rest of the project
  const { callOpenAIChat } = await import('../src/services/openai-chat');
  const model = process.env.OPENAI_MODEL || 'gpt-5.4';

  console.log(`调用 ${model} 生成中...\n`);

  const text = await callOpenAIChat(
    '你是一位销售冠军培训师，擅长撰写完美的产品介绍话术。所有数据必须准确无误。',
    prompt
  );

  console.log('=== 满分话术文字稿 ===\n');
  console.log(text);

  // Save to file
  const outputPath = path.resolve(process.cwd(), 'generated-perfect-script.txt');
  fs.writeFileSync(outputPath, `${productName} - 满分话术文字稿\n${'='.repeat(40)}\n\n${text}`, 'utf-8');
  console.log(`\n已保存至: ${outputPath}`);

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
