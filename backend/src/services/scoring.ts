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

interface DialogueSnapshot {
  sales_reply: string;
  customer_question: string;
}

export function calculatePersuasionScore(
  dialogues: DialogueSnapshot[],
  knowledgeText: string,
): { persuasionScore: number; attitudeHint: string } {
  let persuasionScore = 0;
  let consecutiveNoProductMention = 0;

  for (const round of dialogues) {
    const reply = round.sales_reply || '';
    const cq = round.customer_question;
    if (!reply.trim()) continue;

    persuasionScore += 5;
    if (reply.length < 10) persuasionScore -= 5;
    if (/爱买不买|买不起|别问|不知道|不关我事|随便你|懒得|废话/.test(reply)) persuasionScore -= 20;
    if (/贵|便宜|价格|多少钱/.test(cq) && !/\d|元|块|钱|价格|成本|性价比|划算|值/.test(reply)) persuasionScore -= 10;
    if (/坏|质量|容易|耐用|维修|售后|质保/.test(cq) && !/质保|保修|技术|认证|稳定|三年|五年|网点|服务/.test(reply)) persuasionScore -= 10;
    if (/纳滤|NF/.test(knowledgeText) && /RO反渗透|反渗透.*过滤|RO膜/.test(reply) && !/纳滤/.test(reply)) persuasionScore -= 15;
    if (/3秒|三秒/.test(knowledgeText) && /5秒|五秒|10秒|十几秒|一分钟/.test(reply)) persuasionScore -= 15;
    if (/699/.test(knowledgeText) && /299|399|499|899|999/.test(reply)) persuasionScore -= 15;
    if (/\d/.test(reply)) persuasionScore += 5;

    const hasProductMention = /纳滤|RO|反渗透|过滤精度|3秒|即热|无储水|千滚水|废水比|通量|滤芯|TDS|质保|服务网点|400/.test(reply);
    if (hasProductMention) {
      persuasionScore += 8;
      consecutiveNoProductMention = 0;
    } else {
      consecutiveNoProductMention++;
    }
    if (consecutiveNoProductMention >= 2) {
      persuasionScore -= 5;
      consecutiveNoProductMention = 0;
    }
    if (/今天|明天|下单|安装|定.*一台|送|活动|优惠|试用|7天|30天|无理由|包换|退货|不满意/.test(reply)) persuasionScore += 10;
    if (/贵|便宜|价格|多少钱|成本/.test(cq) && /值|对比|划算|省|抵|送|一天|成本|性价比|算下来/.test(reply)) persuasionScore += 10;
    if (/坏|质量|容易|耐用|维修|售后/.test(cq) && /质保|保修|技术|认证|稳定|大厂|客户|网点/.test(reply)) persuasionScore += 10;
    if (/竞品|别家|美的|网上|两千|牌子|品牌/.test(cq) && /对比|区别|差异|不如|比不上|更|优势/.test(reply)) persuasionScore += 10;
    if (/考虑|比比|看看|再说|商量|想想/.test(cq) && /今天|活动|明天|限量|抓紧|过期|恢复原价/.test(reply)) persuasionScore += 12;
  }

  const lastReply = dialogues[dialogues.length - 1]?.sales_reply || '';
  if (/定一台|买一台|今天定|明天装|开票|下单|签合同|付款/.test(lastReply)) persuasionScore += 15;
  persuasionScore = Math.max(0, Math.min(persuasionScore, 100));

  let attitudeHint = '';
  if (persuasionScore >= 70) {
    attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你已经被打动了，态度明显软化，基本决定购买。如果销售再给一个台阶（如促成下单、强调活动期限），你顺势说出"那就定一台"或"帮我安排安装"即可。`;
  } else if (persuasionScore >= 45) {
    attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你态度有所松动，但仍有些犹豫。可以稍微软化质疑力度，但不要轻易同意购买。`;
  } else {
    attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你仍然很怀疑，继续刁难，保持质疑。`;
  }

  return { persuasionScore, attitudeHint };
}
