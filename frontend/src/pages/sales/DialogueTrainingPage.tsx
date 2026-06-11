import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, Loader2, ArrowLeft, Trophy, XCircle, MessageCircle } from 'lucide-react';
import { dialogueTraining, type DialogueTrainingRound } from '../../api/debrief';

interface Round {
  round_number: number;
  customer_question: string;
  sales_reply?: string;
}

export function DialogueTrainingPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [rounds, setRounds] = useState<Round[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [rounds, loading]);

  useEffect(() => {
    if (!recordId) return;
    let mounted = true;
    setInitialLoading(true);
    setError(null);
    dialogueTraining(recordId, 1, [])
      .then((res) => {
        if (!mounted) return;
        if (res.code === 0 && res.data) {
          setRounds([
            {
              round_number: 1,
              customer_question: res.data.customer_question,
            },
          ]);
          if (res.data.is_convinced) {
            setSuccess(true);
            setFinished(true);
          }
        } else {
          setError(res.data?.customer_question || '获取对话失败');
        }
      })
      .catch((err) => {
        if (!mounted) setError(err instanceof Error ? err.message : '网络错误');
      })
      .finally(() => {
        if (mounted) setInitialLoading(false);
      });
    return () => { mounted = false; };
  }, [recordId]);

  const fetchNextRound = async (currentRounds: Round[]) => {
    if (!recordId) return;
    const nextRoundNumber = currentRounds.length + 1;
    const previousDialogues: DialogueTrainingRound[] = currentRounds.map((r) => ({
      customer_question: r.customer_question,
      sales_reply: r.sales_reply || '',
    }));

    setLoading(true);
    try {
      const res = await dialogueTraining(recordId, nextRoundNumber, previousDialogues);
      if (res.code === 0 && res.data) {
        setRounds((prev) => [
          ...prev,
          {
            round_number: nextRoundNumber,
            customer_question: res.data.customer_question,
          },
        ]);
        if (res.data.is_convinced) {
          setSuccess(true);
          setFinished(true);
        }
      } else {
        setError('获取下一轮失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading || !recordId || finished) return;
    const reply = input.trim();
    setInput('');

    setRounds((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], sales_reply: reply };
      return updated;
    });

    await fetchNextRound([
      ...rounds.slice(0, -1),
      { ...rounds[rounds.length - 1], sales_reply: reply },
    ]);
  };

  const handleFinish = () => {
    setFinished(true);
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
          <p>正在加载对话...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col fade-in">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="font-bold text-gray-900 text-sm">对话训练</h1>
            <p className="text-xs text-orange-600 flex items-center gap-1">
              <MessageCircle className="w-3 h-3" />
              AI 客户（刁难模式）
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!finished && (
            <button
              onClick={handleFinish}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              结束训练
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
            {/* Customer */}
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <span className="text-sm">😠</span>
              </div>
              <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 border shadow-sm max-w-[80%]">
                <p className="text-sm text-gray-800 leading-relaxed">{round.customer_question}</p>
              </div>
            </div>

            {/* Sales reply */}
            {round.sales_reply && (
              <div className="flex gap-3 flex-row-reverse">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-blue-600 text-xs">销售</span>
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
              <span className="text-sm">😠</span>
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
                <p className="text-sm text-gray-500 mb-2">共进行了 {rounds.length} 轮对话</p>
                <p className="text-xs text-gray-400">销售话术运用出色，AI 客户已被说服</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">训练结束</h3>
                <p className="text-sm text-gray-500 mb-2">共进行了 {rounds.length} 轮对话</p>
                <p className="text-xs text-gray-400">继续练习，提升说服能力</p>
              </>
            )}
            <button
              onClick={() => navigate('/employee/home')}
              className="mt-5 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              返回首页
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
              className="flex-1 border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none max-h-32"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">
            按 Enter 发送，自由对话直到 AI 被说服或点击结束训练
          </p>
        </div>
      )}
    </div>
  );
}
