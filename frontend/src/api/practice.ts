import { authHeaders } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export interface UploadResult {
  code: number;
  message: string;
  data: {
    record_id: string;
    status: string;
    audio_url: string;
    estimated_seconds: number;
  };
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  low_confidence: boolean;
}

export interface StatusResult {
  code: number;
  data: {
    record_id: string;
    status: 'processing' | 'completed' | 'failed';
    progress?: number;
    step?: string;
    duration?: number;
    transcript?: string;
    transcript_segments?: Segment[];
    error_code?: string;
    error_message?: string;
  };
}

export function uploadAudio(
  file: File,
  userId: string,
  productLine: string,
  practiceType: string = 'intro',
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('user_id', userId);
    formData.append('product_line', productLine);
    formData.append('practice_type', practiceType);

    xhr.open('POST', `${API_BASE}/api/v1/practices/upload`);

    const headers = authHeaders();
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.floor((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && json.code === 0) {
          resolve(json as UploadResult);
        } else {
          reject(new Error(json.message || `HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error('Invalid JSON response'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Request timeout'));

    xhr.send(formData);
  });
}

export async function getPracticeStatus(recordId: string): Promise<StatusResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/status`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as StatusResult;
}

export async function startAsr(recordId: string): Promise<StatusResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/start-asr`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as StatusResult;
}

export async function retryAsr(recordId: string): Promise<{ code: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/retry-asr`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as { code: number; message: string };
}

export interface PracticeRecordItem {
  record_id: string;
  product_line: string;
  practice_type: string;
  status: 'pending' | 'processing' | 'analyzing' | 'completed' | 'failed';
  duration: number;
  created_at: string;
  updated_at: string;
  audio_url?: string;
  transcript?: string;
  overall_score?: number;
}

export interface PracticeListResult {
  code: number;
  data: {
    list: PracticeRecordItem[];
    total: number;
  };
}

export async function getPracticeList(userId: string): Promise<PracticeListResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices?user_id=${encodeURIComponent(userId)}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PracticeListResult;
}

export interface DialogueRound {
  round_number: number;
  customer_question: string;
  sales_reply?: string;
  difficulty: string;
  expected_focus: string;
  score?: number;
  feedback?: string;
  strengths?: string[];
  weaknesses?: string[];
  missed_points?: string[];
  next_round?: {
    round_number: number;
    customer_question: string;
    difficulty: string;
    expected_focus: string;
  };
  is_last_round: boolean;
  difficulty_adjusted?: boolean;
  adjust_reason?: string;
}

export interface DialogueResult {
  code: number;
  message?: string;
  data: DialogueRound;
}

export async function startDialogueRound(
  recordId: string,
  roundNumber: number
): Promise<DialogueResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ round_number: roundNumber }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as DialogueResult;
}

export interface ReplyResult {
  code: number;
  message?: string;
  data: {
    round_number: number;
    score: number;
    feedback: string;
    strengths?: string[];
    weaknesses?: string[];
    missed_points?: string[];
  };
}

export async function submitReply(
  recordId: string,
  roundNumber: number,
  reply: string,
  reactionMs?: number
): Promise<ReplyResult> {
  const body: Record<string, unknown> = { round_number: roundNumber, reply };
  if (reactionMs !== undefined) body.reaction_ms = reactionMs;
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as ReplyResult;
}

export async function saveDialogueReply(
  recordId: string,
  roundNumber: number,
  reply: string
): Promise<{ code: number }> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/save-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ round_number: roundNumber, reply }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number };
}

export async function finishDialogue(recordId: string): Promise<{ code: number }> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/finish-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number };
}

// --- Dialogue Training (lightweight, no DB storage) ---

export interface DialogueTrainingRound {
  customer_question: string;
  sales_reply?: string;
}

export interface DialogueTrainingResult {
  code: number;
  data: {
    customer_question: string;
    is_convinced: boolean;
  };
}

