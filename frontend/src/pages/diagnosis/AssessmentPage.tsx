import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic, UploadCloud, MessageSquare, FileAudio } from 'lucide-react';
import { getDebriefList, uploadAudio, type DebriefRecord } from '../../api/debrief';
import { ProductLineSelector } from '../../components/ProductLineSelector';
import { Card } from '../../components/ui/Card';
import { ScoreBadge } from '../../components/ui/ScoreBadge';

export function AssessmentPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<DebriefRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDebriefList()
      .then((res) => {
        if (res.code === 0 && res.data) {
          const callRecordings = res.data.list.filter((r) => r.debrief_mode === 'call_recording');
          setRecords(callRecordings);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-[calc(100vh-140px)]">
      {/* 左侧：评估记录列表 */}
      <div className="w-80 border-r border-gray-200 overflow-y-auto bg-gray-50/50">
        <div className="p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">历史评估记录</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            </div>
          ) : records.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">暂无评估记录</p>
          ) : (
            <div className="space-y-2">
              {records.map((r) => (
                <button
                  key={r.record_id}
                  onClick={() => navigate(`/employee/debrief/${r.record_id}/report`)}
                  className="w-full text-left p-3 rounded-lg transition-colors border-l-4 bg-white border-transparent hover:bg-gray-100"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {r.title || '未命名评估'}
                    </span>
                    {r.overall_score !== undefined && (
                      <ScoreBadge score={Math.round(r.overall_score)} />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                    {r.status === 'analyzing' && (
                      <span className="text-xs text-amber-600">分析中</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：新建评估 */}
      <div className="flex-1 overflow-y-auto p-6">
        <NewAssessmentForm />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────
// 新建评估表单（右侧默认展示）
// ──────────────────────────────────────────

function NewAssessmentForm() {
  const [productLineId, setProductLineId] = useState('');
  const [assessmentName, setAssessmentName] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [inputMode, setInputMode] = useState<'audio' | 'text'>('audio');
  const [transcript, setTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        setIsRecording(false);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      alert('无法访问麦克风，请检查权限');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    clearTimer();
  };

  const handleAnalyze = async () => {
    if (!recordedBlob) {
      setError('请先上传音频文件');
      return;
    }
    if (!productLineId) {
      setError('请选择产品线');
      return;
    }
    setAnalyzing(true);
    setError('');
    try {
      const file = recordedBlob instanceof File ? recordedBlob : new File([recordedBlob], 'recording.webm', { type: 'audio/webm' });
      const res = await uploadAudio(file, productLineId, 'intro', undefined, assessmentName.trim() || undefined);
      if (res.code === 0 && res.data) {
        // 跳转到练习会话页面
        window.location.href = `/employee/debrief/${res.data.record_id}/session`;
      } else {
        setError(res.message || '上传失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmitTranscript = async () => {
    if (!transcript.trim()) {
      setError('请输入对话文本');
      return;
    }
    if (!productLineId) {
      setError('请选择产品线');
      return;
    }
    setAnalyzing(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('title', assessmentName.trim() || '对话文本评估');
      formData.append('mode', 'call_recording');
      formData.append('product_line', productLineId);
      formData.append('transcript', transcript.trim());

      const res = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:3000'}/api/v1/debriefs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: formData,
      });
      const json = await res.json();
      if (json.code === 0 && json.data?.record_id) {
        window.location.href = `/employee/debrief/${json.data.record_id}/report`;
      } else {
        setError(json.message || '提交失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRecordedBlob(file);
      setRecordedUrl(URL.createObjectURL(file));
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card className="p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-2">新建能力评估</h2>
        <p className="text-sm text-gray-500 mb-6">
          上传电话录音或输入对话文本，AI 将从多维度评估您的销售能力
        </p>

        <div className="space-y-4">
          {/* 评估名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              评估名称
            </label>
            <input
              type="text"
              value={assessmentName}
              onChange={(e) => setAssessmentName(e.target.value)}
              placeholder="如：王经理 3月电话复盘"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* 选择产品线 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              选择产品线
            </label>
            <ProductLineSelector
              value={productLineId}
              onChange={(id) => {
                setProductLineId(id);
              }}
              placeholder="选择产品线"
              className="w-full"
            />
          </div>

          {/* 输入方式切换 */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setInputMode('audio')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                inputMode === 'audio'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <FileAudio className="w-4 h-4" />
              上传音频
            </button>
            <button
              onClick={() => setInputMode('text')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                inputMode === 'text'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              输入对话文本
            </button>
          </div>

          {inputMode === 'audio' ? (
            /* 音频上传区域 */
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                上传音频文件
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center transition-colors hover:border-blue-500">
                <UploadCloud className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-2">点击上传或拖拽文件到此处</p>
                <p className="text-xs text-gray-400 mb-4">支持 mp3, wav, m4a, webm · 最大100MB</p>
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer transition-colors">
                  <UploadCloud className="w-4 h-4" />
                  选择文件
                  <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>

              {error && (
                <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm text-center">{error}</div>
              )}

              <div className="mt-4">
                {!isRecording && !recordedBlob && (
                  <button
                    onClick={startRecording}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    <Mic className="w-5 h-5 text-red-500" />
                    开始录音
                  </button>
                )}

                {isRecording && (
                  <div className="flex flex-col items-center gap-3 p-4 border rounded-lg bg-red-50 border-red-200">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-2xl font-mono font-bold text-gray-900">{formatTime(recordSeconds)}</span>
                    </div>
                    <button
                      onClick={stopRecording}
                      className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                    >
                      结束录音
                    </button>
                  </div>
                )}

                {recordedBlob && (
                  <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
                    {recordedUrl && <audio src={recordedUrl} controls className="w-full" />}
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setRecordedBlob(null);
                          setRecordedUrl('');
                          setRecordSeconds(0);
                        }}
                        className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                      >
                        重新录制
                      </button>
                      <button
                        onClick={handleAnalyze}
                        disabled={analyzing}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {analyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            上传中...
                          </>
                        ) : (
                          '开始分析'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* 对话文本输入区域 */
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                输入销售与客户的对话文本
              </label>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="例如：&#x000D;&#x000A;销售：您好，请问您需要了解一下我们的净水器吗？&#x000D;&#x000A;客户：我想先看看...&#x000D;&#x000A;（支持多轮对话文本）"
                rows={8}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                提示：对话文本越长，AI 评估越准确。建议包含完整的销售流程（开场、探需、产品介绍、异议处理、促单）。
              </p>

              {error && (
                <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm text-center">{error}</div>
              )}

              <button
                onClick={handleSubmitTranscript}
                disabled={analyzing}
                className="mt-4 w-full px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    分析中...
                  </>
                ) : (
                  '提交对话并评估'
                )}
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
