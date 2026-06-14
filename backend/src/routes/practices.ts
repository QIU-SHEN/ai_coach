import { Router, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { pool, parseJsonRows } from '../db';
import { saveUpload, extractOssKey } from '../services/storage';
import { downloadFromOss } from '../services/oss';
import { getAudioDuration, detectSilenceRatio } from '../services/audio';
import { transcribeWithWhisper, transcribeWithYunwu, transcribeWithAlignment, isLocalWhisper } from '../services/asr';
import { generateCustomerQuestion } from '../services/dialogue';
import { scoreSalesReply } from '../services/scoring';
import { calculateFluencyScore } from '../services/fluency-score';
import { evaluatePractice } from '../services/evaluation';
import { runPreAnalysis } from '../services/pre-analysis';
import { callOpenAIChat } from '../services/openai-chat';
import { sendReportNotification } from '../services/notify';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getQueryUserId, requireRole } from '../middleware/permission';
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
import type { ApiResponse, UploadResponse, StatusResponse } from '../types';
import type { DialogueRoundResponse } from '../types/dialogue';

const router = Router();
const upload = multer({ dest: 'uploads/tmp/' });

const ALLOWED_EXTS = ['.mp3', '.wav', '.m4a', '.webm'];
const MAX_SIZE_MB = 100;
const MIN_DURATION_SECONDS = 120;
const MAX_SILENCE_RATIO = 0.5;

