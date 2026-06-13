import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Send,
  Loader2,
  ArrowLeft,
  Trophy,
  XCircle,
  MessageCircle,
  CheckCircle2,
  Mic,
  Square,
} from 'lucide-react';
import { authHeaders } from '../../api/auth';
import { IFlytekAsrClient } from '../../utils/iflytek-asr';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

interface Round {
  round_number: number;
  customer_question: string;
  sales_reply?: string;
}

interface SimulationState {
  role: string;
  status: string;
  difficulty: string;
  productLineId?: string;
}

interface EvaluationResult {
  score: number;
  dimensionScores: {
    opening: number;
    needsProbing: number;
    productIntro: number;
    objectionHandling: number;
    closing: number;
  };
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

// 角色映射
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

export function SimulationChatPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as SimulationState) || {};

  const [rounds, setRounds] = useState<Round[]>([]);
  const [recording, setRecording] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const asrClientRef = useRef<IFlytekAsrClient | null>(null);

  const roleInfo = roleMap[state.role || ''];
  const statusInfo = statusMap[state.status || ''];

  // 实时语音转写
  const startRealtimeAsr = async () => {
    const client = new IFlytekAsrClient({
      onText: (finalText: string, _interimText: string, _isFinal: boolean) => {
        setInput((prev) => {
          // 去重：如果新文本末尾已经包含 prev，则只用新文本
          if (prev && finalText.startsWith(prev)) {
            return finalText;
          }
          return finalText || prev;
        });
      },
      onError: (err: string) => {
        setError('语音转写: ' + err);
        setRecording(false);
      },
      onStatusChange: (status: 'idle' | 'connecting' | 'recording') => {
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

  // Load history
  useEffect(() => {
    if (!recordId) return;
    let mounted = true;

    (async () => {
      setInitialLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/v1/debriefs/${recordId}/simulation`, {
          headers: { ...authHeaders() },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!mounted) return;
        if (data.code === 0 && data.data?.rounds) {
          setRounds(data.data.rounds);
        }
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : '加载失败');
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

  const handleSend = async () => {
    if (!input.trim() || loading || !recordId) return;
    const reply = input.trim();
    setInput('');
    setLoading(true);
    setError(null);

    try {
      // Optimistic update: show sales message immediately
      const nextRoundNumber = rounds.length + 1;
      const newRound: Round = {
        round_number: nextRoundNumber,
        customer_question: '',
        sales_reply: reply,
      };
      setRounds((prev) => [...prev, newRound]);

      const res = await fetch(`${API_BASE}/api/v1/debriefs/${recordId}/simulation/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          sales_message: reply,
          role: state.role,
          status: state.status,
          difficulty: state.difficulty,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.code === 0 && data.data) {
        setRounds((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            customer_question: data.data.customer_question,
          };
          return updated;
        });

        // AI 被说服
        if (data.data.is_convinced) {
          setSuccess(true);
          setFinished(true);
        }
      } else {
        setError(data.message || '发送失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!recordId) return;
    setFinished(true);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/debriefs/${recordId}/simulation/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.code === 0 && data.data) {
        setEvaluation(data.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '评估失败');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

        {rounds.map((round) => (
          <div key={round.round_number} className="space-y-3">
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

            {/* AI Customer */}
            {round.customer_question && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                  <span className="text-sm">{roleInfo?.emoji || '🧑'}</span>
                </div>
                <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 border shadow-sm max-w-[80%]">
                  <p className="text-sm text-gray-800 leading-relaxed">{round.customer_question}</p>
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
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center max-h-[80vh] overflow-y-auto">
            {success ? (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">成功说服客户！</h3>
                <p className="text-sm text-gray-500 mb-2">共进行了 {rounds.length} 轮对话</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">模拟结束</h3>
                <p className="text-sm text-gray-500 mb-2">共进行了 {rounds.length} 轮对话</p>
              </>
            )}

            {/* Evaluation Report */}
            {evaluation && (
              <div className="mt-4 text-left space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-3xl font-bold text-blue-600">{evaluation.score}</span>
                  <span className="text-sm text-gray-500">分</span>
                </div>
                <div className="grid grid-cols-5 gap-2 text-center">
                  {Object.entries(evaluation.dimensionScores).map(([key, score]) => (
                    <div key={key} className="space-y-1">
                      <div className="text-xs text-gray-500">
                        {key === 'opening' && '开场'}
                        {key === 'needsProbing' && '需求'}
                        {key === 'productIntro' && '产品'}
                        {key === 'objectionHandling' && '异议'}
                        {key === 'closing' && '成交'}
                      </div>
                      <div className={`text-sm font-bold ${score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {score}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-700 leading-relaxed">{evaluation.feedback}</p>
                </div>
                {evaluation.strengths.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      优点
                    </h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {evaluation.strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-green-500 mt-0.5">•</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {evaluation.weaknesses.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1">
                      <MessageCircle className="w-4 h-4 text-orange-500" />
                      不足
                    </h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {evaluation.weaknesses.map((w, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-orange-500 mt-0.5">•</span>
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {evaluation.suggestions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-blue-500" />
                      建议
                    </h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {evaluation.suggestions.map((s, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-blue-500 mt-0.5">•</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

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
