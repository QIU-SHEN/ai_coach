import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, BookOpen, Play, AlertCircle, X, Download } from 'lucide-react';
import { getProductLines, getProductAssets, type ProductLine, type ProductAsset } from '../../api/knowledge';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

function getFileUrl(a: ProductAsset) {
  return `${API_BASE}/api/v1/product-assets/${a.asset_id}/file`;
}

export function ProductDocsPage() {
  const { productLineId } = useParams<{ productLineId: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductLine | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewAsset, setPreviewAsset] = useState<ProductAsset | null>(null);

  useEffect(() => {
    if (!productLineId) return;
    setLoading(true);
    setError(null);

    Promise.all([
      getProductLines().then((res) => {
        if (res.code === 0 && res.data) {
          return res.data.list.find((p) => p.product_line_id === productLineId) || null;
        }
        return null;
      }),
      getProductAssets({
        product_line_id: productLineId,
        limit: 100,
      }).then((res) => {
        if (res.code === 0 && res.data) return res.data.list;
        return [];
      }),
    ])
      .then(([foundProduct, allAssets]) => {
        setProduct(foundProduct);
        const docAssets = allAssets.filter(
          (a) => a.asset_type === 'manual' || a.asset_type === 'brochure' || a.file_path.toLowerCase().endsWith('.mp4')
        );
        setAssets(docAssets);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => setLoading(false));
  }, [productLineId]);

  const isPdf = (a: ProductAsset) =>
    a.file_path.toLowerCase().endsWith('.pdf');

  const isVideo = (a: ProductAsset) =>
    a.file_path.toLowerCase().endsWith('.mp4') ||
    a.file_path.toLowerCase().endsWith('.webm');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate(`/employee/learning/product/${productLineId}`)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">产品文档与视频</h1>
            {product && <p className="text-sm text-gray-500">{product.name}</p>}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Docs list */}
        {assets.length > 0 ? (
          <div className="space-y-3">
            {assets.map((a) => (
              <div
                key={a.asset_id}
                onClick={() => setPreviewAsset(a)}
                className="bg-white rounded-xl border p-4 flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  {isVideo(a) ? (
                    <Play className="w-6 h-6 text-red-500" />
                  ) : (
                    <BookOpen className="w-6 h-6 text-blue-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{a.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {isVideo(a) ? '视频' : 'PDF 文档'}
                  </p>
                </div>
                <span className="text-xs text-blue-600 font-medium shrink-0">
                  {isVideo(a) ? '点击播放' : '点击预览'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border p-10 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无产品文档与视频</p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewAsset && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
            <p className="text-white text-sm truncate max-w-[70%]">
              {previewAsset.title}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(getFileUrl(previewAsset), '_blank');
                }}
                className="text-white hover:text-gray-300 p-2"
                title="新窗口打开"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={() => setPreviewAsset(null)}
                className="text-white hover:text-gray-300 p-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
            {isPdf(previewAsset) ? (
              <embed
                src={getFileUrl(previewAsset)}
                type="application/pdf"
                className="w-full max-w-5xl h-full border-0 rounded-lg bg-white"
              />
            ) : isVideo(previewAsset) ? (
              <video
                controls
                src={getFileUrl(previewAsset)}
                className="w-full max-w-5xl max-h-full rounded-lg"
              />
            ) : (
              <div className="text-white">不支持的文件类型</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
