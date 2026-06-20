import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCircle, Building2, Shield, Calendar, RotateCcw, Trash2, X, Loader2, MessageCircle, BarChart3, MessageSquare, PhoneCall, Mail } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getPracticeList, getDebriefList, deletePractice, type PracticeRecordItem, type DebriefRecord, type DebriefAnalysis, retryAsr } from '../../api/debrief';
import { changePassword, logout } from '../../api/auth';
import { RadarChartComponent } from '../../components/RadarChart';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { ScoreBadge } from '../../components/ui/ScoreBadge';
import { Button } from '../../components/ui/Button';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../hooks/useToast';

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

export function ProfilePage() {
  const navigate = useNavigate();
  const { user } = useAppStore();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [history, setHistory] = useState<PracticeRecordItem[]>([]);
  const [debriefRecords, setDebriefRecords] = useState<DebriefRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: '', new: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [showPortraitModal, setShowPortraitModal] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      getPracticeList(user.id),
      getDebriefList(),
    ])
      .then(([practiceRes, debriefRes]) => {
        if (practiceRes.code === 0 && practiceRes.data) {
          setHistory(practiceRes.data.list);
        }
        if (debriefRes.code === 0 && debriefRes.data) {
          setDebriefRecords(debriefRes.data.list);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '网络错误'))
      .finally(() => setLoading(false));
  }, [user]);

  const roleLabel = user?.role === 'employee' ? '销售员工' : user?.role === 'manager' ? '销售主管' : '系统管理员';

  const completedRecords = debriefRecords.filter((r) => r.status === 'completed');

  // 复盘记录：取最新一条有 personalStyle 的记录
  const latestPostMeeting = completedRecords.find((r) => {
    const analysis = safeParseAnalysis(r);
    return r.debrief_mode === 'post_meeting' && analysis?.personalStyle;
  });
  const postMeetingAnalysis = latestPostMeeting ? safeParseAnalysis(latestPostMeeting) : undefined;
  let personalStyle = postMeetingAnalysis?.personalStyle;

  // 能力评估：取最新一条有 evaluation_result 的记录
  const latestCallRecording = completedRecords.find(
    (r) => r.debrief_mode === 'call_recording' && r.evaluation_result
  );
  const evaluation = latestCallRecording?.evaluation_result;
  const radarData = extractRadarData(evaluation);

  // 如果只有 call_recording 没有 post_meeting，尝试从 evaluation 生成默认风格
  if (!personalStyle && evaluation) {
    const score = evaluation.overallScore ?? 0;
    const weak = (evaluation.weakPoints || []).slice(0, 2).map((w: any) => w.name || w).filter(Boolean);
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

  const handleRetryAsr = async (recordId: string) => {
    try {
      await retryAsr(recordId);
      toast.success('重试已触发，请稍后刷新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重试失败');
    }
  };

  const handleDelete = async (recordId: string) => {
    if (!await confirm({ message: '确定要删除这条练习记录吗？删除后无法恢复。', variant: 'danger' })) return;
    try {
      await deletePractice(recordId);
      setHistory((prev) => prev.filter((h) => h.record_id !== recordId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="p-6 fade-in">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-6">
        <UserCircle className="w-6 h-6 text-blue-600" />
        个人中心
      </h1>

      <Card padding="lg" className="mb-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* 左侧：用户信息 */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-4 mb-6">
              <Avatar name={user?.name || ''} size="lg" className="w-16 h-16 text-2xl" />
              <div>
                <h2 className="text-xl font-bold text-gray-900">{user?.name}</h2>
                <p className="text-gray-500">{roleLabel}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1 flex items-center gap-1">
                  <Building2 className="w-4 h-4" />
                  工号
                </label>
                <p className="font-medium text-gray-900">{user?.employeeId}</p>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1 flex items-center gap-1">
                  <Shield className="w-4 h-4" />
                  角色权限
                </label>
                <p className="font-medium text-gray-900">{roleLabel}</p>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1 flex items-center gap-1">
                  <Mail className="w-4 h-4" />
                  邮箱
                </label>
                <p className="font-medium text-gray-900">{user?.email || '未绑定'}</p>
              </div>
            </div>
          </div>

          {/* 右侧：个人画像 */}
          <div className="lg:col-span-2 flex flex-col justify-center">
            <h2 className="text-lg font-bold text-gray-900 mb-4">个人画像</h2>
            {personalStyle || radarData ? (
              <div
                className="rounded-xl border p-5 cursor-pointer hover:shadow-md transition-shadow bg-gray-50/50"
                onClick={() => setShowPortraitModal(true)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    {personalStyle && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
                            {personalStyle.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {personalStyle.traits.map((trait: string, i: number) => (
                            <span key={i} className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm">
                              {trait}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <button className="text-blue-600 text-sm font-medium hover:underline ml-4 shrink-0">
                    查看完整画像 →
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border p-6 text-center text-gray-400 bg-gray-50/50">
                <UserCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">完成复盘后将生成个人画像</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100 flex gap-3">
          <Button onClick={() => { setShowPwdModal(true); setPwdForm({ old: '', new: '', confirm: '' }); setPwdError(''); }}>
            修改密码
          </Button>
        </div>
      </Card>

      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">复盘记录</h2>

        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">练习名称</th>
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 font-medium">时长</th>
                <th className="px-4 py-3 font-medium">综合得分</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-400" colSpan={6}>
                    加载中...
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td className="px-4 py-6 text-center text-red-600" colSpan={6}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && history.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-400" colSpan={6}>
                    暂无复盘记录
                  </td>
                </tr>
              )}
              {!loading &&
                history.map((h) => {
                  const isCallRecording = h.debrief_mode === 'call_recording';
                  return (
                    <tr key={h.record_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {h.product_line}
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
                        <span className="text-xs text-gray-400 ml-0.5">{h.practice_type}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(h.created_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDuration(h.duration)}</td>
                      <td className="px-4 py-3">
                        {h.overall_score !== undefined ? (
                          <ScoreBadge score={Math.round(h.overall_score)} />
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {h.status === 'completed' && (
                          <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs">已完成</span>
                        )}
                        {h.status === 'analyzing' && (
                          <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">分析中</span>
                        )}
                        {h.status === 'processing' && (
                          <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">处理中</span>
                        )}
                        {h.status === 'pending' && (
                          <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">排队中</span>
                        )}
                        {h.status === 'failed' && (
                          <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs">识别失败</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {h.status === 'completed' && isCallRecording && (
                            <>
                              <button
                                onClick={() => navigate(`/employee/debrief/${h.record_id}/dialogue-training`)}
                                className="flex items-center gap-1 text-orange-600 hover:underline text-xs"
                              >
                                <MessageCircle className="w-3 h-3" />
                                对话训练
                              </button>
                              <button
                                onClick={() => navigate(`/employee/debrief/${h.record_id}/report`)}
                                className="text-blue-600 hover:underline text-xs"
                              >
                                查看报告
                              </button>
                            </>
                          )}
                          {h.status === 'completed' && !isCallRecording && (
                            <button
                              onClick={() => navigate(`/employee/debrief/${h.record_id}`)}
                              className="text-blue-600 hover:underline text-xs"
                            >
                              查看总结
                            </button>
                          )}
                          {h.status === 'analyzing' && (
                            <span className="text-gray-400 text-xs">报告生成中...</span>
                          )}
                          {h.status === 'failed' && (
                            <button
                              onClick={() => handleRetryAsr(h.record_id)}
                              className="flex items-center gap-1 text-red-600 hover:underline text-xs"
                            >
                              <RotateCcw className="w-3 h-3" />
                              重试
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(h.record_id)}
                            className="flex items-center gap-1 text-gray-400 hover:text-red-600 text-xs"
                          >
                            <Trash2 className="w-3 h-3" />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Change password modal */}
      {showPwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPwdModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">修改密码</h3>
              <button onClick={() => setShowPwdModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            {pwdError && <p className="text-sm text-red-600 mb-3">{pwdError}</p>}

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">旧密码</label>
                <input type="password" value={pwdForm.old} onChange={(e) => setPwdForm({ ...pwdForm, old: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">新密码</label>
                <input type="password" value={pwdForm.new} onChange={(e) => setPwdForm({ ...pwdForm, new: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">确认新密码</label>
                <input type="password" value={pwdForm.confirm} onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowPwdModal(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">取消</button>
              <button
                onClick={async () => {
                  if (!pwdForm.old || !pwdForm.new || !pwdForm.confirm) { setPwdError('请填写所有字段'); return; }
                  if (pwdForm.new !== pwdForm.confirm) { setPwdError('两次输入的新密码不一致'); return; }
                  if (pwdForm.new.length < 6) { setPwdError('新密码至少6位'); return; }
                  setPwdLoading(true);
                  try {
                    const res = await changePassword(pwdForm.old, pwdForm.new);
                    if (res.code === 0) {
                      toast.success('密码修改成功，请重新登录');
                      logout();
                      navigate('/login');
                    } else {
                      setPwdError(res.message || '修改失败');
                    }
                  } catch { setPwdError('网络错误'); } finally { setPwdLoading(false); }
                }}
                disabled={pwdLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {pwdLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Personal portrait modal */}
      {showPortraitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPortraitModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">个人画像</h3>
              <button onClick={() => setShowPortraitModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-6">
              {/* 风格标签 */}
              {personalStyle && (
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
                      {personalStyle.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {personalStyle.traits.map((trait: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm">
                        {trait}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 能力雷达图 */}
              {radarData && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    能力雷达
                  </h3>
                  <RadarChartComponent data={radarData} />
                </div>
              )}

              {/* 优势与改进 */}
              {personalStyle && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                    <h4 className="font-medium text-green-900 mb-2">风格优势</h4>
                    <p className="text-sm text-green-800">{personalStyle.leverage}</p>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 rounded-lg p-4">
                    <h4 className="font-medium text-orange-900 mb-2">需要补强</h4>
                    <p className="text-sm text-orange-800">{personalStyle.improvement}</p>
                  </div>
                </div>
              )}

              {/* 学习建议 */}
              {learningSuggestions.length > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">学习建议</h4>
                  <ul className="space-y-2">
                    {learningSuggestions.map((s, i) => (
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

    </div>
  );
}
