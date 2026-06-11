import { pool } from '../db';
import { callOpenAIChat } from './openai-chat';
import type { TranscriptSegment } from '../types';
import type { FluencyBreakdown } from './fluency-score';

interface ContentIssue {
  timestamp: number;
  timestamp_label: string;
  type: 'spec_error' | 'data_inaccurate' | 'methodology_error' | 'claim_unsupported';
  type_label: string;
  said: string;
  correct: string;
  spec_name: string;
  severity: 'high' | 'medium' | 'low';
}

interface CategoryAnalysis {
  category: string;
  score: number;
  covered_items: string[];
  missed_items: string[];
  wrong_items: Array<{ said: string; correct: string }>;
  summary: string;
}

interface EvaluationResult {
  scores: {
    knowledgeCoverage: number;
    coreHitRate: number;
    dataAccuracy: number;
    scriptMatch: number;
    structureScore: number;
    fluencyScore: number;
  };
  overallScore: number;
  categoryAnalysis: CategoryAnalysis[];
  fluencyBreakdown: FluencyBreakdown;
  contentIssues: ContentIssue[];
  matchedKnowledge: Array<{
    knowledge_id: string;
    title: string;
    category: string;
    match_score: number;
    evidence: string;
  }>;
  matchedScripts: Array<{
    script_id: string;
    title: string;
    scene: string;
    match_score: number;
    evidence: string;
  }>;
  matchedSpecs: Array<{
    spec_id: string;
    spec_name: string;
    mentioned_value: string;
    expected_value: string;
    is_correct: boolean;
  }>;
  stageCoverage: {
    opening: { covered: boolean; score: number; evidence: string };
    needsProbe: { covered: boolean; score: number; evidence: string };
    productIntro: { covered: boolean; score: number; evidence: string };
    objection: { covered: boolean; score: number; evidence: string };
    closing: { covered: boolean; score: number; evidence: string };
  };
  weakPoints: Array<{
    id: string;
    name: string;
    score: number;
    maxScore: number;
    description: string;
    severity: 'high' | 'medium' | 'low';
  }>;
  conversationMetrics?: {
    responseAccuracy: number;
    objectionHandling: number;
    needsDiscovery: number;
    scriptCompliance: number;
    conversationControl: number;
  };
}

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface AgentConfig {
  category: string;
  knowledgeText: string;
  itemCount: number;
}

async function runCategoryAgent(transcriptForGpt: string, agent: AgentConfig): Promise<CategoryAnalysis> {
  if (agent.itemCount === 0) {
    return { category: agent.category, score: 50, covered_items: [], missed_items: [], wrong_items: [], summary: '该类别知识库为空，无法评估' };
  }

  const systemPrompt = `你是一位专业的销售能力评估专家，专注于检测「${agent.category}」方面。

## 知识库内容（共${agent.itemCount}条）
${agent.knowledgeText.substring(0, 3000)}

## 员工销售录音转录文本
${transcriptForGpt}

## 任务
1. 逐条检查知识库中的知识点，判断员工是否提及
2. 检查提到的数据是否准确
3. 识别遗漏和错误
4. 给出 0-100 分的评分

## 输出格式（严格JSON，不要markdown代码块）

{
  "category": "${agent.category}",
  "score": 65,
  "covered_items": ["已覆盖的知识点1", "已覆盖的知识点2"],
  "missed_items": ["遗漏的知识点1", "遗漏的知识点2"],
  "wrong_items": [{ "said": "员工说的内容", "correct": "正确的内容" }],
  "summary": "一句话总结评估结果"
}

注意：
- score 为 0-100 整数
- covered_items: 员工正确提到的知识点标题
- missed_items: 应该提到但未提到的知识点标题
- wrong_items: 员工说错的，必须给出 said 和 correct
- summary: 一句话总结
- 只返回 JSON`;

  try {
    const responseText = await callOpenAIChat(systemPrompt, `请检测「${agent.category}」方面的表现，按格式返回JSON。`);
    const cleaned = responseText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gi, '')
      .replace(/[\x00-\x1f]/g, c => c === '\n' || c === '\r' || c === '\t' ? c : '')
      .trim();
    return JSON.parse(cleaned) as CategoryAnalysis;
  } catch {
    return { category: agent.category, score: 0, covered_items: [], missed_items: [], wrong_items: [], summary: '评估失败' };
  }
}

