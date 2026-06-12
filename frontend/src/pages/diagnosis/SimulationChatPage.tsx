import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Send,
  Loader2,
  ArrowLeft,
  Mic,
  Square,
  Trophy,
  XCircle,
} from 'lucide-react';
import {
  startDialogueRound,
  saveDialogueReply,
  type DialogueRound,
  getDialogueHistory,
} from '../../api/debrief';
import { IFlytekAsrClient } from '../../utils/iflytek-asr';

const roleMap: Record<string, { name: string; emoji: string }> = {
  decision_maker: { name: '决策者', emoji: '👔' },
  user: { name: '使用者', emoji: '👷' },
  technical: { name: '技术顾问', emoji: '💻' },
  procurement: { name: '采购', emoji: '📝' },
  admin: { name: '行政', emoji: '📋' },
};

const statusMap: Record<string, { name: string; color: string }> = {
  observing: { name: '观望', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  comparing: { name: '对比', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  urgent: { name: '急迫', color: 'bg-red-50 text-red-700 border-red-200' },
};

interface LocationState {
  role?: string;
  status?: string;
  difficulty?: string;
  productLineName?: string;
}

export function SimulationChatPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState) || {};

  const [rounds, setRounds] = useState<DialogueRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [finished, setFinished] = useState(false);
  const [success, _setSuccess] = useState(false);
  const [recording, setRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const asrClientRef = useRef<IFlytekAsrClient | null>(null);
  const asrFinalRef = useRef('');

  const roleInfo = roleMap[state.role || ''];
  const statusInfo = statusMap[state.status || ''];

  // Load history or start first round
  useEffect(() => {
    if (!recordId) return;
    let mounted = true;

    (async () => {
      setInitialLoading(true);
      try {
        const historyRes = await getDialogueHistory(recordId);
        if (!mounted) return;
        const historyRounds = historyRes.data.rounds;
        if (historyRounds && historyRounds.length > 0) {
          setRounds(historyRounds as DialogueRound[]);
        } else {
          const res = await startDialogueRound(recordId, 1, state.role, state.status);
          if (!mounted) return;
          if (res.code === 0 && res.data) {
            setRounds([res.data]);
          } else {
            setError(res.message || '获取对话失败');
          }
        }
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : '网络错误');
      } finally {
        if (mounted) setInitialLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [recordId]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [rounds, loading]);

  const currentRound = rounds[rounds.length - 1];

  const fetchNextRound = async (currentRoundNum: number) => {
    const nextRoundNumber = currentRoundNum + 1;
    try {
      const nextRes = await startDialogueRound(recordId!, nextRoundNumber, state.role, state.status);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取下一轮失败');
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
    if (!recordId) return;
    setFinished(true);
    // simulation 模式不生成报告，直接返回
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── 实时语音转写 ──
  const startRealtimeAsr = async () => {
    asrFinalRef.current = input;

    const client = new IFlytekAsrClient({
      onText: (final, interim) => {
        const newText = asrFinalRef.current + final + (interim ? ' ' + interim : '');
        setInput(newText);
      },
      onError: (err) => {
        setError(err);
        setRecording(false);
      },
      onStatusChange: (status) => {
        if (status === 'recording') {
          setRecording(true);
        } else if (status === 'idle') {
          setRecording(false);
        }
      },
    });

    asrClientRef.current = client;
    await client.start();
  };

  const stopRealtimeAsr = () => {
    asrClientRef.current?.stop();
    asrClientRef.current = null;
    setRecording(false);
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
          <p>正在加载模拟对话...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col fade-in">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/employee/diagnosis/simulation')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="font-bold text-gray-900 text-sm">情景模拟对话</h1>
            <p className="text-xs text-orange-600 flex items-center gap-1">
              <span className="text-sm">{roleInfo?.emoji || '🧑'}</span>
              AI {roleInfo?.name || '客户'}
              {statusInfo && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusInfo.color}`}>
                  {statusInfo.name}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!finished && (
            <button
              onClick={handleFinish}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              结束模拟
            </button>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm text-center">{error}</div>
        )}

        {rounds.map((round, idx) => (
          <div key={idx} className="space-y-3">
            {/* AI Customer */}
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <span className="text-sm">{roleInfo?.emoji || '🧑'}</span>
              </div>
              <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 border shadow-sm max-w-[80%]">
                <p className="text-sm text-gray-800 leading-relaxed">{round.customer_question}</p>
              </div>
            </div>

            {/* Sales Reply */}
            {round.sales_reply && (
              <div className="flex gap-3 flex-row-reverse">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-blue-600 text-xs">我</span>
                </div>
                <div className="bg-blue-600 rounded-xl rounded-tr-none px-4 py-3 shadow-sm max-w-[80%]">
                  <p className="text-sm text-white leading-relaxed">{round.sales_reply}</p>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <span className="text-sm">{roleInfo?.emoji || '🧑'}</span>
            </div>
            <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 border shadow-sm">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                AI 正在思考...
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Finished overlay */}
      {finished && (
        <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center">
            {success ? (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">成功说服客户！</h3>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">模拟结束</h3>
              </>
            )}
            <p className="text-sm text-gray-500 mb-2">共进行了 {rounds.length} 轮对话</p>
            <button
              onClick={() => navigate('/employee/diagnosis/simulation')}
              className="mt-5 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              返回
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      {!finished && (
        <div className="bg-white border-t px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的回答..."
              rows={1}
              disabled={loading}
              className="flex-1 border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none max-h-32"
            />
            <button
              onClick={recording ? stopRealtimeAsr : startRealtimeAsr}
              disabled={loading}
              className={`p-2.5 rounded-xl shrink-0 ${
                recording
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title={recording ? '停止录音' : '语音输入'}
            >
              {recording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">
            按 Enter 发送，自由对话直到满意或点击结束模拟
          </p>
        </div>
      )}
    </div>
  );
}
