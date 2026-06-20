import { pool } from '../db';
import { logger } from './logger';

async function getSetting(key: string): Promise<string | null> {
  const rows: any = await pool.execute('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  return rows[0]?.[0]?.setting_value ?? null;
}

export async function sendReportNotification(recordId: string): Promise<void> {
  const enabled = await getSetting('wecom_notify_enabled');
  if (enabled !== '1') return;

  const webhookUrl = await getSetting('wecom_webhook_url');
  if (!webhookUrl) return;

  const [rows]: any = await pool.execute(
    `SELECT dr.record_id, u.name AS user_name, u.employee_id, m.product_line, m.duration, m.evaluation_result
     FROM debrief_records dr
     LEFT JOIN debrief_practice_meta m ON dr.record_id = m.record_id
     LEFT JOIN users u ON dr.user_id = u.user_id
     WHERE dr.record_id = ?`,
    [recordId]
  );

  const record = rows?.[0];
  if (!record || !record.evaluation_result) return;

  const evaluation = typeof record.evaluation_result === 'string'
    ? JSON.parse(record.evaluation_result)
    : record.evaluation_result;

  const scores = evaluation.scores || {};
  const overallScore = evaluation.overallScore ?? 0;
  const scoreLine = `知识覆盖：${scores.knowledgeCoverage ?? '-'} | 核心命中：${scores.coreHitRate ?? '-'} | 数据准确：${scores.dataAccuracy ?? '-'}\n话术匹配：${scores.scriptMatch ?? '-'} | 结构完整：${scores.structureScore ?? '-'}`;

  const weakPoints = (evaluation.weakPoints || [])
    .filter((wp: any) => wp.severity === 'high' || wp.severity === 'medium')
    .slice(0, 3)
    .map((wp: any) => `- ${wp.name}（${wp.severity === 'high' ? '高' : '中'}）${wp.description}`)
    .join('\n');

  const recommendations = (evaluation.training_plan?.recommendations || [])
    .slice(0, 3)
    .map((r: any) => `- ${r.topic}：${r.reason}`)
    .join('\n');

  const durationMin = Math.floor((record.duration || 0) / 60);
  const durationSec = Math.floor((record.duration || 0) % 60);

  const content = `**📋 销售练习报告**
> 员工：<font color="info">${record.user_name || '未知'}</font>（${record.employee_id || '-'}）
> 产品线：${record.product_line || '-'} | 练习时长：${durationMin}分${durationSec}秒

**📊 综合评分：<font color="warning">${overallScore}</font> 分**
${scoreLine}

**🔴 薄弱环节**
${weakPoints || '暂无'}

**💡 培训建议**
${recommendations || '暂无'}`;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content },
      }),
    });
  } catch (err) {
    logger.error('WeChat Work notification failed:', err);
  }
}
