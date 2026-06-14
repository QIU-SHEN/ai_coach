import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDb } from './db';
import practicesRouter from './routes/practices';
import authRouter from './routes/auth';
import knowledgeRouter from './routes/knowledge';
import trainingUnitsRouter from './routes/training-units';
import settingsRouter from './routes/settings';
import debriefsRouter from './routes/debriefs';
import quizzesRouter from './routes/quizzes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'https://qiushen.top'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);
app.use(express.json());

// Serve local uploaded files (training materials, etc.)
// 强制内联预览，避免浏览器自动下载
const uploadsStatic = path.resolve(process.cwd(), 'uploads');

app.use('/uploads', (req, res, next) => {
  // 设置 CORS 头，确保跨域 iframe 可以加载
  res.setHeader('Access-Control-Allow-Origin', '*');
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
app.use('/api/v1/practices', practicesRouter);
app.use('/api/v1', knowledgeRouter);
app.use('/api/v1', trainingUnitsRouter);
app.use('/api/v1', settingsRouter);
app.use('/api/v1/debriefs', debriefsRouter);
app.use('/api/v1', quizzesRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

async function main() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
