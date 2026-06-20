import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, FileText, BookOpen, Play, Upload, Trash2, Loader2, AlertCircle } from 'lucide-react';
import {
  getProductLines,
  getProductAssets,
  getAssetFileUrl,
  uploadAsset,
  deleteAsset,
  type ProductLine,
  type ProductAsset,
} from '../../api/knowledge';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../hooks/useToast';

function isDocOrVideo(a: ProductAsset) {
  const path = a.file_path.toLowerCase();
  return (
    a.asset_type === 'manual' ||
    a.asset_type === 'brochure' ||
    a.asset_type === 'video' ||
    path.endsWith('.mp4')
  );
}

export function ProductDocsManagePage() {
  const { productLineId } = useParams<{ productLineId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [product, setProduct] = useState<ProductLine | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setAssets(assetsRes.filter((a) => isDocOrVideo(a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    if (!productLineId) return;
    const ext = file.name.toLowerCase();
    let assetType = 'manual';
    if (ext.endsWith('.mp4')) assetType = 'video';
    else if (ext.endsWith('.pdf')) assetType = 'brochure';

    setUploading(true);
    try {
      const res = await uploadAsset(file, productLineId, assetType);
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
    if (!await confirm({ message: '确定删除该素材？', variant: 'danger' })) return;
    setDeletingId(assetId);
    try {
      const res = await deleteAsset(assetId);
      if (res.code === 0) {
        setAssets((prev) => prev.filter((a) => a.asset_id !== assetId));
      } else {
        toast.error(res.message || '删除失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
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
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`${basePath}/product/${productLineId}`)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">文档及视频管理</h1>
              {product && <p className="text-sm text-gray-500">{product.name}</p>}
            </div>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            上传素材
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.mp4"
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

        {assets.length > 0 ? (
          <div className="space-y-3">
            {assets.map((a) => (
              <div
                key={a.asset_id}
                className="bg-white rounded-xl border p-4 flex items-center gap-4 hover:shadow-md transition-shadow"
              >
                <div className="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  {a.file_path.toLowerCase().endsWith('.mp4') ? (
                    <Play className="w-6 h-6 text-red-500" />
                  ) : (
                    <BookOpen className="w-6 h-6 text-blue-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{a.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {a.file_path.toLowerCase().endsWith('.mp4') ? '视频' : 'PDF 文档'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => window.open(getAssetFileUrl(a.asset_id), '_blank')}
                    className="text-xs text-blue-600 font-medium hover:text-blue-700"
                  >
                    {a.file_path.toLowerCase().endsWith('.mp4') ? '点击播放' : '在新窗口打开'}
                  </button>
                  <button
                    onClick={() => handleDelete(a.asset_id)}
                    disabled={deletingId === a.asset_id}
                    className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
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
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border p-10 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">暂无产品文档与视频</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              上传素材
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
