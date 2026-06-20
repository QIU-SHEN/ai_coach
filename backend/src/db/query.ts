import { pool } from './index';

export async function query(sql: string, params?: any[]): Promise<any[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}
