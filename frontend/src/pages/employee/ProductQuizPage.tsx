import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, HelpCircle, CheckCircle, XCircle, BookOpen, AlertCircle, RotateCcw, Trophy } from 'lucide-react';
import { getProductLines, type ProductLine } from '../../api/knowledge';
import { getQuizzes, getQuizzesByMaterial, submitAttempt, getQuizProgress, type Quiz } from '../../api/quiz';

interface AttemptResult {
  quizId: string;
  selectedIndex: number;
  isCorrect: boolean;
  correctIndex: number;
  showResult: boolean;
}

export function ProductQuizPage() {
  const { productLineId, materialId } = useParams<{ productLineId: string; materialId: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductLine | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState<Record<string, AttemptResult>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ total: 0, attempted: 0, correct: 0, accuracy: 0 });
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isMaterialMode = Boolean(materialId);

  useEffect(() => {
    loadData();
  }, [productLineId, materialId]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const plPromise = productLineId && !isMaterialMode
        ? getProductLines().then((res) => {
            if (res.code === 0 && res.data) {
              return res.data.list.find((p) => p.product_line_id === productLineId) || null;
            }
            return null;
          })
        : Promise.resolve(null);

      let quizRes: { code: number; data?: { list: Quiz[] } };
      let progRes: { code: number; data?: { total: number; attempted: number; correct: number; accuracy: number } };

      if (isMaterialMode && materialId) {
        [quizRes, progRes] = await Promise.all([
          getQuizzesByMaterial(materialId),
          Promise.resolve({ code: 0, data: { total: 0, attempted: 0, correct: 0, accuracy: 0 } }),
        ]);
      } else {
        [quizRes, progRes] = await Promise.all([
          getQuizzes(productLineId || undefined),
          getQuizProgress(productLineId || undefined),
        ]);
      }

      const loadedQuizzes = quizRes.code === 0 && quizRes.data ? quizRes.data.list : [];
      setQuizzes(loadedQuizzes);

      // Pre-populate attempts from server data
      const preloaded: Record<string, AttemptResult> = {};
      loadedQuizzes.forEach((q) => {
        if (q.my_attempt) {
          preloaded[q.quiz_id] = {
            quizId: q.quiz_id,
            selectedIndex: q.my_attempt.selected_index,
            isCorrect: q.my_attempt.is_correct,
            correctIndex: q.correct_index,
            showResult: true,
          };
        }
      });
      setAttempts(preloaded);

      if (isMaterialMode) {
        // Client-side progress for material mode
        const attempted = loadedQuizzes.filter((q) => q.my_attempt).length;
        const correct = loadedQuizzes.filter((q) => q.my_attempt?.is_correct).length;
        setProgress({
          total: loadedQuizzes.length,
          attempted,
          correct,
          accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : 0,
        });
      } else if (progRes.code === 0 && progRes.data) {
        setProgress(progRes.data);
      }

      const plRes = await plPromise;
      setProduct(plRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(quizId: string, selectedIndex: number) {
    if (attempts[quizId]?.showResult) return;
    setSubmittingId(quizId);
    try {
      const res = await submitAttempt(quizId, selectedIndex);
      if (res.code === 0 && res.data) {
        setAttempts((prev) => ({
          ...prev,
          [quizId]: {
            quizId,
            selectedIndex,
            isCorrect: res.data!.is_correct,
            correctIndex: res.data!.correct_index,
            showResult: true,
          },
        }));

        if (isMaterialMode) {
          // Client-side progress refresh for material mode
          setQuizzes((prev) =>
            prev.map((q) =>
              q.quiz_id === quizId
                ? { ...q, my_attempt: { selected_index: selectedIndex, is_correct: res.data!.is_correct } }
                : q
            )
          );
          setProgress((prev) => {
            const newAttempted = Math.min(prev.attempted + (attempts[quizId] ? 0 : 1), prev.total);
            const newCorrect = prev.correct + (res.data!.is_correct ? 1 : attempts[quizId]?.isCorrect ? 0 : 0) - (attempts[quizId]?.isCorrect ? 1 : 0);
            return {
              total: prev.total,
              attempted: newAttempted,
              correct: newCorrect,
              accuracy: newAttempted > 0 ? Math.round((newCorrect / newAttempted) * 100) : 0,
            };
          });
        } else {
          // Refresh progress from server for product-line mode
          const progRes = await getQuizProgress(productLineId);
          if (progRes.code === 0 && progRes.data) {
            setProgress(progRes.data);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmittingId(null);
    }
  }

  function handleReset() {
    if (!confirm('确定要重新做题吗？之前的答题记录将保留。')) return;
    setAttempts({});
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  function scrollToQuestion(quizId: string) {
    const el = questionRefs.current[quizId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const pageTitle = isMaterialMode
    ? '资料题目练习'
    : productLineId && product
    ? '题目练习'
    : '综合题目练习';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                navigate(
                  productLineId && !isMaterialMode
                    ? `/employee/learning/product/${productLineId}`
                    : '/employee/learning'
                )
              }
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{pageTitle}</h1>
              {product && <p className="text-sm text-gray-500">{product.name}</p>}
            </div>
          </div>
          {quizzes.length > 0 && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              重新做题
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {quizzes.length === 0 ? (
          <div className="bg-white rounded-xl border p-10 text-center">
            <HelpCircle className="w-12 h-12 text-purple-300 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">暂无题目</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              {isMaterialMode
                ? '该资料还没有配置练习题，请联系主管或管理员添加题目。'
                : productLineId && product
                ? '该产品还没有配置练习题，请联系主管或管理员添加题目。'
                : '暂无可练习题目，请联系主管或管理员添加题目。'}
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Center: questions */}
            <div className="max-w-3xl mx-auto space-y-6">
              {/* Progress */}
              <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  <span className="text-sm font-medium text-gray-700">进度</span>
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${progress.total > 0 ? (progress.attempted / progress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="text-sm text-gray-600">
                  <span className="font-medium">{progress.attempted}</span> / {progress.total} 题
                  {progress.attempted > 0 && (
                    <span className="ml-2">
                      正确 <span className="font-medium text-green-600">{progress.correct}</span> 题
                      （{progress.accuracy}%）
                    </span>
                  )}
                </div>
              </div>

              {quizzes.map((quiz, idx) => {
                const attempt = attempts[quiz.quiz_id];
                return (
                  <div
                    key={quiz.quiz_id}
                    ref={(el) => { questionRefs.current[quiz.quiz_id] = el; }}
                    className="bg-white rounded-xl border p-6 scroll-mt-6"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-medium text-gray-400">{idx + 1}.</span>
                      {attempt?.showResult && (
                        attempt.isCorrect ? (
                          <span className="flex items-center gap-1 text-sm text-green-600">
                            <CheckCircle className="w-4 h-4" /> 正确
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-sm text-red-600">
                            <XCircle className="w-4 h-4" /> 错误
                          </span>
                        )
                      )}
                    </div>

                    <p className="text-sm font-medium text-gray-900 mb-4">{quiz.question}</p>

                    <div className="space-y-2">
                      {quiz.options.map((opt, i) => {
                        let btnClass = 'border-gray-200 hover:bg-gray-50 text-gray-700';
                        if (attempt?.showResult) {
                          if (i === attempt.correctIndex) {
                            btnClass = 'bg-green-50 border-green-300 text-green-700';
                          } else if (i === attempt.selectedIndex && !attempt.isCorrect) {
                            btnClass = 'bg-red-50 border-red-300 text-red-700';
                          } else {
                            btnClass = 'border-gray-100 text-gray-400';
                          }
                        }
                        return (
                          <button
                            key={i}
                            onClick={() => handleSelect(quiz.quiz_id, i)}
                            disabled={attempt?.showResult || submittingId === quiz.quiz_id}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-sm text-left transition-colors ${btnClass} disabled:cursor-default`}
                          >
                            <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs shrink-0 ${
                              attempt?.showResult && i === attempt.correctIndex
                                ? 'bg-green-500 border-green-500 text-white'
                                : attempt?.showResult && i === attempt.selectedIndex && !attempt.isCorrect
                                ? 'bg-red-500 border-red-500 text-white'
                                : 'border-gray-300'
                            }`}>
                              {String.fromCharCode(65 + i)}
                            </span>
                            <span>{opt}</span>
                            {attempt?.showResult && i === attempt.correctIndex && (
                              <CheckCircle className="w-4 h-4 text-green-600 ml-auto shrink-0" />
                            )}
                            {attempt?.showResult && i === attempt.selectedIndex && !attempt.isCorrect && (
                              <XCircle className="w-4 h-4 text-red-600 ml-auto shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {attempt?.showResult && quiz.explanation && (
                      <div className="mt-4 bg-purple-50 rounded-lg p-4 flex items-start gap-2">
                        <BookOpen className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-purple-800 mb-1">解析</p>
                          <p className="text-sm text-purple-700">{quiz.explanation}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right: answer card */}
            <div className="fixed right-6 top-24 w-64 hidden xl:block">
              <div className="bg-white rounded-xl border p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">答题卡</h3>
                <div className="grid grid-cols-5 gap-2">
                  {quizzes.map((quiz, idx) => {
                    const attempt = attempts[quiz.quiz_id];
                    let statusClass = 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600';
                    if (attempt?.showResult) {
                      statusClass = attempt.isCorrect
                        ? 'bg-green-50 text-green-700 border-green-300'
                        : 'bg-red-50 text-red-700 border-red-300';
                    }
                    return (
                      <button
                        key={quiz.quiz_id}
                        onClick={() => scrollToQuestion(quiz.quiz_id)}
                        className={`aspect-square rounded-lg border text-sm font-medium flex items-center justify-center transition-colors ${statusClass}`}
                        title={`第 ${idx + 1} 题`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-green-50 border border-green-300" /> 正确
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-red-50 border border-red-300" /> 错误
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-gray-50 border border-gray-200" /> 未做
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
