import { API_BASE } from './config';

export interface User {
  user_id: string;
  username: string;
  name: string;
  role: 'employee' | 'manager' | 'admin';
  employee_id?: string;
  department?: string;
  avatar_url?: string;
  phone?: string;
  email?: string;
}

export interface LoginResult {
  code: number;
  message?: string;
  data?: User & { token: string };
}

export interface RegisterInput {
  username: string;
  password: string;
  name: string;
  role: 'employee' | 'manager' | 'admin';
  employee_id?: string;
  manager_id?: string;
}

export interface RegisterResult {
  code: number;
  message?: string;
  data?: User;
}

function getToken(): string | null {
  return localStorage.getItem('token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = (await res.json()) as LoginResult;
  if (res.ok && json.code === 0 && json.data?.token) {
    localStorage.setItem('token', json.data.token);
  }
  return json;
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await res.json()) as RegisterResult;
}

export async function getMe(): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  });
  return (await res.json()) as LoginResult;
}

export function logout(): void {
  localStorage.removeItem('token');
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ new_password: newPassword }),
  });
  return (await res.json()) as { code: number; message?: string };
}

export async function batchAssignManager(userIds: string[], managerId: string | null): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/users/batch-assign-manager`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ user_ids: userIds, manager_id: managerId }),
  });
  return (await res.json()) as { code: number; message?: string };
}

export async function updateEmail(email: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/update-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ email }),
  });
  return (await res.json()) as { code: number; message?: string };
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  return (await res.json()) as { code: number; message?: string };
}

export interface UserListItem {
  user_id: string;
  username: string;
  name: string;
  role: 'employee' | 'manager' | 'admin';
  employee_id?: string;
  department?: string;
  status: string;
  created_at: string;
  manager_id?: string;
}

export interface UserListResult {
  code: number;
  data: {
    list: UserListItem[];
    total: number;
  };
}

export async function getUserList(keyword?: string, role?: string): Promise<UserListResult> {
  const params = new URLSearchParams();
  if (keyword) params.set('keyword', keyword);
  if (role) params.set('role', role);
  const qs = params.toString();
  const url = `${API_BASE}/api/v1/auth/users${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as UserListResult;
}

export async function forgotPassword(email: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return (await res.json()) as { code: number; message?: string };
}

export async function verifyResetToken(token: string): Promise<{ code: number; message?: string; data?: { email: string } }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/reset-password/verify?token=${encodeURIComponent(token)}`);
  return (await res.json()) as { code: number; message?: string; data?: { email: string } };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  return (await res.json()) as { code: number; message?: string };
}

export { getToken, authHeaders };
