import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, MessageSquareText, GraduationCap, Clock, Tag, ExternalLink } from 'lucide-react';
import {
  getKnowledgeById,
  getScriptById,
  getMaterialById,
  getProductLines,
  downloadMaterial,
  type KnowledgeItem,
  type ScriptItem,
  type MaterialItem,
  type ProductLine,
} from '../../api/knowledge';

type ItemType = 'knowledge' | 'script' | 'material';

const typeInfo: Record<ItemType, { label: string; icon: typeof BookOpen; color: string }> = {
  knowledge: { label: '产品知识', icon: BookOpen, color: 'text-blue-600' },
  script: { label: '销售话术', icon: MessageSquareText, color: 'text-purple-600' },
  material: { label: '培训资料', icon: GraduationCap, color: 'text-green-600' },
};

export function LearningDetailPage() {
  const { type, id } = useParams<{ type: ItemType; id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const [knowledge, setKnowledge] = useState<KnowledgeItem | null>(null);
  const [script, setScript] = useState<ScriptItem | null>(null);
  const [material, setMaterial] = useState<MaterialItem | null>(null);
  const [productLines, setProductLines] = useState<ProductLine[]>([]);

  useEffect(() => {
    getProductLines()
      .then((res) => { if (res.code === 0 && res.data) setProductLines(res.data.list); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!type || !id) return;
    setLoading(true);
    if (type === 'knowledge') {
      getKnowledgeById(id)
        .then((res) => {
          if (res.code === 0 && res.data) {
            setKnowledge(res.data);
          }
        })
        .finally(() => setLoading(false));
    } else if (type === 'script') {
      getScriptById(id)
        .then((res) => {
          if (res.code === 0 && res.data) {
            setScript(res.data);
          }
        })
        .finally(() => setLoading(false));
    } else {
      getMaterialById(id)
        .then((res) => {
          if (res.code === 0 && res.data) {
            setMaterial(res.data);
          }
        })
        .finally(() => setLoading(false));
    }
  }, [type, id]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-20">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  const info = type ? typeInfo[type] : null;

  // Derive display data based on type
  const title = type === 'knowledge' ? knowledge?.title : type === 'script' ? script?.title : material?.title;
  const content = type === 'knowledge' ? knowledge?.content : type === 'script' ? script?.content : material?.description || '暂无详细内容';
  const tags = type === 'knowledge' ? knowledge?.tags : type === 'script' ? script?.tags : material?.tags;
  const badge = type === 'knowledge' ? knowledge?.category : type === 'script' ? script?.scene : material?.type;
  const duration = type === 'material' ? material?.duration : undefined;
  const plId = type === 'knowledge' ? knowledge?.product_line_id : type === 'script' ? script?.product_line_id : material?.product_line_id;
  const plName = productLines.find((l) => l.product_line_id === plId)?.name;

  if (!title || !info) {
    return (
      <div className="p-6 text-center py-20">
        <p className="text-gray-400 mb-4">未找到该内容</p>
        <button onClick={() => navigate('/employee/learning')} className="text-blue-600 hover:underline">
          返回学习中心
        </button>
      </div>
    );
  }

  const badgeColors: Record<string, string> = {
    '卖点': 'bg-blue-50 text-blue-700',
    '规格': 'bg-purple-50 text-purple-700',
    '竞品对比': 'bg-orange-50 text-orange-700',
    '常见问题': 'bg-green-50 text-green-700',
    '开场': 'bg-blue-50 text-blue-700',
    '异议处理': 'bg-red-50 text-red-700',
    '促单': 'bg-green-50 text-green-700',
    '转介绍': 'bg-purple-50 text-purple-700',
    'video': 'bg-red-50 text-red-700',
    'pdf': 'bg-blue-50 text-blue-700',
    'audio': 'bg-green-50 text-green-700',
    'article': 'bg-gray-100 text-gray-700',
  };

  const materialTypeLabels: Record<string, string> = {
    video: '视频', pdf: 'PDF', audio: '音频', article: '图文',
  };

  return (
    <div className="p-6 fade-in max-w-4xl mx-auto">
      {/* Header */}
      <button
        onClick={() => navigate('/employee/learning')}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-6 text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        返回学习中心
      </button>

      <div className="bg-white rounded-2xl border shadow-sm p-8">
        <div className="flex items-center gap-3 mb-2">
          <info.icon className={`w-6 h-6 ${info.color}`} />
          <span className="text-sm text-gray-500">{info.label}</span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-4">{title}</h1>

        <div className="flex flex-wrap items-center gap-3 mb-6 text-sm text-gray-500">
          {badge && (
            <span className={`px-2.5 py-1 rounded text-xs font-medium ${badgeColors[badge] || 'bg-gray-100 text-gray-600'}`}>
              {materialTypeLabels[badge] || badge}
            </span>
          )}
          {plName && (
            <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium">
              {plName}
            </span>
          )}
          {duration && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {duration}
            </span>
          )}
          {(tags || []).length > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" />
              {(tags || []).join('、')}
            </span>
          )}
        </div>

        <div className="border-t pt-6">
          <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        </div>

        {type === 'material' && material && (
          <div className="mt-6 pt-4 border-t">
            <button
              onClick={() => downloadMaterial(material.material_id, material.title)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <ExternalLink className="w-4 h-4" />
              资料下载
            </button>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between mt-6">
        <button
          onClick={() => navigate('/employee/learning')}
          className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50"
        >
          返回列表
        </button>
        <button
          onClick={() => {
            alert('已标记为已学习');
            navigate('/employee/learning');
          }}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          标记已学完
        </button>
      </div>
    </div>
  );
}
