import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Download, Headphones, Play, FileText, Loader2,
  ChevronLeft, ChevronRight, ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon
} from 'lucide-react';
import { getMaterialById, fetchMaterialPdf, type MaterialItem } from '../../api/knowledge';
import * as pdfjsLib from 'pdfjs-dist';

// 使用 CDN Worker（避免打包和路径问题）
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.mjs';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export function MaterialPreviewPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const navigate = useNavigate();
  const [material, setMaterial] = useState<MaterialItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // PDF state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1.2);
  const [pdfLoading, setPdfLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  // 智能拼接文件 URL（仅用于视频/音频直接播放，PDF 走接口）
  const rawUrl = material?.file_url || '';
  const fileUrl = rawUrl
    ? rawUrl.startsWith('http')
      ? rawUrl
      : `${API_BASE}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
    : '';

  const needsFile = material ? ['pdf', 'video', 'audio'].includes(material.type) : false;

  // 2. 加载 PDF（通过后端 /download 接口获取 ArrayBuffer）
  useEffect(() => {
    if (!materialId || material?.type !== 'pdf') return;
    setPdfLoading(true);
    let cancelled = false;

    const loadPdf = async () => {
      try {
        const arrayBuffer = await fetchMaterialPdf(materialId);
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
      } catch (err) {
        console.error('PDF load error:', err);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [materialId, material?.type]);

  // 3. 渲染当前页
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: zoom });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (err) {
      console.error('PDF render error:', err);
    }
  }, [pdfDoc, currentPage, zoom]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

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
          <button onClick={() => navigate('/employee/materials')} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            返回资料列表
          </button>
        </div>
      </div>
    );
  }

  const handleDownload = () => {
    if (!fileUrl) return;
    const link = document.createElement('a');
    link.href = fileUrl;
    link.setAttribute('download', material.title);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBack = () => navigate('/employee/materials');

  const goPrev = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goNext = () => setCurrentPage((p) => Math.min(totalPages, p + 1));
  const zoomIn = () => setZoom((z) => Math.min(3, z + 0.2));
  const zoomOut = () => setZoom((z) => Math.max(0.5, z - 0.2));

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-lg">
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
        {needsFile && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <Download className="w-4 h-4" />
            下载到本地
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-hidden">
        <div className="max-w-5xl mx-auto bg-white rounded-xl border overflow-hidden h-full flex flex-col">
          {/* PDF Controls */}
          {material.type === 'pdf' && totalPages > 0 && (
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
              <div className="flex items-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={currentPage <= 1}
                  className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-700">
                  第 <span className="font-medium">{currentPage}</span> / {totalPages} 页
                </span>
                <button
                  onClick={goNext}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={zoomOut} className="p-1.5 hover:bg-gray-200 rounded">
                  <ZoomOutIcon className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={zoomIn} className="p-1.5 hover:bg-gray-200 rounded">
                  <ZoomInIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {material.type === 'pdf' && (
            <div className="flex-1 overflow-auto flex items-center justify-center bg-gray-100 p-4">
              {pdfLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  <p className="text-sm text-gray-500">加载 PDF 中...</p>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="shadow-lg"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              )}
            </div>
          )}

          {material.type === 'video' && (
            <div className="flex items-center justify-center bg-black p-4 flex-1">
              {fileUrl ? (
                <video
                  controls
                  src={fileUrl}
                  className="w-full max-h-[calc(100vh-180px)] rounded-lg"
                  style={{ maxWidth: '100%' }}
                />
              ) : (
                <p className="text-sm text-gray-500">暂无文件</p>
              )}
            </div>
          )}

          {material.type === 'audio' && (
            <div className="flex flex-col items-center justify-center p-12 bg-gradient-to-b from-blue-50 to-white flex-1">
              {fileUrl ? (
                <>
                  <Headphones className="w-24 h-24 text-blue-400 mb-8" />
                  <p className="text-lg font-medium text-gray-700 mb-4">{material.title}</p>
                  <audio controls src={fileUrl} className="w-full max-w-md" />
                </>
              ) : (
                <p className="text-sm text-gray-500">暂无文件</p>
              )}
            </div>
          )}

          {(material.type === 'article' || !['pdf', 'video', 'audio'].includes(material.type)) && (
            <div className="p-8 flex-1">
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
