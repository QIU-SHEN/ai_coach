import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { startDialogueRound, saveDialogueReply, finishDialogue, type DialogueRound, getPracticeStatus, getDialogueHistory, type DialogueHistoryRound, startAsr } from '../../api/debrief';

type SessionStep = 'asr' | 'conversation' | 'done';

const difficultyMap: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

export function PracticeSessionPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const { setCurrentRecordId } = useAppStore();

  const [sessionStep, setSessionStep] = useState<SessionStep>('asr');
  const [asrError, setAsrError] = useState('');
  const [initLoading, setInitLoading] = useState(true);
  const [historyRounds, setHistoryRounds] = useState<DialogueHistoryRound[] | null>(null);

  useEffect(() => {
    if (recordId) setCurrentRecordId(recordId);
  }, [recordId, setCurrentRecordId]);

  useEffect(() => {
    if (!recordId) return;
    let mounted = true;
    (async () => {
      try {
        const triggerRes = await startAsr(recordId);
        if (!mounted) return;
        const status = triggerRes.data.status;

        if (status === 'completed') {
          try {
            const historyRes = await getDialogueHistory(recordId);
            if (!mounted) return;
            const rounds = historyRes.data.rounds;
            if (rounds && rounds.length > 0) {
              setHistoryRounds(rounds);
            }
          } catch { /* no existing dialogue, that's fine */ }
          if (mounted) setSessionStep('conversation');
        } else if (status === 'failed') {
          if (mounted) {
            setAsrError(triggerRes.data.error_message || '语音识别失败');
          }
        }
      } catch {
        // startAsr call failed — fallback to polling
      } finally {
        if (mounted) setInitLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [recordId]);

  const stepLabels: { key: SessionStep; label: string }[] = [
    { key: 'asr', label: '语音识别' },
    { key: 'conversation', label: '对话练习' },
  ];

  const visibleSteps = sessionStep === 'asr'
    ? stepLabels
    : [{ key: 'conversation' as SessionStep, label: '对话练习' }];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between shrink-0">
        <button
          onClick={() => navigate('/employee/debrief/new/practice')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">返回</span>
        </button>
        <div className="flex items-center gap-2">
          {visibleSteps.map((s, idx) => (
            <div key={s.key} className="flex items-center gap-2">
              {idx > 0 && <div className="w-6 h-px bg-gray-300" />}
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                sessionStep === s.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
              }`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
        <div className="w-16" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {initLoading && (
            <div className="bg-white rounded-2xl shadow-sm border p-10 text-center">
              <div className="flex justify-center mb-4">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="text-gray-500">正在加载练习数据...</p>
            </div>
          )}

          {!initLoading && sessionStep === 'asr' && (
            <AsrSection recordId={recordId!} onComplete={() => setSessionStep('conversation')} onError={setAsrError} />
          )}

          {asrError && sessionStep === 'asr' && !initLoading && (
            <div className="mt-4 text-center">
              <button
                onClick={() => navigate('/employee/debrief/new/practice')}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700"
              >
                返回重新上传
              </button>
            </div>
          )}

          {!initLoading && sessionStep === 'conversation' && (
            <ConversationSection
              recordId={recordId!}
              onComplete={() => setSessionStep('done')}
              historyRounds={historyRounds}
            />
          )}

          {!initLoading && sessionStep === 'done' && (
            <div className="bg-white rounded-2xl shadow-sm border p-10 text-center">
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">练习完成</h3>
              <p className="text-sm text-gray-500 mb-6">系统正在后台分析您的表现，分析完成后可在个人中心查看报告</p>
              <button
                onClick={() => navigate('/employee/profile')}
                className="px-8 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                返回个人中心
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- ASR Section ---

function AsrSection({ recordId, onComplete, onError }: {
  recordId: string;
  onComplete: () => void;
  onError: (err: string) => void;
}) {
  const [status, setStatus] = useState<'processing' | 'completed' | 'failed'>('processing');

  useEffect(() => {
    if (!recordId) return;
    const pollRef = setInterval(async () => {
      try {
        const result = await getPracticeStatus(recordId);
        const st = result.data.status;
        setStatus(st);
        if (st === 'completed') {
          clearInterval(pollRef);
          onComplete();
        } else if (st === 'failed') {
          clearInterval(pollRef);
          onError(result.data.error_message || '语音识别失败');
        }
      } catch {
        // keep polling
      }
    }, 3000);
    return () => clearInterval(pollRef);
  }, [recordId, onComplete, onError]);

  if (status === 'failed') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-8 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <p className="font-medium text-red-900 text-lg">语音识别失败</p>
        <p className="text-sm text-red-600 mt-1">请检查音频质量或重新上传</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border p-10 text-center">
      <div className="flex justify-center mb-4">
        <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="font-medium text-gray-900 text-lg">正在识别语音...</p>
      <p className="text-sm text-gray-500 mt-2">系统每 3 秒自动刷新进度，请稍候</p>
    </div>
  );
}

// --- Conversation Section ---

function ConversationSection({ recordId, onComplete, historyRounds }: {
  recordId: string;
  onComplete: () => void;
  historyRounds: DialogueHistoryRound[] | null;
}) {
  const navigate = useNavigate();

  const isHistory = historyRounds !== null && historyRounds.length > 0;

  const [rounds, setRounds] = useState<DialogueRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!isHistory);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [finished, setFinished] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch first round for new conversation
  useEffect(() => {
    if (isHistory) return;
    let mounted = true;
    if (!recordId) return;
    setInitialLoading(true);
    setError(null);
    startDialogueRound(recordId, 1)
      .then((res) => {
        if (!mounted) return;
        if (res.code === 0 && res.data) {
          setRounds([res.data]);
          setFinished(res.data.is_last_round);
        } else {
          setError(res.message || '获取对话失败');
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : '网络错误');
      })
      .finally(() => {
        if (mounted) setInitialLoading(false);
      });
    return () => { mounted = false; };
  }, [recordId, isHistory]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [rounds, loading, finished, historyRounds]);

  const displayRounds = isHistory ? historyRounds! : rounds;
  const currentRound = rounds[rounds.length - 1];
  const totalRounds = 6;

  const fetchNextRound = async (currentRoundNum: number) => {
    const nextRoundNumber = currentRoundNum + 1;
    if (nextRoundNumber > totalRounds) {
      setFinished(true);
      return;
    }
    try {
      const nextRes = await startDialogueRound(recordId, nextRoundNumber);
      if (nextRes.code === 0 && nextRes.data) {
        setRounds((prev) => [
          ...prev,
          {
            round_number: nextRes.data.round_number,
            customer_question: nextRes.data.customer_question,
            difficulty: nextRes.data.difficulty,
            expected_focus: nextRes.data.expected_focus,
            is_last_round: false,
          },
        ]);
      }
    } catch {
      setFinished(true);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading || !recordId) return;
    const reply = input.trim();
    const currentRoundNum = currentRound?.round_number ?? 1;
    setInput('');
    setLoading(true);
    setError(null);

    try {
      await saveDialogueReply(recordId, currentRoundNum, reply);

      setRounds((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], sales_reply: reply };
        return updated;
      });

      await fetchNextRound(currentRoundNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!recordId || finishing) return;
    setFinishing(true);
    try {
      await finishDialogue(recordId);
    } catch {
      // Even if finish-dialogue fails, navigate away
    }
    onComplete();
  };


  if (initialLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-10 text-center text-gray-500">
        <div className="flex justify-center mb-4">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
        <p>正在加载对话...</p>
      </div>
    );
  }

  if (error && displayRounds.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-10 text-center text-red-600">
        <p className="mb-4">{error}</p>
        <button
          onClick={() => navigate('/employee/debrief/new/practice')}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          返回上传
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="bg-gray-50 border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isHistory ? '对话记录' : 'AI 客户模拟对话'}
            </h2>
            <p className="text-sm text-gray-500">
              {isHistory
                ? `共 ${displayRounds.length} 轮对话`
                : <>针对薄弱点进行实战演练 · 当前难度:
                  <span className="font-medium text-blue-600 ml-1">
                    {difficultyMap[currentRound?.difficulty ?? ''] || currentRound?.difficulty || '-'}
                  </span>
                </>
              }
            </p>
          </div>
          {!isHistory && (
            <div className="text-sm text-gray-500">
              轮次: <span className="font-bold text-gray-900">{Math.min((currentRound?.round_number ?? 1), totalRounds)}</span> / {totalRounds}
            </div>
          )}
        </div>

        <div ref={containerRef} className="h-[28rem] overflow-y-auto p-6 space-y-4 bg-white">
          {displayRounds.map((round, idx) => (
            <div key={idx} className="space-y-4">
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tl-none px-4 py-3 max-w-[80%]">
                    <p className="text-sm font-medium text-gray-500 mb-1">
                      AI客户 · 第{round.round_number}轮 · {difficultyMap[round.difficulty] || round.difficulty}
                      {round.expected_focus && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                          针对{round.expected_focus}
                        </span>
                      )}
                    </p>
                    <p>{round.customer_question}</p>
                  </div>
                </div>
                {round.sales_reply && (
                  <div className="flex justify-end">
                    <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-3 max-w-[80%]">
                      <p>{round.sales_reply}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

          {!isHistory && loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tl-none px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
              </div>
            </div>
          )}
          {!isHistory && error && rounds.length > 0 && (
            <div className="text-center text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline hover:no-underline">关闭</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {isHistory ? (
          <div className="border-t p-6 bg-gray-50 text-center">
            <button
              onClick={() => navigate('/employee/profile')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
            >
              返回个人中心
            </button>
          </div>
        ) : !finished ? (
          <div className="border-t p-4 bg-gray-50">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="输入您的回答..."
                disabled={loading}
                className="flex-1 border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Send className="w-4 h-4" />
                发送
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t p-6 bg-gray-50 text-center space-y-3">
            <p className="text-gray-700">对话练习已完成，共 {rounds.filter(r => r.sales_reply).length} 轮应答</p>
            <button
              onClick={handleFinish}
              disabled={finishing}
              className="px-8 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
            >
              {finishing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {finishing ? '正在提交...' : '完成练习'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
