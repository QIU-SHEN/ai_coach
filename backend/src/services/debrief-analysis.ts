import { pool, parseJsonRows } from '../db';
import { callOpenAIChat } from './openai-chat';
import { logger } from './logger';
import { buildPersonalizedTrainingPlanPrompt } from './prompts';

export function parseJsonField(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}

const POST_MEETING_PROMPT = `你是一位资深销售培训专家。请根据以下销售人员的见客描述，分析谈单全流程。

见客描述：
"""
{{content}}
"""

请从以下 5 个阶段进行评估：
1. 开场破冰
2. 需求挖掘
3. 产品介绍
4. 异议处理
5. 成交推进

输出严格 JSON，不要包含 markdown 代码块标记：
{
  "stageAssessment": [
    { "stage": "开场破冰", "score": 0-100, "comment": "简要评价", "strength": "亮点", "weakness": "不足" }
  ],
  "overallScore": 0-100,
  "keyIssues": [
    { "id": "1", "stage": "阶段名", "severity": "high|medium|low", "description": "问题描述", "suggestion": "改进建议" }
  ],
  "personalStyle": {
    "label": "风格标签（如亲和型/专业型/进攻型/温和型）",
    "traits": ["特征1", "特征2"],
    "leverage": "如何发挥风格优势",
    "improvement": "需要补强的地方"
  },
  "trainingPlan": {
    "recommendations": [
      { "topic": "推荐学习主题", "reason": "推荐理由" }
    ]
  }
}`;

const CALL_RECORDING_PROMPT = `你是一位资深销售培训专家。以下是一段真实见客录音的转录文本，内容是销售与客户的对话。

【重要规则】
1. 转录文本中销售与客户的对话是混在一起的，**没有 [销售]/[客户] 标签**。你需要根据语义自行推断：主动介绍产品、推进流程、解释说明的一方是销售；提问、犹豫、表达顾虑的一方是客户。
2. **评判只针对销售的发言**。客户说的话（包括客户的提问、质疑、犹豫、砍价）仅作为上下文参考，**绝对不要因为客户说了什么就降低对销售的评分**。
3. 例如：客户问"这个数据是什么意思"或"我不太懂"，这是客户的正常反应，不是销售的错误，不要因此判定"销售知识储备不足"。应该评判的是销售**如何回应**客户的这个问题。

转录文本：
"""
{{content}}
"""

请分析：
1. 销售的话术节奏、倾听比例、提问质量
2. 客户的反应变化、异议表达、成交信号
3. 双方互动的关键转折点
4. 如果重新来过，销售在哪些时刻可以做得更好

输出严格 JSON，不要包含 markdown 代码块标记：
{
  "stageAssessment": [
    { "stage": "开场破冰", "score": 0-100, "comment": "简要评价", "strength": "亮点", "weakness": "不足" }
  ],
  "overallScore": 0-100,
  "keyIssues": [
    { "id": "1", "stage": "阶段名", "severity": "high|medium|low", "description": "问题描述", "suggestion": "改进建议" }
  ],
  "personalStyle": {
    "label": "风格标签（如亲和型/专业型/进攻型/温和型）",
    "traits": ["特征1", "特征2"],
    "leverage": "如何发挥风格优势",
    "improvement": "需要补强的地方"
  },
  "trainingPlan": {
    "recommendations": [
      { "topic": "推荐学习主题", "reason": "推荐理由" }
    ]
  },
  "interactionAnalysis": {
    "salesTalkRatio": "销售说话占比（如 65%）",
    "customerSentiment": "客户情绪变化（由消极→中性→积极 等）",
    "turningPoints": ["关键转折点1", "关键转折点2"],
    "missedOpportunities": ["错过的成交信号1", "错过的成交信号2"]
  }
}`;

const SUMMARY_PROMPT = `你是一位资深销售培训专家。以下是某位销售人员最近 {{count}} 次见客复盘分析：

{{analyses}}

请输出汇总分析 JSON，不要包含 markdown 代码块标记：
{
  "trend": [
    { "stage": "阶段名", "avgScore": 平均分, "trend": "up|down|stable" }
  ],
  "topIssues": [
    { "stage": "阶段名", "count": 出现次数, "description": "问题描述" }
  ],
  "styleEvolution": "风格演变描述",
  "overallRecommendation": "综合培训建议"
}`;

export async function analyzePostMeeting(content: string) {
  const prompt = POST_MEETING_PROMPT.replace('{{content}}', content);
  const response = await callOpenAIChat(prompt, '请严格按照 JSON 格式输出分析结果。');
  const jsonText = response.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  return JSON.parse(jsonText);
}

export async function analyzeCallRecording(content: string) {
  const prompt = CALL_RECORDING_PROMPT.replace('{{content}}', content);
  const response = await callOpenAIChat(prompt, '请严格按照 JSON 格式输出分析结果。');
  const jsonText = response.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  return JSON.parse(jsonText);
}

export async function analyzeDebriefContent(content: string, mode: 'post_meeting' | 'call_recording' = 'post_meeting') {
  if (mode === 'call_recording') {
    return analyzeCallRecording(content);
  }
  return analyzePostMeeting(content);
}

export async function summarizeDebriefAnalyses(analyses: any[]) {
  if (analyses.length === 0) {
    return {
      trend: [],
      topIssues: [],
      styleEvolution: '',
      overallRecommendation: '',
    };
  }

  const analysesText = analyses.map((a, i) => {
    const score = a.overallScore ?? a.overall_score ?? 0;
    const stages = (a.stageAssessment ?? a.stage_assessment ?? []).map((s: any) => `${s.stage}:${s.score}`).join(', ');
    const issues = (a.keyIssues ?? a.key_issues ?? []).map((k: any) => k.description).join('; ');
    return `第${i + 1}次复盘：总分${score}。各阶段得分：${stages}。主要问题：${issues}。`;
  }).join('\n');

  const prompt = SUMMARY_PROMPT
    .replace('{{count}}', String(analyses.length))
    .replace('{{analyses}}', analysesText);

  const response = await callOpenAIChat(prompt, '请严格按照 JSON 格式输出汇总分析。');
  const jsonText = response.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  return JSON.parse(jsonText);
}

