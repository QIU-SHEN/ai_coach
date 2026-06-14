import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Calendar, ArrowRight, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getPracticeList, deletePractice, type PracticeRecordItem } from '../../api/debrief';

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DialogueHistoryPage() {
  const navigate = useNavigate();
  const { user } = useAppStore();
  const [records, setRecords] = useState<PracticeRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await getPracticeList(user.id);
      if (res.code === 0 && res.data) {
        // Filter for call_recording/simulation mode records (dialogue practice records)
        const filtered = res.data.list.filter((r: PracticeRecordItem) =>
          r.debrief_mode === 'call_recording' || r.debrief_mode === 'simulation'
        );
        setRecords(filtered);
      }
    } catch (err) {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleDelete = async (recordId: string) => {
    if (!confirm('确定要删除这条记录吗？')) return;
    try {
      const res = await deletePractice(recordId);
      if (res.code === 0) {
        setRecords((prev) => prev.filter((r) => r.record_id !== recordId));
      }
    } catch {
      alert('删除失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">对话练习记录</h1>
            <p className="text-sm text-gray-500 mt-1">查看所有模拟客户对话的历史记录</p>
          </div>
          <button
            onClick={() => navigate('/employee/debrief/new/practice')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            开始新对话
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="text-center py-10">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              重试
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && records.length === 0 && (
          <div className="bg-white rounded-2xl border p-10 text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无对话记录</h3>
            <p className="text-sm text-gray-500 mb-6">还没有进行过模拟客户对话练习</p>
            <button
              onClick={() => navigate('/employee/debrief/new/practice')}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              开始第一次对话练习
            </button>
          </div>
        )}

        {/* Records List */}
        {!loading && records.length > 0 && (
          <div className="space-y-3">
            {records.map((record) => (
              <div
                key={record.record_id}
                className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => navigate(`/employee/debrief/${record.record_id}/dialogue-training`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-medium text-gray-900">
                        {record.product_line || '对话练习'}
                      </h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        record.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : record.status === 'analyzing'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {record.status === 'completed' ? '已完成' : record.status === 'analyzing' ? '分析中' : '进行中'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(record.created_at)}
                      </span>
                      <span>{record.practice_type}</span>
                      {record.duration > 0 && (
                        <span>{Math.floor(record.duration / 60)}分{record.duration % 60}秒</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {record.overall_score !== undefined && (
                      <div className="text-right">
                        <p className="text-2xl font-bold text-blue-600">{Math.round(record.overall_score)}</p>
                        <p className="text-xs text-gray-400">综合评分</p>
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(record.record_id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-600 transition-opacity"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ArrowRight className="w-5 h-5 text-gray-300" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
