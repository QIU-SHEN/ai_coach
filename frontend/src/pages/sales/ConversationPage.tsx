import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, FileText } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { startDialogueRound, submitReply, type DialogueRound } from '../../api/debrief';

interface RoundScore {
  round_number: number;
  score: number;
  feedback: string;
  strengths?: string[];
  weaknesses?: string[];
  missed_points?: string[];
}

export function ConversationPage() {
  const { currentRecordId, setStep } = useAppStore();

  const [rounds, setRounds] = useState<DialogueRound[]>([]);
  const [scores, setScores] = useState<RoundScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [finished, setFinished] = useState(false);
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch first round on mount
  useEffect(() => {
    let mounted = true;
    if (!currentRecordId) {
      setError('未找到练习记录，请重新上传音频');
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    setError(null);
    startDialogueRound(currentRecordId, 1)
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
    return () => {
      mounted = false;
    };
  }, [currentRecordId]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [rounds, loading, finished, analysisVisible]);

  const currentRound = rounds[rounds.length - 1];
  const totalRounds = 5;
  const currentRoundNumber = currentRound?.round_number ?? 1;

  const getScoreForRound = (roundNumber: number) =>
    scores.find((s) => s.round_number === roundNumber);

  const handleSend = async () => {
    if (!input.trim() || loading || !currentRecordId) return;
    const reply = input.trim();
    const roundNum = currentRound?.round_number ?? 1;
    setInput('');
    setLoading(true);
    setError(null);

    try {
      // Step 1: Submit reply and get score
      const replyRes = await submitReply(currentRecordId, roundNum, reply);
      if (replyRes.code !== 0 || !replyRes.data) {
        setError(replyRes.message || '提交失败');
        return;
      }
      const replyData = replyRes.data;

      setRounds((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], sales_reply: reply };
        return updated;
      });

      if (replyData.score !== undefined) {
        setScores((prev) => [
          ...prev,
          {
            round_number: replyData.round_number,
            score: replyData.score,
            feedback: replyData.feedback || '',
            strengths: replyData.strengths,
            weaknesses: replyData.weaknesses,
            missed_points: replyData.missed_points,
          },
        ]);
      }

      // Step 2: Fetch next round question
      const nextRoundNumber = roundNum + 1;
      const isLast = nextRoundNumber > totalRounds;

      if (isLast) {
        setFinished(true);
      } else {
        try {
          const nextRes = await startDialogueRound(currentRecordId, nextRoundNumber);
          if (nextRes.code === 0 && nextRes.data) {
            setRounds((prev) => [
              ...prev,
              {
                round_number: nextRes.data.round_number,
                customer_question: nextRes.data.customer_question,
                difficulty: nextRes.data.difficulty,
                expected_focus: nextRes.data.expected_focus,
                is_last_round: isLast,
              },
            ]);
          }
        } catch {
          setFinished(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const difficultyMap: Record<string, string> = {
    easy: '简单',
    medium: '中等',
    hard: '困难',
  };

  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)
      : 0;

  if (initialLoading) {
    return (
      <section className="fade-in">
        <div className="bg-white rounded-2xl shadow-sm border p-10 text-center text-gray-500">
          <div className="flex justify-center mb-4">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
          <p>正在加载对话...</p>
        </div>
      </section>
    );
  }

  if (error && rounds.length === 0) {
    return (
      <section className="fade-in">
        <div className="bg-white rounded-2xl shadow-sm border p-10 text-center text-red-600">
          <p className="mb-4">{error}</p>
          <button
            onClick={() => setStep(1)}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            返回上传
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="fade-in">
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="bg-gray-50 border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">AI 客户模拟对话</h2>
            <p className="text-sm text-gray-500">
              针对薄弱点进行实战演练 · 当前难度:
              <span className="font-medium text-blue-600 ml-1">
                {difficultyMap[currentRound?.difficulty ?? ''] || currentRound?.difficulty || '-'}
              </span>
            </p>
          </div>
          <div className="text-sm text-gray-500">
            轮次: <span className="font-bold text-gray-900">{Math.min(currentRoundNumber, totalRounds)}</span> / {totalRounds}
          </div>
        </div>

        <div ref={containerRef} className="h-96 overflow-y-auto p-6 space-y-4 bg-white">
          {rounds.map((round, idx) => {
            const score = getScoreForRound(round.round_number);
            const showScore = analysisVisible && score !== undefined;
            return (
              <div key={idx} className="space-y-4">
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tl-none px-4 py-3 max-w-[80%]">
                    <p className="text-sm font-medium text-gray-500 mb-1">
                      AI客户 · 第{round.round_number}轮 · {difficultyMap[round.difficulty] || round.difficulty}
                    </p>
                    <p>{round.customer_question}</p>
                    {round.expected_focus && (
                      <p className="text-xs text-gray-400 mt-1">期望方向: {round.expected_focus}</p>
                    )}
                  </div>
                </div>
                {round.sales_reply && (
                  <div className="flex justify-end">
                    <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-3 max-w-[80%]">
                      <p>{round.sales_reply}</p>
                      {showScore && (
                        <div className="mt-2 pt-2 border-t border-blue-500/50 text-xs text-blue-100 space-y-1">
                          <p>
                            本轮评分: <span className="font-bold">{score.score}分</span> · {score.feedback}
                          </p>
                          {score.strengths && score.strengths.length > 0 && (
                            <p>亮点: {score.strengths.join('、')}</p>
                          )}
                          {score.weaknesses && score.weaknesses.length > 0 && (
                            <p>不足: {score.weaknesses.join('、')}</p>
                          )}
                          {score.missed_points && score.missed_points.length > 0 && (
                            <p>遗漏: {score.missed_points.join('、')}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {loading && (
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
          {error && rounds.length > 0 && (
            <div className="text-center text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-2 underline hover:no-underline"
              >
                关闭
              </button>
            </div>
          )}
        </div>

        {!finished ? (
          <div className="border-t p-4 bg-gray-50">
            <div className="flex gap-3">
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
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                发送
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">提示：也可用语音回答（演示模式暂支持文本输入）</p>
          </div>
        ) : !analysisVisible ? (
          <div className="border-t p-6 bg-gray-50 text-center space-y-3">
            <p className="text-gray-700">对话练习已完成，共 {rounds.length} 轮应答</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setAnalysisVisible(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                让 AI 分析我的回答
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-6 py-2 border rounded-lg font-medium hover:bg-gray-100 flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                跳过分析，直接查看诊断报告
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t p-6 bg-gray-50 text-center space-y-3">
            <p className="text-gray-700">
              AI 分析完成，综合评分:{' '}
              <span className="font-bold text-blue-600">{avgScore}分</span>
            </p>
            <button
              onClick={() => setStep(4)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
            >
              查看诊断报告
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
