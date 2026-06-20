import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, Loader2, ChevronRight, BarChart3, MessageSquare, PhoneCall, Headphones } from 'lucide-react';
import { getDebriefList, type DebriefRecord } from '../../api/debrief';
import { getProductLines, type ProductLine } from '../../api/knowledge';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../hooks/useToast';

function ModeBadge({ mode }: { mode?: string }) {
  if (mode === 'call_recording') {
    return (
      <Badge variant="purple" className="flex items-center gap-1">
        <PhoneCall className="w-3 h-3" />
        能力评估
      </Badge>
    );
  }
  return (
    <Badge variant="info" className="flex items-center gap-1">
      <MessageSquare className="w-3 h-3" />
      复盘记录
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge variant="success">已完成</Badge>;
  if (status === 'analyzing') return <Badge variant="info">分析中</Badge>;
  return <Badge variant="neutral">待分析</Badge>;
}

function DebriefCard({ record, productLineName, onClick }: {
  record: DebriefRecord;
  productLineName?: string;
  onClick: () => void;
}) {
  return (
    <Card className="text-left hover:shadow-md transition-shadow cursor-pointer relative">
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h3 className="font-medium text-gray-900 truncate">{record.title}</h3>
              <ModeBadge mode={record.debrief_mode} />
              <StatusBadge status={record.status} />
            </div>
            <p className="text-sm text-gray-400 mt-1 flex items-center gap-2">
              {productLineName && (
                <Badge variant="info" className="text-[10px]">{productLineName}</Badge>
              )}
              {record.audio_path && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Headphones className="w-3 h-3" />
                  含录音
                </span>
              )}
              {new Date(record.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {record.overall_score !== undefined && (
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-600">{record.overall_score}</p>
                <p className="text-xs text-gray-400">综合评分</p>
              </div>
            )}
            <ChevronRight className="w-5 h-5 text-gray-300" />
          </div>
        </div>
      </button>
    </Card>
  );
}

export function DebriefListPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [records, setRecords] = useState<DebriefRecord[]>([]);
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getDebriefList(),
      getProductLines(),
    ])
      .then(([debriefRes, plRes]) => {
        if (debriefRes.code === 0 && debriefRes.data) setRecords(debriefRes.data.list);
        if (plRes.code === 0 && plRes.data) setProductLines(plRes.data.list);
      })
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  const getProductLineName = (id?: string) => productLines.find((pl) => pl.product_line_id === id)?.name;

  return (
    <div className="p-6 space-y-6 fade-in max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">复盘中心</h1>
          <p className="text-gray-500 mt-1">记录见客情况，AI 帮你分析谈单全流程</p>
        </div>
        <button
          onClick={() => navigate('/employee/debrief/new')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          新建复盘
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      )}

      {!loading && records.length === 0 && (
        <Card padding="lg" className="text-center">
          <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">还没有复盘记录</h3>
          <p className="text-sm text-gray-500 mb-6">见完客户后，把谈单情况记录下来，AI 会帮你分析问题和建议</p>
          <button
            onClick={() => navigate('/employee/debrief/new')}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            开始第一次复盘
          </button>
        </Card>
      )}

      {!loading && records.length > 0 && (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* 复盘记录 */}
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                复盘记录
              </h2>
              <div className="space-y-3">
                {records.filter((r) => r.debrief_mode === 'post_meeting').map((r) => (
                  <DebriefCard key={r.record_id} record={r} productLineName={getProductLineName(r.product_line_id)} onClick={() => navigate(`/employee/debrief/${r.record_id}`)} />
                ))}
                {records.filter((r) => r.debrief_mode === 'post_meeting').length === 0 && (
                  <p className="text-sm text-gray-400 py-2">暂无复盘记录</p>
                )}
              </div>
            </div>

            {/* 能力评估 */}
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <PhoneCall className="w-4 h-4" />
                能力评估
              </h2>
              <div className="space-y-3">
                {records.filter((r) => r.debrief_mode === 'call_recording').map((r) => (
                  <DebriefCard
                    key={r.record_id}
                    record={r}
                    productLineName={getProductLineName(r.product_line_id)}
                    onClick={() => {
                      if (r.status === 'completed') {
                        navigate(`/employee/debrief/${r.record_id}/report`);
                      } else {
                        navigate(`/employee/debrief/${r.record_id}/session`);
                      }
                    }}
                  />
                ))}
                {records.filter((r) => r.debrief_mode === 'call_recording').length === 0 && (
                  <p className="text-sm text-gray-400 py-2">暂无能力评估记录</p>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => toast.info('汇总分析功能需后端接口支持，开发中...')}
            className="w-full bg-white rounded-xl border border-dashed p-5 text-left hover:bg-gray-50 transition-colors flex items-center gap-3"
          >
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <div>
              <p className="font-medium text-gray-900">查看汇总分析报告</p>
              <p className="text-sm text-gray-500">基于所有历史复盘记录的综合趋势分析（开发中）</p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
