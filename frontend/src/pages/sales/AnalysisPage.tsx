import { useEffect, useState, useRef } from 'react';
import { Mic, FileText, Activity, Database, AlertTriangle, CheckCircle2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getPracticeStatus, retryAsr } from '../../api/debrief';

interface TaskItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  barColor: string;
}

const tasks: TaskItem[] = [
  { id: 'asr', label: '语音转文字 (ASR)', icon: <Mic className="w-5 h-5" />, color: 'text-blue-600', barColor: 'bg-blue-600' },
  { id: 'content', label: '内容特征提取', icon: <FileText className="w-5 h-5" />, color: 'text-purple-600', barColor: 'bg-purple-600' },
  { id: 'express', label: '表达特征提取', icon: <Activity className="w-5 h-5" />, color: 'text-green-600', barColor: 'bg-green-600' },
  { id: 'kb', label: '知识库匹配与诊断', icon: <Database className="w-5 h-5" />, color: 'text-orange-600', barColor: 'bg-orange-600' },
  { id: 'weak', label: '薄弱点分析与优先级排序', icon: <AlertTriangle className="w-5 h-5" />, color: 'text-red-600', barColor: 'bg-red-600' },
];

export function AnalysisPage() {
  const { setStep, currentRecordId } = useAppStore();
  const [backendStatus, setBackendStatus] = useState<'processing' | 'completed' | 'failed' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);

  // Local animation states
  const [showAnimation, setShowAnimation] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>(() =>
    Object.fromEntries(tasks.map((t) => [t.id, 0]))
  );
  const [status, setStatus] = useState<Record<string, string>>(() =>
    Object.fromEntries(tasks.map((t) => [t.id, '等待中']))
  );
  const [done, setDone] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const clearPoll = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const startLocalAnimation = () => {
    setShowAnimation(true);
    let taskIndex = 0;

    const runNextTask = () => {
      if (taskIndex >= tasks.length) {
        setDone(true);
        return;
      }
      const task = tasks[taskIndex];
      setStatus((prev) => ({ ...prev, [task.id]: '进行中...' }));

      let p = 0;
      const interval = setInterval(() => {
        p += 20;
        setProgress((prev) => ({ ...prev, [task.id]: p }));
        if (p >= 100) {
          clearInterval(interval);
          setStatus((prev) => ({ ...prev, [task.id]: '已完成' }));
          taskIndex++;
          setTimeout(runNextTask, 200);
        }
      }, 250);
    };

    setTimeout(runNextTask, 300);
  };

  const pollStatus = async () => {
    if (!currentRecordId) return;
    try {
      const result = await getPracticeStatus(currentRecordId);
      const st = result.data.status;
      setBackendStatus(st);

      if (st === 'completed') {
        clearPoll();
        if (result.data.transcript) {
          setTranscript(result.data.transcript);
        }
        startLocalAnimation();
      } else if (st === 'failed') {
        clearPoll();
        setErrorMessage(result.data.error_message || '语音识别失败，请检查音频质量或分段上传');
      }
    } catch (err) {
      // Keep polling on network error
    }
  };

  const handleRetry = async () => {
    if (!currentRecordId) return;
    setIsRetrying(true);
    setErrorMessage('');
    setBackendStatus('processing');
    try {
      await retryAsr(currentRecordId);
      pollIntervalRef.current = setInterval(pollStatus, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重试失败';
      setErrorMessage(msg);
      setBackendStatus('failed');
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (!currentRecordId) {
      // No record id, possibly direct access. Show error or allow mock fallback
      setBackendStatus('failed');
      setErrorMessage('未找到练习记录，请重新上传音频');
      return;
    }

    setBackendStatus('processing');
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 3000);

    return () => {
      isMountedRef.current = false;
      clearPoll();
    };
  }, [currentRecordId]);

  return (
    <section className="fade-in">
      <div className="bg-white rounded-2xl shadow-sm border p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6">AI 正在分析您的语音内容</h2>

        {backendStatus === 'processing' && !showAnimation && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">正在云端进行语音识别与分析...</span>
              <span className="text-gray-500">请稍候</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-2 rounded-full animate-[shimmer_2s_infinite] w-1/3" />
            </div>
            <p className="text-xs text-gray-400 mt-2">系统每 3 秒自动刷新进度</p>
          </div>
        )}

        {backendStatus === 'failed' && !showAnimation && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <p className="font-medium text-red-900">分析失败</p>
                <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
                <button
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                  {isRetrying ? '正在重试...' : '重试 ASR'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAnimation && (
          <div className="space-y-5">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full bg-opacity-10 flex items-center justify-center ${task.color.replace('text-', 'bg-')}`}>
                  <span className={task.color}>{task.icon}</span>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-gray-900">{task.label}</span>
                    <span className={`text-sm ${status[task.id] === '已完成' ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                      {status[task.id]}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className={`${task.barColor} h-2 rounded-full transition-all duration-300`} style={{ width: `${progress[task.id]}%` }} />
                  </div>
                </div>
              </div>
            ))}

            {done && transcript && (
              <div className="mt-6 border rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    语音转写原文
                  </span>
                  {showTranscript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showTranscript && (
                  <div className="px-4 py-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {transcript}
                  </div>
                )}
              </div>
            )}

            {done && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-900">分析完成</p>
                    <p className="text-sm text-green-700 mt-1">已识别薄弱点并生成诊断结果。请点击下方按钮进入对话练习。</p>
                    <button
                      onClick={() => setStep(3)}
                      className="mt-3 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                    >
                      开始模拟对话
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