export async function dialogueTraining(
  recordId: string,
  roundNumber: number,
  previousDialogues: DialogueTrainingRound[],
): Promise<DialogueTrainingResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/dialogue-training`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ round_number: roundNumber, previous_dialogues: previousDialogues }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DialogueTrainingResult;
}

// --- Voice Reply ---

export interface VoiceReplyResult {
  code: number;
  data: {
    round_number: number;
    transcript: string;
    tone_feedback: string;
    saved: boolean;
  };
}

export function voiceReply(
  recordId: string,
  audioBlob: Blob,
  roundNumber: number,
): Promise<VoiceReplyResult> {
  const formData = new FormData();
  formData.append('audio', audioBlob, `reply_r${roundNumber}.webm`);
  formData.append('round_number', String(roundNumber));

  return fetch(`${API_BASE}/api/v1/practices/${recordId}/voice-reply`, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: formData,
  }).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as VoiceReplyResult;
  });
}

// --- Dialogue History ---

export interface DialogueHistoryRound {
  round_number: number;
  customer_question: string;
  sales_reply?: string;
  difficulty: string;
  expected_focus: string;
  score?: number;
  feedback?: string;
  strengths?: string[];
  weaknesses?: string[];
  missed_points?: string[];
}

export interface DialogueHistoryResult {
  code: number;
  data: {
    record_id: string;
    status: string;
    rounds: DialogueHistoryRound[];
  };
}

export async function getDialogueHistory(recordId: string): Promise<DialogueHistoryResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/dialogue`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as DialogueHistoryResult;
}

// --- Evaluation ---

export interface MatchedKnowledge {
  knowledge_id: string;
  title: string;
  category: string;
  match_score: number;
  evidence: string;
}

export interface MatchedScript {
  script_id: string;
  title: string;
  scene: string;
  match_score: number;
  evidence: string;
}

export interface MatchedSpec {
  spec_id: string;
  spec_name: string;
  mentioned_value: string;
  expected_value: string;
  is_correct: boolean;
}

export interface StageCoverage {
  covered: boolean;
  score: number;
  evidence: string;
}

export interface EvaluationScores {
  knowledgeCoverage: number;
  coreHitRate: number;
  dataAccuracy: number;
  scriptMatch: number;
  structureScore: number;
  fluencyScore: number;
}

export interface EvaluationWeakPoint {
  id: string;
  name: string;
  score: number;
  maxScore: number;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ContentIssue {
  timestamp: number;
  timestamp_label: string;
  type: 'spec_error' | 'data_inaccurate' | 'methodology_error' | 'claim_unsupported';
  type_label: string;
  said: string;
  correct: string;
  spec_name: string;
  severity: 'high' | 'medium' | 'low';
}

export interface CategoryAnalysisItem {
  said: string;
  correct: string;
}

export interface CategoryAnalysis {
  category: string;
  score: number;
  covered_items: string[];
  missed_items: string[];
  wrong_items: CategoryAnalysisItem[];
  summary: string;
}

export interface FluencyPenalty {
  type: string;
  label: string;
  detail: string;
  points: number;
}

export interface FluencyBreakdown {
  score: number;
  baseScore: number;
  penalties: FluencyPenalty[];
}

export interface PreAnalysisWeakPoint {
  name: string;
  severity: 'high' | 'medium' | 'low';
  score: number;
  missed_items: string[];
}

export interface PreAnalysisStrategy {
  focus_areas: string[];
  suggested_rounds: { round: number; focus: string; difficulty: string }[];
}

export interface PreAnalysisResult {
  code: number;
  data: {
    weak_points: PreAnalysisWeakPoint[];
    initial_scores: EvaluationScores;
    overall_score: number;
    strategy: PreAnalysisStrategy;
  };
}

export interface ConversationMetrics {
  total_rounds: number;
  avg_reaction_ms: number;
  hit_count: number;
  miss_count: number;
  difficulty_progression: string[];
  topic_switches: number;
}

export interface ScoreChange {
  before: number;
  after: number;
  change: number;
}

// DialogueHistoryRound 已在上面定义，此处复用同名接口会导致 TS 合并冲突。
// 如需不同形状请改名；当前直接删除重复声明。

export interface EvaluationResult {
  record_id: string;
  transcript_summary?: string;
  scores: EvaluationScores;
  overallScore: number;
  matchedKnowledge: MatchedKnowledge[];
  matchedScripts: MatchedScript[];
  matchedSpecs: MatchedSpec[];
  stageCoverage: {
    opening: StageCoverage;
    needsProbe: StageCoverage;
    productIntro: StageCoverage;
    objection: StageCoverage;
    closing: StageCoverage;
  };
  weakPoints: EvaluationWeakPoint[];
  contentIssues?: ContentIssue[];
  categoryAnalysis?: CategoryAnalysis[];
  fluencyBreakdown?: FluencyBreakdown;
  initial_scores?: EvaluationScores;
  initial_overall_score?: number;
  conversation_metrics?: ConversationMetrics;
  score_changes?: Record<keyof EvaluationScores, ScoreChange>;
  dialogue_history?: DialogueHistoryRound[];
}

export interface EvaluationResultResponse {
  code: number;
  data: EvaluationResult;
}

export async function getEvaluation(recordId: string): Promise<EvaluationResultResponse> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/evaluation`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as EvaluationResultResponse;
}

export async function updateEvaluation(
  recordId: string,
  evaluation: EvaluationResult
): Promise<{ code: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/evaluation`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ evaluation }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message: string };
}