export async function evaluatePractice(recordId: string, transcript: string, productLineName: string, fluencyBreakdown: FluencyBreakdown, segments: TranscriptSegment[] = [], audioType: string = 'monologue'): Promise<EvaluationResult> {
  // 1. Find product_line_id by name
  const plRows = await query(
    'SELECT product_line_id FROM product_lines WHERE name = ? AND status = ?',
    [productLineName, 'active']
  );
  const productLineId = plRows.length > 0 ? plRows[0].product_line_id : null;

  // 2. Fetch all knowledge for this product line
  const [spRows, scriptsRows, specsRows, scenariosRows, knowledgeRows] = await Promise.all([
    query(
      "SELECT point_id, title, description, keywords, priority, category FROM selling_points WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY priority DESC",
      [productLineId]
    ),
    query(
      "SELECT script_id, title, scene, content FROM sales_scripts WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY created_at DESC",
      [productLineId]
    ),
    query(
      "SELECT spec_id, spec_name, spec_value, unit, common_mistake FROM product_specs WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY created_at DESC",
      [productLineId]
    ),
    query(
      "SELECT scenario_id, title, scene_type, content, key_takeaway FROM sales_scenarios WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY created_at DESC",
      [productLineId]
    ),
    query(
      "SELECT knowledge_id, title, content, category FROM product_knowledge WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY updated_at DESC",
      [productLineId]
    ),
  ]);

  // 3. Build knowledge summary for prompt (limit size)
  const sellingPoints = spRows.map((r: { point_id: string; title: string; description: string; priority: number; category: string }) =>
    `ID:${r.point_id} [${r.priority}] ${r.title} (${r.category}): ${r.description?.substring(0, 100)}`
  ).join('\n');

  const scripts = scriptsRows.map((r: { script_id: string; title: string; scene: string; content: string }) =>
    `ID:${r.script_id} [${r.scene || '通用'}] ${r.title}: ${r.content?.substring(0, 150)}`
  ).join('\n');

  const specs = specsRows.map((r: { spec_id: string; spec_name: string; spec_value: string; unit: string }) =>
    `ID:${r.spec_id} ${r.spec_name}: ${r.spec_value}${r.unit ? ' ' + r.unit : ''}`
  ).join('\n');

  const scenarios = scenariosRows.map((r: { scenario_id: string; title: string; scene_type: string; content: string }) =>
    `ID:${r.scenario_id} [${r.scene_type || '通用'}] ${r.title}: ${r.content?.substring(0, 150)}`
  ).join('\n');

  const knowledge = knowledgeRows.map((r: { knowledge_id: string; title: string; category: string; content: string }) =>
    `ID:${r.knowledge_id} [${r.category || '通用'}] ${r.title}: ${r.content?.substring(0, 150)}`
  ).join('\n');

  // Build timestamped transcript for GPT
  const transcriptForGpt = segments.length > 0
    ? segments.map(seg => `[${formatTime(seg.start)}] ${seg.text}`).join('\n').substring(0, 6000)
    : transcript.substring(0, 6000);

  // === 6 Category Agents (parallel) ===
  const knowledgeByCategory = (category: string) =>
    knowledgeRows
      .filter((r: any) => r.category === category)
      .map((r: any) => `${r.title}: ${r.content?.substring(0, 150)}`)
      .join('\n');

  const agents: AgentConfig[] = [
    { category: '核心卖点', knowledgeText: sellingPoints, itemCount: spRows.length },
    { category: '规格参数', knowledgeText: specs, itemCount: specsRows.length },
    {
      category: '产品功能',
      knowledgeText: knowledgeByCategory('产品功能') + '\n' + knowledgeByCategory('技术原理'),
      itemCount: knowledgeRows.filter((r: any) => r.category === '产品功能' || r.category === '技术原理').length,
    },
    {
      category: '适用场景',
      knowledgeText: scenarios + '\n' + knowledgeByCategory('适用场景'),
      itemCount: scenariosRows.length + knowledgeRows.filter((r: any) => r.category === '适用场景').length,
    },
    {
      category: '竞品对比',
      knowledgeText: knowledgeByCategory('竞品对比'),
      itemCount: knowledgeRows.filter((r: any) => r.category === '竞品对比').length,
    },
    { category: '话术流程', knowledgeText: scripts, itemCount: scriptsRows.length },
  ];

  const categoryAnalysis = await Promise.all(
    agents.map(agent => runCategoryAgent(transcriptForGpt, agent))
  );

  // === Main evaluation (keep existing logic) ===
  const isConversation = audioType === 'conversation';
  const audioTypeDesc = isConversation
    ? '这是一段销售与客户的真实对话录音。请先从转录中区分「客户说的话」和「销售说的话」，然后重点评估销售在对话中的表现。'
    : '这是一段销售产品介绍独白。';

  const conversationInstructions = isConversation
    ? `
## 对话录音专用评估维度（0-100）

6. responseAccuracy：销售对客户问题的回答是否准确、是否符合知识库标准。客户提到的问题/异议，销售是否给出了正确回应。
7. objectionHandling：面对客户质疑或异议时，销售是否有效安抚情绪、给出解决方案。包括价格异议、竞品对比、功能质疑等。
8. needsDiscovery：销售是否主动挖掘客户需求（询问用水人数、预算、现有设备等），而不是一味自说自话。
9. scriptCompliance：在回应客户时是否自然运用了标准话术，而不是生硬背诵或完全不用。
10. conversationControl：销售是否能引导对话节奏，不被客户带偏，能适时拉回产品介绍和促单。

请在返回的JSON中增加 conversationMetrics 字段，包含以上5个维度得分。`
    : '';

  const systemPrompt = `你是一名顶级销售培训专家。${audioTypeDesc}请对以下销售人员的语音转录进行专业评价。

## 转录内容（带时间戳）
${transcriptForGpt}

## 该产品线的知识库（参考标准）

### 核心卖点/观点（共${spRows.length}条）
${sellingPoints.substring(0, 3000)}

### 销售话术（共${scriptsRows.length}条）
${scripts.substring(0, 2000)}

### 产品规格/方法论（共${specsRows.length}条）
${specs.substring(0, 2000)}

### 场景案例（共${scenariosRows.length}条）
${scenarios.substring(0, 2000)}

### 产品知识（共${knowledgeRows.length}条）
${knowledge.substring(0, 2000)}

## 评价要求

请从以下 5 个维度评分（0-100）：

1. knowledgeCoverage：销售提到的产品知识点占应知知识点的比例。如果知识库为空，给50分。
2. coreHitRate：命中高优先级卖点（priority >= 8）的比例。如果知识库为空，给50分。
3. dataAccuracy：提到的具体数字/规格与知识库一致的比例。注意：销售可能提到知识库以外的数字（如客户自己的数据），只要逻辑合理不算错。
4. scriptMatch：使用了推荐销售话术/方法论的比例。
5. structureScore：是否按销售流程推进（开场→探需→产品介绍→异议处理→促单/收尾）。
${conversationInstructions}

同时输出：
- matchedKnowledge：匹配到的知识点列表（含匹配度分数0-1）
- matchedScripts：匹配到的话术列表
- matchedSpecs：提到的规格及正确性（is_correct字段）
- contentIssues：内容错误明细表。逐条列出员工说错的内容，必须包含时间戳。对比知识库中的标准值，标明员工说了什么、正确应该是什么。如果转录带时间戳，timestamp填对应秒数；否则填0。
- weakPoints：薄弱点分析（最多3条，severity: high/medium/low）
- stageCoverage：各销售阶段覆盖情况
- overallScore：综合得分（5维平均分）

## 返回格式（严格JSON，不要markdown代码块）

{
  "scores": {
    "knowledgeCoverage": 72,
    "coreHitRate": 55,
    "dataAccuracy": 80,
    "scriptMatch": 68,
    "structureScore": 85
  },
  "overallScore": 72,
  "matchedKnowledge": [
    {
      "knowledge_id": "uuid",
      "title": "净热一体",
      "category": "核心卖点",
      "match_score": 0.92,
      "evidence": "转录中提到'插电就能用'"
    }
  ],
  "matchedScripts": [
    {
      "script_id": "uuid",
      "title": "价格异议四步法",
      "scene": "异议处理",
      "match_score": 0.85,
      "evidence": "使用了'总拥有成本'概念"
    }
  ],
  "matchedSpecs": [
    {
      "spec_id": "uuid",
      "spec_name": "额定功率",
      "mentioned_value": "2200W",
      "expected_value": "2200W",
      "is_correct": true
    }
  ],
  "contentIssues": [
    {
      "timestamp": 15,
      "timestamp_label": "00:15",
      "type": "spec_error",
      "type_label": "规格数据错误",
      "said": "额定功率是2200W",
      "correct": "额定功率是75W",
      "spec_name": "额定功率",
      "severity": "high"
    },
    {
      "timestamp": 32,
      "timestamp_label": "00:32",
      "type": "data_inaccurate",
      "type_label": "数据不准确",
      "said": "每天的制水量可以达到500升",
      "correct": "制水量为400加仑/天",
      "spec_name": "制水量",
      "severity": "medium"
    }
  ],
  "stageCoverage": {
    "opening": { "covered": true, "score": 85, "evidence": "主动问候并自我介绍" },
    "needsProbe": { "covered": true, "score": 70, "evidence": "询问了用水人数" },
    "productIntro": { "covered": true, "score": 90, "evidence": "介绍了3个核心卖点" },
    "objection": { "covered": false, "score": 0, "evidence": "" },
    "closing": { "covered": false, "score": 0, "evidence": "" }
  },
  "weakPoints": [
    {
      "id": "1",
      "name": "异议处理（价格对比场景）",
      "score": 58,
      "maxScore": 100,
      "description": "客户提出价格质疑时，未使用价格锚点话术。",
      "severity": "high"
    }
  ]${isConversation ? ',\n  "conversationMetrics": {\n    "responseAccuracy": 75,\n    "objectionHandling": 60,\n    "needsDiscovery": 45,\n    "scriptCompliance": 70,\n    "conversationControl": 55\n  }' : ''}
}

注意：
- 所有分数必须是 0-100 的整数
- knowledge_id/script_id/spec_id 必须与知识库中的 ID 一致（从提示中找）
- 如果没有匹配到，返回空数组 []
- contentIssues中，type可选值：spec_error(规格数据错误)、data_inaccurate(数据不准确)、methodology_error(方法论错误)、claim_unsupported(无依据声称)
- timestamp必须是从转录时间戳中提取的实际秒数，timestamp_label格式为"分:秒"
- 只返回 JSON，不要任何解释文字`;

  const responseText = await callOpenAIChat(systemPrompt, '请评价上述销售转录，按格式返回JSON。');

  const cleaned = responseText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/gi, '')
    .replace(/[\x00-\x1f]/g, c => c === '\n' || c === '\r' || c === '\t' ? c : '')
    .trim();

  const parsed = JSON.parse(cleaned) as Omit<EvaluationResult, 'scores'> & { scores: Omit<EvaluationResult['scores'], 'fluencyScore'> };

  return {
    scores: {
      ...parsed.scores,
      fluencyScore: fluencyBreakdown.score,
    },
    overallScore: parsed.overallScore,
    categoryAnalysis,
    fluencyBreakdown,
    contentIssues: parsed.contentIssues || [],
    matchedKnowledge: parsed.matchedKnowledge || [],
    matchedScripts: parsed.matchedScripts || [],
    matchedSpecs: parsed.matchedSpecs || [],
    stageCoverage: parsed.stageCoverage || {
      opening: { covered: false, score: 0, evidence: '' },
      needsProbe: { covered: false, score: 0, evidence: '' },
      productIntro: { covered: false, score: 0, evidence: '' },
      objection: { covered: false, score: 0, evidence: '' },
      closing: { covered: false, score: 0, evidence: '' },
    },
    weakPoints: parsed.weakPoints || [],
    conversationMetrics: isConversation ? (parsed.conversationMetrics || undefined) : undefined,
  };
}
