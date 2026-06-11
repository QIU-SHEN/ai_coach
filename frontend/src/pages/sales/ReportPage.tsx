import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Target, BookOpen, MessageSquareText, BarChart3, LayoutTemplate, Mic } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { RadarChartComponent } from '../../components/RadarChart';
import { getEvaluation, type EvaluationResult, type EvaluationScores } from '../../api/debrief';

const scoreLabels: { key: keyof EvaluationScores; label: string; icon: typeof Target; desc: string }[] = [
  { key: 'knowledgeCoverage', label: '知识覆盖', icon: BookOpen, desc: '提到的知识点占应知知识点的比例' },
  { key: 'coreHitRate', label: '核心命中', icon: Target, desc: '命中高优先级卖点的比例' },
  { key: 'dataAccuracy', label: '数据准确', icon: BarChart3, desc: '提到的事实与知识库一致的比例' },
  { key: 'scriptMatch', label: '话术匹配', icon: MessageSquareText, desc: '使用了推荐话术的比例' },
  { key: 'structureScore', label: '结构完整', icon: LayoutTemplate, desc: '销售流程各阶段覆盖情况' },
  { key: 'fluencyScore', label: '表达流畅', icon: Mic, desc: '语速、填充词、停顿质量' },
];

const severityClass = (severity: string) => {
  switch (severity) {
    case 'high': return 'bg-red-50 border-red-500';
    case 'medium': return 'bg-orange-50 border-orange-500';
    case 'low': return 'bg-yellow-50 border-yellow-500';
    default: return 'bg-gray-50 border-gray-500';
  }
};

const severityText = (severity: string) => {
  switch (severity) {
    case 'high': return 'text-red-900';
    case 'medium': return 'text-orange-900';
    case 'low': return 'text-yellow-900';
    default: return 'text-gray-900';
  }
};

const severitySubText = (severity: string) => {
  switch (severity) {
    case 'high': return 'text-red-800';
    case 'medium': return 'text-orange-800';
    case 'low': return 'text-yellow-800';
    default: return 'text-gray-800';
  }
};

