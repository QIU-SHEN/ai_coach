const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface DashboardData {
  users: { total: number; active: number; admin: number; manager: number; employee: number };
  debriefs: { total: number; completed: number; analyzing: number; failed: number };
  knowledge: { product_lines: number; items: number; scripts: number; materials: number; assets: number };
  quizzes: { total: number; attempts: number; avg_correct_rate: number };
  ai_calls: { total: number };
}

export interface DailyStat {
  date: string;
  new_users: number;
  new_debriefs: number;
  new_quizzes: number;
}

export interface ErrorEntry {
  time: string;
  message: string;
  path: string;
  method: string;
}

export interface BackupInfo {
  latest: { filename: string; size_bytes: number; created_at: string } | null;
  total_count: number;
  total_size_bytes: number;
}

export async function getDashboard(): Promise<{ code: number; data?: DashboardData; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/admin/dashboard`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getDailyStats(days = 7): Promise<{ code: number; data?: { days: DailyStat[] }; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/admin/stats/daily?days=${days}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getErrors(): Promise<{ code: number; data?: { errors: ErrorEntry[] }; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/admin/errors`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getBackupStatus(): Promise<{ code: number; data?: BackupInfo; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/admin/backup`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
