import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { getPracticeList, type PracticeRecordItem, getShowcaseList, type ShowcaseItem } from '../../api/debrief';
import { BookOpen, ClipboardList, Calendar, Clock, ArrowRight, Headphones, X, Play, Star, MessageCircle, MessageSquare, PhoneCall } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { ScoreBadge } from '../../components/ui/ScoreBadge';
import { Button } from '../../components/ui/Button';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}分${s}秒`;
}

function resolveAudioUrl(url: string) {
  if (!url) return '';
  // Replace old localhost URLs with current API base
  if (url.startsWith('http://localhost:')) {
    return url.replace(/^http:\/\/localhost:\d+/, API_BASE);
  }
  // Already a full URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Relative path — ensure leading slash
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE}${path}`;
}

function ShowcaseModal({ item, onClose }: { item: ShowcaseItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-2 sm:mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b bg-amber-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
            优秀录音 · {item.user_name}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-4 text-sm">
            <span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg">{item.product_line}</span>
            <span className="font-bold text-green-600 text-lg">{Math.round(item.overall_score)}分</span>
            <span className="text-gray-400">{formatDuration(item.duration)}</span>
          </div>

          <audio controls className="w-full" preload="auto" src={resolveAudioUrl(item.audio_url)} />

          {item.comment && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-2 font-medium">主管推荐语</p>
              <p className="text-sm text-gray-700 leading-relaxed">{item.comment}</p>
            </div>
          )}
        </div>
        <div className="px-6 pb-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmployeeHomePage() {
  const navigate = useNavigate();
  const { user } = useAppStore();
  const [recentPractices, setRecentPractices] = useState<PracticeRecordItem[]>([]);
  const [loadingPractices, setLoadingPractices] = useState(true);
  const [showcaseList, setShowcaseList] = useState<ShowcaseItem[]>([]);
  const [selectedShowcase, setSelectedShowcase] = useState<ShowcaseItem | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoadingPractices(true);
    getPracticeList(user.id)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setRecentPractices(res.data.list.slice(0, 5));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPractices(false));
  }, [user]);

  useEffect(() => {
    getShowcaseList(10)
      .then((res) => {
        if (res.code === 0 && res.data) setShowcaseList(res.data.list);
      })
      .catch(() => {});
  }, []);

  const quickActions = [
    { label: '销售能力诊断', icon: ClipboardList, to: '/employee/diagnosis', color: 'bg-purple-600' },
    { label: '培训资料学习', icon: BookOpen, to: '/employee/learning', color: 'bg-green-600' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 fade-in">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">欢迎回来，{user?.name}</h1>
        <p className="text-gray-500 mt-1 text-sm">工号：{user?.employeeId}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {quickActions.map((a) => (
          <button
            key={a.label}
            onClick={() => navigate(a.to)}
            className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all text-left"
          >
            <div className={`w-10 h-10 rounded-lg ${a.color} text-white flex items-center justify-center`}>
              <a.icon className="w-5 h-5" />
            </div>
            <span className="font-medium text-gray-900">{a.label}</span>
          </button>
        ))}
      </div>

      {/* 最近练习 + 优秀录音 并列 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
        {/* 左侧：最近复盘 */}
        <Card className="lg:col-span-3" padding="lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base md:text-lg font-bold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              最近复盘
            </h2>
            <button
              onClick={() => navigate('/employee/debrief')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              查看全部 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {loadingPractices ? (
            <p className="text-sm text-gray-400 py-4">加载中...</p>
          ) : recentPractices.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">暂无复盘记录，快去开始第一次复盘吧</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentPractices.map((p) => {
                const isCallRecording = p.debrief_mode === 'call_recording';
                return (
                  <div key={p.record_id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900 text-sm">{p.product_line}</p>
                        {isCallRecording ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                            <PhoneCall className="w-3 h-3" />
                            能力评估
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                            <MessageSquare className="w-3 h-3" />
                            复盘记录
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-500 mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(p.created_at)}
                        </span>
                        <span>{formatDuration(p.duration)}</span>
                        {p.overall_score !== undefined && (
                          <ScoreBadge score={Math.round(p.overall_score)} />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.status === 'completed' && isCallRecording && (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => navigate(`/employee/debrief/${p.record_id}/dialogue-training`)}
                            className="text-xs px-2.5 py-1.5"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">对话训练</span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(`/employee/debrief/${p.record_id}/report`)}
                            className="text-xs px-2.5 py-1.5"
                          >
                            <span className="hidden sm:inline">查看报告</span>
                            <span className="sm:hidden">报告</span>
                          </Button>
                        </>
                      )}
                      {p.status === 'completed' && !isCallRecording && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`/employee/debrief/${p.record_id}`)}
                          className="text-xs px-2.5 py-1.5"
                        >
                          查看总结
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 右侧：优秀录音推荐 */}
        <Card className="lg:col-span-2" padding="lg">
          <h2 className="text-base md:text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Headphones className="w-5 h-5 text-amber-500" />
            优秀录音推荐
          </h2>
          {showcaseList.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">暂无优秀录音推荐</p>
          ) : (
            <div className="space-y-2">
              {showcaseList.map((item, idx) => (
                <button
                  key={item.record_id}
                  onClick={() => setSelectedShowcase(item)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-amber-50 transition-colors text-left group"
                >
                  <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.user_name}</p>
                    <p className="text-xs text-gray-500">{item.product_line}</p>
                  </div>
                  <span className="text-sm font-bold text-green-600 shrink-0">{Math.round(item.overall_score)}分</span>
                  <Play className="w-4 h-4 text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 弹窗 */}
      {selectedShowcase && (
        <ShowcaseModal item={selectedShowcase} onClose={() => setSelectedShowcase(null)} />
      )}
    </div>
  );
}
