import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, HelpCircle, Sparkles, Loader2, Trash2, AlertCircle, CheckCircle, BookOpen } from 'lucide-react';
import { getQuizzesByMaterial, generateQuizzesForMaterial, deleteQuiz, type Quiz } from '../../api/quiz';
import { getMaterialById, type MaterialItem } from '../../api/knowledge';
import { useConfirm } from '../../hooks/useConfirm';

const difficultyMap = {
  easy: { label: '简单', color: 'bg-green-50 text-green-700' },
  medium: { label: '中等', color: 'bg-yellow-50 text-yellow-700' },
  hard: { label: '困难', color: 'bg-red-50 text-red-700' },
};

export function MaterialQuizManagePage() {
  const { materialId } = useParams<{ materialId: string }>();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [material, setMaterial] = useState<MaterialItem | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, [materialId]);

  async function loadData() {
    if (!materialId) return;
    setLoading(true);
    setError('');
    try {
      const [materialRes, quizRes] = await Promise.all([
        getMaterialById(materialId),
        getQuizzesByMaterial(materialId),
      ]);
      if (materialRes.code === 0 && materialRes.data) {
        setMaterial(materialRes.data);
      }
      if (quizRes.code === 0 && quizRes.data) {
        setQuizzes(quizRes.data.list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    if (!await confirm({ title: 'AI 生成练习题', message: '将基于该培训资料AI生成10道练习题，此过程可能需要20-40秒，是否继续？', variant: 'warning' })) return;
    setGenerating(true);
    setError('');
    setSuccess('');
    try {
      const res = await generateQuizzesForMaterial(materialId!);
      if (res.code === 0 && res.data) {
        setSuccess(`成功生成 ${res.data.count} 道题目！`);
        await loadData();
      } else {
        setError('生成失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(quizId: string) {
    if (!await confirm({ message: '确定删除这道题目？', variant: 'danger' })) return;
    setDeletingId(quizId);
    try {
      const res = await deleteQuiz(quizId);
      if (res.code === 0) {
        setQuizzes((prev) => prev.filter((q) => q.quiz_id !== quizId));
      } else {
        setError(res.message || '删除失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  }

  const backPath = location.pathname.startsWith('/admin') ? '/admin/knowledge' : '/manager/knowledge';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(backPath)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">题目管理</h1>
            <p className="text-sm text-gray-500">{material?.title || '加载中...'}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700 mb-4">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 text-green-700 mb-4">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{success}</p>
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">
            {loading ? '加载中...' : `共 ${quizzes.length} 道题目`}
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI生成题目
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto mb-2" />
            <p className="text-sm text-gray-400">加载中...</p>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="bg-white rounded-xl border p-10 text-center">
            <HelpCircle className="w-12 h-12 text-purple-300 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">暂无题目</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
              该资料还没有配置练习题，点击上方"AI生成题目"按钮，系统将基于该资料自动生成10道练习题。
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI生成题目
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {quizzes.map((quiz, idx) => (
              <div key={quiz.quiz_id} className="bg-white rounded-xl border p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-medium text-gray-400">{idx + 1}.</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${difficultyMap[quiz.difficulty]?.color || 'bg-gray-100 text-gray-600'}`}>
                        {difficultyMap[quiz.difficulty]?.label || quiz.difficulty}
                      </span>
                      {quiz.category && (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{quiz.category}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 mb-3">{quiz.question}</p>
                    <div className="space-y-2 mb-4">
                      {quiz.options.map((opt, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                            i === quiz.correct_index
                              ? 'bg-green-50 text-green-700 border border-green-200'
                              : 'bg-gray-50 text-gray-600'
                          }`}
                        >
                          {i === quiz.correct_index ? (
                            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                          ) : (
                            <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                          )}
                          <span>{opt}</span>
                        </div>
                      ))}
                    </div>
                    {quiz.explanation && (
                      <div className="bg-purple-50 rounded-lg p-3 text-sm text-purple-800 flex items-start gap-2">
                        <BookOpen className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{quiz.explanation}</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(quiz.quiz_id)}
                    disabled={deletingId === quiz.quiz_id}
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors shrink-0"
                    title="删除"
                  >
                    {deletingId === quiz.quiz_id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
