import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, UserCircle, BarChart3, MessageSquare, PhoneCall, Calendar, Clock, X, Star } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getDebriefList, toggleShowcase, type DebriefRecord, type DebriefAnalysis } from '../../api/debrief';
import { RadarChartComponent } from '../../components/RadarChart';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ScoreBadge } from '../../components/ui/ScoreBadge';
import { Avatar } from '../../components/ui/Avatar';
import { Skeleton, SkeletonCircle } from '../../components/ui/Skeleton';

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(seconds: number) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}分${s}秒`;
}

function safeParseAnalysis(record: DebriefRecord): DebriefAnalysis | undefined {
  if (!record.analysis) return undefined;
  if (typeof record.analysis === 'string') {
    try {
      return JSON.parse(record.analysis) as DebriefAnalysis;
    } catch {
      return undefined;
    }
  }
  return record.analysis;
}

function extractRadarData(evaluation: any): { subject: string; score: number; threshold: number }[] | null {
  if (!evaluation) return null;
  if (evaluation.scores) {
    const s = evaluation.scores;
    const map: [string, string][] = [
      ['knowledgeCoverage', '知识覆盖'],
      ['coreHitRate', '核心命中'],
      ['dataAccuracy', '数据准确'],
      ['scriptMatch', '话术匹配'],
      ['structureScore', '结构完整'],
      ['fluencyScore', '表达流畅'],
    ];
    const data = map
      .filter(([key]) => typeof s[key] === 'number')
      .map(([key, label]) => ({ subject: label, score: Math.round(s[key]), threshold: 60 }));
    return data.length > 0 ? data : null;
  }
  if (evaluation.stageCoverage) {
    const sc = evaluation.stageCoverage;
    const map: [string, string][] = [
      ['opening', '开场破冰'],
      ['needsProbe', '需求挖掘'],
      ['productIntro', '产品介绍'],
      ['objection', '异议处理'],
      ['closing', '成交推进'],
    ];
    const data = map
      .filter(([key]) => sc[key]?.score !== undefined)
      .map(([key, label]) => ({
        subject: label,
        score: Math.round((sc[key].score <= 1 ? sc[key].score * 100 : sc[key].score)),
        threshold: 60,
      }));
    return data.length > 0 ? data : null;
  }
  return null;
}

interface EmployeeGroup {
  user_id: string;
  user_name: string;
  employee_id: string;
  records: DebriefRecord[];
  avgScore: number;
  latestDate: string;
}

function groupByEmployee(list: DebriefRecord[]): EmployeeGroup[] {
  const map = new Map<string, EmployeeGroup>();
  for (const item of list) {
    if (!item.user_id) continue;
    const existing = map.get(item.user_id);
    if (existing) {
      existing.records.push(item);
      if (item.created_at > existing.latestDate) existing.latestDate = item.created_at;
    } else {
      map.set(item.user_id, {
        user_id: item.user_id,
        user_name: item.user_name || '未知',
        employee_id: item.employee_id || '-',
        records: [item],
        latestDate: item.created_at,
        avgScore: 0,
      });
    }
  }
  for (const group of map.values()) {
    const scored = group.records.filter((r) => r.overall_score !== undefined && r.overall_score !== null);
    group.avgScore = scored.length > 0
      ? Math.round(scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length)
      : 0;
    group.records.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return Array.from(map.values()).sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}

function RecordCard({ record, onClick, onToggleShowcase }: { record: DebriefRecord; onClick: () => void; onToggleShowcase?: (e: React.MouseEvent) => void }) {
  const isCallRecording = record.debrief_mode === 'call_recording';
  const analysis = safeParseAnalysis(record);
  const score = analysis?.overallScore ?? record.overall_score;
  const title = record.title || record.product_line || '未命名';

  return (
    <Card padding="md" className="text-left hover:shadow-md transition-shadow relative">
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-900 truncate">{title}</span>
              <Badge variant={isCallRecording ? 'purple' : 'info'} className="text-[10px]">
                {isCallRecording ? '能力评估' : '复盘记录'}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(record.created_at)}
              </span>
              {record.duration !== undefined && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(record.duration)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {record.is_showcase && (
              <Badge variant="warning" className="text-[10px]">优秀</Badge>
            )}
            {score !== undefined && score !== null && (
              <ScoreBadge score={Math.round(score)} className="text-sm font-bold" />
            )}
          </div>
        </div>
      </button>
      {onToggleShowcase && (
        <button
          onClick={onToggleShowcase}
          className="absolute top-3 right-3 p-1 rounded hover:bg-amber-100 transition-colors"
        >
          <Star className={`w-4 h-4 ${record.is_showcase ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`} />
        </button>
      )}
    </Card>
  );
}

export function TeamListPage() {
  const navigate = useNavigate();
  const { user } = useAppStore();
  const [records, setRecords] = useState<DebriefRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showPortraitModal, setShowPortraitModal] = useState(false);

  // Showcase state
  const [showcaseModal, setShowcaseModal] = useState<{ recordId: string; userName: string } | null>(null);
  const [showcaseComment, setShowcaseComment] = useState('');
  const [submittingShowcase, setSubmittingShowcase] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getDebriefList()
      .then((res) => {
        if (res.code === 0 && res.data) {
          setRecords(res.data.list);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [user]);

  const groups = useMemo(() => groupByEmployee(records), [records]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.user_name.toLowerCase().includes(q) || g.employee_id.toLowerCase().includes(q)
    );
  }, [groups, search]);

  // 默认选中第一个员工
  useEffect(() => {
    if (!selectedUserId && filteredGroups.length > 0) {
      setSelectedUserId(filteredGroups[0].user_id);
    }
  }, [filteredGroups, selectedUserId]);

  const selectedGroup = useMemo(() => groups.find((g) => g.user_id === selectedUserId) || null, [groups, selectedUserId]);

  // 个人画像数据
  const portrait = useMemo(() => {
    if (!selectedGroup) return null;
    const completed = selectedGroup.records.filter((r) => r.status === 'completed');

    const latestPostMeeting = completed.find((r) => {
      const analysis = safeParseAnalysis(r);
      return r.debrief_mode !== 'call_recording' && analysis?.personalStyle;
    });
    const postMeetingAnalysis = latestPostMeeting ? safeParseAnalysis(latestPostMeeting) : undefined;
    let personalStyle = postMeetingAnalysis?.personalStyle;

    const latestCallRecording = completed.find(
      (r) => r.debrief_mode === 'call_recording' && r.evaluation_result
    );
    const evaluation = latestCallRecording?.evaluation_result;
    const radarData = extractRadarData(evaluation);

    if (!personalStyle && evaluation) {
      const score = evaluation.overallScore ?? 0;
      const weak = (evaluation.weakPoints || evaluation.weak_points || []).slice(0, 2).map((w: any) => w.name || w).filter(Boolean);
      personalStyle = {
        label: score >= 80 ? '专业型' : score >= 60 ? '稳健型' : '成长型',
        traits: score >= 80 ? ['表现优秀', '基础扎实'] : score >= 60 ? ['持续进步', '潜力较大'] : ['正在成长', '需要积累'],
        leverage: '通过反复练习巩固已掌握的知识点，逐步建立自信。',
        improvement: weak.length > 0 ? `建议重点关注：${weak.join('、')}。` : '继续多练习，积累更多实战经验。',
      };
    }

    let learningSuggestions = latestPostMeeting?.training_plan?.recommendations || [];
    if (learningSuggestions.length === 0 && latestCallRecording?.training_plan?.recommendations) {
      learningSuggestions = latestCallRecording.training_plan.recommendations;
    }

    return { personalStyle, radarData, learningSuggestions };
  }, [selectedGroup]);

  const postMeetingRecords = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.records.filter((r) => r.debrief_mode !== 'call_recording');
  }, [selectedGroup]);

  const callRecordingRecords = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.records.filter((r) => r.debrief_mode === 'call_recording');
  }, [selectedGroup]);

  const handleToggleShowcase = async (recordId: string, comment?: string) => {
    try {
      const res = await toggleShowcase(recordId, comment);
      if (res.code === 0) {
        setRecords((prev) =>
          prev.map((r) =>
            r.record_id === recordId ? { ...r, is_showcase: res.data.is_showcase } : r
          )
        );
      }
    } catch {
      // ignore
    }
  };

  const handleSubmitShowcase = async () => {
    if (!showcaseModal) return;
    setSubmittingShowcase(true);
    await handleToggleShowcase(showcaseModal.recordId, showcaseComment.trim() || undefined);
    setSubmittingShowcase(false);
    setShowcaseModal(null);
    setShowcaseComment('');
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row gap-4 fade-in">
      {/* 左侧：员工列表 */}
      <div className="md:w-72 md:shrink-0 bg-white rounded-xl border overflow-hidden flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-bold text-gray-900">团队员工</h2>
          <div className="relative mt-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索姓名/工号"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="space-y-3 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <SkeletonCircle size="md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="p-6 text-center text-red-600 text-sm">{error}</div>
          )}

          {!loading && !error && filteredGroups.length === 0 && (
            <div className="p-6 text-center text-gray-400 text-sm">未找到匹配的员工</div>
          )}

          {!loading && !error && filteredGroups.map((g) => (
            <button
              key={g.user_id}
              onClick={() => setSelectedUserId(g.user_id)}
              className={`w-full text-left px-4 py-3 border-b transition-colors ${selectedUserId === g.user_id ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}
            >
              <div className="font-medium text-sm text-gray-900">{g.user_name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {g.employee_id} · {g.records.length}次复盘 · 均分{g.avgScore || '-'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧：员工详情 */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {!selectedGroup && !loading && (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <UserCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>请选择左侧员工查看详情</p>
            </div>
          </div>
        )}

        {selectedGroup && (
          <div className="space-y-4 pb-6">
            {/* 个人信息头部 */}
            <Card className="flex items-center gap-4">
              <Avatar name={selectedGroup.user_name} size="lg" />
              <div>
                <h2 className="font-bold text-gray-900">{selectedGroup.user_name}</h2>
                <p className="text-sm text-gray-500">{selectedGroup.employee_id} · {selectedGroup.records.length}次复盘 · 平均分 {selectedGroup.avgScore || '-'}</p>
              </div>
            </Card>

            {/* 个人画像 — 紧凑卡片 */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  个人画像
                </h3>
                {(portrait?.personalStyle || portrait?.radarData) && (
                  <button
                    onClick={() => setShowPortraitModal(true)}
                    className="text-blue-600 text-sm font-medium hover:underline"
                  >
                    查看完整画像 →
                  </button>
                )}
              </div>

              {portrait?.personalStyle || portrait?.radarData ? (
                <div>
                  {portrait.personalStyle && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
                        {portrait.personalStyle.label}
                      </span>
                      {portrait.personalStyle.traits.map((trait, i) => (
                        <span key={i} className="px-2.5 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs">
                          {trait}
                        </span>
                      ))}
                    </div>
                  )}
                  {!portrait.personalStyle && portrait.radarData && (
                    <p className="text-sm text-gray-500">已有评估数据，点击上方查看完整画像</p>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-400 py-6">
                  <UserCircle className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">该员工暂无画像，完成复盘后将自动生成</p>
                </div>
              )}
            </Card>

            {/* 复盘记录 */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* 复盘记录 */}
              <div>
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                  复盘记录
                  <span className="text-xs font-normal text-gray-400">({postMeetingRecords.length})</span>
                </h3>
                <div className="space-y-3">
                  {postMeetingRecords.map((r) => (
                    <RecordCard
                      key={r.record_id}
                      record={r}
                      onClick={() => navigate(`/manager/team/${r.record_id}/debrief`)}
                    />
                  ))}
                  {postMeetingRecords.length === 0 && (
                    <p className="text-sm text-gray-400 py-2">暂无复盘记录</p>
                  )}
                </div>
              </div>

              {/* 能力评估 */}
              <div>
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-purple-600" />
                  能力评估
                  <span className="text-xs font-normal text-gray-400">({callRecordingRecords.length})</span>
                </h3>
                <div className="space-y-3">
                  {callRecordingRecords.map((r) => (
                    <RecordCard
                      key={r.record_id}
                      record={r}
                      onClick={() => navigate(`/manager/team/${r.record_id}`)}
                      onToggleShowcase={
                        r.status === 'completed'
                          ? (e) => {
                              e.stopPropagation();
                              if (r.is_showcase) {
                                handleToggleShowcase(r.record_id);
                              } else {
                                setShowcaseComment('');
                                setShowcaseModal({ recordId: r.record_id, userName: selectedGroup?.user_name || '' });
                              }
                            }
                          : undefined
                      }
                    />
                  ))}
                  {callRecordingRecords.length === 0 && (
                    <p className="text-sm text-gray-400 py-2">暂无能力评估记录</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 个人画像弹窗 */}
      {showPortraitModal && portrait && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPortraitModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">{selectedGroup.user_name} 的个人画像</h3>
              <button onClick={() => setShowPortraitModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-6">
              {/* 风格标签 */}
              {portrait.personalStyle && (
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
                      {portrait.personalStyle.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {portrait.personalStyle.traits.map((trait, i) => (
                      <span key={i} className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm">
                        {trait}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 能力雷达图 */}
              {portrait.radarData && (
                <div>
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    能力雷达
                  </h4>
                  <div className="h-64 w-full">
                    <RadarChartComponent data={portrait.radarData} />
                  </div>
                </div>
              )}

              {/* 优势与改进 */}
              {portrait.personalStyle && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                    <h4 className="font-medium text-green-900 mb-2">风格优势</h4>
                    <p className="text-sm text-green-800">{portrait.personalStyle.leverage}</p>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 rounded-lg p-4">
                    <h4 className="font-medium text-orange-900 mb-2">需要补强</h4>
                    <p className="text-sm text-orange-800">{portrait.personalStyle.improvement}</p>
                  </div>
                </div>
              )}

              {/* 学习建议 */}
              {portrait.learningSuggestions && portrait.learningSuggestions.length > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">学习建议</h4>
                  <ul className="space-y-2">
                    {portrait.learningSuggestions.map((s, i) => (
                      <li key={i} className="text-sm text-blue-800">
                        <span className="font-medium">{s.topic}</span>
                        <span className="text-blue-600 ml-1">— {s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Showcase comment modal */}
      {showcaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowcaseModal(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-bold text-gray-900">推荐为优秀录音</h3>
              <button onClick={() => setShowcaseModal(null)} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-3">
                将 <span className="font-medium">{showcaseModal.userName}</span> 的录音推荐为优秀展示，全团队可见。
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1">推荐评语（选填）</label>
              <textarea
                value={showcaseComment}
                onChange={(e) => setShowcaseComment(e.target.value)}
                placeholder="写下推荐理由，帮助员工学习这段录音的亮点..."
                className="w-full border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none"
                rows={3}
              />
            </div>
            <div className="px-6 pb-4 flex justify-end gap-2">
              <button
                onClick={() => setShowcaseModal(null)}
                className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSubmitShowcase}
                disabled={submittingShowcase}
                className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1"
              >
                {submittingShowcase && <Loader2 className="w-4 h-4 animate-spin" />}
                确认推荐
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