export function ReportPage() {
  const { diagnosisScore, weakPoints: mockWeakPoints, setStep, currentRecordId } = useAppStore();
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedScore, setExpandedScore] = useState<string | null>(null);

  useEffect(() => {
    if (!currentRecordId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getEvaluation(currentRecordId)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setEvaluation(res.data);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '获取评价失败');
      })
      .finally(() => setLoading(false));
  }, [currentRecordId]);

  // Use API data if available, otherwise fall back to mock store data
  const scores = evaluation?.scores ?? diagnosisScore;
  const overallScore = evaluation?.overallScore ?? 76.5;
  const weakPoints = evaluation?.weakPoints ?? mockWeakPoints;

  const radarData = [
    { subject: '产品知识', score: scores.knowledgeCoverage, threshold: 80 },
    { subject: '核心命中', score: scores.coreHitRate, threshold: 70 },
    { subject: '数据准确', score: scores.dataAccuracy, threshold: 80 },
    { subject: '话术匹配', score: scores.scriptMatch, threshold: 70 },
    { subject: '结构完整', score: scores.structureScore, threshold: 75 },
    { subject: '表达流畅', score: scores.fluencyScore, threshold: 70 },
  ];

  const stageOrder = [
    { key: 'opening' as const, label: '开场' },
    { key: 'needsProbe' as const, label: '探需' },
    { key: 'productIntro' as const, label: '产品介绍' },
    { key: 'objection' as const, label: '异议处理' },
    { key: 'closing' as const, label: '促单/收尾' },
  ];

  return (
    <section className="fade-in space-y-6">
      {loading && (
        <div className="bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="inline-block w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-gray-500">正在生成评价报告...</p>
        </div>
      )}

      {error && !evaluation && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-700">
          评价服务暂未就绪，当前展示模拟数据。
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Radar chart */}
        <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4">销售能力雷达图</h3>
          <RadarChartComponent data={radarData} />
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">综合得分</span>
              <span className="font-bold text-blue-600 text-lg">{overallScore}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">排名</span>
              <span className="font-medium text-gray-900">团队前 45%</span>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Weak points */}
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-4">核心短板分析</h3>
            {weakPoints.length === 0 ? (
              <p className="text-sm text-gray-400">暂无薄弱点记录</p>
            ) : (
              <div className="space-y-4">
                {weakPoints.map((wp) => (
                  <div key={wp.id} className={`p-4 border-l-4 rounded-r-lg ${severityClass(wp.severity)}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-bold ${severityText(wp.severity)}`}>{wp.name}</span>
                      <span className={`text-sm font-medium ${severitySubText(wp.severity)}`}>得分 {wp.score}/{wp.maxScore}</span>
                    </div>
                    <p className={`text-sm ${severitySubText(wp.severity)}`}>{wp.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Score details */}
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-4">诊断指标详情</h3>
            <div className="space-y-3">
              {scoreLabels.map((s) => {
                const score = scores[s.key];
                const isExpanded = expandedScore === s.key;
                return (
                  <div key={s.key} className="border rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedScore(isExpanded ? null : s.key)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <s.icon className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">{s.label}</span>
                        <span className="text-xs text-gray-400">{s.desc}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold ${score < 60 ? 'text-red-600' : score < 75 ? 'text-orange-600' : 'text-green-600'}`}>
                          {score}%
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </div>
                    </button>

                    {isExpanded && evaluation && (
                      <div className="px-4 py-3 bg-gray-50 border-t text-sm space-y-3">
                        {/* Stage coverage for structureScore */}
                        {s.key === 'structureScore' && evaluation.stageCoverage && (
                          <div className="flex items-center gap-2">
                            {stageOrder.map((st) => {
                              const stage = evaluation.stageCoverage[st.key];
                              return (
                                <div key={st.key} className={`flex-1 text-center py-2 rounded-lg ${stage?.covered ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                                  <div className="text-xs">{st.label}</div>
                                  <div className="font-semibold">{stage?.covered ? '✓' : '—'}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Matched knowledge */}
                        {s.key === 'knowledgeCoverage' && evaluation.matchedKnowledge.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-500 font-medium">匹配到的知识点</p>
                            {evaluation.matchedKnowledge.slice(0, 5).map((mk) => (
                              <div key={mk.knowledge_id} className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-gray-700">{mk.title} <span className="text-gray-400">({mk.category})</span></p>
                                  <p className="text-xs text-gray-400">{mk.evidence}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Matched scripts */}
                        {s.key === 'scriptMatch' && evaluation.matchedScripts.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-500 font-medium">匹配到的话术</p>
                            {evaluation.matchedScripts.slice(0, 5).map((ms) => (
                              <div key={ms.script_id} className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-gray-700">{ms.title} <span className="text-gray-400">({ms.scene})</span></p>
                                  <p className="text-xs text-gray-400">{ms.evidence}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Matched specs */}
                        {s.key === 'dataAccuracy' && evaluation.matchedSpecs.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-500 font-medium">提到的规格数据</p>
                            {evaluation.matchedSpecs.map((ms) => (
                              <div key={ms.spec_id} className="flex items-start gap-2">
                                {ms.is_correct ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                                )}
                                <div>
                                  <p className="text-gray-700">
                                    {ms.spec_name}：提到 "{ms.mentioned_value}"，标准值 "{ms.expected_value}"
                                  </p>
                                  {!ms.is_correct && (
                                    <p className="text-xs text-red-500">数据错误</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Generic fallback */}
                        {s.key !== 'structureScore' && s.key !== 'knowledgeCoverage' && s.key !== 'scriptMatch' && s.key !== 'dataAccuracy' && (
                          <p className="text-gray-400 text-xs">详细匹配数据待后端补充</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={() => setStep(5)}
          className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-sm"
        >
          查看个性化培训计划
        </button>
      </div>
    </section>
  );
}
