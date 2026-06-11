import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Image, X, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { getProductLines, getProductAssets, type ProductLine, type ProductAsset } from '../../api/knowledge';

const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

function isImagePath(path: string) {
  return imageExts.some((ext) => path.toLowerCase().endsWith(ext));
}

function getFileUrl(a: ProductAsset) {
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
  return `${API_BASE}/api/v1/product-assets/${a.asset_id}/file`;
}

export function ProductImagesPage() {
  const { productLineId } = useParams<{ productLineId: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductLine | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(-1);

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
        const imageAssets = allAssets.filter((a) => isImagePath(a.file_path));
        setAssets(imageAssets);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => setLoading(false));
  }, [productLineId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate(`/employee/learning/product/${productLineId}`)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">产品图片</h1>
            {product && <p className="text-sm text-gray-500">{product.name}</p>}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Image grid */}
        {assets.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {assets.map((a, idx) => (
              <div
                key={a.asset_id}
                onClick={() => setPreviewIndex(idx)}
                className="bg-white rounded-xl border overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="aspect-square bg-gray-100 flex items-center justify-center">
                  <img
                    src={getFileUrl(a)}
                    alt={a.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <p className="text-xs text-gray-600 p-2 truncate">{a.title}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border p-10 text-center">
            <Image className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无产品图片</p>
          </div>
        )}
      </div>

      {/* Image preview modal */}
      {previewIndex >= 0 && assets[previewIndex] && (
        <PreviewModal
          assets={assets}
          currentIndex={previewIndex}
          onClose={() => setPreviewIndex(-1)}
          onPrev={() => setPreviewIndex((i) => (i > 0 ? i - 1 : assets.length - 1))}
          onNext={() => setPreviewIndex((i) => (i < assets.length - 1 ? i + 1 : 0))}
        />
      )}
    </div>
  );
}

function PreviewModal({
  assets,
  currentIndex,
  onClose,
  onPrev,
  onNext,
}: {
  assets: ProductAsset[];
  currentIndex: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const asset = assets[currentIndex];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10">
        <p className="text-white text-sm truncate max-w-[70%]">
          {asset.title} ({currentIndex + 1} / {assets.length})
        </p>
        <button
          onClick={onClose}
          className="text-white hover:text-gray-300 bg-black/50 rounded-full p-2"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Prev button */}
      {assets.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black/50 rounded-full p-2 md:p-3 z-10"
        >
          <ChevronLeft className="w-6 h-6 md:w-8 md:h-8" />
        </button>
      )}

      {/* Image */}
      <div
        className="max-w-[90vw] max-h-[80vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={getFileUrl(asset)}
          alt={asset.title}
          className="max-w-full max-h-[80vh] object-contain rounded-lg"
        />
      </div>

      {/* Next button */}
      {assets.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black/50 rounded-full p-2 md:p-3 z-10"
        >
          <ChevronRight className="w-6 h-6 md:w-8 md:h-8" />
        </button>
      )}
    </div>
  );
}
