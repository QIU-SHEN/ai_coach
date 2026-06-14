import path from 'path';
import fs from 'fs';
import { uploadToOss, getOssUrl, isOssUrl, deleteFromOss } from './oss';

/**
 * 保存上传文件到 OSS
 * @param sourcePath 本地临时文件路径
 * @param recordId 记录 ID（用于生成文件名）
 * @param ext 文件扩展名
 * @param category 文件分类目录（如 debriefs, voice-replies, assets）
 * @returns OSS 公开访问 URL
 */
export async function saveUpload(
  sourcePath: string,
  recordId: string,
  ext: string,
  category: string = 'files'
): Promise<string> {
  const ossKey = `${category}/${recordId}.${ext}`;
  const url = await uploadToOss(sourcePath, ossKey);
  return url;
}

/**
 * 获取文件的公开访问 URL
 * @param filePath 数据库中存储的路径（可能是 /uploads/xxx 或完整 URL）
 * @returns 完整的公开访问 URL
 */
export function getFileUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  // 如果已经是完整 URL，直接返回
  if (isOssUrl(filePath)) {
    return filePath;
  }
  // 处理 /uploads/ 前缀的旧路径
  const key = filePath.replace(/^\/?uploads\//, '');
  return getOssUrl(key);
}

/**
 * 从完整 URL 或旧路径中提取 OSS Key
 * @param filePath 文件路径或 URL
 * @returns OSS Key（如 debriefs/xxx.webm）
 */
export function extractOssKey(filePath: string): string {
  if (isOssUrl(filePath)) {
    // 从 https://bucket.endpoint/key 中提取 key
    const urlObj = new URL(filePath);
    return urlObj.pathname.replace(/^\//, '');
  }
  // 处理 /uploads/ 前缀的旧路径
  if (filePath.startsWith('/uploads/')) {
    return filePath.replace(/^\/uploads\//, '');
  }
  // 如果就是相对路径，直接返回
  return filePath;
}

/**
 * 删除文件（从 OSS 或本地）
 * @param filePath 文件路径或 URL
 */
export async function deleteFile(filePath: string): Promise<void> {
  // OSS URL
  if (isOssUrl(filePath)) {
    const key = extractOssKey(filePath);
    if (key) {
      await deleteFromOss(key);
    }
    return;
  }

  // 本地文件路径
  const localPath = filePath.startsWith('/') || filePath.startsWith('uploads/')
    ? path.resolve(process.cwd(), filePath.replace(/^\//, ''))
    : path.resolve(process.cwd(), filePath);

  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
  }
}

/**
 * 兼容旧代码的 ensureUploadDir
 * OSS 模式下不需要创建本地目录，但为了兼容仍保留空实现
 */
export async function ensureUploadDir(): Promise<void> {
  // OSS 模式下不需要本地目录
  return;
}
