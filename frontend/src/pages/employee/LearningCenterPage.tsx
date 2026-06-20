import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { GraduationCap, Package, HelpCircle, Eye, Headphones, Play, FileText } from 'lucide-react';
import {
  getMaterials,
  getProductLines,
  type MaterialItem,
  type ProductLine,
} from '../../api/knowledge';
import { ProductMaterialsView } from '../../components/ProductMaterialsView';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';

type SubTab = 'materials' | 'assets';

const materialTypeLabels: Record<MaterialItem['type'], string> = {
  video: '视频', pdf: 'PDF', audio: '音频', article: '图文',
};

const materialTypeColors: Record<MaterialItem['type'], string> = {
  video: 'bg-red-50 text-red-700',
  pdf: 'bg-blue-50 text-blue-700',
  audio: 'bg-green-50 text-green-700',
  article: 'bg-gray-100 text-gray-700',
};


export function LearningCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialTab: SubTab = searchParams.get('tab') === 'assets' ? 'assets' : 'materials';
  const [subTab, setSubTab] = useState<SubTab>(initialTab);
  // Data
  const [materialsList, setMaterialsList] = useState<MaterialItem[]>([]);
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination
  const [materialsPage, setMaterialsPage] = useState(1);
  const MATERIALS_PAGE_SIZE = 12;

  useEffect(() => {
    getProductLines()
      .then((res) => { if (res.code === 0 && res.data) setProductLines(res.data.list.filter((l) => l.status === 'active')); })
      .catch(() => {});
  }, []);

  const getLineName = (id?: string) => productLines.find((l) => l.product_line_id === id)?.name || '';

  const handlePreview = (m: MaterialItem) => {
    navigate(`/employee/learning/material/${m.material_id}`);
  };

  useEffect(() => {
    setLoading(true);
    getMaterials({ limit: 100 })
      .then((materialsRes) => {
        if (materialsRes.code === 0 && materialsRes.data) {
          setMaterialsList(materialsRes.data.list.filter((m) => m.status === 'active'));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // const sceneColors: Record<string, string> = {
  //   '开场': 'bg-blue-50 text-blue-700', '异议处理': 'bg-red-50 text-red-700',
  //   '促单': 'bg-green-50 text-green-700', '转介绍': 'bg-purple-50 text-purple-700',
  // };

  const Pagination = ({ current, total, pageSize, onChange }: { current: number; total: number; pageSize: number; onChange: (p: number) => void }) => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (totalPages <= 1) return null;
    const pages: (number | string)[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= current - 1 && i <= current + 1)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return (
      <div className="flex items-center justify-center gap-1 mt-4">
        <button
          onClick={() => onChange(current - 1)}
          disabled={current <= 1}
          className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          上一页
        </button>
        {pages.map((p, idx) =>
          p === '...' ? (
            <span key={idx} className="px-2 text-sm text-gray-400">...</span>
          ) : (
            <button
              key={idx}
              onClick={() => onChange(p as number)}
              className={`px-3 py-1.5 text-sm rounded-lg border ${
                p === current ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onChange(current + 1)}
          disabled={current >= totalPages}
          className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          下一页
        </button>
      </div>
    );
  };

  return (
    <div className="p-6 fade-in">
      {/* Nav tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          <button
            onClick={() => { setSubTab('materials'); setSearchParams({}); setMaterialsPage(1); }}
            className={`flex items-center gap-1.5 pb-3 text-base font-medium transition-colors border-b-2 ${
              subTab === 'materials'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            培训资料学习
          </button>

          <button
            onClick={() => { setSubTab('assets'); setSearchParams({ tab: 'assets' }); }}
            className={`flex items-center gap-1.5 pb-3 text-base font-medium transition-colors border-b-2 ${
              subTab === 'assets'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Package className="w-4 h-4" />
            产品资料学习
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border p-4 space-y-3">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <SkeletonText lines={2} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* 培训资料 */}
          {subTab === 'materials' && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">培训资料</h3>
              {materialsList.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">暂无培训资料</p>
              ) : (
                <>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {materialsList.slice((materialsPage - 1) * MATERIALS_PAGE_SIZE, materialsPage * MATERIALS_PAGE_SIZE).map((m) => (
                      <div
                        key={m.material_id}
                        className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow flex flex-col"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${materialTypeColors[m.type]}`}>
                            {materialTypeLabels[m.type]}
                          </span>
                          <span className="text-xs text-gray-400">{m.duration || '-'}</span>
                        </div>
                        <h3 className="font-medium text-gray-900 mb-2 line-clamp-2">{m.title}</h3>
                        {m.product_line_id && getLineName(m.product_line_id) && (
                          <p className="text-xs text-gray-400 mb-3">{getLineName(m.product_line_id)}</p>
                        )}
                        {m.description && (
                          <p className="text-sm text-gray-500 line-clamp-2 mb-4">{m.description}</p>
                        )}
                        <div className="mt-auto space-y-2">
                          <button
                            onClick={() => handlePreview(m)}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                          >
                            {m.type === 'pdf' ? <FileText className="w-4 h-4" /> :
                             m.type === 'video' ? <Play className="w-4 h-4" /> :
                             m.type === 'audio' ? <Headphones className="w-4 h-4" /> :
                             <Eye className="w-4 h-4" />}
                            在线查看
                          </button>
                            <button
                              onClick={() => {
                                navigate(`/employee/learning/material/${m.material_id}/quiz`);
                              }}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                            >
                              <HelpCircle className="w-4 h-4" />
                              题目练习
                            </button>
                          </div>
                        </div>
                    ))}
                  </div>
                  <Pagination current={materialsPage} total={materialsList.length} pageSize={MATERIALS_PAGE_SIZE} onChange={setMaterialsPage} />
                </>
              )}
            </>
          )}

          {/* 产品资料学习 */}
          {subTab === 'assets' && <ProductMaterialsView />}
        </>
      )}
    </div>
  );
}
