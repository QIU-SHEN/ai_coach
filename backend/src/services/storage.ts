import fs from 'fs';
import path from 'path';

// MVP: local file storage with pre-signed URL structure
// TODO: replace with MinIO / OSS SDK for production

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export async function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export async function saveUpload(
  sourcePath: string,
  recordId: string,
  ext: string
): Promise<string> {
  await ensureUploadDir();
  const dest = path.join(UPLOAD_DIR, `${recordId}.${ext}`);
  await fs.promises.copyFile(sourcePath, dest);
  // 返回相对路径，不要带域名，这样换域名也不用改数据库
  return `/uploads/${recordId}.${ext}`;
}
