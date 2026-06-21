import 'dotenv/config';
import { initSentry, setupSentryErrorHandler } from './services/sentry';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { initDb, pool } from './db';
import { errorHandler } from './middleware/error-handler';
import { logger } from './services/logger';
import authRouter from './routes/auth';
import knowledgeRouter from './routes/knowledge';
import trainingUnitsRouter from './routes/training-units';
import settingsRouter from './routes/settings';
import debriefsRouter from './routes/debriefs';
import quizzesRouter from './routes/quizzes';

const app = express();
initSentry(app);
const PORT = process.env.PORT || 3000;

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://127.0.0.1:5173',
     'http://localhost:5174', 'http://127.0.0.1:5174',
     'https://qiushen.top'];

app.use(cors({
  origin: CORS_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(helmet());
app.use(express.json());

// 全局限流：200 次/分钟
app.use(rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后重试' },
}));

// 认证端点限流：10 次/15 分钟
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请 15 分钟后再试' },
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);
app.use('/api/v1/auth/reset-password', authLimiter);

// 上传接口限流：5 次/分钟（防止大文件批量上传耗尽资源）
app.use('/api/v1/knowledge/product-assets/upload', rateLimit({
  windowMs: 60_000,
  max: 5,
  message: { code: 429, message: '上传过于频繁，请 1 分钟后再试' },
}));

// AI 模拟/对话接口限流：30 次/分钟（防止暴力调用产生大量费用）
const aiDialogueLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { code: 429, message: 'AI 请求过于频繁，请稍后重试' },
});
app.use('/api/v1/debriefs/:id/simulation', aiDialogueLimit);
app.use('/api/v1/debriefs/:id/dialogue', aiDialogueLimit);
app.use('/api/v1/debriefs/:id/dialogue-training', aiDialogueLimit);

// Serve local uploaded files (training materials, etc.)
// 强制内联预览，避免浏览器自动下载
const uploadsStatic = path.resolve(process.cwd(), 'uploads');

app.use('/uploads', (req, res, next) => {
  // 设置 CORS 头，仅允许配置的源，确保跨域 iframe 可以加载
  const requestOrigin = req.headers.origin;
  if (requestOrigin && CORS_ORIGINS.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
}, express.static(uploadsStatic, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.webm': 'video/webm',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.mov': 'video/quicktime',
    };
    if (mimeMap[ext]) {
      res.setHeader('Content-Type', mimeMap[ext]);
      res.setHeader('Content-Disposition', 'inline');
      // 禁用缓存，避免浏览器缓存旧的响应头
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  },
}));

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/knowledge', knowledgeRouter);
app.use('/api/v1/training', trainingUnitsRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/debriefs', debriefsRouter);
app.use('/api/v1/quizzes', quizzesRouter);

app.get('/health', async (_req, res) => {
  let dbOk = false;
  try {
    await pool.execute('SELECT 1');
    dbOk = true;
  } catch { /* DB down */ }
  const status = dbOk ? 'ok' : 'degraded';
  const httpStatus = dbOk ? 200 : 503;
  res.status(httpStatus).json({
    status,
    time: new Date().toISOString(),
    checks: { database: dbOk ? 'ok' : 'unreachable' },
  });
});

app.get('/ready', async (_req, res) => {
  try {
    await pool.execute('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready' });
  }
});

// Sentry error handler (before custom error handler)
setupSentryErrorHandler(app);

// Centralized error handler (must be last)
app.use(errorHandler);

function validateEnv(): void {
  const required = ['JWT_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  const warnings: string[] = [];
  if (!process.env.OPENAI_API_KEY) warnings.push('OPENAI_API_KEY');
  if (!process.env.DB_HOST) warnings.push('DB_HOST');
  if (warnings.length > 0) {
    console.warn(`[warn] Optional env vars not set: ${warnings.join(', ')} — some features may not work`);
  }
}

function setupGracefulShutdown(server: ReturnType<typeof app.listen>): void {
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] Received ${signal}, shutting down gracefully...`);

    server.close((err) => {
      if (err) console.error('[shutdown] Error closing HTTP server:', err);
    });

    try {
      await pool.end();
      console.log('[shutdown] Database pool closed');
    } catch (err) {
      console.error('[shutdown] Error closing DB pool:', err);
    }

    await logger.flush();
    console.log('[shutdown] Graceful shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function main() {
  validateEnv();
  await initDb();
  const server = app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
  setupGracefulShutdown(server);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
