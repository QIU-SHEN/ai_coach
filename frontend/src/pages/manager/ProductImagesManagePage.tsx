import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Image, X, Upload, Trash2, Loader2, AlertCircle, Sparkles, Check, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getProductLines,
  getProductAssets,
  uploadAsset,
  deleteAsset,
  generateProductDescription,
  type ProductLine,
  type ProductAsset,
} from '../../api/knowledge';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../hooks/useToast';

const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

function isImagePath(path: string) {
  return imageExts.some((ext) => path.toLowerCase().endsWith(ext));
}

function getFileUrl(a: ProductAsset) {
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
  return `${API_BASE}/api/v1/knowledge/product-assets/${a.asset_id}/file`;
}

export function ProductImagesManagePage() {
  const { productLineId } = useParams<{ productLineId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [product, setProduct] = useState<ProductLine | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewIndex, setPreviewIndex] = useState<number>(-1);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [descSuccess, setDescSuccess] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = location.pathname.startsWith('/admin');
  const basePath = isAdmin ? '/admin/assets' : '/manager/assets';

  useEffect(() => {
    if (!productLineId) return;
    loadData();
  }, [productLineId]);

  async function loadData() {
    if (!productLineId) return;
    setLoading(true);
    setError(null);
    try {
      const [plRes, assetsRes] = await Promise.all([
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
      ]);
      setProduct(plRes);
      setAssets(assetsRes.filter((a) => isImagePath(a.file_path)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    if (!productLineId) return;
    setUploading(true);
    try {
      const res = await uploadAsset(file, productLineId, 'image');
      if (res.code === 0) {
        await loadData();
      } else {
        toast.error(res.message || '上传失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(assetId: string) {
    if (!await confirm({ message: '确定删除该图片？', variant: 'danger' })) return;
    setDeletingId(assetId);
    try {
      const res = await deleteAsset(assetId);
      if (res.code === 0) {
        setAssets((prev) => prev.filter((a) => a.asset_id !== assetId));
        setSelectedAssets((prev) => {
          const next = new Set(prev);
          next.delete(assetId);
          return next;
        });
      } else {
        toast.error(res.message || '删除失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelect(assetId: string) {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function selectAll() {
    if (selectedAssets.size === assets.length && assets.length > 0) {
      setSelectedAssets(new Set());
    } else {
      setSelectedAssets(new Set(assets.map((a) => a.asset_id)));
    }
  }

  async function handleGenerateDescription() {
    if (!productLineId) return;
    const useSelected = selectedAssets.size > 0;
    const msg = useSelected
      ? `将基于选中的 ${selectedAssets.size} 张图片生成产品介绍，此过程可能需要 10-30 秒，是否继续？`
      : '将基于所有素材生成产品介绍，此过程可能需要 20-40 秒，是否继续？';
    if (!await confirm({ title: 'AI 生成产品介绍', message: msg, variant: 'warning' })) return;
    setGeneratingDesc(true);
    setDescSuccess('');
    setError(null);
    try {
      const assetIds = useSelected ? [...selectedAssets] : undefined;
      const res = await generateProductDescription(productLineId, assetIds);
      if (res.code === 0 && res.data?.description) {
        setDescSuccess('产品介绍已生成并保存成功！');
      } else {
        setError('生成失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGeneratingDesc(false);
    }
  }

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
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`${basePath}/product/${productLineId}`)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">图片管理</h1>
              {product && <p className="text-sm text-gray-500">{product.name}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="flex items-center gap-2 px-3 py-2 text-gray-700 bg-white border rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              {selectedAssets.size === assets.length && assets.length > 0 ? <Check className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {selectedAssets.size > 0 ? `已选${selectedAssets.size}张` : '全选'}
            </button>
            <button
              onClick={handleGenerateDescription}
              disabled={generatingDesc}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              {generatingDesc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI生成产品介绍
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              上传图片
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = '';
            }}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {descSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3 text-green-700">
            <Sparkles className="w-5 h-5 shrink-0" />
            <p className="text-sm">{descSuccess}</p>
          </div>
        )}

        {assets.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {assets.map((a, idx) => {
              const isSelected = selectedAssets.has(a.asset_id);
              return (
                <div
                  key={a.asset_id}
                  className={`bg-white rounded-xl border overflow-hidden hover:shadow-md transition-shadow group relative ${isSelected ? 'ring-2 ring-purple-500' : ''}`}
                >
                  <div
                    className="aspect-square bg-gray-100 flex items-center justify-center cursor-pointer relative"
                    onClick={() => setPreviewIndex(idx)}
                  >
                    <img
                      src={getFileUrl(a)}
                      alt={a.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {/* Checkbox overlay */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(a.asset_id);
                      }}
                      className={`absolute top-2 left-2 p-1 rounded-md transition-colors ${isSelected ? 'bg-purple-600 text-white' : 'bg-white/80 text-gray-500 hover:bg-white'}`}
                      title={isSelected ? '取消选择' : '选择此图片'}
                    >
                      {isSelected ? <Check className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between px-2 py-2">
                    <p className="text-xs text-gray-600 truncate flex-1">{a.title}</p>
                    <button
                      onClick={() => handleDelete(a.asset_id)}
                      disabled={deletingId === a.asset_id}
                      className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                      title="删除"
                    >
                      {deletingId === a.asset_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border p-10 text-center">
            <Image className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">暂无产品图片</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              上传图片
            </button>
          </div>
        )}
      </div>

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

      <div className="max-w-[90vw] max-h-[80vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <img src={getFileUrl(asset)} alt={asset.title} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
      </div>

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
