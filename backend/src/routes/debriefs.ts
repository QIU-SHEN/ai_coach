import { Router, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { pool, parseJsonRows } from '../db';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { getQueryUserId } from '../middleware/permission';
import {
  ERR_MISSING_PARAMS,
  ERR_FILE_TOO_LARGE,
  ERR_UNSUPPORTED_FORMAT,
  ERR_AUDIO_TOO_SHORT,
  ERR_POOR_AUDIO_QUALITY,
  ERR_RETRY_NOT_ALLOWED,
  ERR_RECORD_NOT_FOUND,
  ERR_INTERNAL_SERVER,
  ASR_ERROR_CODES,
} from '../constants/errors';
import type { ApiResponse } from '../types';
import { transcribeWithYunwu, transcribeWithWhisper, transcribeWithAlignment } from '../services/asr';
import { saveUpload } from '../services/storage';
import { getAudioDuration, detectSilenceRatio } from '../services/audio';
import { analyzeDebriefContent, summarizeDebriefAnalyses } from '../services/debrief-analysis';
import { callOpenAIChat } from '../services/openai-chat';
import { isLocalWhisper } from '../services/asr';
import type { DebriefMode } from '../types';

const router = Router();

const upload = multer({ dest: 'uploads/tmp/' });

const ALLOWED_EXTS = ['.mp3', '.wav', '.m4a', '.webm'];
const MAX_SIZE_MB = 100;
const MIN_DURATION_SECONDS = 120;
const MAX_SILENCE_RATIO = 0.5;

async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}

function normalizeAudioUrl(audioPath: string | null | undefined): string | null {
  if (!audioPath) return null;
  if (audioPath.startsWith('http://') || audioPath.startsWith('https://')) {
    return audioPath;
  }
  return audioPath.startsWith('/') ? audioPath : `/${audioPath}`;
}

async function requireDebriefOwnerOrManager(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user!;
  const recordId = req.params.id || req.params.record_id;
  if (!recordId) return next();
  if (user.role === 'manager' || user.role === 'admin') return next();

  const rows = await query('SELECT user_id FROM debrief_records WHERE record_id = ?', [recordId]);
  if (rows.length === 0) {
    return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
  }
  if (rows[0].user_id !== user.userId) {
    return res.status(403).json({ code: 403000, message: '无权访问该记录' } as ApiResponse);
  }
  next();
}

async function resolveProductLineId(name: string | undefined, id: string | undefined): Promise<string | null> {
  if (id) return id;
  if (!name) return null;
  const rows = await query('SELECT product_line_id FROM product_lines WHERE name = ? AND status = ?', [name, 'active']);
  return rows[0]?.product_line_id || null;
}

