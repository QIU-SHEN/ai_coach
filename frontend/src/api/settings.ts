import { API_BASE } from './config';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

export interface SettingsResult {
  code: number;
  data: Record<string, string>;
}

export async function getSettings(): Promise<SettingsResult> {
  const res = await fetch(`${API_BASE}/api/v1/settings`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SettingsResult;
}

export async function updateSettings(settings: Record<string, string>): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/settings`, {
    method: 'PUT',
    headers: { ...authHeaders() },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string };
}
