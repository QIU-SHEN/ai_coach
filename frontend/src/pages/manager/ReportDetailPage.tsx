import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, Loader2, Mic, Clock, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, XCircle, Pencil, Save, X, Trash2, Plus, GraduationCap, BookOpen, Sparkles, FileText } from 'lucide-react';
import { RadarChartComponent } from '../../components/RadarChart';
import { useAppStore } from '../../store/useAppStore';
import { getPracticeDetail, getEvaluation, updateEvaluation, type PracticeDetailResult, type CategoryAnalysis, type EvaluationScores, type ContentIssue, type EvaluationResult } from '../../api/debrief';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

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

const scoreDimensions: { key: keyof EvaluationScores; label: string }[] = [
  { key: 'knowledgeCoverage', label: '知识覆盖' },
  { key: 'coreHitRate', label: '核心命中' },
  { key: 'dataAccuracy', label: '数据准确' },
  { key: 'scriptMatch', label: '话术匹配' },
  { key: 'structureScore', label: '结构完整' },
];

function recalcOverall(scores: EvaluationScores): number {
  const total = scoreDimensions.reduce((sum, d) => sum - (100 - scores[d.key]) / 5, 100);
  return Math.round(total * 10) / 10;
}

function ScoreBreakdown({ scores, overallScore, evaluation, editing, onScoreChange }: {
  scores: EvaluationScores;
  overallScore: number;
  evaluation: EvaluationResult;
  editing: boolean;
  onScoreChange?: (key: keyof EvaluationScores, value: number) => void;
}) {
  const [expanded, setExpanded] = useState(editing);
  const fluencyBreakdown = evaluation?.fluencyBreakdown;
  const stageCoverage = evaluation?.stageCoverage;
  const contentIssues = evaluation?.contentIssues ?? [];
  const categoryAnalysis = evaluation?.categoryAnalysis ?? [];
  const matchedScripts = evaluation?.matchedScripts ?? [];

  const stageLabels: Record<string, string> = { opening: '开场', needsProbe: '探需', productIntro: '产品介绍', objection: '异议处理', closing: '促单/收尾' };

  const deduction = (key: keyof EvaluationScores) => ((100 - scores[key]) / 5).toFixed(1);

  const dimReason = (key: keyof EvaluationScores): string => {
    switch (key) {
      case 'knowledgeCoverage': {
        const cats = categoryAnalysis.filter((c) => c.category !== '话术流程');
        const missed = cats.filter((c) => c.missed_items.length > 0);
        return missed.length > 0 ? `遗漏：${missed.map((c) => c.missed_items.slice(0, 2).join('、')).join('；')}` : '各知识类别覆盖良好';
      }
      case 'coreHitRate': {
        const core = categoryAnalysis.find((c) => c.category === '核心卖点');
        return core ? (core.missed_items.length > 0 ? `遗漏：${core.missed_items.join('、')}` : '核心卖点全覆盖') : '-';
      }
      case 'dataAccuracy': {
        const errors = contentIssues.filter((i) => i.type === 'spec_error' || i.type === 'data_inaccurate');
        return errors.length > 0 ? `${errors.length}处数据错误：${errors[0].said}（应为${errors[0].correct}）` : '数据准确无误';
      }
      case 'scriptMatch': {
        return matchedScripts.length > 0 ? `匹配了${matchedScripts.length}条推荐话术` : '未使用推荐话术';
      }
      case 'structureScore': {
        if (!stageCoverage) return '-';
        const missing = Object.entries(stageLabels).filter(([k]) => !stageCoverage[k as keyof typeof stageCoverage]?.covered).map(([, v]) => v);
        return missing.length > 0 ? `缺少阶段：${missing.join('、')}` : '销售流程完整';
      }
      default: return '-';
    }
  };

  return (
    <div>
      <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 mt-1">
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? '收起评分构成' : '查看评分构成'}
      </button>
      {expanded && (
        <div className="mt-3 border-t pt-3 space-y-3 text-sm">
          {scoreDimensions.map((dim) => (
            <div key={dim.key}>
              <div className="flex items-center justify-between">
                <span className="text-gray-700 font-medium">{dim.label}</span>
                <div className="flex items-center gap-3">
                  {editing && onScoreChange ? (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={scores[dim.key]}
                      onChange={(e) => onScoreChange(dim.key, Math.min(100, Math.max(0, Number(e.target.value))))}
                      className="w-16 px-2 py-0.5 border rounded text-xs text-center"
                    />
                  ) : (
                    <span className={`text-xs ${scores[dim.key] >= 80 ? 'text-green-600' : scores[dim.key] >= 60 ? 'text-blue-600' : 'text-red-600'}`}>
                      {scores[dim.key]}分
                    </span>
                  )}
                  <span className="text-xs text-gray-400">权重20%</span>
                  <span className="text-xs text-red-500">-{deduction(dim.key)}分</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 ml-0">{dimReason(dim.key)}</p>
            </div>
          ))}
          <div className="border-t pt-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-700 font-medium">表达流畅 <span className="text-xs text-gray-400 font-normal">（不计入总评）</span></span>
              {editing && onScoreChange ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={scores.fluencyScore}
                  onChange={(e) => onScoreChange('fluencyScore', Math.min(100, Math.max(0, Number(e.target.value))))}
                  className="w-16 px-2 py-0.5 border rounded text-xs text-center"
                />
              ) : (
                <span className={`text-xs ${scores.fluencyScore >= 80 ? 'text-green-600' : scores.fluencyScore >= 60 ? 'text-blue-600' : 'text-red-600'}`}>
                  {scores.fluencyScore}分
                </span>
              )}
            </div>
            {fluencyBreakdown && fluencyBreakdown.penalties.filter((p) => p.points > 0).map((p) => (
              <p key={p.type} className="text-xs text-gray-500 mt-0.5">→ {p.label}扣{p.points}分：{p.detail}</p>
            ))}
          </div>
          <div className="border-t pt-2 text-xs text-gray-500">
            基础 100 {scoreDimensions.map((d) => `- ${deduction(d.key)}`).join(' ')} = <span className="font-bold text-gray-900">{overallScore.toFixed(1)} 分</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface EditableCategoryAnalysis extends CategoryAnalysis {
  _removed?: boolean;
}

function CategoryCard({ cat, editing, onEdit }: {
  cat: EditableCategoryAnalysis;
  editing: boolean;
  onEdit?: (updated: EditableCategoryAnalysis) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const scoreColor = cat.score >= 80 ? 'text-green-600' : cat.score >= 60 ? 'text-blue-600' : 'text-red-600';
  const scoreBg = cat.score >= 80 ? 'bg-green-50' : cat.score >= 60 ? 'bg-blue-50' : 'bg-red-50';
  const ringColor = cat.score >= 80 ? 'ring-green-200' : cat.score >= 60 ? 'ring-blue-200' : 'ring-red-200';

  const handleRemoveItem = (field: 'covered_items' | 'missed_items', index: number) => {
    if (!onEdit) return;
    const updated = { ...cat };
    const arr = [...updated[field]];
    arr.splice(index, 1);
    updated[field] = arr;
    onEdit(updated);
  };

  const handleRemoveWrongItem = (index: number) => {
    if (!onEdit) return;
    const updated = { ...cat };
    const arr = [...updated.wrong_items];
    arr.splice(index, 1);
    updated.wrong_items = arr;
    onEdit(updated);
  };

  const handleScoreChange = (score: number) => {
    if (!onEdit) return;
    onEdit({ ...cat, score: Math.min(100, Math.max(0, score)) });
  };

  const handleSummaryChange = (summary: string) => {
    if (!onEdit) return;
    onEdit({ ...cat, summary });
  };

  return (
    <div className={`rounded-xl border p-4 ${scoreBg} ring-1 ${ringColor}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-bold text-gray-900">{cat.category}</h4>
        {editing ? (
          <input
            type="number"
            min={0}
            max={100}
            value={cat.score}
            onChange={(e) => handleScoreChange(Number(e.target.value))}
            className="w-16 px-2 py-0.5 border rounded text-sm font-bold text-center"
          />
        ) : (
          <span className={`text-2xl font-bold ${scoreColor}`}>{cat.score}</span>
        )}
      </div>
      {editing ? (
        <textarea
          value={cat.summary}
          onChange={(e) => handleSummaryChange(e.target.value)}
          className="w-full text-sm border rounded px-2 py-1 mb-2 min-h-[3rem]"
        />
      ) : (
        <p className="text-sm text-gray-600 mb-3">{cat.summary}</p>
      )}
      <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? '收起' : '展开详情'}
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          {cat.covered_items.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">已覆盖</p>
              <div className="flex flex-wrap gap-1">
                {cat.covered_items.map((item, i) => (
                  <span key={i} className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3" />{item}
                    {editing && (
                      <button onClick={() => handleRemoveItem('covered_items', i)} className="ml-0.5 text-green-600 hover:text-red-600">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {cat.missed_items.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">遗漏项</p>
              <div className="flex flex-wrap gap-1">
                {cat.missed_items.map((item, i) => (
                  <span key={i} className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded text-xs flex items-center gap-0.5">
                    <XCircle className="w-3 h-3" />{item}
                    {editing && (
                      <button onClick={() => handleRemoveItem('missed_items', i)} className="ml-0.5 text-orange-600 hover:text-red-600">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {cat.wrong_items.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">说错的内容</p>
              <div className="space-y-1">
                {cat.wrong_items.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-red-700 line-through">{w.said}</span>
                    <span className="text-gray-400">→</span>
                    <span className="text-green-700">{w.correct}</span>
                    {editing && (
                      <button onClick={() => handleRemoveWrongItem(i)} className="text-gray-400 hover:text-red-600 shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}分${s}秒`;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// --- Analyzing View (shown when evaluation is not ready yet) ---

function AnalyzingView({ recordId, backPath, onReady }: {
  recordId: string;
  backPath: string;
  onReady: (evalData: EvaluationResult) => void;
}) {
  const navigate = useNavigate();
  const [, setPolling] = useState(true);
  const fetchingEval = useRef(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    // Immediately trigger evaluation generation on mount
    const triggerEval = async () => {
      if (fetchingEval.current) return;
      fetchingEval.current = true;
      try {
        const res = await getEvaluation(recordId);
        if (res.code === 0 && res.data?.scores) {
          onReady(res.data);
          return;
        }
      } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('404')) {
          setError('记录不存在');
        } else if (msg.includes('500')) {
          setError('评估服务内部错误，请稍后重试');
        }
        // otherwise evaluation not ready yet, fall back to polling
      } finally {
        fetchingEval.current = false;
      }
    };
    triggerEval();

    const timer = setInterval(async () => {
      try {
        const res = await getPracticeDetail(recordId);
        if (res.code === 0) {
          const status = res.data?.status;
          if (status === 'failed') {
            clearInterval(timer);
            setPolling(false);
            setError('分析失败，请稍后重试或联系管理员');
            return;
          }
          if (res.data?.evaluation?.scores) {
            clearInterval(timer);
            setPolling(false);
            onReady(res.data.evaluation);
            return;
          }
        }
      } catch {
        // keep polling
      }
      setAttempts((a) => a + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [recordId, onReady]);

  const timedOut = attempts >= 36; // 36 * 5s = 180s = 3 minutes

  return (
    <div className="fade-in space-y-4">
      <button onClick={() => navigate(backPath)} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> 返回列表
      </button>
      <div className="bg-white rounded-2xl shadow-sm border p-16 text-center">
        {error || timedOut ? (
          <>
            <div className="flex justify-center mb-4">
              <AlertTriangle className="w-10 h-10 text-orange-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">分析未成功</h3>
            <p className="text-sm text-gray-500 mb-6">{error || '等待超时，请稍后刷新页面重试'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              刷新页面
            </button>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-4">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">报告分析中</h3>
            <p className="text-sm text-gray-500 mb-6">系统正在分析您的练习表现，预计需要 1-2 分钟</p>
            <p className="text-xs text-gray-400">页面每 5 秒自动刷新，分析完成后将自动展示报告</p>
          </>
        )}
      </div>
    </div>
  );
}

function FloatingTOC({ items, activeId }: { items: { id: string; label: string }[]; activeId: string }) {
  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-3">
      <div className="w-0.5 h-full bg-gray-200 absolute left-1/2 -translate-x-1/2 -z-10"></div>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="group relative flex items-center justify-center"
          title={item.label}
        >
          <span
            className={`block rounded-full transition-all duration-300 ${
              activeId === item.id
                ? 'w-4 h-4 bg-red-600'
                : 'w-3 h-3 bg-red-400 hover:bg-red-500'
            }`}
          />
          <span className="absolute right-6 whitespace-nowrap text-xs text-gray-600 bg-white px-2 py-1 rounded shadow border opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ReportDetailPage() {
  const navigate = useNavigate();
  const { id: recordId } = useParams();
  const { user } = useAppStore();
  const isEmployee = user?.role === 'employee';
  const [detail, setDetail] = useState<PracticeDetailResult['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSegment, setActiveSegment] = useState<number>(-1);
  const audioRef = useRef<HTMLAudioElement>(null);

  // TOC active section
  const [activeSection, setActiveSection] = useState('section-overview');

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editScores, setEditScores] = useState<EvaluationScores | null>(null);
  const [editContentIssues, setEditContentIssues] = useState<ContentIssue[]>([]);
  const [editCategoryAnalysis, setEditCategoryAnalysis] = useState<EditableCategoryAnalysis[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recordId) return;
    setLoading(true);
    getPracticeDetail(recordId)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setDetail(res.data);
        } else {
          setError(res.message || '加载失败');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [recordId]);

  // Scroll-based TOC highlighting — 取距离视口顶部最近的 section
  useEffect(() => {
    if (!detail) return;
    const sectionIds = [
      'section-overview',
      'section-diagnosis',
      'section-content-issues',
      'section-category-analysis',
      'section-transcript',
      'section-dialogue',
      'section-training',
    ];
    const handleScroll = () => {
      let bestId = sectionIds[0];
      let bestDist = Infinity;
      sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top - 140);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      });
      setActiveSection(bestId);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [detail]);

  // Listen to audio timeupdate to highlight active segment
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !detail?.transcript_segments?.length) return;

    const handleTimeUpdate = () => {
      const ct = audio.currentTime;
      const segments = detail.transcript_segments!;
      const idx = segments.findIndex((s) => ct >= s.start && ct <= s.end);
      setActiveSegment(idx);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => audio.removeEventListener('timeupdate', handleTimeUpdate);
  }, [detail?.transcript_segments]);

  const handleSeek = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      audioRef.current.play();
    }
  };

  const enterEdit = () => {
    if (!detail?.evaluation) return;
    const ev = detail.evaluation;
    setEditScores({ ...ev.scores });
    setEditContentIssues(ev.contentIssues ? ev.contentIssues.map((ci) => ({ ...ci })) : []);
    setEditCategoryAnalysis(ev.categoryAnalysis ? ev.categoryAnalysis.map((cat) => ({ ...cat, covered_items: [...cat.covered_items], missed_items: [...cat.missed_items], wrong_items: cat.wrong_items.map((w) => ({ ...w })) })) : []);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditScores(null);
    setEditContentIssues([]);
    setEditCategoryAnalysis([]);
  };

  const handleScoreChange = useCallback((key: keyof EvaluationScores, value: number) => {
    setEditScores((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const handleRemoveIssue = useCallback((index: number) => {
    setEditContentIssues((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddIssue = useCallback(() => {
    setEditContentIssues((prev) => [{
      timestamp: 0,
      timestamp_label: '00:00',
      type: 'spec_error',
      type_label: '规格错误',
      spec_name: '',
      severity: 'medium' as const,
      said: '',
      correct: '',
    }, ...prev]);
  }, []);

  const handleCategoryEdit = useCallback((index: number, updated: EditableCategoryAnalysis) => {
    setEditCategoryAnalysis((prev) => prev.map((c, i) => i === index ? updated : c));
  }, []);

  const handleSave = async () => {
    if (!recordId || !detail?.evaluation || !editScores) return;
    setSaving(true);
    try {
      const updatedEval: EvaluationResult = {
        ...detail.evaluation,
        scores: editScores,
        overallScore: recalcOverall(editScores),
        contentIssues: editContentIssues,
        categoryAnalysis: editCategoryAnalysis,
      };
      await updateEvaluation(recordId, updatedEval);
      // Update local state
      setDetail((prev) => prev ? {
        ...prev,
        evaluation: updatedEval,
      } : prev);
      setEditing(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fade-in p-10 text-center text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        加载中...
      </div>
    );
  }

  const backPath = isEmployee ? '/employee/diagnosis/assessment' : '/manager/team';

  if (error || !detail) {
    return (
      <div className="fade-in p-10 text-center text-red-600">
        <p>{error || '记录不存在'}</p>
        <button onClick={() => navigate(backPath)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">返回列表</button>
      </div>
    );
  }

  // If evaluation not ready yet (analyzing in background), show polling state
  if (!detail.evaluation || !detail.evaluation.scores) {
    return (
      <AnalyzingView recordId={recordId!} backPath={backPath} onReady={(evalData) => {
        setDetail(prev => prev ? { ...prev, evaluation: evalData, status: 'completed' } : prev);
      }} />
    );
  }

  const evalScores = editing && editScores ? editScores : detail.evaluation?.scores;
  const displayContentIssues = editing ? editContentIssues : (detail.evaluation?.contentIssues ?? []);
  const displayCategoryAnalysis = editing ? editCategoryAnalysis : (detail.evaluation?.categoryAnalysis ?? []);
  const overallScore = editing && editScores ? recalcOverall(editScores) : detail.evaluation?.overallScore ?? 0;

  const radarData = evalScores
    ? [
        { subject: '知识覆盖', score: evalScores.knowledgeCoverage, threshold: 80 },
        { subject: '核心命中', score: evalScores.coreHitRate, threshold: 70 },
        { subject: '数据准确', score: evalScores.dataAccuracy, threshold: 80 },
        { subject: '话术匹配', score: evalScores.scriptMatch, threshold: 70 },
        { subject: '结构完整', score: evalScores.structureScore, threshold: 75 },
        { subject: '表达流畅', score: evalScores.fluencyScore, threshold: 70 },
      ]
    : [];

  const weakPoints = detail.evaluation?.weakPoints ?? [];
  const dialogueRounds = detail.dialogue_rounds ?? [];
  const segments = detail.transcript_segments ?? [];

  const tocItems = [
    { id: 'section-overview', label: '综合得分' },
    { id: 'section-diagnosis', label: '诊断详情' },
    ...(displayContentIssues.length > 0 || editing ? [{ id: 'section-content-issues', label: '内容错误明细' }] : []),
    ...(displayCategoryAnalysis.length > 0 ? [{ id: 'section-category-analysis', label: '知识类别分析' }] : []),
    ...((detail.transcript || segments.length > 0) ? [{ id: 'section-transcript', label: '语音转录文本' }] : []),
    ...(dialogueRounds.length > 0 ? [{ id: 'section-dialogue', label: 'AI 对话记录' }] : []),
    ...(isEmployee && detail.training_plan ? [{ id: 'section-training', label: '个性化培训计划' }] : []),
  ];

  const issueSeverityCls = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-50 border-l-4 border-red-500';
      case 'medium': return 'bg-orange-50 border-l-4 border-orange-500';
      default: return 'bg-gray-50 border-l-4 border-gray-400';
    }
  };

  const issueTypeCls = (type: string) => {
    switch (type) {
      case 'spec_error': return 'bg-red-100 text-red-700';
      case 'data_inaccurate': return 'bg-orange-100 text-orange-700';
      case 'methodology_error': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const severityCls = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-50 border-l-4 border-red-500';
      case 'medium': return 'bg-orange-50 border-l-4 border-orange-500';
      default: return 'bg-yellow-50 border-l-4 border-yellow-500';
    }
  };

  const severityText = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-red-900';
      case 'medium': return 'text-orange-900';
      default: return 'text-yellow-900';
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div id="report-content" className="fade-in space-y-4">
      <div className="flex items-center justify-between no-print">
        <button onClick={() => navigate(backPath)} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> 返回列表
        </button>
        <div className="flex gap-2">
          {!editing && (
            <button onClick={handlePrint} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1">
              <FileDown className="w-4 h-4" /> 导出PDF
            </button>
          )}
          {!isEmployee && !editing ? (
            <>
              {detail.evaluation && (
                <button onClick={enterEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1">
                  <Pencil className="w-4 h-4" /> 编辑评分
                </button>
              )}
            </>
          ) : !isEmployee && editing ? (
            <>
              <button onClick={cancelEdit} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1">
                <X className="w-4 h-4" /> 取消
              </button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存修改
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Editing banner */}
      {editing && !isEmployee && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-amber-800 no-print">
          <Pencil className="w-4 h-4" />
          编辑模式：可修改各维度分数、删除错误条目、编辑类别分析。修改后点击"保存修改"生效。
        </div>
      )}

      <div id="section-overview" className="bg-white rounded-2xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{detail.user_name} · 练习报告</h2>
            <p className="text-sm text-gray-500 mt-1">{detail.employee_id} · {detail.product_line} · {formatDuration(detail.duration)}</p>
          </div>
          <div className="text-right min-w-[200px]">
            {detail.evaluation?.overallScore !== undefined ? (
              <>
                <p className="text-3xl font-bold text-blue-600">{overallScore}</p>
                <p className="text-sm text-gray-500">综合得分{editing ? '（编辑中）' : ''}</p>
                <ScoreBreakdown
                  scores={evalScores!}
                  overallScore={overallScore}
                  evaluation={editing ? { ...detail.evaluation, scores: editScores!, contentIssues: editContentIssues, categoryAnalysis: editCategoryAnalysis } : detail.evaluation}
                  editing={editing}
                  onScoreChange={handleScoreChange}
                />
              </>
            ) : (
              <p className="text-sm text-gray-400">尚未评价</p>
            )}
          </div>
        </div>
      </div>

      <FloatingTOC items={tocItems} activeId={activeSection} />

      <div className="grid lg:grid-cols-3 gap-6">
        <div id="section-radar" className="lg:col-span-1 bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4">能力雷达图</h3>
          {radarData.length > 0 ? (
            <RadarChartComponent data={radarData} />
          ) : (
            <p className="text-center text-gray-400 py-10">暂无评价数据</p>
          )}
        </div>

        <div id="section-diagnosis" className="lg:col-span-2 bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4">诊断详情</h3>
          <div className="space-y-4">
            {weakPoints.length === 0 ? (
              <p className="text-sm text-gray-400">暂无薄弱点记录</p>
            ) : (
              weakPoints.map((wp) => (
                <div key={wp.id} className={`p-4 rounded-r-lg ${severityCls(wp.severity)}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-bold ${severityText(wp.severity)}`}>{wp.name}</span>
                    <span className={`text-sm font-medium ${severityText(wp.severity)}`}>得分 {wp.score}/{wp.maxScore}</span>
                  </div>
                  <p className={`text-sm ${severityText(wp.severity)}`}>{wp.description}</p>
                </div>
              ))
            )}

            {/* Audio player */}
            <div className="p-4 bg-gray-50 rounded-lg no-print">
              <p className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                <Mic className="w-4 h-4" /> 原始语音
              </p>
              <audio ref={audioRef} controls className="w-full" src={resolveAudioUrl(detail.audio_url)}>
                您的浏览器不支持音频播放
              </audio>
            </div>
          </div>
        </div>
      </div>

      {/* Content issues */}
      {(displayContentIssues.length > 0 || editing) && (
        <div id="section-content-issues" className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" /> 内容错误明细
            <span className="text-xs text-gray-400 font-normal">共 {displayContentIssues.length} 处</span>
            {editing && detail.evaluation?.contentIssues && displayContentIssues.length < detail.evaluation.contentIssues.length && (
              <span className="text-xs text-amber-600 font-normal">（已删除 {detail.evaluation.contentIssues.length - displayContentIssues.length} 条）</span>
            )}
            {editing && (
              <button onClick={handleAddIssue} className="ml-auto px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center gap-1">
                <Plus className="w-3 h-3" /> 添加
              </button>
            )}
          </h3>
          <div className="space-y-3">
            {displayContentIssues.map((issue, idx) => (
              <div key={idx} className={`p-4 rounded-r-lg ${issueSeverityCls(issue.severity)} relative`}>
                {editing && (
                  <button
                    onClick={() => handleRemoveIssue(idx)}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="删除此条"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <div className="flex items-center gap-2 mb-2">
                  {editing ? (
                    <input
                      value={issue.timestamp_label}
                      onChange={(e) => {
                        setEditContentIssues((prev) => prev.map((ci, i) => i === idx ? { ...ci, timestamp_label: e.target.value } : ci));
                      }}
                      className="px-2 py-0.5 bg-white border rounded text-xs font-mono w-16"
                      placeholder="00:00"
                    />
                  ) : (
                    <button
                      onClick={() => handleSeek(issue.timestamp)}
                      className="px-2 py-0.5 bg-white border rounded text-xs font-mono hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    >
                      {issue.timestamp_label}
                    </button>
                  )}
                  {editing ? (
                    <select
                      value={issue.type}
                      onChange={(e) => {
                        const type = e.target.value as ContentIssue['type'];
                        const labels: Record<ContentIssue['type'], string> = { spec_error: '规格错误', data_inaccurate: '数据不准', methodology_error: '方法错误', claim_unsupported: '无据断言' };
                        setEditContentIssues((prev) => prev.map((ci, i) => i === idx ? { ...ci, type, type_label: labels[type] } : ci));
                      }}
                      className="px-2 py-0.5 border rounded text-xs"
                    >
                      <option value="spec_error">规格错误</option>
                      <option value="data_inaccurate">数据不准</option>
                      <option value="methodology_error">方法错误</option>
                      <option value="claim_unsupported">无据断言</option>
                    </select>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${issueTypeCls(issue.type)}`}>
                      {issue.type_label}
                    </span>
                  )}
                  {editing ? (
                    <input
                      value={issue.spec_name}
                      onChange={(e) => {
                        setEditContentIssues((prev) => prev.map((ci, i) => i === idx ? { ...ci, spec_name: e.target.value } : ci));
                      }}
                      className="px-2 py-0.5 border rounded text-xs flex-1"
                      placeholder="参数名称"
                    />
                  ) : (
                    <span className="text-xs text-gray-500">{issue.spec_name}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">员工说了</p>
                    {editing ? (
                      <input
                        value={issue.said}
                        onChange={(e) => {
                          setEditContentIssues((prev) => prev.map((ci, i) => i === idx ? { ...ci, said: e.target.value } : ci));
                        }}
                        className="w-full px-2 py-1 border rounded text-sm text-red-900"
                      />
                    ) : (
                      <p className="text-red-900 font-medium">{issue.said}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">正确应该</p>
                    {editing ? (
                      <input
                        value={issue.correct}
                        onChange={(e) => {
                          setEditContentIssues((prev) => prev.map((ci, i) => i === idx ? { ...ci, correct: e.target.value } : ci));
                        }}
                        className="w-full px-2 py-1 border rounded text-sm text-green-900"
                      />
                    ) : (
                      <p className="text-green-900 font-medium">{issue.correct}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category analysis */}
      {displayCategoryAnalysis.length > 0 && (
        <div id="section-category-analysis" className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4">知识类别分析</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayCategoryAnalysis.map((cat, idx) => (
              <CategoryCard
                key={cat.category}
                cat={cat}
                editing={editing}
                onEdit={editing ? (updated) => handleCategoryEdit(idx, updated) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Transcript with segments */}
      {(detail.transcript || segments.length > 0) && (
        <div id="section-transcript" className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" /> 语音转录文本
            {segments.length > 0 && (
              <span className="text-xs text-gray-400 font-normal">共 {segments.length} 段</span>
            )}
          </h3>

          {segments.length > 0 ? (
            <div className="space-y-1 max-h-[28rem] overflow-y-auto bg-gray-50 rounded-lg p-4">
              {segments.map((seg, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-3 p-2 rounded-lg transition-colors cursor-pointer hover:bg-gray-100 ${
                    activeSegment === idx ? 'bg-blue-50 border border-blue-200' : ''
                  } ${seg.low_confidence ? 'bg-yellow-50/50' : ''}`}
                  onClick={() => handleSeek(seg.start)}
                >
                  <button className="shrink-0 mt-0.5 px-2 py-0.5 bg-gray-200 hover:bg-blue-200 rounded text-xs font-mono text-gray-600 hover:text-blue-700 transition-colors">
                    {formatTime(seg.start)}
                  </button>
                  <div className="flex-1">
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {seg.text}
                      {seg.low_confidence && (
                        <span className="ml-2 px-1.5 py-0.5 bg-yellow-200 text-yellow-800 rounded text-xs">低置信度</span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{detail.transcript}</p>
            </div>
          )}
        </div>
      )}

      {/* Dialogue history */}
      {dialogueRounds.length > 0 && (
        <div id="section-dialogue" className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4">AI 对话记录 ({dialogueRounds.length} 轮)</h3>
          <div className="space-y-4">
            {dialogueRounds.map((round) => (
              <div key={round.round_number} className="space-y-3">
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tl-none px-4 py-3 max-w-[80%]">
                    <p className="text-sm font-medium text-gray-500 mb-1">AI客户 · 第{round.round_number}轮 · {round.difficulty}</p>
                    <p>{round.customer_question}</p>
                    {round.expected_focus && <p className="text-xs text-gray-400 mt-1">期望方向: {round.expected_focus}</p>}
                  </div>
                </div>
                {round.sales_reply && (
                  <div className="flex justify-end">
                    <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-3 max-w-[80%]">
                      <p>{round.sales_reply}</p>
                      {round.score !== undefined && (
                        <div className="mt-2 pt-2 border-t border-blue-500/50 text-xs text-blue-100 space-y-1">
                          <p>评分: <span className="font-bold">{round.score}分</span> · {round.feedback}</p>
                          {round.strengths && round.strengths.length > 0 && <p>亮点: {round.strengths.join('、')}</p>}
                          {round.weaknesses && round.weaknesses.length > 0 && <p>不足: {round.weaknesses.join('、')}</p>}
                          {round.missed_points && round.missed_points.length > 0 && <p>遗漏: {round.missed_points.join('、')}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Training plan - employee only */}
      {isEmployee && detail.training_plan && (
        <div id="section-training" className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            个性化培训计划
          </h3>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Weekly schedule */}
              {detail.training_plan.weekly && (
                <div>
                  <h4 className="font-bold text-gray-800 mb-3">未来一周培训日程</h4>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="space-y-2">
                      {(() => {
                        const weekly = detail.training_plan.weekly as any;
                        // 兼容后端返回的两种格式：字符串（新）或数组（旧）
                        const lines: string[] = typeof weekly === 'string'
                          ? weekly.split('\n').filter((l: string) => l.trim())
                          : Array.isArray(weekly)
                            ? weekly.map((item: any) => typeof item === 'string' ? item : `${item.day || ''}  ${item.title || ''}`)
                            : [];
                        return lines.map((line: string, idx: number) => {
                          const match = line.match(/第([一二三四五六七])天\s+(.*)/);
                          if (match) {
                            const dayNum = match[1];
                            const content = match[2];
                            return (
                              <div key={idx} className="flex items-start gap-3 p-2 rounded-lg bg-white">
                                <span className="shrink-0 w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                  {dayNum}
                                </span>
                                <p className="text-sm text-gray-700 leading-relaxed pt-1">{content}</p>
                              </div>
                            );
                          }
                          return (
                            <div key={idx} className="p-2 rounded-lg bg-white">
                              <p className="text-sm text-gray-700 leading-relaxed">{line}</p>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Monthly goals */}
              {detail.training_plan.monthly && detail.training_plan.monthly.length > 0 && (
                <div>
                  <h4 className="font-bold text-gray-800 mb-3">月度阶段目标</h4>
                  <div className="relative pl-6 border-l-2 border-gray-200 space-y-4">
                    {detail.training_plan.monthly.map((goal, idx) => (
                      <div key={idx} className="relative">
                        <div className={`absolute -left-[27px] top-1 w-3 h-3 rounded-full border-3 border-white ${idx === 0 ? 'bg-blue-600' : 'bg-gray-300'}`} />
                        <p className="font-medium text-gray-900 text-sm">第{goal.week}周：{goal.title}</p>
                        <p className="text-xs text-gray-500">目标：{goal.target}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Analysis + Assessment */}
            <div className="space-y-6">
              {detail.training_plan.analysis && detail.training_plan.analysis.length > 0 && (
                <div>
                  <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-blue-600" />
                    能力分析与提升建议
                  </h4>
                  <div className="space-y-2">
                    {detail.training_plan.analysis.map((item, idx) => (
                      <div key={idx} className="p-3 border rounded-lg">
                        <p className="font-medium text-gray-900 text-sm">{item.point}</p>
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.training_plan.assessment && (
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-5 text-white">
                  <h4 className="font-bold mb-3 flex items-center gap-2"><GraduationCap className="w-4 h-4" /> 考核标准</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-blue-200 text-xs mb-0.5">周考核</p>
                      <p className="text-blue-50">{detail.training_plan.assessment.week_assessment}</p>
                    </div>
                    <div>
                      <p className="text-blue-200 text-xs mb-0.5">月考核</p>
                      <p className="text-blue-50">{detail.training_plan.assessment.month_assessment}</p>
                    </div>
                    <div>
                      <p className="text-blue-200 text-xs mb-0.5">达标标准</p>
                      <p className="text-blue-50">{detail.training_plan.assessment.pass_criteria}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Recommended materials */}
              <div>
                <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-blue-600" />
                  推荐学习资料
                </h4>
                <div className="space-y-2">
                  <div
                    onClick={() => navigate('/employee/learning')}
                    className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">企业直销手册-2025</p>
                      <p className="text-xs text-gray-500">PDF 文档</p>
                    </div>
                  </div>
                  <div
                    onClick={() => navigate('/employee/learning')}
                    className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">大客户销售培训资料</p>
                      <p className="text-xs text-gray-500">PDF 文档</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
