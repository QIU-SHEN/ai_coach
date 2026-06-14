import { callOpenAIResponses, extractJson } from './openai';
import type { DialogueResult, GenerateCustomerQuestionInput } from '../types/dialogue';

// 保留旧接口兼容
export { generateCustomerQuestion };

// 新 Simulation 接口
export interface SimulationInput {
  // 新参数
  role?: string;
  status?: string;
  productMaterialText?: string;
  conversationHistory: Array<{ salesReply: string; customerQuestion: string }>;
  difficulty: 'easy' | 'medium' | 'hard';

  // 兼容旧调用（可选）
  round?: number;
  weakPoints?: string[];
  focusArea?: string;
  strategy?: Array<{ round: number; focus: string; difficulty: 'easy' | 'medium' | 'hard' }>;
  productLine?: string;
  knowledgeContext?: string;
  isFollowUp?: boolean;
  previousRoundScore?: number;
  transcript?: string;
  currentFocus?: string;

  // 客户画像
  customerKnowledge?: string;
  customerType?: string;
}

export interface SimulationResult {
  customerQuestion: string;
  isConvinced: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
  expectedFocus: string;
}

const SYSTEM_PROMPT = `你是一位挑剔、难缠的真实客户，正在考察净水器销售人员。

【客户画像】
{CUSTOMER_PROFILE}

【当前角色与心态】
{ROLE}
{STATUS}

【产品背景信息】
{PRODUCT_MATERIAL}

【对话历史】
{HISTORY}

【重要规则】
1. 每轮只说 1 个问题或 1 句回应，不要一次抛多个问题
2. 说话要像真实客户：口语化、有犹豫、有反问、带情绪
3. 字数控制在 30-80 字以内
4. 根据销售人员的回答质量调整你的态度：
   * 回答得好（用了具体数据、解决了你的顾虑）→ 态度软化，但仍保持一点犹豫
   * 回答得差（答非所问、数据错误、回避问题）→ 更刁难，继续追问
   * 完全没回答你的问题 → 直接表示不满，重复或换一个角度问
5. 只有当销售明确促成成交（如说"今天定下来"、"签合同"、"付款"等），你才考虑成交
6. 成交时必须明确说出购买意愿（如"那就定一台"、"帮我安排安装"），设置 is_convinced = true
7. 严禁因为对话时间长而轻易同意购买
8. 你永远不会扮演销售或教练，你只扮演客户

【难度设定】
{DIFFICULTY}

输出严格按以下 JSON 格式，不要有任何额外说明：
{
  "customerQuestion": "你的提问或回应",
  "difficulty": "medium",
  "expectedFocus": "期望销售关注的方向",
  "is_convinced": false
}`;

