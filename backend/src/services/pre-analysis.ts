import { pool } from '../db';
import { callOpenAIChat } from './openai-chat';

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

export interface PreAnalysisResult {
  weak_points: Array<{
    name: string;
    severity: 'high' | 'medium' | 'low';
    score: number;
    missed_items: string[];
  }>;
  initial_scores: {
    knowledgeCoverage: number;
    coreHitRate: number;
    dataAccuracy: number;
    scriptMatch: number;
    structureScore: number;
    fluencyScore: number;
  };
  overall_score: number;
  strategy: {
    focus_areas: string[];
    suggested_rounds: Array<{
      round: number;
      focus: string;
      difficulty: 'easy' | 'medium' | 'hard';
    }>;
    groups: Array<{
      category: string;
      severity: 'high' | 'medium' | 'low';
      base_difficulty: 'easy' | 'medium' | 'hard';
      rounds: Array<{
        round: number;
        difficulty: 'easy' | 'medium' | 'hard' | 'adaptive';
        knowledge_source: string;
        expand_if_correct: 'hard';
        simplify_if_wrong: 'easy';
      }>;
    }>;
  };
}

export async function runPreAnalysis(
  recordId: string,
  transcript: string,
  productLineName: string,
  fluencyScore: number,
  segments: Array<{ start: number; text: string }> = []
): Promise<PreAnalysisResult> {
  // 1. Find product_line_id
  const plRows = await query(
    'SELECT product_line_id FROM product_lines WHERE name = ? AND status = ?',
    [productLineName, 'active']
  );
  const productLineId = plRows.length > 0 ? plRows[0].product_line_id : null;

  // 2. Fetch all knowledge
  const [spRows, scriptsRows, specsRows, scenariosRows, knowledgeRows] = await Promise.all([
    query(
      "SELECT point_id, title, description, priority FROM selling_points WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY priority DESC",
      [productLineId]
    ),
    query(
      "SELECT script_id, title, scene, content FROM sales_scripts WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)",
      [productLineId]
    ),
    query(
      "SELECT spec_id, spec_name, spec_value FROM product_specs WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)",
      [productLineId]
    ),
    query(
      "SELECT scenario_id, title, content FROM sales_scenarios WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)",
      [productLineId]
    ),
    query(
      "SELECT knowledge_id, title, content, category FROM product_knowledge WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL)",
      [productLineId]
    ),
  ]);

  const sellingPoints = spRows
    .map((r: any) => `ID:${r.point_id} [优先级${r.priority}] ${r.title}: ${r.description?.substring(0, 100)}`)
    .join('\n');
  const scripts = scriptsRows
    .map((r: any) => `ID:${r.script_id} [${r.scene || '通用'}] ${r.title}: ${r.content?.substring(0, 120)}`)
    .join('\n');
  const specs = specsRows
    .map((r: any) => `${r.spec_name}: ${r.spec_value}`)
    .join('\n');
  const scenarios = scenariosRows
    .map((r: any) => `${r.title}: ${r.content?.substring(0, 120)}`)
    .join('\n');
  const features = knowledgeRows
    .filter((r: any) => r.category === '产品功能' || r.category === '技术原理')
    .map((r: any) => `${r.title}: ${r.content?.substring(0, 120)}`)
    .join('\n');
  const competitors = knowledgeRows
    .filter((r: any) => r.category === '竞品对比')
    .map((r: any) => `${r.title}: ${r.content?.substring(0, 120)}`)
    .join('\n');

  // Build timestamped transcript
  const transcriptForGpt =
    segments.length > 0
      ? segments.map((seg) => `[${formatTime(seg.start)}] ${seg.text}`).join('\n').substring(0, 4000)
      : transcript.substring(0, 4000);

  const systemPrompt = `你是一位销售培训专家。请根据以下销售录音转录，分析该销售人员的介绍表现，输出薄弱点和对话策略。

## 转录文本
${transcriptForGpt}

## 知识库

### 核心卖点（共${spRows.length}条）
${sellingPoints.substring(0, 2000)}

### 产品功能/技术原理
${features.substring(0, 1200)}

### 规格参数
${specs.substring(0, 1000)}

### 适用场景
${scenarios.substring(0, 1200)}

### 竞品对比
${competitors.substring(0, 1200)}

### 销售话术
${scripts.substring(0, 1200)}

## 任务

1. 按 6 个知识类别评分（0-100）：核心卖点、规格参数、产品功能、适用场景、竞品对比、话术流程
2. 找出每个类别中具体遗漏了哪些知识点（用知识库中的 title 作为 missed_items）
3. 根据得分最低的 3 个类别生成对话策略
4. 每个类别设计 2 轮：第 1 轮 medium，第 2 轮根据回答自适应（adaptive）

## 类别对应的知识来源
- 核心卖点 → selling_points
- 规格参数 → product_specs
- 产品功能 → product_knowledge
- 适用场景 → sales_scenarios
- 竞品对比 → product_knowledge
- 话术流程 → sales_scripts

## 输出格式（严格JSON）

{
  "weak_points": [
    {
      "name": "规格参数",
      "severity": "high",
      "score": 35,
      "missed_items": ["额定功率", "滤芯寿命"]
    },
    {
      "name": "产品功能",
      "severity": "high",
      "score": 42,
      "missed_items": ["童锁功能"]
    },
    {
      "name": "竞品对比",
      "severity": "medium",
      "score": 50,
      "missed_items": ["与品牌X的对比"]
    }
  ],
  "initial_scores": {
    "knowledgeCoverage": 55,
    "coreHitRate": 45,
    "dataAccuracy": 80,
    "scriptMatch": 60,
    "structureScore": 70,
    "fluencyScore": ${fluencyScore}
  },
  "overall_score": 64,
  "strategy": {
    "focus_areas": ["规格参数", "产品功能", "竞品对比"],
    "suggested_rounds": [
      { "round": 1, "focus": "规格参数", "difficulty": "medium" },
      { "round": 2, "focus": "规格参数", "difficulty": "adaptive" },
      { "round": 3, "focus": "产品功能", "difficulty": "medium" },
      { "round": 4, "focus": "产品功能", "difficulty": "adaptive" },
      { "round": 5, "focus": "竞品对比", "difficulty": "medium" },
      { "round": 6, "focus": "竞品对比", "difficulty": "adaptive" }
    ],
    "groups": [
      {
        "category": "规格参数",
        "severity": "high",
        "base_difficulty": "medium",
        "rounds": [
          { "round": 1, "difficulty": "medium", "knowledge_source": "product_specs", "expand_if_correct": "hard", "simplify_if_wrong": "easy" },
          { "round": 2, "difficulty": "adaptive", "knowledge_source": "product_specs", "expand_if_correct": "hard", "simplify_if_wrong": "easy" }
        ]
      },
      {
        "category": "产品功能",
        "severity": "high",
        "base_difficulty": "medium",
        "rounds": [
          { "round": 3, "difficulty": "medium", "knowledge_source": "product_knowledge", "expand_if_correct": "hard", "simplify_if_wrong": "easy" },
          { "round": 4, "difficulty": "adaptive", "knowledge_source": "product_knowledge", "expand_if_correct": "hard", "simplify_if_wrong": "easy" }
        ]
      },
      {
        "category": "竞品对比",
        "severity": "medium",
        "base_difficulty": "medium",
        "rounds": [
          { "round": 5, "difficulty": "medium", "knowledge_source": "product_knowledge", "expand_if_correct": "hard", "simplify_if_wrong": "easy" },
          { "round": 6, "difficulty": "adaptive", "knowledge_source": "product_knowledge", "expand_if_correct": "hard", "simplify_if_wrong": "easy" }
        ]
      }
    ]
  }
}

注意：
- weak_points 按 severity 排序（high > medium > low），最多 6 条
- overall_score = (knowledgeCoverage + coreHitRate + dataAccuracy + scriptMatch + structureScore) / 5
- 选出得分最低的 3 个类别，每个类别 2 轮，共 6 轮
- groups 必须有 3 组，每组的 rounds 有 2 条
- suggested_rounds 必须有 6 条（round 1-6）
- 第 1/3/5 轮 difficulty 固定 medium，第 2/4/6 轮 difficulty 为 adaptive
- fluencyScore 已给定，直接使用 ${fluencyScore}
- 只返回 JSON`;

  const responseText = await callOpenAIChat(
    systemPrompt,
    '请分析上述销售转录，按格式返回JSON。'
  );

  const cleaned = responseText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/gi, '')
    .replace(/[\x00-\x1f]/g, (c) => (c === '\n' || c === '\r' || c === '\t' ? c : ''))
    .trim();

  const parsed = JSON.parse(cleaned) as PreAnalysisResult;

  // Normalize defaults
  return {
    weak_points: parsed.weak_points || [],
    initial_scores: parsed.initial_scores || {
      knowledgeCoverage: 50,
      coreHitRate: 50,
      dataAccuracy: 50,
      scriptMatch: 50,
      structureScore: 50,
      fluencyScore,
    },
    overall_score: parsed.overall_score || 50,
    strategy: parsed.strategy || {
      focus_areas: [],
      suggested_rounds: Array.from({ length: 6 }, (_, i) => ({
        round: i + 1,
        focus: '产品知识',
        difficulty: (i % 2 === 0 ? 'medium' : 'adaptive') as 'medium' | 'adaptive',
      })),
      groups: [],
    },
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