// Helper
async function query(sql: string, params?: any[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}

// Permission middleware: check if user owns the record or is manager/admin
async function requireRecordOwnerOrManager(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user!;
  const recordId = req.params.record_id;
  if (!recordId) return next();
  if (user.role === 'manager' || user.role === 'admin') return next();
  const rows = await query('SELECT user_id FROM practice_records WHERE record_id = ?', [recordId]);
  if (rows.length === 0) {
    return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
  }
  if (rows[0].user_id !== user.userId) {
    return res.status(403).json({ code: 403000, message: '无权访问该记录' } as ApiResponse);
  }
  next();
}

// Training plan cache (refreshed daily)
let trainingPlanCache: any = null;

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const queryUserId = getQueryUserId(req);

  try {
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (queryUserId) {
      where += ' AND pr.user_id = ?';
      params.push(queryUserId);
    }

    const listRows = await query(
      `SELECT
         pr.record_id,
         pr.product_line,
         pr.practice_type,
         pr.status,
         pr.duration,
         pr.created_at,
         pr.updated_at,
         pr.audio_path as audio_url,
         pr.transcript,
         pr.overall_score
       FROM practice_records pr
       ${where}
       ORDER BY pr.created_at DESC
       LIMIT 20`,
      params
    );

    const countWhere = queryUserId ? 'WHERE user_id = ?' : '';
    const countParams = queryUserId ? [queryUserId] : [];
    const countRows = await query(
      `SELECT COUNT(*) as total FROM practice_records ${countWhere}`,
      countParams
    );

    const list = listRows.map((row) => ({
      record_id: row.record_id,
      product_line: row.product_line,
      practice_type: row.practice_type,
      status: row.status,
      duration: row.duration,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      audio_url: row.audio_url,
      transcript: row.transcript,
      overall_score: row.overall_score != null ? Number(row.overall_score) : undefined,
    }));

    return res.json({
      code: 0,
      data: {
        list,
        total: parseInt(countRows[0].total, 10),
      },
    } as ApiResponse);
  } catch (err) {
    console.error('List query error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Helper: normalize audio_path to a consistent relative URL
function normalizeAudioUrl(audioPath: string | null | undefined): string | null {
  if (!audioPath) return null;
  // Already a full URL — return as-is
  if (audioPath.startsWith('http://') || audioPath.startsWith('https://')) {
    return audioPath;
  }
  // Remove redundant leading "uploads/" or "/uploads/" and rebuild
  const clean = audioPath.replace(/^\/?uploads\//, '');
  return `/uploads/${clean}`;
}

// Showcase: list excellent recordings
router.get('/showcase', authMiddleware, async (req: AuthRequest, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 6;
  try {
    const rows = await query(
      `SELECT pr.record_id, u.name as user_name, pr.product_line, pr.overall_score,
              pr.audio_path, pr.duration, pr.created_at, pr.showcase_comment
       FROM practice_records pr
       JOIN users u ON pr.user_id = u.user_id
       WHERE pr.is_showcase = 1 AND pr.status = 'completed'
       ORDER BY pr.overall_score DESC
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

router.post('/upload', authMiddleware, upload.single('audio'), async (req: AuthRequest, res) => {
  const file = req.file;
  const userId = req.user!.userId;
  const productLine = req.body.product_line as string | undefined;
  const practiceType = (req.body.practice_type as string) || 'intro';
  const audioType = (req.body.audio_type as string) || 'monologue';
  const customerKnowledge = (req.body.customer_knowledge as string) || 'unknown';
  const customerType = (req.body.customer_type as string) || 'new';

  if (!file) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: ERR_MISSING_PARAMS.message } as ApiResponse);
  }
  if (!userId || !productLine) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: ERR_MISSING_PARAMS.message } as ApiResponse);
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
    const savedPath = await saveUpload(file.path, recordId, ext.replace('.', ''), 'practices');

    // Analyze the local temp file (still available after saveUpload)
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

    // Quality check
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

    // Clean up temp file after analysis
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    await pool.execute(
      'INSERT INTO practice_records (record_id, user_id, audio_path, duration, product_line, practice_type, audio_type, customer_knowledge, customer_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [recordId, userId, savedPath, duration, productLine, practiceType, audioType, customerKnowledge, customerType]
    );

    return res.status(201).json({
      code: 0,
      data: {
        record_id: recordId,
        audio_url: savedPath,
        duration,
        status: 'pending',
        product_line: productLine,
        practice_type: practiceType,
        audio_type: audioType,
        customer_knowledge: customerKnowledge,
        customer_type: customerType,
      },
    } as unknown as UploadResponse);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Status check
router.get('/:record_id/status', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  try {
    const rows = await query(
      'SELECT record_id, status, transcript, asr_engine, asr_task_id, error_code, error_message FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = rows[0];
    const response = {
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
    };
    res.json(response);
  } catch (err) {
    console.error('Status check error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Retry ASR (Whisper only)
router.post('/:record_id/retry-asr', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;

  try {
    const rows = await query(
      'SELECT record_id, status, audio_path, audio_type FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = rows[0];
    if (record.status !== 'failed') {
      return res.status(400).json({ code: ERR_RETRY_NOT_ALLOWED.code, message: ERR_RETRY_NOT_ALLOWED.message } as ApiResponse);
    }

    await pool.execute(
      "UPDATE practice_records SET status = 'processing', error_code = NULL, error_message = NULL WHERE record_id = ?",
      [record_id]
    );

    try {
      // Download from OSS to local temp
      const localFilePath = path.resolve(process.cwd(), 'uploads', `${record_id}.tmp.${path.extname(record.audio_path).slice(1) || 'mp3'}`);
      const ossKey = extractOssKey(record.audio_path);
      await downloadFromOss(ossKey, localFilePath);

      const engineRows = await query('SELECT setting_value FROM settings WHERE setting_key = ?', ['asr_engine']);
      const engine = engineRows[0]?.setting_value || 'whisper';

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

      await pool.execute(
        'UPDATE practice_records SET status = ?, transcript = ?, transcript_segments = ? WHERE record_id = ?',
        ['completed', transcript, JSON.stringify(segments), record_id]
      );
      return res.json({ code: 0, data: { record_id, status: 'completed' } } as ApiResponse);
    } catch (whisperErr) {
      console.error('Whisper retry error:', whisperErr);
      await pool.execute(
        "UPDATE practice_records SET status = 'failed', error_code = 'WHISPER_RETRY_FAILED', error_message = ? WHERE record_id = ?",
        [String(whisperErr), record_id]
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

// Start ASR (user triggers manually)
router.post('/:record_id/start-asr', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  try {
    const rows = await query(
      'SELECT record_id, status, audio_path, audio_type FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = rows[0];

    if (record.status !== 'pending') {
      return res.json({ code: 0, data: { record_id, status: record.status } } as ApiResponse);
    }

    await pool.execute(
      "UPDATE practice_records SET status = 'processing' WHERE record_id = ?",
      [record_id]
    );

    // Download from OSS to local temp
    const localFilePath = path.resolve(process.cwd(), 'uploads', `${record_id}.tmp.${path.extname(record.audio_path).slice(1) || 'mp3'}`);
    const ossKey = extractOssKey(record.audio_path);
    await downloadFromOss(ossKey, localFilePath);

    // Read ASR engine config
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

      await pool.execute(
        'UPDATE practice_records SET status = ?, transcript = ?, transcript_segments = ? WHERE record_id = ?',
        ['completed', transcript, JSON.stringify(segments), record_id]
      );
      return res.json({ code: 0, data: { record_id, status: 'completed' } } as ApiResponse);
    } catch (err) {
      console.error('ASR error:', err);
      await pool.execute(
        "UPDATE practice_records SET status = 'failed', error_code = 'WHISPER_FAILED', error_message = ? WHERE record_id = ?",
        [String(err), record_id]
      );
      return res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: '语音识别失败' } as ApiResponse);
    }
  } catch (err) {
    console.error('Start ASR error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Delete practice
router.delete('/:record_id', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  try {
    const [result]: any = await pool.execute(
      'DELETE FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    res.json({ code: 0, message: '删除成功' } as ApiResponse);
  } catch (err) {
    console.error('Delete practice error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Toggle showcase (manager only)
router.post('/:record_id/showcase', authMiddleware, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const user = req.user;

  if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
    return res.status(403).json({ code: 403000, message: '仅主管可操作' } as ApiResponse);
  }

  try {
    const rows = await query(
      "SELECT record_id, status, is_showcase FROM practice_records WHERE record_id = ?",
      [record_id]
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
        'UPDATE practice_records SET is_showcase = ?, showcase_comment = NULL WHERE record_id = ?',
        [newShowcase, record_id]
      );
    } else {
      await pool.execute(
        'UPDATE practice_records SET is_showcase = ?, showcase_comment = ? WHERE record_id = ?',
        [newShowcase, comment || null, record_id]
      );
    }

    res.json({ code: 0, message: 'ok', data: { is_showcase: !!newShowcase } } as ApiResponse);
  } catch (err) {
    console.error('Showcase toggle error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Manager: edit evaluation
router.put('/:record_id/evaluation', authMiddleware, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const user = req.user;

  if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
    return res.status(403).json({ code: 403000, message: '仅主管可操作' } as ApiResponse);
  }

  const evaluation = req.body.evaluation;
  if (!evaluation || typeof evaluation !== 'object') {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 evaluation 参数' } as ApiResponse);
  }

  try {
    const rows = await query('SELECT record_id FROM practice_records WHERE record_id = ?', [record_id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const overallScore = evaluation.overallScore ?? null;
    await pool.execute(
      'UPDATE practice_records SET evaluation_result = ?, overall_score = ? WHERE record_id = ?',
      [JSON.stringify(evaluation), overallScore, record_id]
    );

    res.json({ code: 0, message: 'ok' } as ApiResponse);
  } catch (err) {
    console.error('Evaluation edit error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// === Pre-analysis route (V2) ===
router.get('/:record_id/pre-analysis', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  try {
    const recordRows = await query(
      'SELECT record_id, transcript, product_line, fluency_score, duration, pre_analysis, transcript_segments, status FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    if (record.status !== 'completed') {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '练习尚未完成ASR，无法预分析' } as ApiResponse);
    }
    if (!record.transcript) {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '转录文本为空' } as ApiResponse);
    }

    // Return cached pre-analysis
    if (record.pre_analysis) {
      const pa = typeof record.pre_analysis === 'string' ? JSON.parse(record.pre_analysis) : record.pre_analysis;
      return res.json({ code: 0, data: pa } as ApiResponse);
    }

    const segments = record.transcript_segments
      ? (typeof record.transcript_segments === 'string' ? JSON.parse(record.transcript_segments) : record.transcript_segments)
      : [];

    const fluencyBreakdown = calculateFluencyScore(record.transcript, segments, record.duration || 0);
    const preAnalysis = await runPreAnalysis(record_id, record.transcript, record.product_line, fluencyBreakdown.score, segments);

    // Cache result
    await pool.execute(
      'UPDATE practice_records SET pre_analysis = ?, initial_scores = ? WHERE record_id = ?',
      [JSON.stringify(preAnalysis), JSON.stringify(preAnalysis.initial_scores), record_id]
    );

    res.json({ code: 0, data: preAnalysis } as ApiResponse);
  } catch (err) {
    console.error('Pre-analysis error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Polling ASR status (Whisper: returns DB status directly)
router.get('/:record_id/asr-status', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  try {
    const rows = await query(
      'SELECT record_id, status, transcript, error_code, error_message FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = rows[0];

    const response = {
      code: 0,
      data: {
        record_id: record.record_id,
        status: record.status,
        transcript: record.transcript || undefined,
        error: record.error_code ? {
          code: record.error_code,
          message: record.error_message || ASR_ERROR_CODES[record.error_code as keyof typeof ASR_ERROR_CODES]?.message || '未知错误',
        } : undefined,
      },
    };
    res.json(response);
  } catch (err) {
    console.error('ASR status error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Start dialogue round
router.post('/:record_id/dialogue', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const { round_number } = req.body as { round_number: number };

  if (!round_number || round_number < 1) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少有效的 round_number' } as ApiResponse);
  }

  try {
    const recordRows = await query(
      'SELECT record_id, product_line, status, customer_knowledge, customer_type FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    if (record.status !== 'completed') {
      return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '练习尚未完成ASR，无法进行对话' } as ApiResponse);
    }

    // Fetch 3 random knowledge points from knowledge tables
    const knowledgePoints: string[] = [];
    const knowledgeTables = [
      { table: 'selling_points', select: "CONCAT('【卖点】', title, ': ', description)" },
      { table: 'product_specs', select: "CONCAT('【规格】', spec_name, ': ', spec_value, IFNULL(CONCAT(' ', unit), ''))" },
      { table: 'product_knowledge', select: "CONCAT('【知识】', title, ': ', LEFT(content, 100))" },
      { table: 'sales_scenarios', select: "CONCAT('【场景】', title, ': ', LEFT(content, 100))" },
      { table: 'sales_scripts', select: "CONCAT('【话术】', title, ': ', LEFT(content, 100))" },
    ];
    for (const kt of knowledgeTables) {
      try {
        const rows = await query(
          `SELECT ${kt.select} as point FROM ${kt.table} WHERE status = 'active' ORDER BY RAND() LIMIT 1`, []
        );
        if (rows.length > 0) knowledgePoints.push(rows[0].point);
      } catch { /* table may be empty */ }
    }
    // Trim to 3
    const selectedPoints = knowledgePoints.slice(0, 3);

    // Build conversation history from previous rounds
    const existingRounds = await query(
      'SELECT customer_question, sales_reply FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
      [record_id]
    );
    const conversationHistory = existingRounds.map((r: any) => ({
      customerQuestion: r.customer_question,
      salesReply: r.sales_reply || '',
    }));

    // Determine difficulty based on previous round's reply
    let difficulty: 'easy' | 'medium' | 'hard' = 'medium';
    const previousRound = round_number - 1;
    if (previousRound >= 1) {
      const prevReplyRows = await query(
        'SELECT sales_reply FROM dialogue_rounds WHERE record_id = ? AND round_number = ?',
        [record_id, previousRound]
      );
      const prevReply = prevReplyRows[0]?.sales_reply;
      if (prevReply) {
        try {
          const diffResult = await callOpenAIChat(
            `你是一位销售培训难度评估专家。请根据销售人员的回答质量，判断下一轮应该用什么难度。

评分标准：
- 回答完整、有说服力、用了具体数据或案例 → 回复 hard
- 回答基本到位但不够深入或缺少细节 → 回复 medium
- 回答偏离主题、没有回应客户问题、内容空洞 → 回复 easy

只回复一个词：easy、medium 或 hard，不要任何其他内容。`,
            `客户问题（第${previousRound}轮）：${existingRounds[existingRounds.length - 1]?.customer_question || ''}

销售人员的回答：${prevReply}`
          );
          const d = diffResult.trim().toLowerCase();
          if (d === 'easy' || d === 'medium' || d === 'hard') {
            difficulty = d;
          }
        } catch (err) {
          console.warn('Difficulty assessment failed:', err);
        }
      }
    }

    const result = await generateCustomerQuestion({
      round: round_number,
      weakPoints: [],
      conversationHistory,
      difficulty,
      productLine: record.product_line,
      knowledgeContext: selectedPoints.join('\n'),
      customerKnowledge: record.customer_knowledge,
      customerType: record.customer_type,
    });

    // Check for existing round (avoid duplicate on page refresh)
    const existing = await query(
      'SELECT round_number, customer_question, difficulty, expected_focus FROM dialogue_rounds WHERE record_id = ? AND round_number = ?',
      [record_id, round_number]
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
      [record_id, round_number, result.customerQuestion, result.difficulty, result.expectedFocus]
    );

    const dialogueResponse = {
      round_number,
      customer_question: result.customerQuestion,
      difficulty: result.difficulty,
      expected_focus: result.expectedFocus,
      is_last_round: false,
    };

    res.json({ code: 0, data: dialogueResponse } as ApiResponse);
  } catch (err) {
    console.error('Dialogue error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Submit reply and score
router.post('/:record_id/reply', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const { round_number, reply } = req.body as { round_number: number; reply: string };

  if (!round_number || !reply) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 round_number 或 reply' } as ApiResponse);
  }

  try {
    const roundRows = await query(
      'SELECT customer_question, expected_focus, difficulty FROM dialogue_rounds WHERE record_id = ? AND round_number = ?',
      [record_id, round_number]
    );
    if (roundRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '对话轮次不存在' } as ApiResponse);
    }

    const round = roundRows[0];
    const scoringResult = await scoreSalesReply({
      customerQuestion: round.customer_question,
      salesReply: reply,
      weakPoints: [],
      round: round_number,
    });

    await pool.execute(
      'UPDATE dialogue_rounds SET sales_reply = ?, score = ?, feedback = ?, strengths = ?, weaknesses = ?, missed_points = ? WHERE record_id = ? AND round_number = ?',
      [reply, scoringResult.score, scoringResult.feedback, JSON.stringify(scoringResult.strengths), JSON.stringify(scoringResult.weaknesses), JSON.stringify(scoringResult.missedPoints), record_id, round_number]
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

// Save reply without AI scoring (simplified dialogue flow)
router.post('/:record_id/save-reply', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const { round_number, reply } = req.body as { round_number: number; reply: string };

  if (!round_number || !reply) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 round_number 或 reply' } as ApiResponse);
  }

  try {
    await pool.execute(
      'UPDATE dialogue_rounds SET sales_reply = ? WHERE record_id = ? AND round_number = ?',
      [reply, record_id, round_number]
    );
    res.json({ code: 0 } as ApiResponse);
  } catch (err) {
    console.error('Save reply error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Voice reply: upload audio, GPT understands speech directly
router.post('/:record_id/voice-reply', authMiddleware, upload.single('audio'), requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
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
      [record_id, round_number]
    );
    if (roundRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: '对话轮次不存在' } as ApiResponse);
    }

    const ext = path.extname(file.originalname).toLowerCase().replace('.', '') || 'mp3';
    const audioSaveName = `voice_${record_id}_${round_number}`;

    // Upload to OSS
    const savedUrl = await saveUpload(file.path, audioSaveName, ext, 'voice-replies');

    // Clean up temp file
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    // Download from OSS to local for transcription
    const localFilePath = path.resolve(process.cwd(), 'uploads', `${audioSaveName}.tmp.${ext}`);
    const ossKey = extractOssKey(savedUrl);
    await downloadFromOss(ossKey, localFilePath);

    // 1. Transcribe based on ASR engine setting
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

    // Clean up local temp
    try { fs.unlinkSync(localFilePath); } catch { /* ignore */ }

    // 2. Save transcript to dialogue_rounds
    await pool.execute(
      'UPDATE dialogue_rounds SET sales_reply = ?, audio_reply_path = ? WHERE record_id = ? AND round_number = ?',
      [transcript, savedUrl, record_id, round_number]
    );

    res.json({
      code: 0,
      data: {
        round_number,
        transcript,
        saved: true,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Voice reply error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Finish dialogue and trigger background analysis
router.post('/:record_id/finish-dialogue', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;

  try {
    const rows = await query(
      'SELECT record_id FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    // Set status to analyzing before returning
    await pool.execute(
      "UPDATE practice_records SET status = 'analyzing' WHERE record_id = ?",
      [record_id]
    );

    // Return immediately, run analysis in background
    res.json({ code: 0 } as ApiResponse);

    runBackgroundAnalysis(record_id).catch(async err => {
      console.error('Background analysis failed:', record_id, err);
      await pool.execute(
        "UPDATE practice_records SET status = 'failed', error_code = 'ANALYSIS_FAILED', error_message = ? WHERE record_id = ?",
        [String(err), record_id]
      );
    });
  } catch (err) {
    console.error('Finish dialogue error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

async function runBackgroundAnalysis(recordId: string) {
  const recordRows = await query(
    'SELECT record_id, transcript, product_line, fluency_score, duration, transcript_segments, audio_type FROM practice_records WHERE record_id = ?',
    [recordId]
  );
  const record = recordRows[0];
  if (!record || !record.transcript) return;

  const roundRows = await query(
    'SELECT round_number, customer_question, sales_reply, difficulty, expected_focus, score, feedback, strengths, weaknesses, missed_points FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
    [recordId]
  );

  // 0. Score each dialogue round if not already scored
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

  // Re-fetch rounds with updated scores
  const updatedRounds = await query(
    'SELECT round_number, customer_question, sales_reply, difficulty, expected_focus, score, feedback, strengths, weaknesses, missed_points FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
    [recordId]
  );

  // 1. Run evaluation
  const segments = record.transcript_segments
    ? (typeof record.transcript_segments === 'string' ? JSON.parse(record.transcript_segments) : record.transcript_segments)
    : [];
  const fluencyBreakdown = calculateFluencyScore(record.transcript, segments, record.duration || 0);
  const evaluation = await evaluatePractice(recordId, record.transcript, record.product_line, fluencyBreakdown, segments, record.audio_type);

  // 2. Build dialogue history
  const dialogue_history = updatedRounds.map((r: any) => ({
    round_number: r.round_number,
    customer_question: r.customer_question,
    sales_reply: r.sales_reply,
    difficulty: r.difficulty,
    score: r.score,
    feedback: r.feedback,
    strengths: r.strengths ? (typeof r.strengths === 'string' ? JSON.parse(r.strengths) : r.strengths) : [],
    weaknesses: r.weaknesses ? (typeof r.weaknesses === 'string' ? JSON.parse(r.weaknesses) : r.weaknesses) : [],
    missed_points: r.missed_points ? (typeof r.missed_points === 'string' ? JSON.parse(r.missed_points) : r.missed_points) : [],
  }));

  // 3. Extract weak points for training plan
  const weakPoints: string[] = [];
  for (const round of updatedRounds) {
    if (round.weaknesses) {
      const ws = typeof round.weaknesses === 'string' ? JSON.parse(round.weaknesses) : round.weaknesses;
      weakPoints.push(...ws);
    }
    if (round.missed_points) {
      const ms = typeof round.missed_points === 'string' ? JSON.parse(round.missed_points) : round.missed_points;
      weakPoints.push(...ms);
    }
  }
  const uniqueWeakPoints = [...new Set(weakPoints)];
  const weakPointsDesc = uniqueWeakPoints.length > 0 ? uniqueWeakPoints.join('、') : '暂无明确薄弱点，请生成通用销售提升计划';

  // 4. Generate training plan
  const trainingPlanPrompt = `你是一位资深销售培训专家。基于以下练习情况生成个性化培训计划。

产品：${record.product_line}
薄弱点：${weakPointsDesc}
各轮得分：${updatedRounds.map((r: any) => `第${r.round_number}轮 ${r.score ?? '未评分'}分`).join('、')}

输出 JSON：
{
  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],
  "monthly": [{"week":1,"title":"...","target":"..."}, ...],
  "recommendations": [{"topic":"...","reason":"..."}, ...]
}`;

  let trainingPlan = null;
  try {
    const planText = await callOpenAIChat(trainingPlanPrompt, '请生成培训计划');
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (jsonMatch) trainingPlan = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Training plan generation failed:', err);
  }

  // 4.5 Query real training materials and merge into training plan
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

  // 5. Save everything
  const evalOverallScore = evaluation.overallScore ?? null;
  const fullEvaluation = {
    ...evaluation,
    dialogue_history,
  };

  await pool.execute(
    'UPDATE practice_records SET evaluation_result = ?, overall_score = ?, training_plan = ?, status = ? WHERE record_id = ?',
    [JSON.stringify(fullEvaluation), evalOverallScore, trainingPlan ? JSON.stringify(trainingPlan) : null, 'completed', recordId]
  );

  // Send notification (non-blocking)
  sendReportNotification(recordId).catch(err => {
    console.error('Notification failed:', err);
  });
}

// AI Evaluation
router.get('/:record_id/evaluation', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  try {
    const recordRows = await query(
      'SELECT record_id, transcript, product_line, fluency_score, duration, evaluation_result, transcript_segments, status, pre_analysis, initial_scores, audio_type FROM practice_records WHERE record_id = ?',
      [record_id]
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
      'SELECT round_number, customer_question, sales_reply, difficulty, expected_focus, score, feedback, strengths, weaknesses, missed_points FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
      [record_id]
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

    // Build dialogue history
    const dialogue_history = roundRows.map((r: any) => ({
      round_number: r.round_number,
      customer_question: r.customer_question,
      sales_reply: r.sales_reply,
      difficulty: r.difficulty,
      score: r.score,
      feedback: r.feedback,
      strengths: r.strengths ? (typeof r.strengths === 'string' ? JSON.parse(r.strengths) : r.strengths) : [],
      weaknesses: r.weaknesses ? (typeof r.weaknesses === 'string' ? JSON.parse(r.weaknesses) : r.weaknesses) : [],
      missed_points: r.missed_points ? (typeof r.missed_points === 'string' ? JSON.parse(r.missed_points) : r.missed_points) : [],
    }));

    // Parse initial scores
    const initialScores = record.initial_scores
      ? (typeof record.initial_scores === 'string' ? JSON.parse(record.initial_scores) : record.initial_scores)
      : null;

    // Return cached evaluation if exists
    if (record.evaluation_result) {
      const evaluationResult = typeof record.evaluation_result === 'string' ? JSON.parse(record.evaluation_result) : record.evaluation_result;

      // Compute score changes if initial scores exist
      let scoreChanges: Record<string, { before: number; after: number; change: number }> | null = null;
      if (initialScores && evaluationResult.scores) {
        scoreChanges = {};
        for (const key of Object.keys(evaluationResult.scores) as string[]) {
          const before = (initialScores as Record<string, number>)[key] ?? 0;
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
          score_changes: scoreChanges,
        },
      } as ApiResponse);
    }

    // Parse transcript_segments for fluency calculation
    const segments = record.transcript_segments
      ? (typeof record.transcript_segments === 'string' ? JSON.parse(record.transcript_segments) : record.transcript_segments)
      : [];

    const fluencyBreakdown = calculateFluencyScore(record.transcript, segments, record.duration || 0);
    const evaluation = await evaluatePractice(record_id, record.transcript, record.product_line, fluencyBreakdown, segments, record.audio_type);

    // Compute score changes
    let scoreChanges: Record<string, { before: number; after: number; change: number }> | null = null;
    if (initialScores) {
      scoreChanges = {};
      for (const key of Object.keys(evaluation.scores) as Array<keyof typeof evaluation.scores>) {
        const before = (initialScores as Record<string, number>)[key] ?? 0;
        const after = evaluation.scores[key] ?? 0;
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
      dialogue_history: dialogue_history,
      score_changes: scoreChanges,
    };

    // Cache result and sync overall_score
    const evalOverallScore = fullEvaluation.overallScore ?? null;
    await pool.execute(
      'UPDATE practice_records SET evaluation_result = ?, overall_score = ?, conversation_metrics = ? WHERE record_id = ?',
      [JSON.stringify(fullEvaluation), evalOverallScore, JSON.stringify(conversationMetrics), record_id]
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

// ==================== Training Plan (AI generated, no record association) ====================
router.get('/training-plan', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (trainingPlanCache && trainingPlanCache.date === today) {
      return res.json({ code: 0, data: trainingPlanCache.data } as ApiResponse);
    }

    const systemPrompt = `你是一位资深销售培训专家。请直接生成一份通用的销售培训计划（不基于任何具体员工的练习记录），包含以下三个部分：

1. weekly：未来一周每日培训安排（周一到周日，每天一项）
   - day: 周几
   - title: 当日培训主题（具体、有吸引力）
   - type: video | practice | test | recording | exam
   - duration: 预计时长（如 "12分钟"、"15分钟"）

2. monthly：月度阶段目标（共4周）
   - week: 第几周（1-4）
   - title: 阶段主题
   - target: 量化目标（具体、可衡量）

3. recommended_materials：推荐学习资料（AI生成，不关联真实数据库）
   - material_id: 虚拟ID，如 "ai-1", "ai-2" 等
   - title: 资料名称
   - type: video | pdf | audio | article
   - duration: 时长/页数（如 "12分钟"、"2页"、"5分钟阅读"）

请确保内容专业、实用，覆盖销售技巧、产品知识、沟通能力、异议处理等维度。月度目标要有量化指标。

必须严格按以下 JSON 格式返回，不要有任何额外说明：
{
  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],
  "monthly": [{"week":1,"title":"...","target":"..."}, ...],
  "recommended_materials": [{"material_id":"ai-1","title":"...","type":"video","duration":"..."}, ...]
}`;

    const responseText = await callOpenAIChat(systemPrompt, '请生成一份销售培训计划');
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
    const planData = JSON.parse(jsonStr);

    // 查询真实的培训资料
    const materialRows = await query(
      `SELECT material_id, title, type, duration, file_url, description, product_line_id
       FROM training_materials WHERE status = 'active' ORDER BY created_at DESC LIMIT 10`
    );
    const recommendedMaterials = materialRows.map((m: any) => ({
      material_id: m.material_id,
      title: m.title,
      type: m.type,
      duration: m.duration || '',
      description: m.description || '',
    }));

    res.json({
      code: 0,
      data: {
        ...planData,
        recommended_materials: recommendedMaterials,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Training plan AI error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// ==================== Training Plan (based on evaluation report) ====================
router.get('/:record_id/training-plan', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  try {
    const recordRows = await query(
      'SELECT product_line, transcript FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    const record = recordRows[0];
    if (!record) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    // Read dialogue rounds to extract weak points
    const dialogueRows = await query(
      'SELECT round_number, customer_question, sales_reply, score, feedback, weaknesses, missed_points FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC',
      [record_id]
    );

    const weakPoints: string[] = [];
    for (const round of dialogueRows) {
      if (round.weaknesses) {
        const ws = typeof round.weaknesses === 'string' ? JSON.parse(round.weaknesses) : round.weaknesses;
        weakPoints.push(...ws);
      }
      if (round.missed_points) {
        const ms = typeof round.missed_points === 'string' ? JSON.parse(round.missed_points) : round.missed_points;
        weakPoints.push(...ms);
      }
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

    const systemPrompt = `你是一位资深销售培训专家。请基于以下员工的练习情况，生成一份个性化的培训计划。

产品：${record.product_line}
薄弱点：${weakPointsDesc}
对话轮次：${roundsSummary.length} 轮
各轮得分：${roundsSummary.map((r: any) => `第${r.round}轮 ${r.score ?? '未评分'}分`).join('、')}

详细数据：
${summaryText}

请生成以下内容：

1. weekly：未来一周每日培训安排（周一到周日，每天一项）
   - day: 周几
   - title: 当日培训主题（具体、有针对性）
   - type: video | practice | test | recording | exam
   - duration: 预计时长（如 "12分钟"、"15分钟"）

2. monthly：月度阶段目标（共4周）
   - week: 第几周（1-4）
   - title: 阶段主题
   - target: 量化目标（具体、可衡量）

3. recommendations：个性化学习建议
   - topic: 学习方向/主题
   - reason: 为什么需要学这个方向（基于练习中的具体薄弱点）

必须严格按以下 JSON 格式返回，不要有任何额外说明：
{
  "weekly": [{"day":"周一","title":"...","type":"video","duration":"..."}, ...],
  "monthly": [{"week":1,"title":"...","target":"..."}, ...],
  "recommendations": [{"topic":"...","reason":"..."}, ...]
}`;

    const responseText = await callOpenAIChat(systemPrompt, '请基于练习情况生成个性化培训计划');
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
    const planData = JSON.parse(jsonStr);

    // 查询真实的培训资料
    const materialRows = await query(
      `SELECT material_id, title, type, duration, file_url, description, product_line_id
       FROM training_materials WHERE status = 'active' ORDER BY created_at DESC LIMIT 10`
    );
    const recommendedMaterials = materialRows.map((m: any) => ({
      material_id: m.material_id,
      title: m.title,
      type: m.type,
      duration: m.duration || '',
      description: m.description || '',
    }));

    res.json({
      code: 0,
      data: {
        ...planData,
        recommended_materials: recommendedMaterials,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Training plan error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// ==================== Manager: Team Practice List ====================
router.get('/team', authMiddleware, requireRole('manager', 'admin'), async (req: AuthRequest, res) => {
  const { page = '1', limit = '20' } = req.query;
  const user = req.user!;
  try {
    const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);

    // Build manager filter
    let managerFilter = '';
    const managerParams: any[] = [];
    if (user.role === 'manager') {
      managerFilter = `AND (u.user_id = ? OR u.manager_id = ?)`;
      managerParams.push(user.userId, user.userId);
    }

    const countRows = await query(
      `SELECT COUNT(*) as total FROM practice_records pr
       JOIN users u ON pr.user_id = u.user_id
       WHERE u.status = 'active' ${managerFilter}`,
      [...managerParams]
    );

    const listRows = await query(
      `SELECT
         pr.record_id,
         pr.user_id,
         u.name as user_name,
         u.employee_id,
         pr.product_line,
         pr.practice_type,
         pr.status,
         pr.duration,
         pr.overall_score,
         pr.fluency_score,
         pr.weak_points,
         pr.evaluation_result,
         pr.is_showcase,
         pr.created_at
       FROM practice_records pr
       JOIN users u ON pr.user_id = u.user_id
       WHERE u.status = 'active' ${managerFilter}
       ORDER BY pr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...managerParams, parseInt(limit as string, 10), offset]
    );

    const list = listRows.map((row: any) => {
      let weakPoints: Array<{ name: string; severity: string }> = [];
      if (row.evaluation_result) {
        const evalResult = typeof row.evaluation_result === 'string' ? JSON.parse(row.evaluation_result) : row.evaluation_result;
        if (evalResult.weakPoints) {
          weakPoints = evalResult.weakPoints.map((wp: any) => ({ name: wp.name, severity: wp.severity }));
        }
      } else if (row.weak_points) {
        const raw = typeof row.weak_points === 'string' ? JSON.parse(row.weak_points) : row.weak_points;
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

// ==================== Manager: Practice Detail ====================
router.get('/:record_id/detail', authMiddleware, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const user = req.user!;
  try {
    const rows = await query(
      `SELECT pr.*, u.name as user_name, u.employee_id
       FROM practice_records pr
       JOIN users u ON pr.user_id = u.user_id
       WHERE pr.record_id = ?`,
      [record_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    const row = rows[0];
    // Permission check: employee can only view their own records
    if (user.role === 'employee' && row.user_id !== user.userId) {
      return res.status(403).json({ code: 403000, message: '无权访问该记录' } as ApiResponse);
    }
    const evaluation = row.evaluation_result
      ? (typeof row.evaluation_result === 'string' ? JSON.parse(row.evaluation_result) : row.evaluation_result)
      : null;

    // Get dialogue rounds
    const roundRows = await query(
      `SELECT round_number, customer_question, sales_reply, difficulty, expected_focus,
              score, feedback, strengths, weaknesses, missed_points
       FROM dialogue_rounds WHERE record_id = ? ORDER BY round_number ASC`,
      [record_id]
    );

    const dialogueRounds = roundRows.map((r: any) => ({
      round_number: r.round_number,
      customer_question: r.customer_question,
      sales_reply: r.sales_reply,
      difficulty: r.difficulty,
      expected_focus: r.expected_focus,
      score: r.score,
      feedback: r.feedback,
      strengths: r.strengths ? (typeof r.strengths === 'string' ? JSON.parse(r.strengths) : r.strengths) : [],
      weaknesses: r.weaknesses ? (typeof r.weaknesses === 'string' ? JSON.parse(r.weaknesses) : r.weaknesses) : [],
      missed_points: r.missed_points ? (typeof r.missed_points === 'string' ? JSON.parse(r.missed_points) : r.missed_points) : [],
    }));

    res.json({
      code: 0,
      data: {
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
        audio_url: row.audio_path,
        transcript: row.transcript,
        transcript_segments: row.transcript_segments
          ? (typeof row.transcript_segments === 'string' ? JSON.parse(row.transcript_segments) : row.transcript_segments)
          : [],
        evaluation,
        dialogue_rounds: dialogueRounds,
        training_plan: row.training_plan ? (typeof row.training_plan === 'string' ? JSON.parse(row.training_plan) : row.training_plan) : null,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Detail error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// Manager review / comment
router.post('/:record_id/review', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const { comment } = req.body as { comment?: string };

  if (!comment) {
    return res.status(400).json({ code: ERR_MISSING_PARAMS.code, message: '缺少 comment' } as ApiResponse);
  }

  try {
    const rows = await query('SELECT record_id FROM practice_records WHERE record_id = ?', [record_id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }

    await pool.execute(
      'UPDATE practice_records SET review_comment = ? WHERE record_id = ?',
      [comment, record_id]
    );

    res.json({ code: 0, message: 'ok' } as ApiResponse);
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message: ERR_INTERNAL_SERVER.message } as ApiResponse);
  }
});

// ==================== Dialogue Training (lightweight, no DB save) ====================
router.post('/:record_id/dialogue-training', authMiddleware, requireRecordOwnerOrManager, async (req: AuthRequest, res) => {
  const { record_id } = req.params;
  const { round_number, previous_dialogues } = req.body as {
    round_number?: number;
    previous_dialogues?: Array<{ customer_question: string; sales_reply: string }>;
  };

  try {
    // 1. Get record info
    const recordRows = await query(
      'SELECT product_line, evaluation_result FROM practice_records WHERE record_id = ?',
      [record_id]
    );
    if (recordRows.length === 0) {
      return res.status(404).json({ code: ERR_RECORD_NOT_FOUND.code, message: ERR_RECORD_NOT_FOUND.message } as ApiResponse);
    }
    const record = recordRows[0];

    // 2. Extract weak points from evaluation_result
    let weakPoints: string[] = [];
    if (record.evaluation_result) {
      const evalResult = typeof record.evaluation_result === 'string' ? JSON.parse(record.evaluation_result) : record.evaluation_result;
      if (evalResult.weakPoints) {
        weakPoints = evalResult.weakPoints.map((wp: any) => wp.name);
      }
    }

    // 3. Find product_line_id
    const plRows = await query(
      'SELECT product_line_id FROM product_lines WHERE name = ? AND status = ?',
      [record.product_line, 'active']
    );
    const productLineId = plRows.length > 0 ? plRows[0].product_line_id : null;

    // 4. Fetch product knowledge
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

    // Calculate hidden persuasion score based on sales replies
    let persuasionScore = 0;
    const dialogues = previous_dialogues || [];
    let consecutiveNoProductMention = 0;

    for (const round of dialogues) {
      const reply = round.sales_reply || '';
      const cq = round.customer_question;
      if (!reply.trim()) continue;

      // Base participation
      persuasionScore += 5;

      // Penalty: too short / perfunctory
      if (reply.length < 10) {
        persuasionScore -= 5;
      }

      // Penalty: rude or dismissive tone
      if (/爱买不买|买不起|别问|不知道|不关我事|随便你|懒得|废话/.test(reply)) {
        persuasionScore -= 20;
      }

      // Penalty: evading customer question
      if (/贵|便宜|价格|多少钱/.test(cq) && !/\d|元|块|钱|价格|成本|性价比|划算|值/.test(reply)) {
        persuasionScore -= 10;
      }
      if (/坏|质量|容易|耐用|维修|售后|质保/.test(cq) && !/质保|保修|技术|认证|稳定|三年|五年|网点|服务/.test(reply)) {
        persuasionScore -= 10;
      }

      // Penalty: wrong key data (common mistakes)
      // 纳滤说成 RO 反渗透
      if (/纳滤|NF/.test(knowledgeText) && /RO反渗透|反渗透.*过滤|RO膜/.test(reply) && !/纳滤/.test(reply)) {
        persuasionScore -= 15;
      }
      // 把 3 秒即热说错
      if (/3秒|三秒/.test(knowledgeText) && /5秒|五秒|10秒|十几秒|一分钟/.test(reply)) {
        persuasionScore -= 15;
      }
      // 把一年换芯成本 699 说错
      if (/699/.test(knowledgeText) && /299|399|499|899|999/.test(reply)) {
        persuasionScore -= 15;
      }

      // Contains specific numbers/params
      if (/\d/.test(reply)) persuasionScore += 5;

      // Contains product core selling points
      const hasProductMention = /纳滤|RO|反渗透|过滤精度|3秒|即热|无储水|千滚水|废水比|通量|滤芯|TDS|质保|服务网点|400/.test(reply);
      if (hasProductMention) {
        persuasionScore += 8;
        consecutiveNoProductMention = 0;
      } else {
        consecutiveNoProductMention++;
      }

      // Penalty: consecutive rounds without product mention
      if (consecutiveNoProductMention >= 2) {
        persuasionScore -= 5;
        consecutiveNoProductMention = 0;
      }

      // Contains closing/promotion language
      if (/今天|明天|下单|安装|定.*一台|送|活动|优惠|试用|7天|30天|无理由|包换|退货|不满意/.test(reply)) {
        persuasionScore += 10;
      }

      // Objection handling bonuses
      if (/贵|便宜|价格|多少钱|成本/.test(cq) && /值|对比|划算|省|抵|送|一天|成本|性价比|算下来/.test(reply)) {
        persuasionScore += 10;
      }
      if (/坏|质量|容易|耐用|维修|售后/.test(cq) && /质保|保修|技术|认证|稳定|大厂|客户|网点/.test(reply)) {
        persuasionScore += 10;
      }
      if (/竞品|别家|美的|网上|两千|牌子|品牌/.test(cq) && /对比|区别|差异|不如|比不上|更|优势/.test(reply)) {
        persuasionScore += 10;
      }
      if (/考虑|比比|看看|再说|商量|想想/.test(cq) && /今天|活动|明天|限量|抓紧|过期|恢复原价/.test(reply)) {
        persuasionScore += 12;
      }
    }
    // Bonus for explicit closing in last round
    const lastReply = dialogues[dialogues.length - 1]?.sales_reply || '';
    if (/定一台|买一台|今天定|明天装|开票|下单|签合同|付款/.test(lastReply)) {
      persuasionScore += 15;
    }
    persuasionScore = Math.max(0, Math.min(persuasionScore, 100));

    // Build attitude hint based on score (hidden from frontend)
    let attitudeHint = '';
    if (persuasionScore >= 70) {
      attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你已经被打动了，态度明显软化，基本决定购买。如果销售再给一个台阶（如促成下单、强调活动期限），你顺势说出"那就定一台"或"帮我安排安装"即可。`;
    } else if (persuasionScore >= 45) {
      attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你态度有所松动，但仍有些犹豫。可以稍微软化质疑力度，但不要轻易同意购买。`;
    } else {
      attitudeHint = `\n\n【内心状态】销售当前累计说服力 ${persuasionScore}/100 分。你仍然很怀疑，继续刁难，保持质疑。`;
    }

    // 5. Build previous dialogues text (summarize if too long)
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
      previousDialoguesText = `前期对话摘要（共${earlier.length}轮）：\n${earlierSummary}\n\n最近5轮完整对话：\n${recentText}`;
    }

    // 6. Build prompt
    const systemPrompt = `你是一位挑剔、难缠的客户，正在和销售沟通产品。

**重要规则**：
- 每轮只说 1 个问题或 1 句回应，不要一次抛多个问题
- 说话要像真实客户：口语化、有犹豫、有反问、带情绪
- 字数控制在 30 字以内
- 例子（好）：「真的假的？那比我网上看的贵一倍啊」
- 例子（差）：「你们这净水器凭什么卖这么贵？滤芯多久换一次？后期维护费用多少？质保几年？」

背景信息（来自原报告）：
- 产品线：${record.product_line}
- 销售薄弱点：${weakPoints.length > 0 ? weakPoints.join('、') : '暂无'}
- 核心卖点：
${sellingPointsText || '暂无'}
- 产品规格：
${specsText || '暂无'}
- 销售话术：
${scriptsText || '暂无'}
- 销售场景：
${scenariosText || '暂无'}
- 产品知识：
${knowledgeText || '暂无'}

当前是第 ${round_number || 1} 轮对话。
前面的对话记录：
${previousDialoguesText}
${attitudeHint}

请生成你的下一轮回应：
1. 如果这是第 1 轮，抛出尖锐质疑（针对薄弱点或价格）
2. 如果销售上一轮回答得好（用了标准话术、数据准确），你可以稍微软化但仍保持质疑
3. 如果销售答错了关键数据或遗漏核心卖点，你可以更刁难
4. 只有当你明确说出"同意购买""愿意下单""决定了""买一台""签合同""付款""帮我安排安装""今天就定""定一台"等成交语句时，才设置 is_convinced = true
5. 严禁因为对话时间长、销售态度好、或者你想结束对话而轻易设为 true。没有明确的成交语句，必须保持 is_convinced = false

输出严格按以下 JSON 格式，不要有任何额外说明：
{
  "customer_question": "你的提问或回应",
  "is_convinced": false
}`;

    const responseText = await callOpenAIChat(systemPrompt, '请生成下一轮客户回应');

    // 7. Parse JSON
    let result: { customer_question: string; is_convinced: boolean };
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
      result = JSON.parse(jsonStr);
    } catch {
      result = {
        customer_question: responseText.trim(),
        is_convinced: false,
      };
    }

    // 8. Post-process is_convinced: force true only if explicit purchase intent detected
    const purchaseKeywords = ['同意购买', '愿意下单', '决定了', '买一台', '签合同', '付款', '买了', '下单', '成交', '付定金', '帮我安排安装', '今天就定', '定一台', '来一台'];
    if (!result.is_convinced && purchaseKeywords.some((kw) => result.customer_question.includes(kw))) {
      result.is_convinced = true;
    }

    res.json({
      code: 0,
      data: {
        customer_question: result.customer_question,
        is_convinced: !!result.is_convinced,
      },
    } as ApiResponse);
  } catch (err) {
    console.error('Dialogue training error:', err);
    const message = err instanceof Error ? err.message : ERR_INTERNAL_SERVER.message;
    res.status(500).json({ code: ERR_INTERNAL_SERVER.code, message } as ApiResponse);
  }
});

export default router;
