import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  Mic,
  Square,
  Send,
} from 'lucide-react';
import { getDebriefList, type DebriefRecord, createDebrief } from '../../api/debrief';
import { IFlytekAsrClient } from '../../utils/iflytek-asr';
import { Card } from '../../components/ui/Card';
import { ScoreBadge } from '../../components/ui/ScoreBadge';
import { ProductLineSelector } from '../../components/ProductLineSelector';

export function DebriefCenterPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<DebriefRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDebriefList()
      .then((res) => {
        if (res.code === 0 && res.data) {
          // 只保留 post_meeting（复盘记录）
          const postMeetingRecords = res.data.list.filter(
            (r) => r.debrief_mode === 'post_meeting'
          );
          setRecords(postMeetingRecords);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-[calc(100vh-140px)]">
      {/* 左侧：复盘记录列表 */}
      <div className="w-80 border-r border-gray-200 overflow-y-auto bg-gray-50/50">
        <div className="p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">复盘记录</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            </div>
          ) : records.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">暂无复盘记录</p>
          ) : (
            <div className="space-y-2">
              {records.map((r) => (
                <button
                  key={r.record_id}
                  onClick={() => navigate(`/employee/debrief/${r.record_id}`)}
                  className="w-full text-left p-3 rounded-lg transition-colors border-l-4 bg-white border-transparent hover:bg-gray-100"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {r.title || '未命名复盘'}
                    </span>
                    {r.overall_score !== undefined && (
                      <ScoreBadge score={Math.round(r.overall_score)} />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                    {r.status === 'analyzing' && (
                      <span className="text-xs text-amber-600">分析中</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：新建复盘 */}
      <div className="flex-1 overflow-y-auto p-6">
        <NewDebriefForm />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────
// 新建复盘表单（右侧默认展示）
// ──────────────────────────────────────────

function NewDebriefForm() {
  const [title, setTitle] = useState('');
  const [productLineId, setProductLineId] = useState('');
  const [content, setContent] = useState('');
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const asrFinalRef = useRef('');
  const asrClientRef = useRef<IFlytekAsrClient | null>(null);

  const startRealtimeAsr = async () => {
    asrFinalRef.current = content;

    const client = new IFlytekAsrClient({
      onText: (final, interim) => {
        setContent(asrFinalRef.current + final + (interim ? ' ' + interim : ''));
      },
      onError: (err) => {
        setError(err);
        setRecording(false);
      },
      onStatusChange: (status) => {
        if (status === 'recording') {
          setRecording(true);
        } else if (status === 'idle') {
          setRecording(false);
        }
      },
    });

    asrClientRef.current = client;
    await client.start();
  };

  const stopRealtimeAsr = () => {
    asrClientRef.current?.stop();
    asrClientRef.current = null;
    setRecording(false);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请填写见客主题');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await createDebrief(title.trim(), content.trim(), productLineId || undefined);
      if (res.code === 0 && res.data) {
        // 提交成功后刷新页面或跳转
        window.location.reload();
      } else {
        setError('提交失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card className="p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-2">新建复盘</h2>
        <p className="text-sm text-gray-500 mb-6">记录见客情况，AI 帮你分析谈单全流程</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              见客主题 / 客户名称
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：拜访张三（某科技公司）"
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">产品线</label>
            <ProductLineSelector
              value={productLineId}
              onChange={(id) => setProductLineId(id)}
              placeholder="选择产品线（可选）"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              谈单情况描述
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请描述见客过程：客户背景、谈了什么、客户反应、遇到的问题、结果如何..."
              rows={6}
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">也可以只语音描述，不填文字</p>
          </div>

          {/* 语音转文字按钮 */}
          <div className="flex items-center gap-3">
            <button
              onClick={recording ? stopRealtimeAsr : startRealtimeAsr}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                recording
                  ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                  : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {recording ? '停止转写' : '🎤 语音转文字'}
            </button>
          </div>
          {recording && <p className="text-xs text-blue-600">正在实时转写... 请说话</p>}

          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                提交复盘
              </>
            )}
          </button>
        </div>
      </Card>
    </div>
  );
}
