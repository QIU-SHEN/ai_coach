import { authHeaders } from './auth';
import { API_BASE } from './config';

export interface Quiz {
  quiz_id: string;
  product_line_id: string;
  product_line_name: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
  my_attempt: {
    selected_index: number;
    is_correct: boolean;
  } | null;
}

export interface QuizProgress {
  total: number;
  attempted: number;
  correct: number;
  accuracy: number;
}

export async function getQuizzes(productLineId?: string): Promise<{ code: number; data?: { list: Quiz[] } }> {
  const qs = productLineId ? `?product_line_id=${productLineId}` : '';
  const res = await fetch(`${API_BASE}/api/v1/quizzes${qs}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: { list: Quiz[] } };
}

export async function generateQuizzes(productLineId: string): Promise<{ code: number; data?: { count: number; quizzes: Quiz[] } }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/generate-quizzes`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: { count: number; quizzes: Quiz[] } };
}

export async function submitAttempt(quizId: string, selectedIndex: number): Promise<{ code: number; data?: { is_correct: boolean; correct_index: number } }> {
  const res = await fetch(`${API_BASE}/api/v1/quizzes/${quizId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ selected_index: selectedIndex }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: { is_correct: boolean; correct_index: number } };
}

export async function getQuizProgress(productLineId?: string): Promise<{ code: number; data?: QuizProgress }> {
  const qs = productLineId ? `?product_line_id=${productLineId}` : '';
  const res = await fetch(`${API_BASE}/api/v1/quizzes/progress${qs}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: QuizProgress };
}

export async function deleteQuiz(quizId: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/quizzes/${quizId}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string };
}

export async function getQuizzesByMaterial(materialId: string): Promise<{ code: number; data?: { list: Quiz[] } }> {
  const res = await fetch(`${API_BASE}/api/v1/training-materials/${materialId}/quizzes`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: { list: Quiz[] } };
}

export async function generateQuizzesForMaterial(materialId: string): Promise<{ code: number; data?: { count: number; quizzes: Quiz[] } }> {
  const res = await fetch(`${API_BASE}/api/v1/training-materials/${materialId}/generate-quizzes`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: { count: number; quizzes: Quiz[] } };
}
