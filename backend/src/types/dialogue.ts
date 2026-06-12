export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  low_confidence: boolean;
}

export interface GenerateCustomerQuestionInput {
  round: number;
  weakPoints: string[];
  focusArea?: string;
  strategy?: Array<{ round: number; focus: string; difficulty: 'easy' | 'medium' | 'hard' }>;
  conversationHistory: Array<{ salesReply: string; customerQuestion: string }>;
  difficulty: 'easy' | 'medium' | 'hard';
  productLine: string;
  knowledgeContext?: string;
  isFollowUp?: boolean;
  previousRoundScore?: number;
  transcript?: string;
  productMaterialText?: string;
  currentFocus?: string;
  role?: string;
  status?: string;
}

export interface DialogueResult {
  customerQuestion: string;
  difficulty: 'easy' | 'medium' | 'hard';
  expectedFocus: string;
  expectedAnswer?: string;
}

export interface ScoreRoundInput {
  customerQuestion: string;
  salesReply: string;
  weakPoints: string[];
  knowledgeBaseHits?: string[];
  round: number;
  expectedAnswer?: string;
}

export interface ScoringResult {
  score: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  missedPoints: string[];
}

export interface DialogueRoundResponse {
  round_number: number;
  customer_question: string;
  expected_answer?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  expected_focus: string;
  focus_area?: string;
  is_follow_up?: boolean;
  sales_reply?: string;
  score?: number;
  feedback?: string;
  strengths?: string[];
  weaknesses?: string[];
  missed_points?: string[];
  difficulty_adjusted?: boolean;
  adjust_reason?: string;
  next_round?: {
    round_number: number;
    customer_question: string;
    expected_answer?: string;
    difficulty: 'easy' | 'medium' | 'hard';
    expected_focus: string;
  };
  is_last_round: boolean;
}
