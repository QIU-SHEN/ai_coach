import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(__dirname, '..', 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function ensureBackupDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runMysqldump(outputPath: string): void {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '3306';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'ai_sales_coach';

  const cmd = `mysqldump --host=${host} --port=${port} --user=${user} --password=${password} --single-transaction --routines --triggers --default-character-set=utf8mb4 --result-file=${outputPath} ${database}`;

  console.log(`[backup] Running mysqldump for ${database}...`);
  execSync(cmd, { stdio: 'inherit', timeout: 300_000 });
}

function removeOldBackups(dir: string, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz'))
    .map(f => ({ name: f, fullPath: path.join(dir, f) }));

  let removed = 0;
  for (const file of files) {
    const stat = fs.statSync(file.fullPath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(file.fullPath);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[backup] Removed ${removed} old backup(s) older than ${retentionDays} days`);
  }
}

function main(): void {
  ensureBackupDir(BACKUP_DIR);
  const filename = `ai_sales_coach_${getTimestamp()}.sql`;
  const outputPath = path.join(BACKUP_DIR, filename);

  runMysqldump(outputPath);

  const stat = fs.statSync(outputPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`[backup] Backup created: ${filename} (${sizeMB} MB)`);

  removeOldBackups(BACKUP_DIR, RETENTION_DAYS);
}

main();
