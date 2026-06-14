import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertTriangle, Lightbulb, User, BookOpen, Target, ChevronDown, ChevronUp, MessageSquare, PhoneCall, BarChart3, TrendingUp, Frown, Zap, FileDown } from 'lucide-react';
import { getDebriefDetail, analyzeDebrief, type DebriefRecord, type DebriefAnalysis } from '../../api/debrief';
import { getProductLines, type ProductLine } from '../../api/knowledge';

function SeverityBadge({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const map = {
    high: { bg: 'bg-red-50', text: 'text-red-700', label: '高' },
    medium: { bg: 'bg-orange-50', text: 'text-orange-700', label: '中' },
    low: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: '低' },
  };
  const s = map[severity];
  return <span className={`px-2 py-0.5 rounded text-xs ${s.bg} ${s.text}`}>{s.label}</span>;
}

function ModeBadge({ mode }: { mode?: string }) {
  if (mode === 'call_recording') {
    return (
      <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs flex items-center gap-1">
        <PhoneCall className="w-3 h-3" />
        能力评估
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs flex items-center gap-1">
      <MessageSquare className="w-3 h-3" />
      复盘记录
    </span>
  );
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

export function DebriefReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<DebriefRecord | null>(null);
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);

  useEffect(() => {
    getProductLines()
      .then((res) => {
        if (res.code === 0 && res.data) setProductLines(res.data.list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getDebriefDetail(id)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setRecord(res.data);
          if (res.data.status === 'pending' && res.data.debrief_mode !== 'call_recording') {
            triggerAnalyze(id);
          }
        } else {
          setError('获取复盘记录失败');
        }
      })
      .catch(() => setError('获取复盘记录失败'))
      .finally(() => setLoading(false));
  }, [id]);

  const triggerAnalyze = async (recordId: string) => {
    setAnalyzing(true);
    try {
      const res = await analyzeDebrief(recordId);
      if (res.code === 0 && res.data) {
        setRecord(res.data);
        // TODO: 后端 user_profiles 接口完成后，调用 refreshUserProfile 触发画像更新
      } else {
        setError('分析失败');
      }
    } catch {
      setError('分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border p-8 text-center max-w-md">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <p className="text-red-900 font-medium">{error || '记录不存在'}</p>
          <button
            onClick={() => navigate('/employee/diagnosis/debrief')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            返回列表
          </button>
        </div>
      </div>
    );
  }

  const analysis = safeParseAnalysis(record);
  const productLineName = productLines.find((pl) => pl.product_line_id === record.product_line_id)?.name;
  const isCallRecording = record.debrief_mode === 'call_recording';
  const interaction = analysis?.interactionAnalysis;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/employee/diagnosis/debrief')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-gray-900 truncate">{record.title}</h1>
            <ModeBadge mode={record.debrief_mode} />
          </div>
          <p className="text-xs text-gray-400">
            {productLineName && (
              <span className="mr-2 px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">{productLineName}</span>
            )}
            {new Date(record.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="no-print px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
        >
          <FileDown className="w-4 h-4" />
          导出PDF
        </button>
      </div>

      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-6">
        {analyzing && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
            <p className="text-sm text-blue-800 font-medium">AI 正在分析谈单流程...</p>
            <p className="text-xs text-blue-600 mt-1">请稍候，预计需要 10-20 秒</p>
          </div>
        )}

        {analysis && (
          <>
            {/* Overview */}
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">综合评分</p>
                  <p className={`text-4xl font-bold ${
                    analysis.overallScore >= 80 ? 'text-green-600' : analysis.overallScore >= 60 ? 'text-blue-600' : 'text-red-600'
                  }`}>
                    {analysis.overallScore}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">个人风格</p>
                  <p className="text-lg font-medium text-gray-900">{analysis.personalStyle.label}</p>
                </div>
              </div>
            </div>

            {/* Interaction Analysis - call_recording only */}
            {isCallRecording && interaction && (
              <div className="bg-white rounded-xl border p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  对话互动分析
                </h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-purple-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-purple-800 mb-1 flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      销售说话占比
                    </p>
                    <p className="text-lg font-bold text-purple-700">{interaction.salesTalkRatio}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-blue-800 mb-1 flex items-center gap-1">
                      <Frown className="w-4 h-4" />
                      客户情绪变化
                    </p>
                    <p className="text-sm text-blue-700">{interaction.customerSentiment}</p>
                  </div>
                </div>
                {interaction.turningPoints.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                      <Zap className="w-4 h-4 text-amber-500" />
                      关键转折点
                    </p>
                    <ul className="space-y-2">
                      {interaction.turningPoints.map((tp, i) => (
                        <li key={i} className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                          {tp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {interaction.missedOpportunities.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">错过的成交信号</p>
                    <ul className="space-y-2">
                      {interaction.missedOpportunities.map((mo, i) => (
                        <li key={i} className="text-sm text-gray-600 bg-orange-50 rounded-lg p-3">
                          {mo}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Stage Assessment */}
            <div className="bg-white rounded-xl border p-6">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-600" />
                谈单流程评估
              </h3>
              <div className="space-y-4">
                {analysis.stageAssessment.map((stage) => (
                  <div key={stage.stage}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">{stage.stage}</span>
                      <span className={`text-sm font-bold ${
                        stage.score >= 80 ? 'text-green-600' : stage.score >= 60 ? 'text-blue-600' : 'text-red-600'
                      }`}>
                        {stage.score}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{stage.comment}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Issues */}
            {analysis.keyIssues.length > 0 && (
              <div className="bg-white rounded-xl border p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                  关键问题
                </h3>
                <div className="space-y-3">
                  {analysis.keyIssues.map((issue) => (
                    <div key={issue.id} className="border rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedIssue(expandedIssue === issue.id ? null : issue.id)}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <SeverityBadge severity={issue.severity} />
                          <span className="text-sm text-gray-800">{issue.stage} · {issue.description}</span>
                        </div>
                        {expandedIssue === issue.id ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      {expandedIssue === issue.id && (
                        <div className="px-4 pb-4">
                          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                            <p className="font-medium text-gray-700 mb-1">改进建议：</p>
                            <p>{issue.suggestion}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Personal Style */}
            <div className="bg-white rounded-xl border p-6">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-purple-600" />
                个人风格分析
              </h3>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {analysis.personalStyle.traits.map((trait) => (
                    <span key={trait} className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm">
                      {trait}
                    </span>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-green-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-green-800 mb-1">优势发挥</p>
                    <p className="text-sm text-green-700">{analysis.personalStyle.leverage}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-orange-800 mb-1">待改进</p>
                    <p className="text-sm text-orange-700">{analysis.personalStyle.improvement}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Training Plan */}
            {record.training_plan && (
              <div className="bg-white rounded-xl border p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-600" />
                  培训方案
                </h3>
                {record.training_plan.recommendations.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-gray-700">推荐学习</p>
                    {record.training_plan.recommendations.map((rec, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <Lightbulb className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm text-gray-800">{rec.topic}</p>
                          <p className="text-xs text-gray-400">{rec.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Analysis missing placeholder */}
        {!analysis && !analyzing && (
          <div className="bg-white rounded-xl border p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h3 className="font-bold text-gray-900 mb-2">AI 分析报告尚未生成</h3>
            <p className="text-sm text-gray-500 mb-4">点击下方按钮重新触发分析</p>
            <button
              onClick={() => triggerAnalyze(id!)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              重新分析
            </button>
          </div>
        )}

        {/* Original content */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-bold text-gray-900 mb-3">原始描述</h3>
          {record.content && (
            <div className="text-sm text-gray-600 whitespace-pre-wrap mb-3">{record.content}</div>
          )}
          {record.transcript && (
            <div className="border-t pt-3">
              <p className="text-xs text-gray-400 mb-1">语音转录</p>
              <div className="text-sm text-gray-600 whitespace-pre-wrap">{record.transcript}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
