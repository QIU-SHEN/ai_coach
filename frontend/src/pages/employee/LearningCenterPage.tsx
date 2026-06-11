import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { BookOpen, GraduationCap, Package, X, HelpCircle } from 'lucide-react';
import {
  getMaterials,
  getProductLines,
  downloadMaterial,
  type ScriptItem,
  type MaterialItem,
  type ProductLine,
  type SellingPoint,
  type ProductSpec,
  type SalesScenario,
} from '../../api/knowledge';
import { ProductMaterialsView } from '../../components/ProductMaterialsView';

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

  // Modal
  const [modalItem, setModalItem] = useState<{
    type: 'sp' | 'script' | 'spec' | 'scenario';
    data: SellingPoint | ScriptItem | ProductSpec | SalesScenario;
  } | null>(null);

  // Pagination
  const [materialsPage, setMaterialsPage] = useState(1);
  const MATERIALS_PAGE_SIZE = 12;

  useEffect(() => {
    getProductLines()
      .then((res) => { if (res.code === 0 && res.data) setProductLines(res.data.list.filter((l) => l.status === 'active')); })
      .catch(() => {});
  }, []);

  const getLineName = (id?: string) => productLines.find((l) => l.product_line_id === id)?.name || '';

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

  const sceneColors: Record<string, string> = {
    '开场': 'bg-blue-50 text-blue-700', '异议处理': 'bg-red-50 text-red-700',
    '促单': 'bg-green-50 text-green-700', '转介绍': 'bg-purple-50 text-purple-700',
  };

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
        <p className="text-sm text-gray-400 py-8 text-center">加载中...</p>
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
                            onClick={() => downloadMaterial(m.material_id, m.title)}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                          >
                            <BookOpen className="w-4 h-4" />
                            资料下载
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

      {/* Structured unit detail modal */}
      {modalItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setModalItem(null)}>
          <div className="relative bg-white rounded-xl shadow-lg max-w-2xl w-full my-8 p-6" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setModalItem(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>

            {modalItem.type === 'sp' && (
              (() => {
                const sp = modalItem.data as SellingPoint;
                return (
                  <div>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">卖点</span>
                    <h2 className="text-lg font-bold text-gray-900 mt-2 mb-1">{sp.title}</h2>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mb-4">
                      <span>优先级: <span className={`font-semibold ${sp.priority >= 8 ? 'text-red-600' : sp.priority >= 5 ? 'text-orange-600' : 'text-gray-600'}`}>{sp.priority}</span></span>
                      <span>分类: {sp.category}</span>
                    </div>
                    <div className="border-t pt-4">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{sp.description}</p>
                      {sp.keywords && sp.keywords.length > 0 && (
                        <p className="text-xs text-gray-400 mt-4">关键词：{sp.keywords.join('、')}</p>
                      )}
                    </div>
                  </div>
                );
              })()
            )}

            {modalItem.type === 'script' && (
              (() => {
                const s = modalItem.data as ScriptItem;
                return (
                  <div>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">话术</span>
                    <h2 className="text-lg font-bold text-gray-900 mt-2 mb-1">{s.title}</h2>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mb-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${sceneColors[s.scene] || 'bg-gray-100 text-gray-600'}`}>{s.scene}</span>
                    </div>
                    <div className="border-t pt-4">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{s.content}</p>
                      {s.tags && s.tags.length > 0 && (
                        <p className="text-xs text-gray-400 mt-4">标签：{s.tags.join('、')}</p>
                      )}
                    </div>
                  </div>
                );
              })()
            )}

            {modalItem.type === 'spec' && (
              (() => {
                const spec = modalItem.data as ProductSpec;
                return (
                  <div>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700">方法论</span>
                    <h2 className="text-lg font-bold text-gray-900 mt-2 mb-1">{spec.spec_name}</h2>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mb-4">
                      <span>值: {spec.spec_value}</span>
                      {spec.unit && <span>单位: {spec.unit}</span>}
                    </div>
                    <div className="border-t pt-4">
                      {spec.common_mistake ? (
                        <>
                          <p className="text-xs text-gray-500 mb-1">常见误区</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{spec.common_mistake}</p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400">暂无补充说明</p>
                      )}
                    </div>
                  </div>
                );
              })()
            )}

            {modalItem.type === 'scenario' && (
              (() => {
                const sc = modalItem.data as SalesScenario;
                return (
                  <div>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">场景</span>
                    <h2 className="text-lg font-bold text-gray-900 mt-2 mb-1">{sc.title}</h2>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mb-4">
                      <span>类型: {sc.scene_type}</span>
                    </div>
                    <div className="border-t pt-4">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{sc.content}</p>
                      {sc.key_takeaway && (
                        <p className="text-xs text-gray-500 mt-4 font-medium">要点：{sc.key_takeaway}</p>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
