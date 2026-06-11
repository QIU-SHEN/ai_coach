import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Download, Headphones, Play, FileText, Loader2 } from 'lucide-react';
import { getMaterialById, downloadMaterial, type MaterialItem } from '../../api/knowledge';
import { authHeaders } from '../../api/auth';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export function MaterialPreviewPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const navigate = useNavigate();
  const [material, setMaterial] = useState<MaterialItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [blobUrl, setBlobUrl] = useState<string>('');

  const [blobLoading, setBlobLoading] = useState(false);

  // 1. 获取资料元数据
  useEffect(() => {
    if (!materialId) return;
    setLoading(true);
    getMaterialById(materialId)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setMaterial(res.data);
        } else {
          setError('资料不存在');
        }
      })
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false));
  }, [materialId]);

  // 2. 获取 blob URL（带鉴权）
  useEffect(() => {
    if (!material) return;

    const fetchBlob = async () => {
      if (material.type === 'pdf' || material.type === 'video' || material.type === 'audio') {
        setBlobLoading(true);
      }
      try {
        const res = await fetch(`${API_BASE}/api/v1/materials/${material.material_id}/download`, {
          headers: { ...authHeaders() },
        });
        if (!res.ok) throw new Error('获取失败');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch {
        setError('预览加载失败');
      } finally {
        setBlobLoading(false);
      }
    };

    fetchBlob();

    return () => {
      if (blobUrl) {
        window.URL.revokeObjectURL(blobUrl);
      }
    };
  }, [material]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !material) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border p-8 text-center max-w-md">
          <p className="text-red-900 font-medium">{error || '资料不存在'}</p>
          <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            返回
          </button>
        </div>
      </div>
    );
  }

  const downloadUrl = `${API_BASE}/api/v1/materials/${material.material_id}/download`;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/employee/learning')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="font-bold text-gray-900 text-sm flex items-center gap-2">
              {material.type === 'pdf' && <FileText className="w-4 h-4 text-blue-600" />}
              {material.type === 'video' && <Play className="w-4 h-4 text-red-600" />}
              {material.type === 'audio' && <Headphones className="w-4 h-4 text-green-600" />}
              {material.type === 'article' && <BookOpen className="w-4 h-4 text-gray-600" />}
              {material.title}
            </h1>
            <p className="text-xs text-gray-400">
              {material.type === 'pdf' && 'PDF 文档'}
              {material.type === 'video' && '视频资料'}
              {material.type === 'audio' && '音频资料'}
              {material.type === 'article' && '图文资料'}
            </p>
          </div>
        </div>
        <button
          onClick={() => downloadMaterial(material.material_id, material.title)}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
        >
          <Download className="w-4 h-4" />
          下载到本地
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl border overflow-hidden">
          {material.type === 'pdf' && (
            <div className="h-[calc(100vh-180px)]">
              {blobLoading && (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">正在加载文档...</p>
                  </div>
                </div>
              )}
              {blobUrl && (
                <iframe
                  src={blobUrl}
                  className="w-full h-full border-0"
                  title={material.title}
                />
              )}
            </div>
          )}

          {material.type === 'video' && (
            <div className="flex items-center justify-center bg-black p-4">
              {blobLoading && (
                <div className="text-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">正在加载视频...</p>
                </div>
              )}
              {blobUrl && (
                <video
                  controls
                  src={blobUrl}
                  className="w-full max-h-[calc(100vh-180px)] rounded-lg"
                  style={{ maxWidth: '100%' }}
                />
              )}
            </div>
          )}

          {material.type === 'audio' && (
            <div className="flex flex-col items-center justify-center p-12 bg-gradient-to-b from-blue-50 to-white">
              {blobLoading && (
                <div className="text-center mb-6">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">正在加载音频...</p>
                </div>
              )}
              {blobUrl && (
                <>
                  <Headphones className="w-24 h-24 text-blue-400 mb-8" />
                  <p className="text-lg font-medium text-gray-700 mb-4">{material.title}</p>
                  <audio controls src={blobUrl} className="w-full max-w-md" />
                </>
              )}
            </div>
          )}

          {(material.type === 'article' || !['pdf', 'video', 'audio'].includes(material.type)) && (
            <div className="p-8">
              {material.description ? (
                <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {material.description}
                </div>
              ) : (
                <p className="text-gray-400 text-center py-20">暂无内容</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
