import { callOpenAIResponses, extractJson } from './openai';
import type { ScoreRoundInput, ScoringResult } from '../types/dialogue';

const SYSTEM_PROMPT_SCORING = `你是一位资深销售培训教练。你的任务是对销售人员在模拟对话中的应答进行客观评分和建设性反馈。

规则：
1. 评分维度：
   - 针对性（是否直接回应客户问题）
   - 话术运用（是否使用知识库中的标准话术/卖点）
   - 逻辑性（表达是否清晰、有条理）
   - 说服力（是否有证据、数字、案例支撑）
2. 总分 0-100，给出具体分数。
3. feedback 必须具体，引用销售回答中的内容，不能泛泛而谈。
4. 如果销售漏掉了关键卖点或话术，明确指出来。
5. 语气专业、鼓励为主，但要指出真实问题。

输出格式（严格 JSON）：
{
  "score": 82,
  "feedback": "应答整体方向正确，提到了总拥有成本，但缺少具体数字对比，未能完全打消客户顾虑。",
  "strengths": ["主动转移话题到长期价值", "语气自信"],
  "weaknesses": ["缺少竞品量化对比数据", "没有给出价格锚点"],
  "missedPoints": ["5年总成本低15%的第三方检测报告", "价格异议四步法第一步：认同感受"]
}`;

export async function scoreSalesReply(input: ScoreRoundInput): Promise<ScoringResult> {
  const text = await callOpenAIResponses(SYSTEM_PROMPT_SCORING, JSON.stringify(input));
  return extractJson<ScoringResult>(text);
}
