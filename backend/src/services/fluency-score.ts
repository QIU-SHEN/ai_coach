interface Segment {
  text?: string;
  confidence?: number;
  start?: number;
  end?: number;
}

export interface FluencyPenalty {
  type: 'filler_words' | 'speech_rate' | 'low_confidence' | 'short_transcript';
  label: string;
  detail: string;
  points: number;
}

export interface FluencyBreakdown {
  score: number;
  baseScore: number;
  penalties: FluencyPenalty[];
}

export function calculateFluencyScore(transcript: string, segments: Segment[], durationSeconds: number): FluencyBreakdown {
  if (!transcript || transcript.trim().length === 0) {
    return { score: 0, baseScore: 100, penalties: [] };
  }

  const baseScore = 100;
  const penalties: FluencyPenalty[] = [];
  let totalPenalty = 0;

  // 1. 填充词扣分
  const fillerWords = ['嗯', '啊', '那个', '就是', '然后', '呃', '哈', '对吧', '对不对', '嗯哼', '嘛'];
  const fillerDetails: { word: string; count: number }[] = [];
  let fillerCount = 0;
  for (const word of fillerWords) {
    const regex = new RegExp(word, 'g');
    const matches = transcript.match(regex);
    if (matches) {
      fillerCount += matches.length;
      fillerDetails.push({ word, count: matches.length });
    }
  }
  const fillerPenalty = Math.min(fillerCount, 20);
  if (fillerPenalty > 0) {
    const detail = fillerDetails.map(d => `${d.word}(${d.count}次)`).join('、');
    penalties.push({ type: 'filler_words', label: '填充词', detail, points: fillerPenalty });
    totalPenalty += fillerPenalty;
  } else {
    penalties.push({ type: 'filler_words', label: '填充词', detail: '无', points: 0 });
  }

  // 2. 语速扣分
  const charCount = transcript.length;
  const durationMinutes = durationSeconds / 60;
  let speechPenalty = 0;
  let speechDetail = '';
  if (durationMinutes > 0) {
    const wpm = charCount / durationMinutes;
    if (wpm < 150) {
      speechPenalty = Math.floor((150 - wpm) / 10) * 2;
      speechDetail = `${Math.round(wpm)}字/分钟，偏慢（正常150-200）`;
    } else if (wpm > 200) {
      speechPenalty = Math.floor((wpm - 200) / 10) * 2;
      speechDetail = `${Math.round(wpm)}字/分钟，偏快（正常150-200）`;
    } else {
      speechDetail = `${Math.round(wpm)}字/分钟，正常`;
    }
    speechPenalty = Math.min(speechPenalty, 20);
    if (speechPenalty > 0) {
      penalties.push({ type: 'speech_rate', label: wpm < 150 ? '语速偏慢' : '语速偏快', detail: speechDetail, points: speechPenalty });
      totalPenalty += speechPenalty;
    } else {
      penalties.push({ type: 'speech_rate', label: '语速', detail: speechDetail, points: 0 });
    }
  } else {
    penalties.push({ type: 'speech_rate', label: '语速', detail: '未知时长', points: 0 });
  }

  // 3. 低置信度片段扣分
  if (segments && segments.length > 0) {
    const lowConfSegments = segments.filter((s) => (s.confidence || 0) < 0.8);
    const lowConfRatio = lowConfSegments.length / segments.length;
    const lowConfPenalty = Math.min(Math.floor(lowConfRatio * 10) * 3, 20);
    const detail = `${lowConfSegments.length}/${segments.length}段置信度低于0.8，占比${Math.round(lowConfRatio * 100)}%`;
    if (lowConfPenalty > 0) {
      penalties.push({ type: 'low_confidence', label: '低置信度片段', detail, points: lowConfPenalty });
      totalPenalty += lowConfPenalty;
    } else {
      penalties.push({ type: 'low_confidence', label: '低置信度片段', detail, points: 0 });
    }
  } else {
    penalties.push({ type: 'low_confidence', label: '低置信度片段', detail: '无片段数据', points: 0 });
  }

  // 4. 文本过短扣分
  let shortPenalty = 0;
  if (charCount < 50) {
    shortPenalty = 20;
    penalties.push({ type: 'short_transcript', label: '文本过短', detail: `${charCount}字，少于50字`, points: shortPenalty });
    totalPenalty += shortPenalty;
  } else {
    penalties.push({ type: 'short_transcript', label: '文本过短', detail: `${charCount}字`, points: 0 });
  }

  const score = Math.max(0, Math.round(baseScore - totalPenalty));
  return { score, baseScore, penalties };
}
