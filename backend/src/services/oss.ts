import OSS from 'ali-oss';
import path from 'path';
import fs from 'fs';

// 从环境变量读取 OSS 配置
const region = process.env.OSS_REGION || 'oss-cn-shanghai';
const bucket = process.env.OSS_BUCKET || 'ai-coach0';
const accessKeyId = process.env.OSS_ACCESS_KEY_ID || '';
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || '';

// 公开访问域名
export const OSS_PUBLIC_URL = process.env.OSS_PUBLIC_URL || `https://${bucket}.${region}.aliyuncs.com`;

let ossClient: OSS | null = null;

export function getOssClient(): OSS {
  if (ossClient) return ossClient;

  if (!accessKeyId || !accessKeySecret) {
    throw new Error('Missing OSS credentials. Please set OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET env vars.');
  }

  ossClient = new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    // 使用 V4 签名（推荐）
    authorizationV4: true,
    // 超时设置
    timeout: '120s',
  });

  return ossClient;
}

/**
 * 上传文件到 OSS
 * @param localPath 本地文件路径
 * @param ossKey OSS 上的对象 Key（如 debriefs/xxx.webm）
 * @returns 完整的公开访问 URL
 */
export async function uploadToOss(localPath: string, ossKey: string): Promise<string> {
  const client = getOssClient();
  await client.put(ossKey, localPath);
  return `${OSS_PUBLIC_URL}/${ossKey}`;
}

/**
 * 上传 Buffer 到 OSS
 * @param buffer 文件 Buffer
 * @param ossKey OSS 上的对象 Key
 * @returns 完整的公开访问 URL
 */
export async function uploadBufferToOss(buffer: Buffer, ossKey: string): Promise<string> {
  const client = getOssClient();
  await client.put(ossKey, buffer);
  return `${OSS_PUBLIC_URL}/${ossKey}`;
}

/**
 * 从 OSS 下载文件到本地
 * @param ossKey OSS 上的对象 Key
 * @param localPath 本地保存路径
 */
export async function downloadFromOss(ossKey: string, localPath: string): Promise<void> {
  const client = getOssClient();
  const result = await client.get(ossKey);
  fs.writeFileSync(localPath, result.content);
}

/**
 * 删除 OSS 上的文件
 * @param ossKey OSS 上的对象 Key
 */
export async function deleteFromOss(ossKey: string): Promise<void> {
  const client = getOssClient();
  await client.delete(ossKey);
}

/**
 * 生成 OSS 文件的公开访问 URL
 * @param ossKey OSS 上的对象 Key
 * @returns 完整的公开访问 URL
 */
export function getOssUrl(ossKey: string): string {
  return `${OSS_PUBLIC_URL}/${ossKey}`;
}

/**
 * 检查路径是否是 OSS URL
 */
export function isOssUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * 从完整 URL 中提取 OSS Key
 * @param url 完整 URL 或相对路径
 * @returns OSS Key（如 debriefs/xxx.webm）
 */
export function extractOssKey(url: string): string {
  if (isOssUrl(url)) {
    // 从 https://bucket.endpoint/key 中提取 key
    const urlObj = new URL(url);
    return urlObj.pathname.replace(/^\//, '');
  }
  // 处理 /uploads/xxx 格式的旧路径
  if (url.startsWith('/uploads/')) {
    return url.replace(/^\/uploads\//, '');
  }
  return url;
}