export async function getPreAnalysis(recordId: string): Promise<PreAnalysisResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/pre-analysis`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PreAnalysisResult;
}

export async function deletePractice(recordId: string, userId: string): Promise<{ code: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message: string };
}

// --- Team / Manager ---

export interface TeamPracticeItem {
  record_id: string;
  user_id: string;
  user_name: string;
  employee_id: string;
  product_line: string;
  practice_type: string;
  status: string;
  duration: number;
  overall_score: number | null;
  fluency_score: number;
  weak_points: { name: string; severity: 'high' | 'medium' | 'low' }[];
  created_at: string;
  is_showcase?: boolean;
}

export interface TeamPracticeListResult {
  code: number;
  data: {
    list: TeamPracticeItem[];
    total: number;
  };
}

export async function getTeamPractices(managerId: string, page = 1, limit = 20): Promise<TeamPracticeListResult> {
  const qs = new URLSearchParams({ manager_id: managerId, page: String(page), limit: String(limit) });
  const res = await fetch(`${API_BASE}/api/v1/practices/team?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as TeamPracticeListResult;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  low_confidence: boolean;
}

export interface TrainingPlanMonthly {
  week: number;
  title: string;
  target: string;
}

export interface TrainingPlanAnalysis {
  point: string;
  detail: string;
}

export interface TrainingPlanAssessment {
  week_assessment: string;
  month_assessment: string;
  pass_criteria: string;
}

export interface TrainingPlan {
  weekly: string;
  monthly: TrainingPlanMonthly[];
  analysis: TrainingPlanAnalysis[];
  assessment: TrainingPlanAssessment;
}

export interface PracticeDetailResult {
  code: number;
  message?: string;
  data: {
    record_id: string;
    user_id: string;
    user_name: string;
    employee_id: string;
    product_line: string;
    practice_type: string;
    status: string;
    duration: number;
    transcript?: string;
    transcript_segments?: TranscriptSegment[];
    audio_url: string;
    created_at: string;
    evaluation: EvaluationResult;
    dialogue_rounds: DialogueHistoryRound[];
    fluency_score: number;
    weak_points: string[];
    training_plan: TrainingPlan | null;
  };
}

export async function getPracticeDetail(recordId: string): Promise<PracticeDetailResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/detail`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PracticeDetailResult;
}

export async function reviewPractice(recordId: string, managerId: string, reviewStatus: string, reviewComment?: string): Promise<{ code: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ manager_id: managerId, review_status: reviewStatus, review_comment: reviewComment }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message: string };
}

// --- Showcase ---

export interface ShowcaseItem {
  record_id: string;
  user_name: string;
  product_line: string;
  overall_score: number;
  audio_url: string;
  duration: number;
  created_at: string;
  comment?: string;
}

export async function toggleShowcase(recordId: string, comment?: string): Promise<{ code: number; data: { is_showcase: boolean } }> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/showcase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(comment ? { comment } : undefined),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: { is_showcase: boolean } };
}

export async function getShowcaseList(limit?: number): Promise<{ code: number; data: { list: ShowcaseItem[] } }> {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', String(limit));
  const res = await fetch(`${API_BASE}/api/v1/practices/showcase?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: { list: ShowcaseItem[] } };
}