async function generateCustomerQuestion(
  input: SimulationInput
): Promise<DialogueResult & { isConvinced?: boolean }> {
  // 客户画像
  let customerProfile = '';
  if (input.customerKnowledge || input.customerType) {
    const knowledgeDesc: Record<string, string> = {
      known: '你对净水器有较深的了解，知道滤芯、TDS值、RO反渗透等专业术语，不容易被忽悠。',
      unknown: '你对净水器完全不了解，需要销售从基础概念讲起，容易被专业术语绕晕。',
      partial: '你听说过净水器，但不太了解技术细节，处于一知半解的状态。',
    };
    const typeDesc: Record<string, string> = {
      new: '你是第一次了解这个品牌，没有任何历史购买记录，没有任何信任基础。',
      existing: '你已经用过这个品牌的其他产品，对其有一定信任度，但还在犹豫是否升级。',
      returning: '你之前咨询过但没买，现在重新考虑，对之前的价格或服务有些顾虑。',
    };
    const parts: string[] = [];
    if (input.customerKnowledge) {
      parts.push(knowledgeDesc[input.customerKnowledge] || '');
    }
    if (input.customerType) {
      parts.push(typeDesc[input.customerType] || '');
    }
    customerProfile = parts.join('\n');
  }

  // 角色设定
  let rolePrompt = '你是普通消费者，没有特殊身份设定。';
  if (input.role) {
    const roleNames: Record<string, string> = {
      decision_maker: '你是决策者（高层，关注 ROI 和战略价值）',
      user: '你是使用者（一线员工，关注易用性和效率）',
      technical: '你是技术顾问（IT/技术负责人，关注技术细节）',
      procurement: '你是采购（采购部门，关注价格和合同条款）',
      admin: '你是行政（关注流程合规）',
    };
    rolePrompt = `${roleNames[input.role] || '你是' + input.role}`;
  }

  // 采购心态
  let statusPrompt = '';
  if (input.status) {
    const statusNames: Record<string, string> = {
      observing: '观望（犹豫不决，需要更多说服）',
      comparing: '对比（正在对比多家供应商）',
      urgent: '急迫（有明确需求，希望快速推进）',
    };
    statusPrompt = `当前采购心态：${statusNames[input.status] || input.status}`;
  }

  // 对话历史
  let historyPrompt = '';
  if (input.conversationHistory && input.conversationHistory.length > 0) {
    const lines: string[] = [];
    for (const r of input.conversationHistory) {
      if (r.customerQuestion) {
        lines.push(`客户：${r.customerQuestion}`);
      }
      if (r.salesReply) {
        lines.push(`销售：${r.salesReply}`);
      }
    }
    historyPrompt = lines.join('\n');
  } else {
    historyPrompt = '（这是对话的开始）';
  }

  // 难度提示
  const difficultyPrompts: Record<string, string> = {
    easy: '难度：简单。你比较容易沟通，问题相对基础，不会刻意刁难。',
    medium: '难度：中等。你会提出一些有挑战性的问题，但态度还算客气。',
    hard: '难度：困难。你非常挑剔、难缠，经常打断、反问、质疑，态度强硬。',
  };
  const difficultyPrompt = difficultyPrompts[input.difficulty] || difficultyPrompts.medium;

  // 产品资料
  const productMaterialText = input.productMaterialText || input.knowledgeContext || '暂无产品资料';

  const finalPrompt = SYSTEM_PROMPT
    .replace('{CUSTOMER_PROFILE}', customerProfile)
    .replace('{ROLE}', rolePrompt)
    .replace('{STATUS}', statusPrompt)
    .replace('{PRODUCT_MATERIAL}', productMaterialText)
    .replace('{HISTORY}', historyPrompt)
    .replace('{DIFFICULTY}', difficultyPrompt);

  const text = await callOpenAIResponses(finalPrompt, '请生成客户回应');

  let result: {
    customerQuestion: string;
    difficulty: 'easy' | 'medium' | 'hard';
    expectedFocus: string;
    is_convinced?: boolean;
  };

  try {
    result = extractJson<typeof result>(text);
  } catch (parseErr) {
    console.error('[Dialogue] JSON parse failed, raw text:', text, 'error:', parseErr);
    // Fallback: return a default question to keep conversation going
    const fallbackQuestions = [
      '你刚才说的我不太满意，能再详细说说吗？',
      '这个产品的价格有点高，有没有优惠？',
      '我再考虑一下，你给我点时间。',
      '你说的这个和其他品牌有什么不同？',
      '我要和家人商量一下，晚点给你答复。',
    ];
    const randomQ = fallbackQuestions[Math.floor(Math.random() * fallbackQuestions.length)];
    result = {
      customerQuestion: randomQ,
      difficulty: input.difficulty,
      expectedFocus: '继续沟通',
      is_convinced: false,
    };
  }

  return {
    customerQuestion: result.customerQuestion,
    difficulty: result.difficulty,
    expectedFocus: result.expectedFocus,
    isConvinced: result.is_convinced ?? false,
  };
}

// 评估报告生成
export interface EvaluationInput {
  conversationHistory: Array<{ customerQuestion: string; salesReply: string }>;
}

export interface EvaluationResult {
  score: number;
  dimensionScores: {
    opening: number;
    needsProbing: number;
    productIntro: number;
    objectionHandling: number;
    closing: number;
  };
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

const EVALUATION_PROMPT = `你是一位资深销售培训师。请基于以下对话记录，对销售人员的表现进行评估。

对话记录：
{CONVERSATION}

请从以下5个维度评分（0-100），并给出总体评价：
1. 开场破冰 — 是否能自然引入话题，建立初步信任
2. 需求挖掘 — 是否通过提问了解客户真实需求
3. 产品介绍 — 是否准确、有针对性地介绍产品
4. 异议处理 — 能否妥善处理客户疑虑
5. 成交推动 — 是否能适时促成交易

输出严格按以下 JSON 格式，不要有任何额外说明：
{
  "score": 78,
  "dimensionScores": {
    "opening": 80,
    "needsProbing": 75,
    "productIntro": 82,
    "objectionHandling": 76,
    "closing": 79
  },
  "feedback": "总体评价...",
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "suggestions": ["建议1", "建议2"]
}`;

export async function evaluateSimulation(
  input: EvaluationInput
): Promise<EvaluationResult> {
  const conversationText = input.conversationHistory
    .map((r, i) => `第${i + 1}轮：\n客户：${r.customerQuestion}\n销售：${r.salesReply || '（未回答）'}`)
    .join('\n\n');

  const prompt = EVALUATION_PROMPT.replace('{CONVERSATION}', conversationText);

  const text = await callOpenAIResponses(prompt, '请评估销售表现');

  const result = extractJson<{
    score: number;
    dimensionScores: EvaluationResult['dimensionScores'];
    feedback: string;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  }>(text);

  return {
    score: result.score ?? 0,
    dimensionScores: result.dimensionScores ?? {
      opening: 0,
      needsProbing: 0,
      productIntro: 0,
      objectionHandling: 0,
      closing: 0,
    },
    feedback: result.feedback ?? '暂无评价',
    strengths: result.strengths ?? [],
    weaknesses: result.weaknesses ?? [],
    suggestions: result.suggestions ?? [],
  };
}
