import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, HelpCircle, Image, FileText, Edit3, X, Check } from 'lucide-react';
import { getProductLines, getProductAssets, setProductCoverImage, type ProductLine, type ProductAsset } from '../../api/knowledge';
import { useToast } from '../../hooks/useToast';

export function ProductAssetsOverviewPage() {
  const { productLineId } = useParams<{ productLineId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [product, setProduct] = useState<ProductLine | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectingCover, setSelectingCover] = useState(false);
  const [savingCover, setSavingCover] = useState(false);

  const isAdmin = location.pathname.startsWith('/admin');
  const basePath = isAdmin ? '/admin/assets' : '/manager/assets';

  useEffect(() => {
    if (!productLineId) return;
    loadData();
  }, [productLineId]);

  async function loadData() {
    if (!productLineId) return;
    setLoading(true);
    try {
      const [plRes, assetsRes] = await Promise.all([
        getProductLines().then((res) => {
          if (res.code === 0 && res.data) {
            return res.data.list.find((p) => p.product_line_id === productLineId) || null;
          }
          return null;
        }),
        getProductAssets({ product_line_id: productLineId, asset_type: 'image', limit: 100 }),
      ]);
      setProduct(plRes);
      if (assetsRes.code === 0 && assetsRes.data) {
        setAssets(assetsRes.data.list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetCover(assetId: string) {
    if (!productLineId) return;
    setSavingCover(true);
    try {
      const res = await setProductCoverImage(productLineId, assetId);
      if (res.code === 0) {
        setProduct((prev) => prev ? { ...prev, cover_image_asset_id: assetId } : null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '设置失败');
    } finally {
      setSavingCover(false);
      setSelectingCover(false);
    }
  }

  function getCoverUrl() {
    if (!product?.cover_image_asset_id) return null;
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
    return `${API_BASE}/api/v1/knowledge/product-assets/${product.cover_image_asset_id}/file`;
  }

  const cards = [
    {
      key: 'quiz',
      title: '题目配置',
      desc: '配置产品相关的练习题与考核题目',
      icon: <HelpCircle className="w-6 h-6 text-purple-500" />,
      color: 'hover:border-purple-300 hover:bg-purple-50',
    },
    {
      key: 'images',
      title: '图片管理',
      desc: '管理产品高清图片与宣传素材',
      icon: <Image className="w-6 h-6 text-green-500" />,
      color: 'hover:border-green-300 hover:bg-green-50',
    },
    {
      key: 'docs',
      title: '文档及视频管理',
      desc: '管理说明书、技术文档与演示视频',
      icon: <FileText className="w-6 h-6 text-blue-500" />,
      color: 'hover:border-blue-300 hover:bg-blue-50',
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-gray-500">产品不存在</p>
          <button
            onClick={() => navigate(basePath)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            返回产品素材
          </button>
        </div>
      </div>
    );
  }

  const coverUrl = getCoverUrl();

  return (
    <div className="fixed left-0 right-0 bottom-0 bg-gray-50 p-6 overflow-hidden flex flex-col" style={{ top: '64px' }}>
      <div className="max-w-6xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <button
          onClick={() => navigate(basePath)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-4 shrink-0"
        >
          <ArrowLeft className="w-4 h-4" /> 返回
        </button>

        <div className="flex gap-6 flex-1 min-h-0">
          {/* Left column: product info */}
          <div className="w-1/2 flex flex-col min-h-0">
            <div className="bg-white rounded-xl border p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-3 shrink-0">
                <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
              </div>

              <div className="border-t pt-3 h-[500px] overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {product.description ? (
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{product.description}</p>
                ) : (
                  <p className="text-sm text-gray-400">暂无产品介绍</p>
                )}
              </div>
            </div>
          </div>

          {/* Right column: cover image + feature cards */}
          <div className="w-1/2 flex flex-col gap-3 min-h-0">
            {/* Cover image */}
            <div className="relative group shrink-0">
              <button
                onClick={() => setSelectingCover((v) => !v)}
                className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur text-xs text-blue-600 rounded-md shadow-sm"
              >
                {selectingCover ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                {selectingCover ? '取消' : '更换封面'}
              </button>

              {selectingCover ? (
                <div>
                  <p className="text-xs text-gray-500 mb-2">点击图片设为封面</p>
                  {assets.length === 0 ? (
                    <p className="text-sm text-gray-400">暂无图片素材，请先上传图片</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1">
                      {assets.map((a) => {
                        const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
                        const url = `${API_BASE}/api/v1/knowledge/product-assets/${a.asset_id}/file`;
                        const isSelected = a.asset_id === product.cover_image_asset_id;
                        return (
                          <button
                            key={a.asset_id}
                            onClick={() => handleSetCover(a.asset_id)}
                            disabled={savingCover}
                            className={`relative aspect-square rounded-lg overflow-hidden border-2 ${
                              isSelected ? 'border-blue-500' : 'border-transparent hover:border-blue-300'
                            }`}
                          >
                            <img src={url} alt={a.title} className="w-full h-full object-cover" />
                            {isSelected && (
                              <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                                <Check className="w-5 h-5 text-blue-600 bg-white rounded-full p-0.5" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : coverUrl ? (
                <div className="aspect-[16/9] bg-gray-100 rounded-xl overflow-hidden max-h-78">
                  <img src={coverUrl} alt={product.name} className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="aspect-[16/9] bg-gray-50 rounded-xl flex flex-col items-center justify-center text-gray-400 max-h-52">
                  <Image className="w-10 h-10 mb-2" />
                  <p className="text-sm">暂无封面图</p>
                  <p className="text-xs">点击"更换封面"从产品图片中选择</p>
                </div>
              )}
            </div>

            {/* Feature cards */}
            {cards.map((card) => (
              <button
                key={card.key}
                onClick={() => navigate(`${basePath}/product/${productLineId}/${card.key}`)}
                className={`w-full bg-white rounded-xl border px-5 py-4 text-left hover:shadow-md transition-all shrink-0 ${card.color}`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                    {card.icon}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">{card.title}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">{card.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
