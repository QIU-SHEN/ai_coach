import fs from 'fs';
import path from 'path';
import { getAudioDuration } from './audio';
import type { AsrResult, TranscriptSegment } from '../types';

const {
  OPENAI_API_KEY = '',
  OPENAI_BASE_URL = 'https://yunwu.ai',
  LOCAL_WHISPER_URL = '',
} = process.env;

export function isLocalWhisper(): boolean {
  return LOCAL_WHISPER_URL !== '';
}

export async function transcribeWithWhisper(audioFilePath: string): Promise<AsrResult> {
  const fileBuffer = fs.readFileSync(audioFilePath);
  const blob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append('file', blob, path.basename(audioFilePath));

  const response = await fetch(`${LOCAL_WHISPER_URL}/v1/audio/transcriptions`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Whisper server error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    text: string;
    language: string;
    segments?: Array<{
      start: number;
      end: number;
      text: string;
      confidence: number;
      low_confidence: boolean;
    }>;
  };

  const segments: TranscriptSegment[] =
    data.segments?.map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
      confidence: seg.confidence,
      low_confidence: seg.low_confidence,
    })) || [];

  return {
    taskId: `whisper-${Date.now()}`,
    transcript: data.text,
    segments,
  };
}

export async function transcribeWithYunwu(audioFilePath: string, audioType?: string, speakerCount?: number): Promise<{ transcript: string; segments: TranscriptSegment[] }> {
  const fileBuffer = fs.readFileSync(audioFilePath);
  const blob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append('file', blob, path.basename(audioFilePath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  if (speakerCount === 2) {
    formData.append('prompt', '这是一段销售与客户的真实见客对话录音。请在每句话前标注说话人身份：[销售] 或 [客户]。注意区分双方声音，确保标注准确。');
  } else if (audioType === 'conversation') {
    formData.append('prompt', '这是一段销售与客户的对话录音。请在每句话前标注说话人身份：[销售] 或 [客户]。');
  }

  const response = await fetch(`${OPENAI_BASE_URL}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Yunwu audio error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    text: string;
    segments?: Array<{
      start: number;
      end: number;
      text: string;
    }>;
  };

  const segments: TranscriptSegment[] =
    data.segments?.map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      confidence: 0.9,
      low_confidence: false,
    })) || [];

  const transcript = segments.length > 0
    ? segments.map(s => s.text).join('')
    : data.text;

  return { transcript, segments };
}

function alignSegments(
  gptSegments: TranscriptSegment[],
  whisperSegments: TranscriptSegment[]
): TranscriptSegment[] {
  if (whisperSegments.length === 0) return gptSegments;
  if (gptSegments.length === 0) return whisperSegments;
  if (gptSegments.length === 1) {
    return [{
      start: whisperSegments[0].start,
      end: whisperSegments[whisperSegments.length - 1].end,
      text: gptSegments[0].text,
      confidence: whisperSegments[0].confidence,
      low_confidence: whisperSegments.some(s => s.low_confidence),
    }];
  }

  // Split whisper segments into N groups (N = gpt segment count)
  // and map each group to the corresponding gpt segment
  const groupSize = whisperSegments.length / gptSegments.length;
  return gptSegments.map((gptSeg, i) => {
    const from = Math.round(i * groupSize);
    const to = Math.round((i + 1) * groupSize);
    const group = whisperSegments.slice(from, to);
    if (group.length === 0) {
      return { ...gptSeg, start: 0, end: 0 };
    }
    return {
      start: group[0].start,
      end: group[group.length - 1].end,
      text: gptSeg.text,
      confidence: group.reduce((sum, s) => sum + s.confidence, 0) / group.length,
      low_confidence: group.some(s => s.low_confidence),
    };
  });
}

export async function transcribeWithAlignment(audioFilePath: string, audioType?: string): Promise<AsrResult> {
  const gptResult = await transcribeWithYunwu(audioFilePath, audioType);
  return { taskId: `gpt-${Date.now()}`, transcript: gptResult.transcript, segments: gptResult.segments };
}