// POST /debriefs — 创建复盘记录
router.post('/', authMiddleware, upload.single('audio'), async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { title, content, product_line_id, product_line, mode, practice_type, audio_type } = req.body;
  const debriefMode: DebriefMode =
    mode === 'call_recording' ? 'call_recording' :
    mode === 'simulation' ? 'simulation' :
    'post_meeting';

  if (debriefMode === 'simulation') {
    if (!title || !title.trim()) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 title' } as ApiResponse);
    }
    try {
      const recordId = uuidv4();
      await pool.execute(
        `INSERT INTO debrief_records (record_id, user_id, product_line_id, title, content, audio_path, transcript, status, debrief_mode, speaker_diagram)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
        [recordId, userId, product_line_id || null, title.trim(), content || null, null, null, debriefMode, null]
      );
      // simulation 模式也需要创建 practice_meta，让 /dialogue 能读取 product_line
      await pool.execute(
        `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, audio_type, product_line)
         VALUES (?, 0, 'intro', 'monologue', ?)
         ON DUPLICATE KEY UPDATE product_line = VALUES(product_line)`,
        [recordId, product_line_id || null]
      );
      return res.status(201).json({ code: 0, data: { record_id: recordId } } as ApiResponse);
    } catch (err) {
      console.error('Debrief create error (simulation):', err);
      return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: err instanceof Error ? err.message : String(err) } as ApiResponse);
    }
  }

  if (debriefMode === 'post_meeting') {
    if (!title || !title.trim()) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 title' } as ApiResponse);
    }

    let audioPath: string | null = null;
    let transcript = '';
    let speakerDiagram = null;

    try {
      if (req.file) {
        const ext = path.extname(req.file.originalname).toLowerCase();
        const savedName = `${uuidv4()}${ext}`;
        const destPath = path.join('uploads/debriefs', savedName);
        if (!fs.existsSync('uploads/debriefs')) {
          fs.mkdirSync('uploads/debriefs', { recursive: true });
        }
        fs.renameSync(req.file.path, destPath);
        audioPath = `/${destPath.replace(/\\/g, '/')}`;

        const speakerCount = 1;
        const asrResult = await transcribeWithYunwu(destPath, 'conversation', speakerCount);
        transcript = asrResult.transcript;
      }

      const recordId = uuidv4();
      await pool.execute(
        `INSERT INTO debrief_records (record_id, user_id, product_line_id, title, content, audio_path, transcript, status, debrief_mode, speaker_diagram)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [recordId, userId, product_line_id || null, title.trim(), content || null, audioPath, transcript || null, debriefMode, speakerDiagram ? JSON.stringify(speakerDiagram) : null]
      );

      return res.status(201).json({ code: 0, data: { record_id: recordId } } as ApiResponse);
    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error('Debrief create error:', err);
      return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
    }
  }

  // === call_recording 模式：复用原 practices upload 流程 ===
  // 新增支持：直接传入对话文本（transcript），不需要音频文件
  const transcript = req.body.transcript as string | undefined;
  const file = req.file;
  const pType = (practice_type as string) || 'intro';
  const aType = (audio_type as string) || 'monologue';
  const pLineName = product_line as string | undefined;
  const pLineId = product_line_id as string | undefined;

  // 如果提供了对话文本，直接保存，不需要音频文件
  if (transcript && transcript.trim()) {
    if (!pLineName && !pLineId) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 product_line' } as ApiResponse);
    }

    try {
      const recordId = uuidv4();
      const resolvedProductLineId = await resolveProductLineId(pLineName, product_line_id);

      await pool.execute(
        `INSERT INTO debrief_records (record_id, user_id, product_line_id, title, content, audio_path, transcript, status, debrief_mode, speaker_diagram)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
        [recordId, userId, resolvedProductLineId, title || `${pLineName} 对话练习`, content || null, null, transcript.trim(), debriefMode, null]
      );
      await pool.execute(
        `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, audio_type, product_line)
         VALUES (?, ?, ?, ?, ?)`,
        [recordId, 0, pType, aType, pLineName || null]
      );

      // 触发后台分析
      runBackgroundAnalysis(recordId).catch(err => {
        console.error('Background analysis failed:', recordId, err);
      });

      return res.status(201).json({
        code: 0,
        data: {
          record_id: recordId,
          status: 'completed',
          product_line: pLineName,
          practice_type: pType,
          audio_type: aType,
        },
      } as ApiResponse);
    } catch (err) {
      console.error('Debrief create error (text):', err);
      return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
    }
  }

  // 原有音频文件处理流程
  if (!file) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: ERR_MISSING_PARAMS.message } as ApiResponse);
  }
  if (!pLineName && !pLineId) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 product_line' } as ApiResponse);
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) {
    return res.status(400).json({
      code: ERR_UNSUPPORTED_FORMAT.code,
      message: `不支持的音频格式：${ext}。仅支持 ${ALLOWED_EXTS.join(' / ')}`,
    } as ApiResponse);
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return res.status(400).json({
      code: ERR_FILE_TOO_LARGE.code,
      message: `音频文件过大，请压缩至 ${MAX_SIZE_MB}MB 以下`,
    } as ApiResponse);
  }

  try {
    const recordId = uuidv4();

    // 1. 先分析本地文件
    let rawDuration = 0;
    try {
      rawDuration = await getAudioDuration(file.path);
    } catch (audioErr) {
      console.warn('Failed to get audio duration:', audioErr);
    }
    const duration = Math.max(0, Math.round(Number(rawDuration) || 0));

    if (duration > 0 && duration < MIN_DURATION_SECONDS) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      return res.status(400).json({
        code: ERR_AUDIO_TOO_SHORT.code,
        message: `音频时长过短（${duration}秒），请录制至少 ${MIN_DURATION_SECONDS} 秒`,
      } as ApiResponse);
    }

    if (duration > 0) {
      const silenceRatio = await detectSilenceRatio(file.path);
      if (silenceRatio > MAX_SILENCE_RATIO) {
        try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        return res.status(400).json({
          code: ERR_POOR_AUDIO_QUALITY.code,
          message: `音频静音比例过高（${(silenceRatio * 100).toFixed(1)}%），请检查麦克风并重新录制`,
        } as ApiResponse);
      }
    }

    // 2. 分析完成后上传到 OSS
    const savedPath = await saveUpload(file.path, recordId, ext.replace('.', ''), 'debriefs');

    // 3. 清理本地临时文件
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    const resolvedProductLineId = await resolveProductLineId(pLineName, product_line_id);

    await pool.execute(
      `INSERT INTO debrief_records (record_id, user_id, product_line_id, title, content, audio_path, transcript, status, debrief_mode, speaker_diagram)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [recordId, userId, resolvedProductLineId, title || `${pLineName} 练习`, content || null, savedPath, null, debriefMode, null]
    );
    await pool.execute(
      `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, audio_type, product_line)
       VALUES (?, ?, ?, ?, ?)`,
      [recordId, duration, pType, aType, pLineName || null]
    );

    return res.status(201).json({
      code: 0,
      data: {
        record_id: recordId,
        audio_url: savedPath,
        duration,
        status: 'pending',
        product_line: pLineName,
        practice_type: pType,
        audio_type: aType,
      },
    } as ApiResponse);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Debrief create error:', err);
    return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs — 获取复盘列表
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const user = req.user!;
  try {
    let where = 'WHERE dr.debrief_mode != ?';
    const params: any[] = ['simulation'];

    if (user.role === 'employee') {
      where += ' AND dr.user_id = ?';
      params.push(user.userId);
    } else if (user.role === 'manager') {
      where += ' AND (dr.user_id = ? OR u.manager_id = ?)';
      params.push(user.userId, user.userId);
    }

    const rows = await query(
      `SELECT dr.record_id, dr.user_id, dr.title, dr.status, dr.analysis, dr.product_line_id,
              dr.debrief_mode, dr.created_at, dr.training_plan,
              m.duration, m.practice_type, m.overall_score as meta_score, m.is_showcase,
              m.evaluation_result, m.weak_points,
              pl.name as product_line,
              u.name as user_name, u.employee_id
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       LEFT JOIN product_lines pl ON dr.product_line_id = pl.product_line_id
       LEFT JOIN users u ON dr.user_id = u.user_id
       ${where}
       ORDER BY dr.created_at DESC`,
      params
    );

    const list = rows.map((row: any) => {
      const base = {
        record_id: row.record_id,
        user_id: row.user_id,
        user_name: row.user_name || undefined,
        employee_id: row.employee_id || undefined,
        product_line_id: row.product_line_id,
        product_line: row.product_line || undefined,
        title: row.title,
        status: row.status,
        debrief_mode: row.debrief_mode || 'post_meeting',
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      };

      if (row.debrief_mode === 'call_recording') {
        return {
          ...base,
          duration: row.duration ?? 0,
          practice_type: row.practice_type,
          overall_score: row.meta_score != null ? Number(row.meta_score) : undefined,
          is_showcase: !!row.is_showcase,
          evaluation_result: parseJsonField(row.evaluation_result),
          weak_points: parseJsonField(row.weak_points),
          training_plan: parseJsonField(row.training_plan),
        };
      }

      let overallScore: number | null = null;
      if (row.analysis) {
        try {
          const a = typeof row.analysis === 'string' ? JSON.parse(row.analysis) : row.analysis;
          overallScore = a.overallScore ?? a.overall_score ?? null;
        } catch {
          // ignore
        }
      }
      return {
        ...base,
        overall_score: overallScore,
        analysis: parseJsonField(row.analysis),
        training_plan: parseJsonField(row.training_plan),
      };
    });

    const countRows = await query(
      `SELECT COUNT(*) as total FROM debrief_records dr
       LEFT JOIN users u ON dr.user_id = u.user_id ${where}`,
      params
    );

    res.json({ code: 0, data: { list, total: parseInt(countRows[0].total, 10) } } as ApiResponse);
  } catch (err) {
    console.error('Debrief list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

function parseJsonField(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

// GET /debriefs/simulation-list — 获取模拟对话列表
router.get('/simulation-list', authMiddleware, async (req: AuthRequest, res) => {
  const user = req.user!;
  try {
    let where = 'WHERE dr.debrief_mode = ?';
    const params: any[] = ['simulation'];

    if (user.role === 'employee') {
      where += ' AND dr.user_id = ?';
      params.push(user.userId);
    } else if (user.role === 'manager') {
      where += ' AND (dr.user_id = ? OR u.manager_id = ?)';
      params.push(user.userId, user.userId);
    }

    const rows = await query(
      `SELECT dr.record_id, dr.user_id, dr.title, dr.status, dr.created_at,
              m.overall_score as meta_score,
              pl.name as product_line,
              u.name as user_name
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       LEFT JOIN product_lines pl ON dr.product_line_id = pl.product_line_id
       LEFT JOIN users u ON dr.user_id = u.user_id
       ${where}
       ORDER BY dr.created_at DESC`,
      params
    );

    const list = rows.map((row: any) => ({
      record_id: row.record_id,
      title: row.title,
      status: row.status,
      product_line: row.product_line || undefined,
      overall_score: row.meta_score != null ? Number(row.meta_score) : undefined,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));

    res.json({
      code: 0,
      data: { list },
    } as ApiResponse);
  } catch (err) {
    console.error('Simulation list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/:id — 获取复盘详情
router.get('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  const user = req.user!;
  const { id } = req.params;

  const reservedKeywords = ['team', 'showcase', 'summary', 'training-plan', 'simulation-list'];
  if (reservedKeywords.includes(id)) {
    return next();
  }

  try {
    const rows = await query(
      `SELECT dr.record_id, dr.user_id, dr.product_line_id, dr.title, dr.content, dr.audio_path,
              dr.transcript, dr.analysis, dr.training_plan, dr.status, dr.debrief_mode,
              dr.speaker_diagram, dr.created_at,
              m.duration, m.practice_type, m.audio_type, m.transcript_segments,
              m.overall_score as meta_score, m.weak_points, m.fluency_score,
              m.evaluation_result, m.pre_analysis, m.initial_scores,
              m.conversation_metrics, m.dialogue_history, m.is_showcase,
              m.showcase_comment, m.review_comment,
              pl.name as product_line,
              u.name as user_name, u.employee_id
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       LEFT JOIN product_lines pl ON dr.product_line_id = pl.product_line_id
       LEFT JOIN users u ON dr.user_id = u.user_id
       WHERE dr.record_id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const record = rows[0];
    if (user.role === 'employee' && record.user_id !== user.userId) {
      return res.status(403).json({ code: 403000, message: '无权访问该记录' } as ApiResponse);
    }

    const base: any = {
      record_id: record.record_id,
      user_id: record.user_id,
      user_name: record.user_name || undefined,
      employee_id: record.employee_id || undefined,
      product_line_id: record.product_line_id,
      product_line: record.product_line || undefined,
      title: record.title,
      status: record.status,
      debrief_mode: record.debrief_mode || 'post_meeting',
      audio_path: record.audio_path,
      audio_url: normalizeAudioUrl(record.audio_path),
      transcript: record.transcript,
      training_plan: parseJsonField(record.training_plan),
      created_at: record.created_at ? new Date(record.created_at).toISOString() : null,
    };

    if (record.debrief_mode === 'call_recording' || record.practice_type) {
      Object.assign(base, {
        duration: record.duration ?? 0,
        practice_type: record.practice_type,
        audio_type: record.audio_type,
        transcript_segments: parseJsonField(record.transcript_segments),
        overall_score: record.meta_score != null ? Number(record.meta_score) : null,
        fluency_score: record.fluency_score,
        weak_points: parseJsonField(record.weak_points),
        evaluation_result: parseJsonField(record.evaluation_result),
        pre_analysis: parseJsonField(record.pre_analysis),
        initial_scores: parseJsonField(record.initial_scores),
        conversation_metrics: parseJsonField(record.conversation_metrics),
        dialogue_history: parseJsonField(record.dialogue_history) || (parseJsonField(record.evaluation_result) as any)?.dialogue_history || [],
        is_showcase: !!record.is_showcase,
        showcase_comment: record.showcase_comment || null,
        review_comment: record.review_comment || null,
        analysis: parseJsonField(record.analysis),
        training_plan: parseJsonField(record.training_plan),
      });
    } else {
      Object.assign(base, {
        content: record.content,
        analysis: parseJsonField(record.analysis),
        speaker_diagram: parseJsonField(record.speaker_diagram),
      });
    }

    res.json({ code: 0, data: base } as ApiResponse);
  } catch (err) {
    console.error('Debrief detail error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/analyze — 触发 AI 分析
router.post('/:id/analyze', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  try {
    const rows = await query(
      `SELECT user_id, title, content, transcript, status, analysis, training_plan, debrief_mode
       FROM debrief_records WHERE record_id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const record = rows[0];
    if (record.user_id !== userId && !['manager', 'admin'].includes(req.user!.role)) {
      return res.status(403).json({ code: 403000, message: '无权访问该记录' } as ApiResponse);
    }

    const inputText = [record.content, record.transcript].filter(Boolean).join('\n\n');
    if (!inputText.trim()) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '没有可分析的内容' } as ApiResponse);
    }

    const mode = record.debrief_mode || 'post_meeting';
    const result = await analyzeDebriefContent(inputText, mode);

    const analysisJson = JSON.stringify(result);
    const trainingPlanJson = JSON.stringify(result.trainingPlan || result.training_plan || {});

    await pool.execute(
      `UPDATE debrief_records SET analysis = ?, training_plan = ?, status = 'completed' WHERE record_id = ?`,
      [analysisJson, trainingPlanJson, id]
    );

    const updated = await query(
      `SELECT record_id, title, content, audio_path, transcript, analysis, training_plan, status, debrief_mode, speaker_diagram, created_at
       FROM debrief_records WHERE record_id = ?`,
      [id]
    );

    const data = {
      record_id: updated[0].record_id,
      title: updated[0].title,
      content: updated[0].content,
      audio_path: updated[0].audio_path,
      transcript: updated[0].transcript,
      analysis: typeof updated[0].analysis === 'string' ? JSON.parse(updated[0].analysis) : updated[0].analysis,
      training_plan: typeof updated[0].training_plan === 'string' ? JSON.parse(updated[0].training_plan) : updated[0].training_plan,
      status: updated[0].status,
      debrief_mode: updated[0].debrief_mode || 'post_meeting',
      speaker_diagram: updated[0].speaker_diagram ? (typeof updated[0].speaker_diagram === 'string' ? JSON.parse(updated[0].speaker_diagram) : updated[0].speaker_diagram) : null,
      created_at: updated[0].created_at ? new Date(updated[0].created_at).toISOString() : null,
    };

    res.json({ code: 0, data } as ApiResponse);
  } catch (err) {
    console.error('Debrief analyze error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/:id/status — ASR 处理状态
router.get('/:id/status', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const rows = await query(
      `SELECT dr.record_id, dr.status, dr.transcript, m.asr_engine, m.asr_task_id, m.error_code, m.error_message
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = rows[0];
    return res.json({
      code: 0,
      data: {
        record_id: record.record_id,
        status: record.status,
        transcript: record.transcript || undefined,
        asr_engine: record.asr_engine || undefined,
        asr_task_id: record.asr_task_id || undefined,
        error: record.error_code ? {
          code: record.error_code,
          message: record.error_message || ASR_ERROR_CODES[record.error_code as keyof typeof ASR_ERROR_CODES]?.message || '未知错误',
        } : undefined,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Status check error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/start-asr — 启动 ASR
router.post('/:id/start-asr', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const rows = await query(
      `SELECT dr.record_id, dr.status, dr.audio_path, m.audio_type
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = rows[0];
    if (record.status !== 'pending') {
      return res.json({ code: 0, data: { record_id: id, status: record.status } } as ApiResponse);
    }

    // 从 OSS 下载音频到本地临时文件
    const { getFileUrl, extractOssKey } = await import('../services/storage');
    const audioUrl = getFileUrl(record.audio_path);
    if (!audioUrl) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '音频路径不存在' } as ApiResponse);
    }
    const ossKey = extractOssKey(record.audio_path);
    const localFilePath = path.resolve(process.cwd(), 'uploads/tmp', path.basename(ossKey));
    const { downloadFromOss } = await import('../services/oss');
    await downloadFromOss(ossKey, localFilePath);

    await pool.execute("UPDATE debrief_records SET status = 'processing' WHERE record_id = ?", [id]);

    const engineRows = await query('SELECT setting_value FROM settings WHERE setting_key = ?', ['asr_engine']);
    const engine = engineRows[0]?.setting_value || 'whisper';

    try {
      let transcript: string;
      let segments: any[];
      if (engine === 'gpt') {
        const alignedResult = await transcribeWithAlignment(localFilePath, record.audio_type);
        transcript = alignedResult.transcript;
        segments = alignedResult.segments;
      } else {
        const result = await transcribeWithWhisper(localFilePath);
        transcript = result.transcript;
        segments = result.segments;
      }

      // Ensure debrief_practice_meta exists and save ASR segments
      await pool.execute(
        `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, asr_engine, transcript_segments)
         VALUES (?, 0, 'intro', ?, ?)
         ON DUPLICATE KEY UPDATE asr_engine = VALUES(asr_engine), transcript_segments = VALUES(transcript_segments)`,
        [id, engine, JSON.stringify(segments)]
      );
      await pool.execute(
        `UPDATE debrief_records SET status = ?, transcript = ? WHERE record_id = ?`,
        ['completed', transcript, id]
      );
      return res.json({ code: 0, data: { record_id: id, status: 'completed' } } as ApiResponse);
    } catch (asrErr) {
      console.error('ASR error:', asrErr);
      await pool.execute(
        "UPDATE debrief_records SET status = 'failed' WHERE record_id = ?",
        [id]
      );
      await pool.execute(
        `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, error_code, error_message)
         VALUES (?, 0, 'intro', ?, ?)
         ON DUPLICATE KEY UPDATE error_code = VALUES(error_code), error_message = VALUES(error_message)`,
        [id, 'WHISPER_FAILED', String(asrErr)]
      );
      return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: '语音识别失败' } as ApiResponse);
    }
  } catch (err) {
    console.error('Start ASR error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/retry-asr — 重试 ASR
router.post('/:id/retry-asr', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const rows = await query(
      `SELECT dr.record_id, dr.status, dr.audio_path, m.audio_type
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = rows[0];
    if (record.status !== 'failed') {
      return res.status(400).json({ code: ERR_RETRY_NOT_ALLOWED.code, message: ERR_RETRY_NOT_ALLOWED.message } as ApiResponse);
    }

    await pool.execute(
      "UPDATE debrief_records SET status = 'processing' WHERE record_id = ?",
      [id]
    );
    await pool.execute(
      'UPDATE debrief_practice_meta SET error_code = NULL, error_message = NULL WHERE record_id = ?',
      [id]
    );

    // 从 OSS 下载音频到本地临时文件
    const { getFileUrl: _getFileUrl2, extractOssKey: _extractOssKey2 } = await import('../services/storage');
    const _audioUrl2 = _getFileUrl2(record.audio_path);
    if (!_audioUrl2) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '音频路径不存在' } as ApiResponse);
    }
    const _ossKey2 = _extractOssKey2(record.audio_path);
    const localFilePath = path.resolve(process.cwd(), 'uploads/tmp', path.basename(_ossKey2));
    const { downloadFromOss: _downloadFromOss2 } = await import('../services/oss');
    await _downloadFromOss2(_ossKey2, localFilePath);

    const engineRows = await query('SELECT setting_value FROM settings WHERE setting_key = ?', ['asr_engine']);
    const engine = engineRows[0]?.setting_value || 'whisper';

    try {
      let transcript: string;
      let segments: any[];
      if (engine === 'gpt') {
        const alignedResult = await transcribeWithAlignment(localFilePath, record.audio_type);
        transcript = alignedResult.transcript;
        segments = alignedResult.segments;
      } else {
        const result = await transcribeWithWhisper(localFilePath);
        transcript = result.transcript;
        segments = result.segments;
      }

      // Ensure debrief_practice_meta exists and save ASR segments
      await pool.execute(
        `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, asr_engine, transcript_segments)
         VALUES (?, 0, 'intro', ?, ?)
         ON DUPLICATE KEY UPDATE asr_engine = VALUES(asr_engine), transcript_segments = VALUES(transcript_segments)`,
        [id, engine, JSON.stringify(segments)]
      );
      await pool.execute(
        `UPDATE debrief_records SET status = ?, transcript = ? WHERE record_id = ?`,
        ['completed', transcript, id]
      );
      return res.json({ code: 0, data: { record_id: id, status: 'completed' } } as ApiResponse);
    } catch (whisperErr) {
      console.error('Whisper retry error:', whisperErr);
      await pool.execute("UPDATE debrief_records SET status = 'failed' WHERE record_id = ?", [id]);
      await pool.execute(
        `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, error_code, error_message)
         VALUES (?, 0, 'intro', ?, ?)
         ON DUPLICATE KEY UPDATE error_code = VALUES(error_code), error_message = VALUES(error_message)`,
        [id, 'WHISPER_RETRY_FAILED', String(whisperErr)]
      );
      return res.status(500).json({
        code: ERR_INTERNAL_SERVER.code,
        message: 'Whisper 重试失败，请检查日志',
      } as ApiResponse);
    }
  } catch (err) {
    console.error('Retry ASR error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/summary — 获取历史汇总分析
router.get('/summary', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  try {
    const rows = await query(
      `SELECT analysis FROM debrief_records
       WHERE user_id = ? AND status = 'completed' AND analysis IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );

    const analyses = rows
      .map((r: any) => {
        try {
          return typeof r.analysis === 'string' ? JSON.parse(r.analysis) : r.analysis;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const summary = await summarizeDebriefAnalyses(analyses);

    res.json({ code: 0, data: { summary } } as ApiResponse);
  } catch (err) {
    console.error('Debrief summary error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/training-plan — AI 生成通用培训计划（按日缓存）
let trainingPlanCache: { date: string; data: unknown } | null = null;
router.get('/training-plan', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (trainingPlanCache && trainingPlanCache.date === today) {
      return res.json({ code: 0, data: trainingPlanCache.data } as ApiResponse);
    }

    const systemPrompt = `你是一位资深销售培训专家。请直接生成一份通用的销售培训计划（不基于任何具体员工的练习记录），包含以下三个部分：\n\n1. weekly：未来一周每日培训安排（周一到周日，每天一项）\n   - day: 周几\n   - title: 当日培训主题（具体、有吸引力）\n   - type: video | practice | test | recording | exam\n   - duration: 预计时长（如 "12分钟"、"15分钟"）\n\n2. monthly：月度阶段目标（共4周）\n   - week: 第几周（1-4）\n   - title: 阶段主题\n   - target: 量化目标（具体、可衡量）\n\n3. recommended_materials：推荐学习资料（AI生成，不关联真实数据库）\n   - material_id: 虚拟ID，如 "ai-1", "ai-2" 等\n   - title: 资料名称\n   - type: video | pdf | audio | article\n   - duration: 时长/页数（如 "12分钟"、"2页"、"5分钟阅读"）\n\n请确保内容专业、实用，覆盖销售技巧、产品知识、沟通能力、异议处理等维度。月度目标要有量化指标。\n\n必须严格按以下 JSON 格式返回，不要有任何额外说明：\n{\n  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],\n  "monthly": [{"week":1,"title":"...","target":"..."}, ...],\n  "recommended_materials": [{"material_id":"ai-1","title":"...","type":"video","duration":"..."}, ...]\n}`;

    const responseText = await callOpenAIChat(systemPrompt, '请生成一份销售培训计划');
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
    const planData = JSON.parse(jsonStr);

    trainingPlanCache = { date: today, data: planData };
    res.json({ code: 0, data: planData } as ApiResponse);
  } catch (err) {
    console.error('Training plan AI error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/:id/dialogue — 获取对话历史
router.get('/:id/dialogue', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const recordRows = await query('SELECT record_id FROM debrief_records WHERE record_id = ?', [id]);
    if (recordRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const roundRows = await query(
      `SELECT round_number, customer_question, sales_reply, difficulty, expected_focus,
              score, feedback, strengths, weaknesses, missed_points, reaction_ms, audio_reply_path
       FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC`,
      [id]
    );

    const dialogueRounds = roundRows.map((r: any) => ({
      round_number: r.round_number,
      customer_question: r.customer_question,
      sales_reply: r.sales_reply,
      difficulty: r.difficulty,
      expected_focus: r.expected_focus,
      score: r.score,
      feedback: r.feedback,
      strengths: parseJsonField(r.strengths) ?? [],
      weaknesses: parseJsonField(r.weaknesses) ?? [],
      missed_points: parseJsonField(r.missed_points) ?? [],
      reaction_ms: r.reaction_ms,
      audio_reply_path: r.audio_reply_path,
    }));

    res.json({ code: 0, data: { record_id: id, dialogue_rounds: dialogueRounds } } as ApiResponse);
  } catch (err) {
    console.error('Get dialogue error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/dialogue — 开始对话轮次
router.post('/:id/dialogue', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { round_number, role, status } = req.body as { round_number: number; role?: string; status?: string };

  if (!round_number || round_number < 1) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少有效的 round_number' } as ApiResponse);
  }

  try {
    const recordRows = await query(
      `SELECT dr.record_id, dr.status, dr.transcript, dr.debrief_mode, dr.product_line_id, m.product_line
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    // simulation 模式不需要 ASR，直接进入对话
    if (record.status !== 'completed' && record.debrief_mode !== 'simulation') {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '练习尚未完成ASR，无法进行对话' } as ApiResponse);
    }

    // 获取产品资料介绍文字（只取 product_lines.description）
    let productMaterialText = '';
    if (record.product_line_id) {
      const [productLineRows] = await pool.execute(
        `SELECT description FROM product_lines WHERE product_line_id = ? AND description IS NOT NULL AND description != ''`,
        [record.product_line_id]
      );
      if ((productLineRows as any[])[0]?.description) {
        productMaterialText = (productLineRows as any[])[0].description;
      }
    }

    const existingRounds = await query(
      'SELECT customer_question, sales_reply FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
      [id]
    );
    const conversationHistory = existingRounds.map((r: any) => ({
      customerQuestion: r.customer_question,
      salesReply: r.sales_reply || '',
    }));

    let difficulty: 'easy' | 'medium' | 'hard' = 'medium';

    // 如果是第1轮且没有历史对话，由销售先开场
    if (round_number === 1 && existingRounds.length === 0) {
      return res.json({
        code: 0,
        data: {
          round_number: 1,
          customer_question: '',
          difficulty: 'medium',
          expected_focus: '等待销售开场白',
          is_first_round: true,
        },
      } as ApiResponse);
    }

    const { generateCustomerQuestion } = await import('../services/dialogue');
    const result = await generateCustomerQuestion({
      round: round_number,
      weakPoints: [],
      conversationHistory,
      difficulty,
      productLine: record.product_line,
      transcript: record.transcript || '',
      productMaterialText,
      role,
      status,
    });

    const existing = await query(
      'SELECT round_number, customer_question, difficulty, expected_focus FROM dialogue_rounds WHERE record_id = ? AND round_number = ?',
      [id, round_number]
    );
    if (existing.length > 0) {
      const r = existing[0];
      return res.json({
        code: 0,
        data: {
          round_number,
          customer_question: r.customer_question,
          difficulty: r.difficulty,
          expected_focus: r.expected_focus,
        },
      } as ApiResponse);
    }

    await pool.execute(
      'INSERT INTO dialogue_rounds (record_id, round_number, customer_question, difficulty, expected_focus) VALUES (?, ?, ?, ?, ?)',
      [id, round_number, result.customerQuestion, result.difficulty, result.expectedFocus]
    );

    res.json({
      code: 0,
      data: {
        round_number,
        customer_question: result.customerQuestion,
        difficulty: result.difficulty,
        expected_focus: result.expectedFocus,
        is_last_round: false,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Dialogue error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/reply — 提交并评分
router.post('/:id/reply', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { round_number, reply } = req.body as { round_number: number; reply: string };

  if (!round_number || !reply) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 round_number 或 reply' } as ApiResponse);
  }

  try {
    const roundRows = await query(
      'SELECT customer_question, expected_focus, difficulty FROM dialogue_rounds WHERE record_id = ? AND round_number = ?',
      [id, round_number]
    );
    if (roundRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '对话轮次不存在' } as ApiResponse);
    }

    const { scoreSalesReply } = await import('../services/scoring');
    const round = roundRows[0];
    const scoringResult = await scoreSalesReply({
      customerQuestion: round.customer_question,
      salesReply: reply,
      weakPoints: [],
      round: round_number,
    });

    await pool.execute(
      'UPDATE dialogue_rounds SET sales_reply = ?, score = ?, feedback = ?, strengths = ?, weaknesses = ?, missed_points = ? WHERE record_id = ? AND round_number = ?',
      [reply, scoringResult.score, scoringResult.feedback, JSON.stringify(scoringResult.strengths), JSON.stringify(scoringResult.weaknesses), JSON.stringify(scoringResult.missedPoints), id, round_number]
    );

    res.json({
      code: 0,
      data: {
        round_number,
        score: scoringResult.score,
        feedback: scoringResult.feedback,
        strengths: scoringResult.strengths,
        weaknesses: scoringResult.weaknesses,
        missed_points: scoringResult.missedPoints,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Reply error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/voice-reply — 语音回复
router.post('/:id/voice-reply', authMiddleware, upload.single('audio'), requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const file = req.file;
  const round_number = parseInt(req.body.round_number as string, 10);

  if (!file) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少音频文件' } as ApiResponse);
  }
  if (!round_number || round_number < 1) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少有效的 round_number' } as ApiResponse);
  }

  try {
    const roundRows = await query(
      'SELECT round_number FROM dialogue_rounds WHERE record_id = ? AND round_number = ?',
      [id, round_number]
    );
    if (roundRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '对话轮次不存在' } as ApiResponse);
    }

    const ext = path.extname(file.originalname).toLowerCase().replace('.', '') || 'mp3';
    const audioSaveName = `voice_${id}_${round_number}.${ext}`;

    // 上传到 OSS
    const { uploadToOss } = await import('../services/oss');
    const ossKey = `voice-replies/${audioSaveName}`;
    const ossUrl = await uploadToOss(file.path, ossKey);

    // 下载到本地用于 ASR
    const { downloadFromOss } = await import('../services/oss');
    const localFilePath = path.resolve(process.cwd(), 'uploads/tmp', audioSaveName);
    await downloadFromOss(ossKey, localFilePath);

    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    const engineRows = await query('SELECT setting_value FROM settings WHERE setting_key = ?', ['asr_engine']);
    const engine = engineRows[0]?.setting_value || 'whisper';

    let transcript: string;
    if (engine === 'whisper' && isLocalWhisper()) {
      const result = await transcribeWithWhisper(localFilePath);
      transcript = result.transcript;
    } else {
      const result = await transcribeWithYunwu(localFilePath);
      transcript = result.transcript;
    }

    await pool.execute(
      'UPDATE dialogue_rounds SET sales_reply = ?, audio_reply_path = ? WHERE record_id = ? AND round_number = ?',
      [transcript, ossUrl, id, round_number]
    );

    res.json({
      code: 0,
      data: { round_number, transcript, saved: true },
    } as ApiResponse);
  } catch (err) {
    console.error('Voice reply error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/finish-dialogue — 结束对话并触发后台分析
router.post('/:id/finish-dialogue', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;

  try {
    const rows = await query('SELECT record_id, debrief_mode FROM debrief_records WHERE record_id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    // simulation 模式不生成报告，直接返回
    if (rows[0].debrief_mode === 'simulation') {
      return res.json({ code: 0 } as ApiResponse);
    }

    await pool.execute("UPDATE debrief_records SET status = 'analyzing' WHERE record_id = ?", [id]);

    res.json({ code: 0 } as ApiResponse);

    runBackgroundAnalysis(id).catch(async err => {
      console.error('Background analysis failed:', id, err);
      await pool.execute("UPDATE debrief_records SET status = 'failed' WHERE record_id = ?", [id]);
      await pool.execute(
        'UPDATE debrief_practice_meta SET error_code = ?, error_message = ? WHERE record_id = ?',
        ['ANALYSIS_FAILED', String(err), id]
      );
    });
  } catch (err) {
    console.error('Finish dialogue error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/save-reply — 保存回复（不评分）
router.post('/:id/save-reply', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { round_number, reply } = req.body as { round_number: number; reply: string };

  if (!round_number || !reply) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 round_number 或 reply' } as ApiResponse);
  }

  try {
    await pool.execute(
      'UPDATE dialogue_rounds SET sales_reply = ? WHERE record_id = ? AND round_number = ?',
      [reply, id, round_number]
    );
    res.json({ code: 0 } as ApiResponse);
  } catch (err) {
    console.error('Save reply error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

async function runBackgroundAnalysis(recordId: string) {
  const recordRows = await query(
    `SELECT dr.record_id, dr.transcript, m.product_line, m.fluency_score, m.duration, m.transcript_segments, m.audio_type
     FROM debrief_records dr
     LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
     WHERE dr.record_id = ?`,
    [recordId]
  );
  const record = recordRows[0];
  if (!record || !record.transcript) return;

  const roundRows = await query(
    `SELECT round_number, customer_question, sales_reply, difficulty, expected_focus, score, feedback, strengths, weaknesses, missed_points
     FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC`,
    [recordId]
  );

  const { scoreSalesReply } = await import('../services/scoring');
  const { calculateFluencyScore } = await import('../services/fluency-score');
  const { evaluatePractice } = await import('../services/evaluation');

  for (const round of roundRows) {
    if (round.score != null || !round.sales_reply) continue;
    try {
      const scoringResult = await scoreSalesReply({
        customerQuestion: round.customer_question,
        salesReply: round.sales_reply,
        weakPoints: [],
        round: round.round_number,
      });
      await pool.execute(
        'UPDATE dialogue_rounds SET score = ?, feedback = ?, strengths = ?, weaknesses = ?, missed_points = ? WHERE record_id = ? AND round_number = ?',
        [scoringResult.score, scoringResult.feedback, JSON.stringify(scoringResult.strengths), JSON.stringify(scoringResult.weaknesses), JSON.stringify(scoringResult.missedPoints), recordId, round.round_number]
      );
      round.score = scoringResult.score;
      round.feedback = scoringResult.feedback;
      round.strengths = scoringResult.strengths;
      round.weaknesses = scoringResult.weaknesses;
      round.missed_points = scoringResult.missedPoints;
    } catch (err) {
      console.error(`Failed to score round ${round.round_number}:`, err);
    }
  }

  const updatedRounds = await query(
    `SELECT round_number, customer_question, sales_reply, difficulty, expected_focus, score, feedback, strengths, weaknesses, missed_points
     FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC`,
    [recordId]
  );

  const segments = parseJsonField(record.transcript_segments) as any[] || [];
  const fluencyBreakdown = calculateFluencyScore(record.transcript, segments, record.duration || 0);
  const evaluation = await evaluatePractice(recordId, record.transcript, record.product_line, fluencyBreakdown, segments, record.audio_type);

  const dialogue_history = updatedRounds.map((r: any) => ({
    round_number: r.round_number,
    customer_question: r.customer_question,
    sales_reply: r.sales_reply,
    difficulty: r.difficulty,
    score: r.score,
    feedback: r.feedback,
    strengths: parseJsonField(r.strengths) ?? [],
    weaknesses: parseJsonField(r.weaknesses) ?? [],
    missed_points: parseJsonField(r.missed_points) ?? [],
  }));

  const weakPoints: string[] = [];
  for (const round of updatedRounds) {
    const ws = parseJsonField(round.weaknesses) as string[];
    const ms = parseJsonField(round.missed_points) as string[];
    if (ws) weakPoints.push(...ws);
    if (ms) weakPoints.push(...ms);
  }
  const uniqueWeakPoints = [...new Set(weakPoints)];
  const weakPointsDesc = uniqueWeakPoints.length > 0 ? uniqueWeakPoints.join('、') : '暂无明确薄弱点，请生成通用销售提升计划';

  const trainingPlanPrompt = `你是一位资深销售培训专家。基于以下练习情况生成个性化培训计划。\n\n产品：${record.product_line}\n薄弱点：${weakPointsDesc}\n各轮得分：${updatedRounds.map((r: any) => `第${r.round_number}轮 ${r.score ?? '未评分'}分`).join('、')}\n\n输出 JSON：\n{\n  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],\n  "monthly": [{"week":1,"title":"...","target":"..."}, ...],\n  "recommendations": [{"topic":"...","reason":"..."}, ...]\n}`;

  let trainingPlan = null;
  try {
    const planText = await callOpenAIChat(trainingPlanPrompt, '请生成培训计划');
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (jsonMatch) trainingPlan = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Training plan generation failed:', err);
  }

  // 5. Query real training materials and merge into training plan
  if (trainingPlan) {
    try {
      const materialRows = await query(
        `SELECT material_id, title, type, duration, file_url, description
         FROM training_materials WHERE status = 'active' ORDER BY created_at DESC LIMIT 10`
      );
      trainingPlan.recommended_materials = materialRows.map((m: any) => ({
        material_id: m.material_id,
        title: m.title,
        type: m.type,
        duration: m.duration || '',
        file_url: m.file_url || '',
        description: m.description || '',
      }));
    } catch (err) {
      console.error('Query training materials failed:', err);
      trainingPlan.recommended_materials = [];
    }
  }

  const evalOverallScore = evaluation.overallScore ?? null;
  const fullEvaluation = { ...evaluation, dialogue_history };

  // Ensure debrief_practice_meta row exists before updating (handles migrated old records)
  await pool.execute(
    `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, evaluation_result, overall_score)
     VALUES (?, 0, 'intro', ?, ?)
     ON DUPLICATE KEY UPDATE evaluation_result = VALUES(evaluation_result), overall_score = VALUES(overall_score)`,
    [recordId, JSON.stringify(fullEvaluation), evalOverallScore]
  );
  await pool.execute(
    `UPDATE debrief_records SET training_plan = ?, status = ? WHERE record_id = ?`,
    [trainingPlan ? JSON.stringify(trainingPlan) : null, 'completed', recordId]
  );

  const { sendReportNotification } = await import('../services/notify');
  sendReportNotification(recordId).catch(err => {
    console.error('Notification failed:', err);
  });
}

// GET /debriefs/:id/evaluation — 获取评估报告
router.get('/:id/evaluation', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const recordRows = await query(
      `SELECT dr.record_id, dr.transcript, dr.status, m.product_line, m.fluency_score, m.duration,
              m.evaluation_result, m.transcript_segments, m.pre_analysis, m.initial_scores, m.audio_type
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    if (record.status !== 'completed') {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '练习尚未完成ASR，无法评估' } as ApiResponse);
    }
    if (!record.transcript) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '转录文本为空' } as ApiResponse);
    }

    const roundRows = await query(
      `SELECT round_number, customer_question, sales_reply, difficulty, expected_focus, score, feedback,
              strengths, weaknesses, missed_points, reaction_ms, difficulty_adjusted
       FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC`,
      [id]
    );

    const totalRounds = roundRows.length;
    const scoredRounds = roundRows.filter((r: any) => r.score != null);
    const avgScore = totalRounds > 0
      ? Math.round(scoredRounds.reduce((sum: number, r: any) => sum + (r.score || 0), 0) / totalRounds)
      : 0;
    const avgReactionMs = totalRounds > 0
      ? Math.round(roundRows.reduce((sum: number, r: any) => sum + (r.reaction_ms || 0), 0) / totalRounds)
      : 0;
    const hitCount = scoredRounds.filter((r: any) => r.score >= 60).length;
    const missCount = totalRounds - hitCount;
    const difficultyProgression = roundRows.map((r: any) => r.difficulty);
    const topicSwitches = scoredRounds.filter((r: any) => r.difficulty_adjusted).length;

    const conversationMetrics = {
      total_rounds: totalRounds,
      avg_reaction_ms: avgReactionMs,
      hit_count: hitCount,
      miss_count: missCount,
      difficulty_progression: difficultyProgression,
      topic_switches: topicSwitches,
    };

    const dialogue_history = roundRows.map((r: any) => ({
      round_number: r.round_number,
      customer_question: r.customer_question,
      sales_reply: r.sales_reply,
      difficulty: r.difficulty,
      score: r.score,
      feedback: r.feedback,
      strengths: parseJsonField(r.strengths) ?? [],
      weaknesses: parseJsonField(r.weaknesses) ?? [],
      missed_points: parseJsonField(r.missed_points) ?? [],
    }));

    // 聚合对话中的薄弱点
    const dialogueWeakPoints: string[] = [];
    for (const r of roundRows) {
      const ws = parseJsonField(r.weaknesses) as string[] || [];
      const ms = parseJsonField(r.missed_points) as string[] || [];
      dialogueWeakPoints.push(...ws, ...ms);
    }
    const uniqueDialogueWeakPoints = [...new Set(dialogueWeakPoints)];

    // 查询训练计划
    const trainingPlanRows = await query('SELECT training_plan FROM debrief_records WHERE record_id = ?', [id]);
    const trainingPlan = parseJsonField(trainingPlanRows[0]?.training_plan);

    const initialScores = parseJsonField(record.initial_scores) as Record<string, number> | null;

    if (record.evaluation_result) {
      const evaluationResult = parseJsonField(record.evaluation_result) as any;
      let scoreChanges: Record<string, { before: number; after: number; change: number }> | null = null;
      if (initialScores && evaluationResult?.scores) {
        scoreChanges = {};
        for (const key of Object.keys(evaluationResult.scores)) {
          const before = initialScores[key] ?? 0;
          const after = evaluationResult.scores[key] ?? 0;
          scoreChanges[key] = { before, after, change: after - before };
        }
      }

      return res.json({
        code: 0,
        data: {
          record_id: record.record_id,
          audio_type: record.audio_type,
          ...evaluationResult,
          initial_scores: initialScores,
          initial_overall_score: initialScores
            ? Math.round((initialScores.knowledgeCoverage + initialScores.coreHitRate + initialScores.dataAccuracy + initialScores.scriptMatch + initialScores.structureScore) / 5)
            : null,
          conversation_metrics: conversationMetrics,
          dialogue_history: evaluationResult.dialogue_history || dialogue_history,
          dialogue_weak_points: uniqueDialogueWeakPoints,
          training_plan: trainingPlan,
          score_changes: scoreChanges,
        },
      } as ApiResponse);
    }

    const segments = parseJsonField(record.transcript_segments) as any[] || [];
    const { calculateFluencyScore } = await import('../services/fluency-score');
    const { evaluatePractice } = await import('../services/evaluation');
    const fluencyBreakdown = calculateFluencyScore(record.transcript, segments, record.duration || 0);
    const evaluation = await evaluatePractice(id, record.transcript, record.product_line, fluencyBreakdown, segments, record.audio_type);

    let scoreChanges: Record<string, { before: number; after: number; change: number }> | null = null;
    if (initialScores) {
      scoreChanges = {};
      for (const key of Object.keys(evaluation.scores)) {
        const before = initialScores[key as keyof typeof initialScores] ?? 0;
        const after = evaluation.scores[key as keyof typeof evaluation.scores] ?? 0;
        scoreChanges[key] = { before, after, change: after - before };
      }
    }

    const fullEvaluation = {
      ...evaluation,
      initial_scores: initialScores,
      initial_overall_score: initialScores
        ? Math.round((initialScores.knowledgeCoverage + initialScores.coreHitRate + initialScores.dataAccuracy + initialScores.scriptMatch + initialScores.structureScore) / 5)
        : null,
      conversation_metrics: conversationMetrics,
      dialogue_history,
      dialogue_weak_points: uniqueDialogueWeakPoints,
      training_plan: trainingPlan,
      score_changes: scoreChanges,
    };

    const evalOverallScore = fullEvaluation.overallScore ?? null;
    // Ensure debrief_practice_meta row exists before updating (handles migrated old records)
    await pool.execute(
      `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, evaluation_result, overall_score, conversation_metrics)
       VALUES (?, 0, 'intro', ?, ?, ?)
       ON DUPLICATE KEY UPDATE evaluation_result = VALUES(evaluation_result), overall_score = VALUES(overall_score), conversation_metrics = VALUES(conversation_metrics)`,
      [id, JSON.stringify(fullEvaluation), evalOverallScore, JSON.stringify(conversationMetrics)]
    );

    res.json({
      code: 0,
      data: {
        record_id: record.record_id,
        audio_type: record.audio_type,
        ...fullEvaluation,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Evaluation error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

// PUT /debriefs/:id/evaluation — 主管修改评估
router.put('/:id/evaluation', authMiddleware, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const user = req.user;

  if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
    return res.status(403).json({ code: 403000, message: '仅主管可操作' } as ApiResponse);
  }

  const { evaluation } = req.body;
  if (!evaluation) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 evaluation' } as ApiResponse);
  }

  try {
    const rows = await query('SELECT 1 FROM debrief_records WHERE record_id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const evalJson = JSON.stringify(evaluation);
    const overallScore = evaluation?.overallScore ?? null;

    await pool.execute(
      `UPDATE debrief_practice_meta SET evaluation_result = ?, overall_score = ? WHERE record_id = ?`,
      [evalJson, overallScore, id]
    );

    res.json({ code: 0, message: 'ok' } as ApiResponse);
  } catch (err) {
    console.error('Update evaluation error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/:id/pre-analysis — 获取预分析
router.get('/:id/pre-analysis', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const recordRows = await query(
      `SELECT dr.record_id, dr.transcript, dr.status, m.product_line, m.fluency_score, m.duration,
              m.transcript_segments, m.pre_analysis, m.initial_scores
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    if (!record.transcript) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '转录文本为空' } as ApiResponse);
    }

    const cachedPreAnalysis = parseJsonField(record.pre_analysis);
    const cachedInitialScores = parseJsonField(record.initial_scores) as Record<string, number> | null;

    if (cachedPreAnalysis && cachedInitialScores) {
      return res.json({
        code: 0,
        data: {
          record_id: record.record_id,
          pre_analysis: cachedPreAnalysis,
          initial_scores: cachedInitialScores,
          initial_overall_score: Math.round(
            (cachedInitialScores.knowledgeCoverage + cachedInitialScores.coreHitRate + cachedInitialScores.dataAccuracy + cachedInitialScores.scriptMatch + cachedInitialScores.structureScore) / 5
          ),
        },
      } as ApiResponse);
    }

    const segments = parseJsonField(record.transcript_segments) as any[] || [];
    const { calculateFluencyScore } = await import('../services/fluency-score');
    const { runPreAnalysis } = await import('../services/pre-analysis');
    const fluencyBreakdown = calculateFluencyScore(record.transcript, segments, record.duration || 0);
    const preAnalysisResult = await runPreAnalysis(id, record.transcript, record.product_line, record.fluency_score || fluencyBreakdown.score, segments);

    const preAnalysisJson = JSON.stringify(preAnalysisResult);
    const initialScores = preAnalysisResult.initial_scores;

    await pool.execute(
      `UPDATE debrief_practice_meta SET pre_analysis = ?, initial_scores = ? WHERE record_id = ?`,
      [preAnalysisJson, JSON.stringify(initialScores), id]
    );

    res.json({
      code: 0,
      data: {
        record_id: record.record_id,
        pre_analysis: preAnalysisResult,
        initial_scores: initialScores,
        initial_overall_score: Math.round(
          (initialScores.knowledgeCoverage + initialScores.coreHitRate + initialScores.dataAccuracy + initialScores.scriptMatch + initialScores.structureScore) / 5
        ),
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Pre-analysis error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/:id/training-plan — 基于评估报告生成个性化训练计划
router.get('/:id/training-plan', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const recordRows = await query(
      `SELECT dr.record_id, dr.transcript, m.product_line
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const dialogueRows = await query(
      `SELECT round_number, customer_question, sales_reply, score, feedback, weaknesses, missed_points
       FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC`,
      [id]
    );

    const weakPoints: string[] = [];
    for (const round of dialogueRows) {
      const ws = parseJsonField(round.weaknesses) as string[];
      const ms = parseJsonField(round.missed_points) as string[];
      if (ws) weakPoints.push(...ws);
      if (ms) weakPoints.push(...ms);
    }

    const uniqueWeakPoints = [...new Set(weakPoints)];
    const roundsSummary = dialogueRows.map((r: any) => ({
      round: r.round_number,
      score: r.score,
      weaknesses: r.weaknesses,
      missedPoints: r.missed_points,
    }));

    const summaryText = JSON.stringify({
      productLine: record.product_line,
      transcript: record.transcript?.substring(0, 2000) || '',
      dialogueRounds: roundsSummary,
      weakPoints: uniqueWeakPoints,
    }, null, 2);

    const weakPointsDesc = uniqueWeakPoints.length > 0
      ? uniqueWeakPoints.join('、')
      : '暂无明确薄弱点，请生成通用销售提升计划';

    const systemPrompt = `你是一位资深销售培训专家。请基于以下员工的练习情况，生成一份个性化的培训计划。\n\n产品：${record.product_line}\n薄弱点：${weakPointsDesc}\n对话轮次：${roundsSummary.length} 轮\n各轮得分：${roundsSummary.map((r: any) => `第${r.round}轮 ${r.score ?? '未评分'}分`).join('、')}\n\n详细数据：\n${summaryText}\n\n请生成以下内容：\n\n1. weekly：未来一周每日培训安排（周一到周日，每天一项）\n   - day: 周几\n   - title: 当日培训主题（具体、有针对性）\n   - type: video | practice | test | recording | exam\n   - duration: 预计时长（如 "12分钟"、"15分钟"）\n\n2. monthly：月度阶段目标（共4周）\n   - week: 第几周（1-4）\n   - title: 阶段主题\n   - target: 量化目标（具体、可衡量）\n\n3. recommendations：个性化学习建议\n   - topic: 学习方向/主题\n   - reason: 为什么需要学这个方向（基于练习中的具体薄弱点）\n\n必须严格按以下 JSON 格式返回，不要有任何额外说明：\n{\n  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],\n  "monthly": [{"week":1,"title":"...","target":"..."}, ...],\n  "recommendations": [{"topic":"...","reason":"..."}, ...]\n}`;

    const responseText = await callOpenAIChat(systemPrompt, '请基于练习情况生成个性化培训计划');
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
    const planData = JSON.parse(jsonStr);

    res.json({ code: 0, data: planData } as ApiResponse);
  } catch (err) {
    console.error('Training plan error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/team — 团队复盘列表
router.get('/team', authMiddleware, async (req: AuthRequest, res) => {
  const { page = '1', limit = '20' } = req.query;
  const user = req.user!;

  if (user.role !== 'manager' && user.role !== 'admin') {
    return res.status(403).json({ code: 403000, message: '权限不足' } as ApiResponse);
  }

  try {
    const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);

    let managerFilter = '';
    const managerParams: any[] = [];
    if (user.role === 'manager') {
      managerFilter = `AND (u.user_id = ? OR u.manager_id = ?)`;
      managerParams.push(user.userId, user.userId);
    }

    const countRows = await query(
      `SELECT COUNT(*) as total FROM debrief_records dr
       JOIN users u ON dr.user_id = u.user_id
       WHERE u.status = 'active' AND dr.debrief_mode = 'call_recording' ${managerFilter}`,
      [...managerParams]
    );

    const listRows = await query(
      `SELECT
         dr.record_id,
         dr.user_id,
         u.name as user_name,
         u.employee_id,
         m.product_line,
         m.practice_type,
         dr.status,
         m.duration,
         m.overall_score,
         m.fluency_score,
         m.weak_points,
         m.evaluation_result,
         m.is_showcase,
         dr.created_at
       FROM debrief_records dr
       JOIN users u ON dr.user_id = u.user_id
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE u.status = 'active' AND dr.debrief_mode = 'call_recording' ${managerFilter}
       ORDER BY dr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...managerParams, parseInt(limit as string, 10), offset]
    );

    const list = listRows.map((row: any) => {
      let weakPoints: Array<{ name: string; severity: string }> = [];
      if (row.evaluation_result) {
        const evalResult = parseJsonField(row.evaluation_result) as any;
        if (evalResult?.weakPoints) {
          weakPoints = evalResult.weakPoints.map((wp: any) => ({ name: wp.name, severity: wp.severity }));
        }
      } else if (row.weak_points) {
        const raw = parseJsonField(row.weak_points) as string[];
        weakPoints = raw.map((name: string) => ({ name, severity: 'medium' }));
      }

      return {
        record_id: row.record_id,
        user_id: row.user_id,
        user_name: row.user_name,
        employee_id: row.employee_id,
        product_line: row.product_line,
        practice_type: row.practice_type,
        status: row.status,
        duration: row.duration,
        overall_score: row.overall_score != null ? Number(row.overall_score) : null,
        fluency_score: row.fluency_score,
        weak_points: weakPoints,
        is_showcase: !!row.is_showcase,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      };
    });

    res.json({
      code: 0,
      data: { list, total: parseInt(countRows[0].total, 10) },
    } as ApiResponse);
  } catch (err) {
    console.error('Team list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/showcase — 优秀录音列表
router.get('/showcase', authMiddleware, async (req: AuthRequest, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 6;
  try {
    const rows = await query(
      `SELECT dr.record_id, u.name as user_name, m.product_line, m.overall_score,
              dr.audio_path, m.duration, dr.created_at, m.showcase_comment
       FROM debrief_records dr
       JOIN users u ON dr.user_id = u.user_id
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE m.is_showcase = 1 AND dr.status = 'completed' AND dr.debrief_mode = 'call_recording'
       ORDER BY m.overall_score DESC
       LIMIT ?`,
      [limit]
    );
    const list = rows.map((r: any) => ({
      record_id: r.record_id,
      user_name: r.user_name,
      product_line: r.product_line,
      overall_score: r.overall_score ? Number(r.overall_score) : null,
      audio_url: normalizeAudioUrl(r.audio_path),
      duration: r.duration,
      created_at: r.created_at,
      comment: r.showcase_comment || undefined,
    }));
    res.json({ code: 0, data: { list } } as ApiResponse);
  } catch (err) {
    console.error('Showcase list error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/showcase — 标记/取消优秀录音
router.post('/:id/showcase', authMiddleware, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const user = req.user;

  if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
    return res.status(403).json({ code: 403000, message: '仅主管可操作' } as ApiResponse);
  }

  try {
    const rows = await query(
      `SELECT dr.record_id, dr.status, m.is_showcase
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    if (rows[0].status !== 'completed') {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '只能标记已完成的练习' } as ApiResponse);
    }

    const newShowcase = rows[0].is_showcase ? 0 : 1;
    const { comment } = req.body;

    if (newShowcase === 0) {
      await pool.execute(
        'UPDATE debrief_practice_meta SET is_showcase = ?, showcase_comment = NULL WHERE record_id = ?',
        [newShowcase, id]
      );
    } else {
      await pool.execute(
        'UPDATE debrief_practice_meta SET is_showcase = ?, showcase_comment = ? WHERE record_id = ?',
        [newShowcase, comment || null, id]
      );
    }

    res.json({ code: 0, message: 'ok', data: { is_showcase: !!newShowcase } } as ApiResponse);
  } catch (err) {
    console.error('Showcase error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/review — 主管点评
router.post('/:id/review', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { comment } = req.body as { comment?: string };

  if (!comment) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 comment' } as ApiResponse);
  }

  try {
    const rows = await query('SELECT record_id FROM debrief_records WHERE record_id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    await pool.execute(
      'UPDATE debrief_practice_meta SET review_comment = ? WHERE record_id = ?',
      [comment, id]
    );

    res.json({ code: 0, message: 'ok' } as ApiResponse);
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// DELETE /debriefs/:id — 删除记录
router.delete('/:id', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const [result]: any = await pool.execute(
      'DELETE FROM debrief_records WHERE record_id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Delete debrief error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/dialogue-training — 对话训练（轻量生成，不保存）
router.post('/:id/dialogue-training', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { round_number, previous_dialogues } = req.body as {
    round_number?: number;
    previous_dialogues?: Array<{ customer_question: string; sales_reply: string }>;
  };

  try {
    const recordRows = await query(
      `SELECT m.product_line, m.evaluation_result
       FROM debrief_records dr
       LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
       WHERE dr.record_id = ?`,
      [id]
    );
    if (recordRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = recordRows[0];

    let weakPoints: string[] = [];
    if (record.evaluation_result) {
      const evalResult = parseJsonField(record.evaluation_result) as any;
      if (evalResult?.weakPoints) {
        weakPoints = evalResult.weakPoints.map((wp: any) => wp.name);
      }
    }

    const plRows = await query(
      'SELECT product_line_id FROM product_lines WHERE name = ? AND status = ?',
      [record.product_line, 'active']
    );
    const productLineId = plRows.length > 0 ? plRows[0].product_line_id : null;

    const [spRows, scriptsRows, specsRows, scenariosRows, knowledgeRows] = await Promise.all([
      query(
        "SELECT title, description FROM selling_points WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY priority DESC LIMIT 10",
        [productLineId]
      ),
      query(
        "SELECT title, scene, content FROM sales_scripts WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY created_at DESC LIMIT 5",
        [productLineId]
      ),
      query(
        "SELECT spec_name, spec_value, unit FROM product_specs WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY created_at DESC LIMIT 10",
        [productLineId]
      ),
      query(
        "SELECT title, scene_type, content FROM sales_scenarios WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY created_at DESC LIMIT 5",
        [productLineId]
      ),
      query(
        "SELECT title, content, category FROM product_knowledge WHERE status = 'active' AND (product_line_id = ? OR product_line_id IS NULL) ORDER BY updated_at DESC LIMIT 10",
        [productLineId]
      ),
    ]);

    const sellingPointsText = spRows.map((r: any) => `- ${r.title}: ${r.description?.substring(0, 100)}`).join('\n');
    const scriptsText = scriptsRows.map((r: any) => `- [${r.scene || '通用'}] ${r.title}: ${r.content?.substring(0, 150)}`).join('\n');
    const specsText = specsRows.map((r: any) => `- ${r.spec_name}: ${r.spec_value}${r.unit ? ' ' + r.unit : ''}`).join('\n');
    const scenariosText = scenariosRows.map((r: any) => `- [${r.scene_type || '通用'}] ${r.title}: ${r.content?.substring(0, 150)}`).join('\n');
    const knowledgeText = knowledgeRows.map((r: any) => `- [${r.category || '通用'}] ${r.title}: ${r.content?.substring(0, 150)}`).join('\n');

    let persuasionScore = 0;
    const dialogues = previous_dialogues || [];
    let consecutiveNoProductMention = 0;

    for (const round of dialogues) {
      const reply = round.sales_reply || '';
      const cq = round.customer_question;
      if (!reply.trim()) continue;

      persuasionScore += 5;
      if (reply.length < 10) persuasionScore -= 5;
      if (/爱买不买|买不起|别问|不知道|不关我事|随便你|懒得|废话/.test(reply)) persuasionScore -= 20;
      if (/贵|便宜|价格|多少钱/.test(cq) && !/\d|元|块|钱|价格|成本|性价比|划算|值/.test(reply)) persuasionScore -= 10;
      if (/坏|质量|容易|耐用|维修|售后|质保/.test(cq) && !/质保|保修|技术|认证|稳定|三年|五年|网点|服务/.test(reply)) persuasionScore -= 10;
      if (/纳滤|NF/.test(knowledgeText) && /RO反渗透|反渗透.*过滤|RO膜/.test(reply) && !/纳滤/.test(reply)) persuasionScore -= 15;
      if (/3秒|三秒/.test(knowledgeText) && /5秒|五秒|10秒|十几秒|一分钟/.test(reply)) persuasionScore -= 15;
      if (/699/.test(knowledgeText) && /299|399|499|899|999/.test(reply)) persuasionScore -= 15;
      if (/\d/.test(reply)) persuasionScore += 5;

      const hasProductMention = /纳滤|RO|反渗透|过滤精度|3秒|即热|无储水|千滚水|废水比|通量|滤芯|TDS|质保|服务网点|400/.test(reply);
      if (hasProductMention) {
        persuasionScore += 8;
        consecutiveNoProductMention = 0;
      } else {
        consecutiveNoProductMention++;
      }
      if (consecutiveNoProductMention >= 2) {
        persuasionScore -= 5;
        consecutiveNoProductMention = 0;
      }
      if (/今天|明天|下单|安装|定.*一台|送|活动|优惠|试用|7天|30天|无理由|包换|退货|不满意/.test(reply)) persuasionScore += 10;
      if (/贵|便宜|价格|多少钱|成本/.test(cq) && /值|对比|划算|省|抵|送|一天|成本|性价比|算下来/.test(reply)) persuasionScore += 10;
      if (/坏|质量|容易|耐用|维修|售后/.test(cq) && /质保|保修|技术|认证|稳定|大厂|客户|网点/.test(reply)) persuasionScore += 10;
      if (/竞品|别家|美的|网上|两千|牌子|品牌/.test(cq) && /对比|区别|差异|不如|比不上|更|优势/.test(reply)) persuasionScore += 10;
      if (/考虑|比比|看看|再说|商量|想想/.test(cq) && /今天|活动|明天|限量|抓紧|过期|恢复原价/.test(reply)) persuasionScore += 12;
    }
    const lastReply = dialogues[dialogues.length - 1]?.sales_reply || '';
    if (/定一台|买一台|今天定|明天装|开票|下单|签合同|付款/.test(lastReply)) persuasionScore += 15;
    persuasionScore = Math.max(0, Math.min(persuasionScore, 100));

    let attitudeHint = '';
    if (persuasionScore >= 70) {
      attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你已经被打动了，态度明显软化，基本决定购买。如果销售再给一个台阶（如促成下单、强调活动期限），你顺势说出"那就定一台"或"帮我安排安装"即可。`;
    } else if (persuasionScore >= 45) {
      attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你态度有所松动，但仍有些犹豫。可以稍微软化质疑力度，但不要轻易同意购买。`;
    } else {
      attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你仍然很怀疑，继续刁难，保持质疑。`;
    }

    let previousDialoguesText: string;
    if (!previous_dialogues || previous_dialogues.length === 0) {
      previousDialoguesText = '（这是第一轮）';
    } else if (previous_dialogues.length <= 10) {
      previousDialoguesText = previous_dialogues
        .map((d, i) => `第${i + 1}轮：\n客户：${d.customer_question}\n销售：${d.sales_reply}`)
        .join('\n\n');
    } else {
      const earlier = previous_dialogues.slice(0, -5);
      const recent = previous_dialogues.slice(-5);
      const earlierSummary = earlier.map((d, i) => {
        const cq = d.customer_question.length > 15 ? d.customer_question.substring(0, 15) + '...' : d.customer_question;
        const sr = d.sales_reply.length > 20 ? d.sales_reply.substring(0, 20) + '...' : d.sales_reply;
        return `第${i + 1}轮：客户"${cq}"，销售回应"${sr}"`;
      }).join('\n');
      const recentText = recent.map((d, i) => {
        const actualRound = previous_dialogues.length - 5 + i + 1;
        return `第${actualRound}轮：\n客户：${d.customer_question}\n销售：${d.sales_reply}`;
      }).join('\n\n');
      previousDialoguesText = ` earlier rounds summary：\n${earlierSummary}\n\n recent 5 rounds：\n${recentText}`;
    }

    const systemPrompt = `你是一位模拟真实客户的 AI，正在参与销售培训练习。当前是第 ${round_number ?? 1} 轮对话。\n\n产品信息：\n${knowledgeText}\n\n卖点：\n${sellingPointsText}\n\n话术脚本：\n${scriptsText}\n\n规格参数：\n${specsText}\n\n销售场景：\n${scenariosText}\n\n销售人员薄弱点（请重点围绕这些方向提问/反驳）：\n${weakPoints.length > 0 ? weakPoints.join('、') : '暂无'}\n\n之前对话：\n${previousDialoguesText}${attitudeHint}\n\n请扮演一个真实的潜在客户，根据销售人员的回复继续对话。你的回复应自然、口语化，可以有适度的质疑、犹豫或兴趣。如果销售已经较好回应了你的问题，你可以稍微软化态度；如果销售回答不到位，请继续追问或表示不满。\n\n请只输出客户说的话，不要有任何额外说明。`;

    const responseText = await callOpenAIChat(systemPrompt, '请继续扮演客户进行对话练习');
    res.json({ code: 0, data: { customer_question: responseText.trim(), persuasion_score: persuasionScore } } as ApiResponse);
  } catch (err) {
    console.error('Dialogue training error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/simulation/send — 模拟对话：用户发送消息，AI 回应
router.post('/:id/simulation/send', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { sales_message, role, status, difficulty } = req.body as { sales_message?: string; role?: string; status?: string; difficulty?: string };

  if (!sales_message || !sales_message.trim()) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 sales_message' } as ApiResponse);
  }

  try {
    const recordRows = await query(
      `SELECT dr.record_id, dr.debrief_mode, dr.product_line_id
       FROM debrief_records dr
       WHERE dr.record_id = ?`,
      [id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    // 获取当前最大轮次
    const maxRoundRows = await query(
      'SELECT COALESCE(MAX(round_number), 0) as max_round FROM dialogue_rounds WHERE record_id = ?',
      [id]
    );
    const currentRoundNumber = (maxRoundRows[0]?.max_round ?? 0) + 1;

    // 保存销售消息到新轮次
    await pool.execute(
      'INSERT INTO dialogue_rounds (record_id, round_number, customer_question, sales_reply, difficulty) VALUES (?, ?, ?, ?, ?)',
      [id, currentRoundNumber, '', sales_message.trim(), difficulty || 'medium']
    );

    // 获取对话历史（用于AI上下文）
    const historyRows = await query(
      'SELECT customer_question, sales_reply FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
      [id]
    );
    const conversationHistory = historyRows.map((r: any) => ({
      customerQuestion: r.customer_question || '',
      salesReply: r.sales_reply || '',
    }));

    // 获取产品资料
    let productMaterialText = '';
    if (record.product_line_id) {
      const [productLineRows] = await pool.execute(
        `SELECT description FROM product_lines WHERE product_line_id = ? AND description IS NOT NULL AND description != ''`,
        [record.product_line_id]
      );
      if ((productLineRows as any[])[0]?.description) {
        productMaterialText = (productLineRows as any[])[0].description;
      }
    }

    // 调用 AI 生成客户回应
    const { generateCustomerQuestion } = await import('../services/dialogue');
    const result = await generateCustomerQuestion({
      role,
      status,
      productMaterialText,
      conversationHistory,
      difficulty: (difficulty as 'easy' | 'medium' | 'hard') || 'medium',
    });

    // 更新当前轮次的 customer_question
    await pool.execute(
      'UPDATE dialogue_rounds SET customer_question = ? WHERE record_id = ? AND round_number = ?',
      [result.customerQuestion, id, currentRoundNumber]
    );

    res.json({
      code: 0,
      data: {
        round_number: currentRoundNumber,
        customer_question: result.customerQuestion,
        is_convinced: result.isConvinced,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Simulation send error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// POST /debriefs/:id/simulation/finish — 结束模拟对话并评估
router.post('/:id/simulation/finish', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;

  try {
    const recordRows = await query('SELECT record_id FROM debrief_records WHERE record_id = ?', [id]);
    if (recordRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    // 获取完整对话历史
    const historyRows = await query(
      'SELECT customer_question, sales_reply FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
      [id]
    );
    const conversationHistory = historyRows.map((r: any) => ({
      customerQuestion: r.customer_question || '',
      salesReply: r.sales_reply || '',
    }));

    // 调用 AI 评估
    const { evaluateSimulation } = await import('../services/dialogue');
    const evalResult = await evaluateSimulation({ conversationHistory });

    // 保存评估结果到 debrief_practice_meta
    await pool.execute(
      `INSERT INTO debrief_practice_meta (record_id, duration, practice_type, evaluation_result, overall_score)
       VALUES (?, 0, 'simulation', ?, ?)
       ON DUPLICATE KEY UPDATE evaluation_result = VALUES(evaluation_result), overall_score = VALUES(overall_score)`,
      [id, JSON.stringify(evalResult), evalResult.score]
    );

    res.json({
      code: 0,
      data: evalResult,
    } as ApiResponse);
  } catch (err) {
    console.error('Simulation finish error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// GET /debriefs/:id/simulation — 获取模拟对话历史
router.get('/:id/simulation', authMiddleware, requireDebriefOwnerOrManager, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const recordRows = await query('SELECT record_id FROM debrief_records WHERE record_id = ?', [id]);
    if (recordRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const roundRows = await query(
      'SELECT round_number, customer_question, sales_reply FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
      [id]
    );

    const rounds = roundRows.map((r: any) => ({
      round_number: r.round_number,
      customer_question: r.customer_question,
      sales_reply: r.sales_reply,
    }));

    res.json({
      code: 0,
      data: { record_id: id, rounds },
    } as ApiResponse);
  } catch (err) {
    console.error('Get simulation error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

export default router;
