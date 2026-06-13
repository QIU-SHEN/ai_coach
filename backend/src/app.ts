import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
