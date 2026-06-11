import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getTrainingPlan, type TrainingPlanResult } from '../../api/knowledge';
import { Play, FileText, Headphones, BookOpen, GraduationCap, CheckCircle2, Loader2 } from 'lucide-react';

const typeIcon = (type: string) => {
  switch (type) {
    case 'video':
      return <Play className="w-4 h-4" />;
    case 'practice':
      return <Headphones className="w-4 h-4" />;
    case 'test':
      return <FileText className="w-4 h-4" />;
    case 'recording':
      return <BookOpen className="w-4 h-4" />;
    case 'exam':
      return <GraduationCap className="w-4 h-4" />;
    default:
      return <Play className="w-4 h-4" />;
  }
};

const typeLabel = (type: string) => {
  switch (type) {
    case 'video':
      return '视频';
    case 'practice':
      return '练习';
    case 'test':
      return '测试';
    case 'recording':
      return '录音';
    case 'exam':
      return '考核';
    default:
      return '学习';
  }
};

export function TrainingPlanPage() {
  const { currentRecordId, weakPoints } = useAppStore();
  const [plan, setPlan] = useState<TrainingPlanResult['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentRecordId) {
      setLoading(false);
      setError('暂无练习记录，无法生成培训计划');
      return;
    }
    setLoading(true);
    setError('');
    getTrainingPlan(currentRecordId)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setPlan(res.data);
        } else {
          setError('加载培训计划失败');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载培训计划失败'))
      .finally(() => setLoading(false));
  }, [currentRecordId]);

  if (loading) {
    return (
      <section className="fade-in flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </section>
    );
  }

  if (error || !plan) {
    return (
      <section className="fade-in p-6 text-center text-gray-500 bg-white rounded-2xl shadow-sm border">
        {error || '暂无培训计划'}
      </section>
    );
  }

  return (
    <section className="fade-in">
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-4">未来一周培训日程</h3>
            <div className="space-y-3">
              {plan.weekly.map((day, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-4 p-4 rounded-xl ${
                    day.type === 'exam' ? 'bg-green-50 border border-green-200' : 'bg-gray-50'
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-sm ${
                      day.type === 'exam' ? 'bg-green-200 text-green-700' : 'bg-blue-100 text-blue-600'
                    }`}
                  >
                    {day.day}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{day.title}</p>
                    <p className="text-sm text-gray-500">{day.duration || '学习计划'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {day.type === 'exam' ? (
                      <span className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm">考核日</span>
                    ) : (
                      <button className="px-3 py-1.5 bg-white border rounded-lg text-sm text-gray-600 hover:bg-gray-100 flex items-center gap-1">
                        {typeIcon(day.type)}
                        {typeLabel(day.type)}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-4">月度阶段目标</h3>
            <div className="relative pl-6 border-l-2 border-gray-200 space-y-6">
              {plan.monthly.map((goal, idx) => (
                <div key={idx} className="relative">
                  <div
                    className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-4 border-white ${
                      idx === 0 ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  />
                  <p className="font-medium text-gray-900">第{goal.week}周：{goal.title}</p>
                  <p className="text-sm text-gray-500">目标：{goal.target}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-4">学习建议</h3>
            <div className="space-y-3">
              {plan.recommendations.length === 0 ? (
                <p className="text-sm text-gray-400">暂无学习建议</p>
              ) : (
                plan.recommendations.map((r, idx) => (
                  <div key={idx} className="p-3 border rounded-lg bg-gray-50">
                    <p className="font-medium text-gray-900 text-sm">{r.topic}</p>
                    <p className="text-xs text-gray-500 mt-1">{r.reason}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-sm p-6 text-white">
            <h3 className="font-bold mb-3">考核标准</h3>
            <ul className="space-y-2 text-sm text-blue-100">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-white rounded-full" />
                模拟客户对话 + 语音复述
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-white rounded-full" />
                平均分 ≥ 85分
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-white rounded-full" />
                关键数据错误率为 0
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-white rounded-full" />
                下次考核：待定
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-3">薄弱点对应</h3>
            <div className="space-y-2">
              {weakPoints.length === 0 ? (
                <p className="text-sm text-gray-400">暂无薄弱点记录</p>
              ) : (
                weakPoints.map((wp) => (
                  <div key={wp.id} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-gray-700">{wp.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
