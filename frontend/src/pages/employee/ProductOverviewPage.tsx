import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, HelpCircle, Image, FileText } from 'lucide-react';
import { getProductLines, type ProductLine } from '../../api/knowledge';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';

export function ProductOverviewPage() {
  const { productLineId } = useParams<{ productLineId: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductLine | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!productLineId) return;
    setLoading(true);
    getProductLines()
      .then((res) => {
        if (res.code === 0 && res.data) {
          const found = res.data.list.find((p) => p.product_line_id === productLineId);
          if (found) setProduct(found);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [productLineId]);

  function getCoverUrl() {
    if (!product?.cover_image_asset_id) return null;
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
    return `${API_BASE}/api/v1/knowledge/product-assets/${product.cover_image_asset_id}/file`;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/3" />
            <SkeletonText lines={3} />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-gray-500">产品不存在</p>
          <button
            onClick={() => navigate('/employee/learning?tab=assets')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            返回学习中心
          </button>
        </div>
      </div>
    );
  }

  const coverUrl = getCoverUrl();

  const cards = [
    {
      key: 'quiz',
      title: '题目练习',
      desc: '针对本产品进行知识巩固练习',
      icon: <HelpCircle className="w-6 h-6 text-purple-500" />,
      color: 'hover:border-purple-300 hover:bg-purple-50',
    },
    {
      key: 'images',
      title: '产品图片',
      desc: '查看产品高清图片与宣传素材',
      icon: <Image className="w-6 h-6 text-green-500" />,
      color: 'hover:border-green-300 hover:bg-green-50',
    },
    {
      key: 'docs',
      title: '产品文档与视频',
      desc: '查看说明书、技术文档与演示视频',
      icon: <FileText className="w-6 h-6 text-blue-500" />,
      color: 'hover:border-blue-300 hover:bg-blue-50',
    },
  ];

  return (
    <div className="fixed left-0 right-0 bottom-0 bg-gray-50 p-6 overflow-hidden flex flex-col" style={{ top: '64px' }}>
      <style>{`html,body{overflow:hidden;}`}</style>
      <div className="max-w-6xl mx-auto w-full flex flex-col flex-1 min-h-0">
        {/* Back button */}
        <button
          onClick={() => navigate('/employee/learning?tab=assets')}
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
            <div className="shrink-0">
              {coverUrl ? (
                <div className="aspect-[16/9] bg-gray-100 rounded-xl overflow-hidden max-h-78">
                  <img src={coverUrl} alt={product.name} className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="aspect-[16/9] bg-gray-50 rounded-xl flex flex-col items-center justify-center text-gray-400 max-h-52">
                  <Image className="w-10 h-10 mb-2" />
                  <p className="text-sm">暂无封面图</p>
                </div>
              )}
            </div>

            {/* Feature cards */}
            {cards.map((card) => (
              <button
                key={card.key}
                onClick={() => navigate(`/employee/learning/product/${productLineId}/${card.key}`)}
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
