import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { callOpenAIChat } from './openai-chat';

const PARSE_PROMPT = `你是一名销售培训资料解析专家。请将以下销售培训资料拆解为结构化的最小可匹配单元。

请按以下 JSON 格式返回：

{
  "selling_points": [
    {
      "title": "核心观点标题（一句话）",
      "description": "详细阐述",
      "keywords": ["关键词1", "关键词2", "关键词3"],
      "priority": 8,
      "category": "分类（如：方法论/客户认知/价值主张/竞争优势）"
    }
  ],
  "scripts": [
    {
      "title": "话术标题",
      "scene": "适用场景（如：客户说太贵了/开场白/异议处理/成交推进）",
      "content": "标准话术文本（完整保留原文，包括引号内的对话）"
    }
  ],
  "specs": [
    {
      "spec_name": "概念/方法名称（如：SPIN/FABE/CPLA）",
      "spec_value": "定义或核心内容",
      "unit": "",
      "common_mistake": "常见错误做法或误解"
    }
  ],
  "scenarios": [
    {
      "title": "案例/场景标题",
      "scene_type": "类型（如：实战案例/客户类型/销售阶段/行业场景）",
      "content": "详细描述（完整保留原文）",
      "key_takeaway": "关键启示/要点"
    }
  ]
}

提取规则：
1. selling_points：提取资料中的核心观点、关键洞察、价值主张。如"从卖产品到卖方案""服务是最好的销售"等
2. scripts：提取所有带引号的对话、话术示例、标准应答。每个场景独立成条
3. specs：提取销售方法论（SPIN四步、FABE法则等）的定义和要点
4. scenarios：提取实战案例、客户类型分析、销售阶段描述
5. 每个单元必须是从原文真实提取，不要编造
6. 关键词要简短（2-4个字），方便搜索匹配
7. priority 1-10，核心方法论给 9-10，一般观点给 5-7
8. 如果某类单元在资料中找不到，返回空数组

只返回 JSON，不要有其他文字。`;

interface ParsedTrainingDoc {
  selling_points: Array<{
    title: string;
    description: string;
    keywords: string[];
    priority: number;
    category: string;
  }>;
  scripts: Array<{
    title: string;
    scene: string;
    content: string;
  }>;
  specs: Array<{
    spec_name: string;
    spec_value: string;
    unit: string;
    common_mistake: string;
  }>;
  scenarios: Array<{
    title: string;
    scene_type: string;
    content: string;
    key_takeaway: string;
  }>;
}

export async function aiParseTrainingDoc(rawText: string, productLineId?: string) {
  const responseText = await callOpenAIChat(PARSE_PROMPT, rawText.substring(0, 12000));

  const cleaned = responseText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/gi, '')
    .replace(/[\x00-\x1f]/g, c => c === '\n' || c === '\r' || c === '\t' ? c : '')
    .trim();

  const parsed: ParsedTrainingDoc = JSON.parse(cleaned);

  const result = {
    selling_points_count: 0,
    scripts_count: 0,
    specs_count: 0,
    scenarios_count: 0,
  };

  // Insert selling points
  if (parsed.selling_points && parsed.selling_points.length > 0) {
    for (const sp of parsed.selling_points) {
      const id = uuidv4();
      await pool.execute(
        `INSERT INTO selling_points (point_id, product_line_id, title, description, keywords, priority, category, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ai')`,
        [
          id,
          productLineId || null,
          sp.title,
          sp.description,
          sp.keywords && sp.keywords.length > 0 ? JSON.stringify(sp.keywords) : null,
          sp.priority || 5,
          sp.category || null,
        ]
      );
    }
    result.selling_points_count = parsed.selling_points.length;
  }

  // Insert scripts
  if (parsed.scripts && parsed.scripts.length > 0) {
    for (const sc of parsed.scripts) {
      const id = uuidv4();
      await pool.execute(
        `INSERT INTO sales_scripts (script_id, product_line_id, title, scene, content, source)
         VALUES (?, ?, ?, ?, ?, 'ai')`,
        [
          id,
          productLineId || null,
          sc.title,
          sc.scene || null,
          sc.content,
        ]
      );
    }
    result.scripts_count = parsed.scripts.length;
  }

  // Insert specs
  if (parsed.specs && parsed.specs.length > 0) {
    for (const sp of parsed.specs) {
      const id = uuidv4();
      await pool.execute(
        `INSERT INTO product_specs (spec_id, product_line_id, spec_name, spec_value, unit, common_mistake, source)
         VALUES (?, ?, ?, ?, ?, ?, 'ai')`,
        [
          id,
          productLineId || null,
          sp.spec_name,
          sp.spec_value,
          sp.unit || null,
          sp.common_mistake || null,
        ]
      );
    }
    result.specs_count = parsed.specs.length;
  }

  // Insert scenarios
  if (parsed.scenarios && parsed.scenarios.length > 0) {
    for (const sc of parsed.scenarios) {
      const id = uuidv4();
      await pool.execute(
        `INSERT INTO sales_scenarios (scenario_id, product_line_id, title, scene_type, content, key_takeaway, source)
         VALUES (?, ?, ?, ?, ?, ?, 'ai')`,
        [
          id,
          productLineId || null,
          sc.title,
          sc.scene_type || null,
          sc.content,
          sc.key_takeaway || null,
        ]
      );
    }
    result.scenarios_count = parsed.scenarios.length;
  }

  return result;
}