export async function runBackgroundAnalysis(recordId: string) {
  const recordRows = await query(
    `SELECT dr.record_id, dr.transcript, m.product_line, m.fluency_score, m.duration, m.transcript_segments, m.audio_type
     FROM debrief_records dr
     LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
     WHERE dr.record_id = ?`,
    [recordId]
  );
  const record = recordRows[0];
  if (!record || !record.transcript) return;

  const roundRows = await query(
    `SELECT round_number, customer_question, sales_reply, difficulty, expected_focus, score, feedback, strengths, weaknesses, missed_points
     FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC`,
    [recordId]
  );

  const { scoreSalesReply } = await import('./scoring');
  const { calculateFluencyScore } = await import('./fluency-score');
  const { evaluatePractice } = await import('./evaluation');

  for (const round of roundRows) {
    if (round.score != null || !round.sales_reply) continue;
    try {
      const scoringResult = await scoreSalesReply({
        customerQuestion: round.customer_question,
        salesReply: round.sales_reply,
        weakPoints: [],
        round: round.round_number,
      });
      await pool.execute(
        'UPDATE dialogue_rounds SET score = ?, feedback = ?, strengths = ?, weaknesses = ?, missed_points = ? WHERE record_id = ? AND round_number = ?',
        [scoringResult.score, scoringResult.feedback, JSON.stringify(scoringResult.strengths), JSON.stringify(scoringResult.weaknesses), JSON.stringify(scoringResult.missedPoints), recordId, round.round_number]
      );
      round.score = scoringResult.score;
      round.feedback = scoringResult.feedback;
      round.strengths = scoringResult.strengths;
      round.weaknesses = scoringResult.weaknesses;
      round.missed_points = scoringResult.missedPoints;
    } catch (err) {
      logger.error(`Failed to score round ${round.round_number}:`, err);
    }
  }

  const segments = parseJsonField(record.transcript_segments) as any[] || [];
  const fluencyBreakdown = calculateFluencyScore(record.transcript, segments, record.duration || 0);
  const evaluation = await evaluatePractice(recordId, record.transcript, record.product_line, fluencyBreakdown, segments, record.audio_type);

  const dialogue_history = roundRows.map((r: any) => ({
    round_number: r.round_number,
    customer_question: r.customer_question,
    sales_reply: r.sales_reply,
    difficulty: r.difficulty,
    score: r.score,
    feedback: r.feedback,
    strengths: parseJsonField(r.strengths) ?? [],
    weaknesses: parseJsonField(r.weaknesses) ?? [],
    missed_points: parseJsonField(r.missed_points) ?? [],
  }));

  const weakPoints: string[] = [];
  for (const round of roundRows) {
    const ws = parseJsonField(round.weaknesses) as string[];
    const ms = parseJsonField(round.missed_points) as string[];
    if (ws) weakPoints.push(...ws);
    if (ms) weakPoints.push(...ms);
  }
  const uniqueWeakPoints = [...new Set(weakPoints)];
  const weakPointsDesc = uniqueWeakPoints.length > 0 ? uniqueWeakPoints.join('、') : '暂无明确薄弱点，请生成通用销售提升计划';

  const roundsSummary = roundRows.map((r: any) => ({ round: r.round_number, score: r.score as number | null }));
  const trainingPlanPrompt = buildPersonalizedTrainingPlanPrompt({
    productLine: record.product_line || '',
    weakPointsDesc,
    roundsSummaryLength: roundRows.length,
    roundsSummary,
    summaryText: '',
  });

  let trainingPlan = null;
  try {
    const planText = await callOpenAIChat(trainingPlanPrompt, '请生成培训计划');
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (jsonMatch) trainingPlan = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.error('Training plan generation failed:', err);
  }

  if (trainingPlan) {
    try {
      const materialRows = await query(
        `SELECT material_id, title, type, duration, file_url, description
         FROM training_materials WHERE status = 'active' ORDER BY created_at DESC LIMIT 10`
      );
      trainingPlan.recommended_materials = materialRows.map((m: any) => ({
        material_id: m.material_id,
        title: m.title,
        type: m.type,
        duration: m.duration || '',
        file_url: m.file_url || '',
        description: m.description || '',
      }));
    } catch (err) {
      logger.error('Query training materials failed:', err);
      trainingPlan.recommended_materials = [];
    }
  }

  const evalOverallScore = evaluation.overallScore ?? null;
  const fullEvaluation = { ...evaluation, dialogue_history };

  await pool.execute(
    `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, evaluation_result, overall_score)
     VALUES (?, 0, 'intro', ?, ?)
     ON DUPLICATE KEY UPDATE evaluation_result = VALUES(evaluation_result), overall_score = VALUES(overall_score)`,
    [recordId, JSON.stringify(fullEvaluation), evalOverallScore]
  );
  await pool.execute(
    `UPDATE debrief_records SET training_plan = ?, status = ? WHERE record_id = ?`,
    [trainingPlan ? JSON.stringify(trainingPlan) : null, 'completed', recordId]
  );

  const { sendReportNotification } = await import('./notify');
  sendReportNotification(recordId).catch(err => {
    logger.error('Notification failed:', err);
  });
}
