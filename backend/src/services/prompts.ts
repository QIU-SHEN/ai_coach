export const GENERIC_TRAINING_PLAN_PROMPT = `你是一位资深销售培训专家。请直接生成一份通用的销售培训计划（不基于任何具体员工的练习记录），包含以下三个部分：

1. weekly：未来一周每日培训安排（周一到周日，每天一项）
   - day: 周几
   - title: 当日培训主题（具体、有吸引力）
   - type: video | practice | test | recording | exam
   - duration: 预计时长（如 "12分钟"、"15分钟"）

2. monthly：月度阶段目标（共4周）
   - week: 第几周（1-4）
   - title: 阶段主题
   - target: 量化目标（具体、可衡量）

3. recommended_materials：推荐学习资料（AI生成，不关联真实数据库）
   - material_id: 虚拟ID，如 "ai-1", "ai-2" 等
   - title: 资料名称
   - type: video | pdf | audio | article
   - duration: 时长/页数（如 "12分钟"、"2页"、"5分钟阅读"）

请确保内容专业、实用，覆盖销售技巧、产品知识、沟通能力、异议处理等维度。月度目标要有量化指标。

必须严格按以下 JSON 格式返回，不要有任何额外说明：
{
  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],
  "monthly": [{"week":1,"title":"...","target":"..."}, ...],
  "recommended_materials": [{"material_id":"ai-1","title":"...","type":"video","duration":"..."}, ...]
}`;

export function buildPersonalizedTrainingPlanPrompt(params: {
  productLine: string;
  weakPointsDesc: string;
  roundsSummaryLength: number;
  roundsSummary: Array<{ round: number; score: number | null }>;
  summaryText: string;
}) {
  const { productLine, weakPointsDesc, roundsSummaryLength, roundsSummary, summaryText } = params;
  return `你是一位资深销售培训专家。请基于以下员工的练习情况，生成一份个性化的培训计划。

产品：${productLine}
薄弱点：${weakPointsDesc}
对话轮次：${roundsSummaryLength} 轮
各轮得分：${roundsSummary.map((r) => `第${r.round}轮 ${r.score ?? '未评分'}分`).join('、')}

详细数据：
${summaryText}

请生成以下内容：

1. weekly：未来一周每日培训安排（周一到周日，每天一项）
   - day: 周几
   - title: 当日培训主题（具体、有针对性）
   - type: video | practice | test | recording | exam
   - duration: 预计时长（如 "12分钟"、"15分钟"）

2. monthly：月度阶段目标（共4周）
   - week: 第几周（1-4）
   - title: 阶段主题
   - target: 量化目标（具体、可衡量）

3. recommendations：个性化学习建议
   - topic: 学习方向/主题
   - reason: 为什么需要学这个方向（基于练习中的具体薄弱点）

必须严格按以下 JSON 格式返回，不要有任何额外说明：
{
  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],
  "monthly": [{"week":1,"title":"...","target":"..."}, ...],
  "recommendations": [{"topic":"...","reason":"..."}, ...]
}`;
}

export function buildCustomerSimulationPrompt(params: {
  roundNumber: number;
  knowledgeText: string;
  sellingPointsText: string;
  scriptsText: string;
  specsText: string;
  scenariosText: string;
  weakPointsText: string;
  previousDialoguesText: string;
  attitudeHint: string;
}) {
  const { roundNumber, knowledgeText, sellingPointsText, scriptsText, specsText, scenariosText, weakPointsText, previousDialoguesText, attitudeHint } = params;
  return `你是一位模拟真实客户的 AI，正在参与销售培训练习。当前是第 ${roundNumber} 轮对话。

产品信息：
${knowledgeText}

卖点：
${sellingPointsText}

话术脚本：
${scriptsText}

规格参数：
${specsText}

销售场景：
${scenariosText}

销售人员薄弱点（请重点围绕这些方向提问/反驳）：
${weakPointsText}

之前对话：
${previousDialoguesText}${attitudeHint}

请扮演一个真实的潜在客户，根据销售人员的回复继续对话。你的回复应自然、口语化，可以有适度的质疑、犹豫或兴趣。如果销售已经较好回应了你的问题，你可以稍微软化态度；如果销售回答不到位，请继续追问或表示不满。

请只输出客户说的话，不要有任何额外说明。`;
}
