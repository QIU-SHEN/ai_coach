import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Edit2, Trash2, X, ImageIcon, FileText, Film, Package, Image, BookOpen, Sparkles, Loader2, Eye, Upload, CheckSquare, Square, Settings2, Mic, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { register, getUserList, resetUserPassword, batchAssignManager, type UserListItem, type RegisterInput } from '../../api/auth';
import { getSettings, updateSettings } from '../../api/settings';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../hooks/useToast';
import { ProductLineSelector } from '../../components/ProductLineSelector';
import {
  getProductLines,
  getMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  getProductAssets,
  aiClassify,
  aiTag,
  saveSummaries,
  type ProductLine,
  type MaterialItem,
  type ProductAsset,
  type AiSummaryItem,
  type AiClassifyCategory,
  type AiClassifyItem,
  type AssetText,
  getAssetTexts,
  aiExtractTexts,
  uploadAsset,
  deleteAsset,
  batchDeleteAssets,
  createProductLine,
  updateProductLine,
  deleteProductLine,
} from '../../api/knowledge';

import { getDashboard, getDailyStats, getErrors, getBackupStatus, type DashboardData, type DailyStat, type ErrorEntry, type BackupInfo } from '../../api/admin';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AdminTab = 'knowledge' | 'assets' | 'users' | 'review' | 'config' | 'monitor';
type KnowledgeSubTab = 'materials';

function useProductLines() {
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const refresh = () => {
    getProductLines()
      .then((res) => {
        if (res.code === 0 && res.data) {
          setProductLines(res.data.list.filter((l) => l.status === 'active'));
        }
      })
      .catch(() => setProductLines([]));
  };
  useEffect(() => { refresh(); }, []);
  return { productLines, refresh };
}

function getProductLineName(lines: ProductLine[], id?: string) {
  return lines.find((l) => l.product_line_id === id)?.name || '-';
}

export function KnowledgeBaseTab() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [subTab] = useState<KnowledgeSubTab>('materials');
  const { productLines, refresh: refreshPL } = useProductLines();

  // Common modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode] = useState<'create' | 'edit'>('create');
  const [editingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Materials
  const [materialsList, setMaterialsList] = useState<MaterialItem[]>([]);
  const [materialsPage, setMaterialsPage] = useState(1);
  const [materialsTotal, setMaterialsTotal] = useState(0);
  const materialsLimit = 10;

  // Product line management
  const [showPLModal, setShowPLModal] = useState(false);
  const [plForm, setPlForm] = useState({ name: '', description: '' });
  const [plEditingId, setPlEditingId] = useState<string | null>(null);
  const [plSaving, setPlSaving] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(true);

  // Material delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmTitle, setDeleteConfirmTitle] = useState('');

  // Material upload modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadProductLine, setUploadProductLine] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadDuration, setUploadDuration] = useState('');

  // Form
  const [mForm, setMForm] = useState({
    title: '',
    type: 'video' as MaterialItem['type'],
    duration: '',
    file_url: '',
    description: '',
    tags: '',
    status: 'active' as 'active' | 'inactive',
  });


  const loadMaterials = useCallback((page = 1) => {
    setMaterialsLoading(true);
    getMaterials({ page, limit: materialsLimit })
      .then((res) => {
        if (res.code === 0 && res.data) {
          setMaterialsList(res.data.list);
          setMaterialsTotal(res.data.total);
          setMaterialsPage(page);
        }
      })
      .finally(() => setMaterialsLoading(false));
  }, []);

  useEffect(() => { loadMaterials(1); }, [loadMaterials]);

  const handlePLSave = async () => {
    if (!plForm.name.trim()) return;
    setPlSaving(true);
    try {
      if (plEditingId) {
        await updateProductLine(plEditingId, plForm.name.trim(), plForm.description.trim() || undefined);
      } else {
        await createProductLine(plForm.name.trim(), plForm.description.trim() || undefined);
      }
      refreshPL();
      setPlForm({ name: '', description: '' });
      setPlEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setPlSaving(false);
    }
  };

  const handlePLDelete = async (id: string) => {
    if (!await confirm({ message: '确定删除该产品线？如有关联数据需先清理。', variant: 'danger' })) return;
    try {
      await deleteProductLine(id);
      refreshPL();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const payload = {
      title: mForm.title.trim(),
      type: mForm.type,
      duration: mForm.duration.trim() || undefined,
      file_url: mForm.file_url.trim() || undefined,
      description: mForm.description.trim() || undefined,
      tags: mForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      status: mForm.status,
    };
    try {
      if (modalMode === 'create') {
        const res = await createMaterial(payload);
        if (res.code === 0 && res.data) {
          setMaterialsList((prev) => [res.data!, ...prev]);
          setShowModal(false);
        } else {
          setError(res.message || '创建失败');
        }
      } else if (editingId) {
        const res = await updateMaterial(editingId, payload);
        if (res.code === 0 && res.data) {
          setMaterialsList((prev) => prev.map((i) => (i.material_id === editingId ? res.data! : i)));
          setShowModal(false);
        } else {
          setError(res.message || '更新失败');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setShowUploadModal(true); setUploadFiles([]); setUploadTitle(''); setUploadDescription(''); setUploadDuration(''); setUploadProductLine(''); setUploadProgress({}); }}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-1"
        >
          <Upload className="w-4 h-4" /> 上传资料
        </button>
      </div>

      {subTab === 'materials' && (
        <>
          {materialsLoading && <p className="text-sm text-gray-400 py-8 text-center">加载中...</p>}
          {!materialsLoading && materialsList.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">暂无培训资料</p>}
          {!materialsLoading && materialsList.length > 0 && (
            <>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {materialsList.map((m) => (
                  <div key={m.material_id} className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        m.type === 'video' ? 'bg-red-50 text-red-700' :
                        m.type === 'pdf' ? 'bg-blue-50 text-blue-700' :
                        m.type === 'audio' ? 'bg-green-50 text-green-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {m.type === 'video' ? '视频' : m.type === 'pdf' ? 'PDF' : m.type === 'audio' ? '音频' : '图文'}
                      </span>
                      <span className="text-xs text-gray-400">{m.duration || '-'}</span>
                    </div>
                    <h3 className="font-medium text-gray-900 mb-2 line-clamp-2">{m.title}</h3>
                    {m.description && <p className="text-sm text-gray-500 line-clamp-2 mb-4">{m.description}</p>}
                    <div className="mt-auto space-y-2">
                      <button
                        onClick={() => navigate(`/manager/learning/material/${m.material_id}`)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                      >
                        <BookOpen className="w-4 h-4" /> 预览资料
                      </button>
                      <button
                        onClick={() => navigate(`material/${m.material_id}/quiz`)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50"
                      >
                        <Sparkles className="w-4 h-4" /> 题目管理
                      </button>
                      <button
                        onClick={() => { setDeleteConfirmId(m.material_id); setDeleteConfirmTitle(m.title); }}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" /> 删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {materialsTotal > materialsLimit && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-sm mt-4 rounded-xl">
                  <span className="text-gray-500">共 {materialsTotal} 条</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadMaterials(materialsPage - 1)}
                      disabled={materialsPage <= 1}
                      className="px-3 py-1 border rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >上一页</button>
                    <span className="text-gray-700">{materialsPage} / {Math.ceil(materialsTotal / materialsLimit)}</span>
                    <button
                      onClick={() => loadMaterials(materialsPage + 1)}
                      disabled={materialsPage >= Math.ceil(materialsTotal / materialsLimit)}
                      className="px-3 py-1 border rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >下一页</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Upload Material Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">上传培训资料</h3>
              <button onClick={() => !uploading && setShowUploadModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files); setUploadFiles((prev) => [...prev, ...files]); }}
                className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-blue-400 transition-colors cursor-pointer"
                onClick={() => document.getElementById('material-file-input')?.click()}
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600">拖拽文件到此处，或点击选择</p>
                <p className="text-xs text-gray-400 mt-1">支持视频、PDF、音频等格式</p>
                <input
                  id="material-file-input"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => { const files = Array.from(e.target.files || []); setUploadFiles((prev) => [...prev, ...files]); }}
                />
              </div>
              {uploadFiles.length > 0 && (
                <div className="space-y-2">
                  {uploadFiles.map((file, idx) => (
                    <div key={`${file.name}-${idx}`} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-700 flex-1 truncate">{file.name}</span>
                      <span className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                      {uploadProgress[file.name] !== undefined && (
                        <span className="text-xs text-blue-600 w-12 text-right">{uploadProgress[file.name]}%</span>
                      )}
                      <button onClick={() => setUploadFiles((prev) => prev.filter((_, i) => i !== idx))} className="p-1 hover:bg-gray-200 rounded">
                        <X className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
                <input type="text" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="资料标题" className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">关联产品线（可选）</label>
                <select value={uploadProductLine} onChange={(e) => setUploadProductLine(e.target.value)} className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">不关联</option>
                  {productLines.map((pl) => (
                    <option key={pl.product_line_id} value={pl.product_line_id}>{pl.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">时长/页数</label>
                <input type="text" value={uploadDuration} onChange={(e) => setUploadDuration(e.target.value)} placeholder="例如: 12分钟 / 3页" className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={3} placeholder="资料描述..." className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
              <button
                onClick={async () => {
                  if (!uploadTitle.trim() || uploadFiles.length === 0) { setError('请填写标题并选择文件'); return; }
                  setUploading(true);
                  setError('');
                  try {
                    const ext = uploadFiles[0].name.split('.').pop()?.toLowerCase() || '';
                    const typeMap: Record<string, MaterialItem['type']> = { mp4: 'video', mov: 'video', pdf: 'pdf', mp3: 'audio', wav: 'audio', m4a: 'audio' };
                    const fileType = typeMap[ext] || 'article';
                    const createRes = await createMaterial({
                      title: uploadTitle.trim(),
                      type: fileType,
                      duration: uploadDuration.trim() || undefined,
                      description: uploadDescription.trim() || undefined,
                      tags: [],
                      status: 'active',
                      product_line_id: uploadProductLine || undefined,
                      file: uploadFiles[0],
                    });
                    if (createRes.code === 0) {
                      setShowUploadModal(false);
                      loadMaterials(1);
                    } else {
                      setError(createRes.message || '创建资料失败');
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '上传失败');
                  } finally {
                    setUploading(false);
                  }
                }}
                disabled={uploading}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> 上传中...</> : <><Upload className="w-4 h-4" /> 确认上传</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Line Management Modal */}
      {showPLModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-900">管理产品线</h3>
              <button onClick={() => setShowPLModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {productLines.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">暂无产品线</p>
              )}
              {productLines.map((pl) => (
                <div key={pl.product_line_id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{pl.name}</p>
                    {pl.description && <p className="text-xs text-gray-400 truncate">{pl.description}</p>}
                  </div>
                  <button
                    onClick={() => { setPlEditingId(pl.product_line_id); setPlForm({ name: pl.name, description: pl.description || '' }); }}
                    className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handlePLDelete(pl.product_line_id)}
                    className="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            {/* Create / Edit form */}
            <div className="px-6 py-4 border-t shrink-0 space-y-3">
              <p className="text-sm font-medium text-gray-700">{plEditingId ? '编辑产品线' : '新建产品线'}</p>
              <input
                type="text"
                value={plForm.name}
                onChange={(e) => setPlForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="产品线名称 *"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={plForm.description}
                onChange={(e) => setPlForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="描述（可选）"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePLSave}
                  disabled={plSaving || !plForm.name.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {plSaving ? '保存中...' : plEditingId ? '保存修改' : '创建'}
                </button>
                {plEditingId && (
                  <button
                    onClick={() => { setPlEditingId(null); setPlForm({ name: '', description: '' }); }}
                    className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {modalMode === 'create' ? '新建培训资料' : '编辑培训资料'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSaveMaterial} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
                  <input type="text" value={mForm.title} onChange={(e) => setMForm({ ...mForm, title: e.target.value })} className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型 *</label>
                  <select value={mForm.type} onChange={(e) => setMForm({ ...mForm, type: e.target.value as MaterialItem['type'] })} className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="video">视频</option>
                    <option value="pdf">PDF</option>
                    <option value="audio">音频</option>
                    <option value="article">图文</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">时长/页数</label>
                  <input type="text" value={mForm.duration} onChange={(e) => setMForm({ ...mForm, duration: e.target.value })} placeholder="例如: 12分钟 / 3页" className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">文件链接</label>
                  <input type="text" value={mForm.file_url} onChange={(e) => setMForm({ ...mForm, file_url: e.target.value })} placeholder="http://..." className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                  <textarea value={mForm.description} onChange={(e) => setMForm({ ...mForm, description: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标签（逗号分隔）</label>
                  <input type="text" value={mForm.tags} onChange={(e) => setMForm({ ...mForm, tags: e.target.value })} placeholder="例如: 价格异议, 微课" className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                  <select value={mForm.status} onChange={(e) => setMForm({ ...mForm, status: e.target.value as 'active' | 'inactive' })} className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="active">启用</option>
                    <option value="inactive">停用</option>
                  </select>
                </div>
                {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border rounded-lg font-medium hover:bg-gray-50">取消</button>
                  <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">{loading ? '保存中...' : '保存'}</button>
                </div>
              </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">确认删除</h3>
            <p className="text-sm text-gray-500 mb-4">
              确定要删除资料 <span className="font-medium text-gray-900">「{deleteConfirmTitle}」</span> 吗？<br />
              此操作不可撤销，关联的测验题目也将被清理。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 border rounded-lg font-medium hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (!deleteConfirmId) return;
                  setLoading(true);
                  try {
                    const res = await deleteMaterial(deleteConfirmId);
                    if (res.code === 0) {
                      setMaterialsList((prev) => prev.filter((i) => i.material_id !== deleteConfirmId));
                    } else {
                      setError(res.message || '删除失败');
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '网络错误');
                  } finally {
                    setLoading(false);
                    setDeleteConfirmId(null);
                  }
                }}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export function UsersTab() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'employee' as 'employee' | 'manager' | 'admin',
    employee_id: '',
    manager_id: '',
  });

  // Reset password
  const [resetTarget, setResetTarget] = useState<UserListItem | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  // Tree expand state
  const [expandedManagers, setExpandedManagers] = useState<Set<string>>(new Set());

  // Batch assign state
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTargetManagerId, setAssignTargetManagerId] = useState<string>('__keep__');
  const [assignLoading, setAssignLoading] = useState(false);

  const fetchUsers = () => {
    setListLoading(true);
    getUserList()
      .then((res) => {
        if (res.code === 0 && res.data) setUsers(res.data.list);
      })
      .catch(() => setUsers([]))
      .finally(() => setListLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  // Auto-expand all managers when data loads
  useEffect(() => {
    const mids = users.filter((u) => u.role === 'manager').map((u) => u.user_id);
    if (mids.length > 0) {
      setExpandedManagers(new Set(mids));
    }
  }, [users]);

  const openModal = () => {
    setForm({ username: '', password: '', name: '', role: 'employee', employee_id: '', manager_id: '' });
    setError('');
    setSuccess('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetLoading(true);
    try {
      const res = await resetUserPassword(resetTarget.user_id, '123456');
      if (res.code === 0) {
        setSuccess(`已将 ${resetTarget.name} 的密码重置为 123456`);
      } else {
        setError(res.message || '重置失败');
      }
    } catch {
      setError('重置失败');
    } finally {
      setResetLoading(false);
      setResetTarget(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.username.trim() || !form.password.trim() || !form.name.trim()) {
      setError('用户名、密码、姓名不能为空');
      return;
    }
    if (form.password.length < 6) {
      setError('密码长度不能少于6位');
      return;
    }

    setLoading(true);
    try {
      const payload: RegisterInput = {
        username: form.username.trim(),
        password: form.password,
        name: form.name.trim(),
        role: form.role,
        employee_id: form.employee_id.trim() || undefined,
      };
      if (form.role === 'employee' && form.manager_id) {
        payload.manager_id = form.manager_id;
      }
      const res = await register(payload);
      if (res.code === 0 && res.data) {
        setSuccess(`用户 ${res.data.name} 创建成功`);
        fetchUsers();
        setTimeout(() => { setShowModal(false); }, 800);
      } else {
        setError(res.message || '创建失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const toggleManager = (managerId: string) => {
    setExpandedManagers((prev) => {
      const next = new Set(prev);
      if (next.has(managerId)) next.delete(managerId);
      else next.add(managerId);
      return next;
    });
  };

  // Tree view data
  const managers = useMemo(() => users.filter((u) => u.role === 'manager'), [users]);
  const employees = useMemo(() => users.filter((u) => u.role === 'employee'), [users]);
  const admins = useMemo(() => users.filter((u) => u.role === 'admin'), [users]);

  const employeeByManager = useMemo(() => {
    const map = new Map<string, UserListItem[]>();
    for (const e of employees) {
      const mid = e.manager_id || '';
      if (!map.has(mid)) map.set(mid, []);
      map.get(mid)!.push(e);
    }
    return map;
  }, [employees]);

  const activeManagers = useMemo(() => managers.filter((m) => m.status === 'active'), [managers]);

  const matchesSearch = useCallback((u: UserListItem) => {
    if (!keyword.trim()) return true;
    const q = keyword.trim().toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.employee_id || '').toLowerCase().includes(q)
    );
  }, [keyword]);

  const visibleManagers = useMemo(() => {
    return managers.filter((m) => {
      const managerMatches = matchesSearch(m);
      const subs = employeeByManager.get(m.user_id) || [];
      const hasVisibleSub = subs.some((e) => matchesSearch(e));
      if (roleFilter === 'employee') return hasVisibleSub;
      if (roleFilter === 'manager') return managerMatches;
      if (roleFilter === 'admin') return false;
      return managerMatches || hasVisibleSub;
    });
  }, [managers, employeeByManager, matchesSearch, roleFilter]);

  const unassigned = employeeByManager.get('') || [];
  const visibleUnassigned = useMemo(() => {
    if (roleFilter === 'manager' || roleFilter === 'admin') return [];
    return unassigned.filter((e) => matchesSearch(e));
  }, [unassigned, matchesSearch, roleFilter]);

  const visibleAdmins = useMemo(() => {
    if (roleFilter === 'employee' || roleFilter === 'manager') return [];
    return admins.filter((a) => matchesSearch(a));
  }, [admins, matchesSearch, roleFilter]);

  const hasContent = visibleManagers.length > 0 || visibleUnassigned.length > 0 || visibleAdmins.length > 0;

  // Batch assign helpers (must be after tree view data)
  const visibleEmployees = useMemo(() => {
    const list: UserListItem[] = [];
    for (const m of visibleManagers) {
      const subs = (employeeByManager.get(m.user_id) || []).filter((e) => matchesSearch(e));
      list.push(...subs);
    }
    list.push(...visibleUnassigned);
    return list;
  }, [visibleManagers, employeeByManager, matchesSearch, visibleUnassigned]);

  const selectableCount = visibleEmployees.length;
  const selectedCount = selectedEmployeeIds.size;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;

  const toggleEmployeeSelection = (userId: string) => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedEmployeeIds(new Set());
    } else {
      setSelectedEmployeeIds(new Set(visibleEmployees.map((e) => e.user_id)));
    }
  };

  const clearSelection = () => setSelectedEmployeeIds(new Set());

  const openAssignModal = () => {
    setAssignTargetManagerId('__keep__');
    setError('');
    setSuccess('');
    setShowAssignModal(true);
  };

  const closeAssignModal = () => {
    setShowAssignModal(false);
  };

  const handleBatchAssign = async () => {
    if (selectedEmployeeIds.size === 0) return;
    setAssignLoading(true);
    setError('');
    setSuccess('');
    try {
      const managerId = assignTargetManagerId === '__keep__' ? null : assignTargetManagerId || null;
      const res = await batchAssignManager(Array.from(selectedEmployeeIds), managerId);
      if (res.code === 0) {
        setSuccess(`已成功分配 ${selectedEmployeeIds.size} 位员工`);
        fetchUsers();
        clearSelection();
        setTimeout(() => { setShowAssignModal(false); }, 800);
      } else {
        setError(res.message || '分配失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '分配失败');
    } finally {
      setAssignLoading(false);
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索姓名/工号"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="pl-9 pr-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); }}
            className="border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
          >
            <option value="">全部角色</option>
            <option value="employee">销售员工</option>
            <option value="manager">销售主管</option>
            <option value="admin">系统管理员</option>
          </select>
        </div>
        <button onClick={openModal} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1 shrink-0">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">新增用户</span>
        </button>
      </div>

      {/* Batch assign action bar */}
      {selectedCount > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-blue-900 font-medium">已选 {selectedCount} 位员工</span>
            <button
              onClick={toggleSelectAll}
              className="text-xs text-blue-700 hover:text-blue-900 hover:underline"
            >
              {allSelected ? '取消全选' : '全选'}
            </button>
            <button
              onClick={clearSelection}
              className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
            >
              清空
            </button>
          </div>
          <button
            onClick={openAssignModal}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shrink-0"
          >
            批量分配主管
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        {listLoading && (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">加载中...</div>
        )}
        {!listLoading && !hasContent && (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">暂无用户</div>
        )}
        {!listLoading && hasContent && (
          <div className="divide-y">
            {/* Managers and their employees */}
            {visibleManagers.map((manager) => {
              const subs = (employeeByManager.get(manager.user_id) || []).filter((e) => matchesSearch(e));
              const isExpanded = expandedManagers.has(manager.user_id);
              return (
                <div key={manager.user_id}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 hover:bg-gray-50 border-b border-gray-100 gap-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => toggleManager(manager.user_id)}
                        className="p-0.5 hover:bg-gray-100 rounded shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{manager.name}</p>
                        <p className="text-xs text-gray-400 truncate">{manager.username}{manager.employee_id ? ` · ${manager.employee_id}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 shrink-0 ml-6 sm:ml-0">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">销售主管</span>
                      <span className={`px-2 py-1 rounded text-xs ${manager.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {manager.status === 'active' ? '在职' : '停用'}
                      </span>
                      <button
                        onClick={() => setResetTarget(manager)}
                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        重置密码
                      </button>
                    </div>
                  </div>
                  {isExpanded && subs.length > 0 && (
                    <div className="bg-gray-50/50 divide-y divide-gray-100">
                      {subs.map((employee) => {
                        const isSelected = selectedEmployeeIds.has(employee.user_id);
                        return (
                          <div key={employee.user_id} className="flex flex-col sm:flex-row sm:items-center justify-between pl-4 sm:pl-10 pr-4 py-3 hover:bg-gray-50 gap-2">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <button
                                onClick={() => toggleEmployeeSelection(employee.user_id)}
                                className="shrink-0 text-gray-400 hover:text-blue-600"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{employee.name}</p>
                                <p className="text-xs text-gray-400 truncate">{employee.username}{employee.employee_id ? ` · ${employee.employee_id}` : ''}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-4 shrink-0 ml-6 sm:ml-0">
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">销售员工</span>
                              <span className={`px-2 py-1 rounded text-xs ${employee.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                {employee.status === 'active' ? '在职' : '停用'}
                              </span>
                              <span className="text-xs text-gray-400 hidden sm:inline">{employee.created_at ? new Date(employee.created_at).toLocaleDateString() : '-'}</span>
                              <button
                                onClick={() => setResetTarget(employee)}
                                className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                              >
                                重置密码
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {isExpanded && subs.length === 0 && (
                    <div className="pl-10 pr-4 py-2 text-xs text-gray-400 bg-gray-50/50">暂无下属员工</div>
                  )}
                </div>
              );
            })}

            {/* Unassigned employees */}
            {visibleUnassigned.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-700">未分配员工</span>
                  <span className="text-xs text-gray-400">{visibleUnassigned.length} 人</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {visibleUnassigned.map((employee) => {
                    const isSelected = selectedEmployeeIds.has(employee.user_id);
                    return (
                      <div key={employee.user_id} className="flex items-center justify-between pl-10 pr-4 py-3 hover:bg-gray-50">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button
                            onClick={() => toggleEmployeeSelection(employee.user_id)}
                            className="shrink-0 text-gray-400 hover:text-blue-600"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{employee.name}</p>
                            <p className="text-xs text-gray-400 truncate">{employee.username}{employee.employee_id ? ` · ${employee.employee_id}` : ''}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">销售员工</span>
                          <span className={`px-2 py-1 rounded text-xs ${employee.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {employee.status === 'active' ? '在职' : '停用'}
                          </span>
                          <span className="text-xs text-gray-400">{employee.created_at ? new Date(employee.created_at).toLocaleDateString() : '-'}</span>
                          <button
                            onClick={() => setResetTarget(employee)}
                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            重置密码
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Admins */}
            {visibleAdmins.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-700">系统管理员</span>
                  <span className="text-xs text-gray-400">{visibleAdmins.length} 人</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {visibleAdmins.map((admin) => (
                    <div key={admin.user_id} className="flex items-center justify-between pl-10 pr-4 py-3 hover:bg-gray-50">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{admin.name}</p>
                          <p className="text-xs text-gray-400 truncate">{admin.username}{admin.employee_id ? ` · ${admin.employee_id}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">系统管理员</span>
                        <span className={`px-2 py-1 rounded text-xs ${admin.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {admin.status === 'active' ? '在职' : '停用'}
                        </span>
                        <span className="text-xs text-gray-400">{admin.created_at ? new Date(admin.created_at).toLocaleDateString() : '-'}</span>
                        <button
                          onClick={() => setResetTarget(admin)}
                          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          重置密码
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">新增用户</h3>
              <button onClick={closeModal} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户名 <span className="text-gray-400">*</span></label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="登录账号"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">密码 <span className="text-gray-400">*</span></label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="不少于6位"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名 <span className="text-gray-400">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="真实姓名"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色 <span className="text-gray-400">*</span></label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as 'employee' | 'manager' | 'admin', manager_id: '' })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="employee">销售员工</option>
                  <option value="manager">销售主管</option>
                  <option value="admin">系统管理员</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">工号</label>
                <input
                  type="text"
                  value={form.employee_id}
                  onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  placeholder="例如 SALES-2024-001"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {form.role === 'employee' && activeManagers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">所属主管</label>
                  <select
                    value={form.manager_id}
                    onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">不分配</option>
                    {activeManagers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
              {success && <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border rounded-lg font-medium hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? '创建中...' : '确认创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch assign manager modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">批量分配主管</h3>
              <button onClick={closeAssignModal} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                已选 <span className="font-medium text-gray-900">{selectedCount}</span> 位员工，请选择要分配的主管：
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">所属主管</label>
                <select
                  value={assignTargetManagerId}
                  onChange={(e) => setAssignTargetManagerId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="__keep__">-- 保持当前主管不变 --</option>
                  <option value="">取消分配（未分配）</option>
                  {activeManagers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
              {success && <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeAssignModal}
                  className="flex-1 px-4 py-2 border rounded-lg font-medium hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchAssign}
                  disabled={assignLoading || assignTargetManagerId === '__keep__'}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {assignLoading ? '分配中...' : '确认分配'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">重置密码</h3>
            <p className="text-sm text-gray-500 mb-4">
              确认将 <span className="font-medium text-gray-900">{resetTarget.name}</span> 的密码重置为 <span className="font-mono bg-gray-100 px-1 rounded">123456</span>？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setResetTarget(null)}
                className="flex-1 px-4 py-2 border rounded-lg font-medium hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleResetPassword}
                disabled={resetLoading}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {resetLoading ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewTab() {
  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center gap-2">
        <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">待复核 (2)</button>
        <button className="px-3 py-1.5 bg-white border rounded-lg text-sm text-gray-600 hover:bg-gray-50">已处理</button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {[
          { name: '张三', id: 'SALES-2024-001', reason: '异议处理评分过低，我认为已使用价格锚点话术', time: '2026-04-16 10:20' },
          { name: '王五', id: 'SALES-2024-003', reason: '产品知识得分与实际介绍内容不符', time: '2026-04-14 16:05' },
        ].map((r, idx) => (
          <div key={idx} className="bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-gray-900">{r.name} <span className="text-gray-400 font-normal text-sm">{r.id}</span></span>
              <span className="text-xs text-gray-400">{r.time}</span>
            </div>
            <p className="text-sm text-gray-600 mb-3">申诉理由：{r.reason}</p>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">查看详情</button>
              <button className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">快速通过</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConfigTab() {
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getSettings()
      .then((res) => {
        if (res.code === 0 && res.data) {
          setSettingsMap(res.data);
        }
      })
      .catch(() => setError('加载配置失败'))
      .finally(() => setLoading(false));
  }, []);

  const getValue = (key: string) => settingsMap[key] ?? '';
  const setValue = (key: string, value: string) => {
    setSettingsMap((prev) => ({ ...prev, [key]: value }));
    setSuccess('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await updateSettings(settingsMap);
      if (res.code === 0) {
        setSuccess('配置已保存');
      } else {
        setError(res.message || '保存失败');
      }
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4 fade-in">
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Mic className="w-5 h-5" /> 语音转文字引擎</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">上传录音转文字引擎</label>
            <select
              value={getValue('asr_engine') || 'whisper'}
              onChange={(e) => setValue('asr_engine', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="whisper">Whisper（纯转录，速度快）</option>
              <option value="gpt">GPT 音频理解（转录+语义理解）</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              上传录音后的语音转文字引擎。对话阶段的语音回答固定使用 GPT。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><MessageSquare className="w-5 h-5" /> 企业微信通知</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">自动推送报告摘要</label>
            <select
              value={getValue('wecom_notify_enabled') || '0'}
              onChange={(e) => setValue('wecom_notify_enabled', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="0">关闭</option>
              <option value="1">开启</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">开启后，每次练习分析完成自动推送文字报告摘要到企业微信群</p>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">机器人 Webhook 地址</label>
            <input
              type="text"
              value={getValue('wecom_webhook_url')}
              onChange={(e) => setValue('wecom_webhook_url', e.target.value)}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">在企业微信群中添加机器人后获取的 Webhook 地址</p>
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          保存配置
        </button>
      </div>

    </div>
  );
}

// --- Product Assets Tab (read-only browsing) ---

const assetTypeLabels: Record<string, string> = {
  brochure: '三折页',
  detail_page: '详情页',
  image: '高清图',
  video: '视频',
  manual: '说明书',
  packaging: '包装',
  banner: '头图',
};

const assetTypeIcons: Record<string, React.ReactNode> = {
  brochure: <FileText className="w-4 h-4 text-blue-600" />,
  detail_page: <FileText className="w-4 h-4 text-purple-600" />,
  image: <ImageIcon className="w-4 h-4 text-green-600" />,
  video: <Film className="w-4 h-4 text-red-600" />,
  manual: <BookOpen className="w-4 h-4 text-orange-600" />,
  packaging: <Package className="w-4 h-4 text-yellow-600" />,
  banner: <Image className="w-4 h-4 text-cyan-600" />,
};

const assetTypeColors: Record<string, string> = {
  brochure: 'bg-blue-50 text-blue-700',
  detail_page: 'bg-purple-50 text-purple-700',
  image: 'bg-green-50 text-green-700',
  video: 'bg-red-50 text-red-700',
  manual: 'bg-orange-50 text-orange-700',
  packaging: 'bg-yellow-50 text-yellow-700',
  banner: 'bg-cyan-50 text-cyan-700',
};

type PipelineStep = 'idle' | 'classify' | 'tag' | 'done';

export function ProductAssetsTab() {
  const { productLines, refresh: refreshPL } = useProductLines();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [selectedLine, setSelectedLine] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [previewAsset, setPreviewAsset] = useState<ProductAsset | null>(null);
  const [viewMode, setViewMode] = useState<'assets' | 'texts'>('assets');
  const [selectedForExtract, setSelectedForExtract] = useState<Set<string>>(new Set());

  // Product line management
  const [showPLModal, setShowPLModal] = useState(false);
  const [plForm, setPlForm] = useState({ name: '', description: '' });
  const [plEditingId, setPlEditingId] = useState<string | null>(null);
  const [plSaving, setPlSaving] = useState(false);

  // Extracted texts
  const [assetTexts, setAssetTexts] = useState<AssetText[]>([]);
  const [textsLoading, setTextsLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');

  // Pipeline state
  const [step, setStep] = useState<PipelineStep>('idle');
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [categories, setCategories] = useState<AiClassifyCategory[]>([]);

  // Single-item classify
  const [classifyingTextId, setClassifyingTextId] = useState<string | null>(null);
  const [isSingleClassify, setIsSingleClassify] = useState(false);

  // Upload / delete state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadLine, setUploadLine] = useState('');
  const [uploadType, setUploadType] = useState('image');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
  const getFileUrl = (a: ProductAsset) => `${API_BASE}/api/v1/knowledge/product-assets/${a.asset_id}/file`;
  const isImageType = (a: ProductAsset) => /\.(jpe?g|png|webp|gif)$/i.test(a.file_path);

  const resetPipeline = () => {
    setStep('idle');
    setCategories([]);
    setMsg('');
    setIsSingleClassify(false);
  };

  const handlePLSave = async () => {
    if (!plForm.name.trim()) return;
    setPlSaving(true);
    try {
      if (plEditingId) {
        await updateProductLine(plEditingId, plForm.name.trim(), plForm.description.trim() || undefined);
      } else {
        await createProductLine(plForm.name.trim(), plForm.description.trim() || undefined);
      }
      refreshPL();
      setPlForm({ name: '', description: '' });
      setPlEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setPlSaving(false);
    }
  };

  const handlePLDelete = async (id: string) => {
    if (!await confirm({ message: '确定删除该产品线？如有关联数据需先清理。', variant: 'danger' })) return;
    try {
      await deleteProductLine(id);
      refreshPL();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleUpload = async () => {
    if (!uploadLine || uploadFiles.length === 0) return;
    setUploading(true);
    setUploadProgress({});
    let successCount = 0;
    for (const file of uploadFiles) {
      try {
        setUploadProgress((prev) => ({ ...prev, [file.name]: 0 }));
        await uploadAsset(file, uploadLine, uploadType, undefined, (pct) => {
          setUploadProgress((prev) => ({ ...prev, [file.name]: pct }));
        });
        successCount++;
      } catch {
        setUploadProgress((prev) => ({ ...prev, [file.name]: -1 }));
      }
    }
    setUploading(false);
    if (successCount > 0) {
      fetchAssets();
      setShowUploadModal(false);
      setUploadFiles([]);
      setUploadProgress({});
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedAssets.size === 0) return;
    if (!await confirm({ message: `确定删除 ${selectedAssets.size} 个素材？`, variant: 'danger' })) return;
    setDeleting(true);
    try {
      if (selectedAssets.size === 1) {
        await deleteAsset([...selectedAssets][0]);
      } else {
        await batchDeleteAssets([...selectedAssets]);
      }
      setSelectedAssets(new Set());
      fetchAssets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteOne = async (assetId: string) => {
    if (!await confirm({ message: '确定删除该素材？', variant: 'danger' })) return;
    try {
      await deleteAsset(assetId);
      setSelectedAssets((prev) => { const n = new Set(prev); n.delete(assetId); return n; });
      fetchAssets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const fetchAssets = () => {
    setLoading(true);
    getProductAssets({
      product_line_id: selectedLine || undefined,
      asset_type: selectedType || undefined,
      limit: 200,
    })
      .then((res) => {
        if (res.code === 0 && res.data) {
          setAssets(res.data.list);
          setTotal(res.data.total);
        }
      })
      .catch(() => toast.error('刷新素材列表失败，请手动刷新页面'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAssets(); }, [selectedLine, selectedType]);

  // Fetch extracted texts
  const fetchTexts = async () => {
    if (!selectedLine) return;
    setTextsLoading(true);
    setAssetTexts([]);
    try {
      const res = await getAssetTexts(selectedLine);
      if (res.code === 0 && res.data) {
        setAssetTexts(res.data.texts);
      }
    } catch {
      setAssetTexts([]);
    } finally {
      setTextsLoading(false);
    }
  };

  const handleViewTexts = () => {
    setViewMode('texts');
    if (assetTexts.length === 0) fetchTexts();
  };

  const handleExtract = async () => {
    if (!selectedLine) return;
    setExtracting(true);
    setExtractMsg('');
    try {
      const assetIds = selectedForExtract.size > 0 ? [...selectedForExtract] : undefined;
      const res = await aiExtractTexts(selectedLine, assetIds);
      if (res.code === 0 && res.data) {
        setExtractMsg(`已提取 ${res.data.extracted_count} 个文件的文字`);
        setSelectedForExtract(new Set());
        fetchTexts();
      } else {
        setExtractMsg('提取失败，请重试');
      }
    } catch (err) {
      setExtractMsg(err instanceof Error ? err.message : '提取失败');
    } finally {
      setExtracting(false);
    }
  };

  // Step 2: AI Classify
  const handleClassify = async () => {
    if (!selectedLine) return;
    setProcessing(true);
    setMsg('');
    setCategories([]);
    setIsSingleClassify(false);
    setStep('classify');
    try {
      const assetIds = selectedForExtract.size > 0 ? [...selectedForExtract] : undefined;
      const res = await aiClassify(selectedLine, assetIds);
      if (res.code === 0 && res.data) {
        setCategories(res.data.categories);
        const totalItems = res.data.categories.reduce((sum, c) => sum + c.items.length, 0);
        setMsg(`从 ${res.data.source_file_count} 个素材中提取并分为 ${res.data.categories.length} 类，共 ${totalItems} 条`);
      } else {
        setMsg('分类失败，请重试');
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '分类失败');
    } finally {
      setProcessing(false);
    }
  };

  // Step 3: AI Tag
  const handleTag = async () => {
    if (!selectedLine || categories.length === 0) return;
    setProcessing(true);
    setMsg('');
    try {
      const res = await aiTag(selectedLine, categories);
      if (res.code === 0 && res.data) {
        setCategories(res.data.categories);
        setStep('tag');
        setMsg('标签生成完成，请检查后保存');
      } else {
        setMsg('打标签失败，请重试');
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '打标签失败');
    } finally {
      setProcessing(false);
    }
  };

  // Save to knowledge base
  const handleSave = async () => {
    if (!selectedLine) return;
    setSaving(true);
    setMsg('');
    const summaries: AiSummaryItem[] = categories.flatMap((c) =>
      c.items.map((item) => ({
        category: c.category,
        title: item.title,
        content: item.content,
        tags: item.tags || [],
      }))
    );
    try {
      const res = await saveSummaries(selectedLine, summaries, isSingleClassify ? 'append' : undefined);
      if (res.code === 0) {
        setMsg('已保存到知识库');
        setStep('done');
      } else {
        setMsg(res.message || '保存失败');
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSingleClassify = async (text: AssetText) => {
    if (!selectedLine) return;
    const asset = assets.find((a) => a.file_path === text.file_path);
    if (!asset) { setMsg('找不到对应的素材文件'); return; }

    setClassifyingTextId(text.id);
    setMsg('');
    try {
      const res = await aiClassify(selectedLine, [asset.asset_id]);
      if (res.code === 0 && res.data) {
        const newCategories = res.data.categories;
        setCategories((prev) => {
          const merged = prev.map((c) => ({ ...c, items: [...c.items] }));
          for (const nc of newCategories) {
            const existing = merged.find((c) => c.category === nc.category);
            if (existing) {
              existing.items = [...existing.items, ...nc.items];
            } else {
              merged.push(nc);
            }
          }
          return merged;
        });
        setStep('classify');
        setIsSingleClassify(true);
        const added = newCategories.reduce((sum, c) => sum + c.items.length, 0);
        setMsg(`已分类「${text.file_path.split('/').pop()}」，新增 ${added} 条内容`);
      } else {
        setMsg('分类失败，请重试');
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '分类失败');
    } finally {
      setClassifyingTextId(null);
    }
  };

  // Edit helpers
  const updateCategoryName = (catIdx: number, name: string) => {
    setCategories((prev) => prev.map((c, i) => i === catIdx ? { ...c, category: name } : c));
  };

  const updateItem = (catIdx: number, itemIdx: number, field: keyof AiClassifyItem, value: string) => {
    setCategories((prev) => prev.map((c, i) => {
      if (i !== catIdx) return c;
      return { ...c, items: c.items.map((it, j) => j === itemIdx ? { ...it, [field]: value } : it) };
    }));
  };

  const updateItemTags = (catIdx: number, itemIdx: number, tags: string[]) => {
    setCategories((prev) => prev.map((c, i) => {
      if (i !== catIdx) return c;
      return { ...c, items: c.items.map((it, j) => j === itemIdx ? { ...it, tags } : it) };
    }));
  };

  const removeItem = (catIdx: number, itemIdx: number) => {
    setCategories((prev) => prev.map((c, i) => {
      if (i !== catIdx) return c;
      return { ...c, items: c.items.filter((_, j) => j !== itemIdx) };
    }).filter((c) => c.items.length > 0));
  };

  const allCategories = ['核心卖点', '规格参数', '竞品对比', '适用场景', '常见问题', '产品功能', '技术原理', '目标客户', '品牌与企业资质'];

  const grouped = assets.reduce<Record<string, ProductAsset[]>>((acc, a) => {
    const key = a.product_line_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  const totalItems = categories.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="space-y-4 fade-in">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedLine}
          onChange={(e) => { setSelectedLine(e.target.value); resetPipeline(); }}
          className="border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全部产品</option>
          {productLines.map((pl) => (
            <option key={pl.product_line_id} value={pl.product_line_id}>{pl.name}</option>
          ))}
        </select>
        <button
          onClick={() => { setPlForm({ name: '', description: '' }); setPlEditingId(null); setShowPLModal(true); }}
          className="px-2 py-2 border rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          title="管理产品线"
        >
          <Settings2 className="w-4 h-4" />
        </button>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全部类型</option>
          {Object.entries(assetTypeLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400">共 {total} 个素材</span>

        <div className="ml-auto flex items-center gap-2">
          {selectedAssets.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              删除选中 ({selectedAssets.size})
            </button>
          )}
          <button
            onClick={() => {
              setUploadFiles([]);
              setUploadLine(selectedLine || (productLines[0]?.product_line_id ?? ''));
              setUploadType('image');
              setUploadProgress({});
              setShowUploadModal(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1"
          >
            <Upload className="w-4 h-4" />
            上传素材
          </button>
        </div>

        {selectedLine && (
          <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('assets')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${viewMode === 'assets' ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              素材浏览
            </button>
            <button
              onClick={handleViewTexts}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${viewMode === 'texts' ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Eye className="w-3.5 h-3.5" />
              提取文字
            </button>
          </div>
        )}
      </div>

      {/* Pipeline Controls */}
      {selectedLine && (
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Step indicator */}
            <div className="flex items-center gap-1 text-sm">
              {(['classify', 'tag', 'done'] as PipelineStep[]).map((s, i) => (
                <span key={s} className="flex items-center gap-1">
                  <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium ${
                    step === s ? 'bg-blue-600 text-white' :
                    ['classify', 'tag', 'done'].indexOf(step) > i ? 'bg-green-500 text-white' :
                    'bg-gray-200 text-gray-500'
                  }`}>{i + 1}</span>
                  <span className={step === s ? 'text-blue-600 font-medium' : 'text-gray-400'}>
                    {i === 0 ? 'AI 分类去重' : i === 1 ? 'AI 打标签' : '保存'}
                  </span>
                  {i < 2 && <span className="text-gray-300 mx-1">→</span>}
                </span>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {step === 'idle' && (
                <button
                  onClick={handleClassify}
                  disabled={processing}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {processing ? 'AI 分类中...' : '开始 AI 分类'}
                </button>
              )}
              {step === 'classify' && !processing && categories.length > 0 && (
                <button
                  onClick={handleTag}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-purple-700 hover:to-blue-700 flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4" />
                  生成标签
                </button>
              )}
              {step === 'tag' && !processing && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '保存中...' : '确认保存到知识库'}
                </button>
              )}
              {step === 'done' && (
                <button
                  onClick={resetPipeline}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                >
                  重新处理
                </button>
              )}
              {step !== 'idle' && step !== 'done' && (
                <button
                  onClick={resetPipeline}
                  className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600"
                >
                  重置
                </button>
              )}
            </div>
          </div>

          {msg && (
            <p className={`text-sm mt-2 ${msg.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>
          )}
        </div>
      )}

      {/* Pipeline Results */}
      {(step === 'classify' || step === 'tag' || step === 'done') && categories.length > 0 && (
        <div className="bg-white rounded-xl border p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900">
              {step === 'classify' ? '分类结果（确认后可生成标签）' :
               step === 'tag' ? '标签结果（确认后保存到知识库）' :
               '已保存到知识库'}
              <span className="text-sm font-normal text-gray-400 ml-2">{categories.length} 个分类，{totalItems} 条内容</span>
            </h3>
          </div>

          {processing && (
            <p className="text-sm text-gray-400 py-4 text-center">
              {step === 'classify' ? '正在分析素材并分类去重，请稍候（可能需要 1-2 分钟）...' : '正在生成标签...'}
            </p>
          )}

          {categories.map((cat, catIdx) => (
            <div key={catIdx} className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 flex items-center gap-2">
                {step === 'classify' || step === 'tag' ? (
                  <select
                    value={cat.category}
                    onChange={(e) => updateCategoryName(catIdx, e.target.value)}
                    className="border rounded px-2 py-1 text-sm font-medium bg-white"
                  >
                    {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    {!allCategories.includes(cat.category) && <option value={cat.category}>{cat.category}</option>}
                  </select>
                ) : (
                  <span className="font-medium text-sm">{cat.category}</span>
                )}
                <span className="text-xs text-gray-400">{cat.items.length} 条</span>
              </div>
              <div className="divide-y">
                {cat.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      {step !== 'done' ? (
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateItem(catIdx, itemIdx, 'title', e.target.value)}
                          className="flex-1 border rounded px-2 py-1 text-sm font-medium"
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-900">{item.title}</span>
                      )}
                      {step !== 'done' && (
                        <button onClick={() => removeItem(catIdx, itemIdx)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {step !== 'done' ? (
                      <textarea
                        value={item.content}
                        onChange={(e) => updateItem(catIdx, itemIdx, 'content', e.target.value)}
                        rows={2}
                        className="w-full border rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.content}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>来源：{item.source_file}</span>
                      {item.tags && item.tags.length > 0 && (
                        <span className="flex gap-1">
                          {item.tags.map((t, ti) => (
                            <span key={ti} className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{t}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    {step === 'tag' && (
                      <input
                        type="text"
                        value={item.tags ? item.tags.join('、') : ''}
                        onChange={(e) => updateItemTags(catIdx, itemIdx, e.target.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean))}
                        placeholder="标签（逗号分隔）"
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Extracted Texts View */}
      {viewMode === 'texts' && selectedLine && (
        textsLoading ? (
          <p className="text-sm text-gray-400 py-8 text-center">加载提取文字...</p>
        ) : (
        <div className="space-y-4">
          {/* File selector for extraction */}
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-gray-900">选择要提取的文件</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedForExtract.size === assets.length) {
                      setSelectedForExtract(new Set());
                    } else {
                      setSelectedForExtract(new Set(assets.map((a) => a.asset_id)));
                    }
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {selectedForExtract.size === assets.length ? '取消全选' : '全选'}
                </button>
                <span className="text-xs text-gray-400">
                  已选 {selectedForExtract.size > 0 ? selectedForExtract.size : '全部'} / {assets.length} 个文件
                </span>
              </div>
            </div>
            {assets.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">该产品线暂无素材文件，请先上传</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-40 overflow-y-auto">
                {assets.map((a) => {
                  const selected = selectedForExtract.has(a.asset_id);
                  return (
                    <button
                      key={a.asset_id}
                      onClick={() => {
                        setSelectedForExtract((prev) => {
                          const next = new Set(prev);
                          if (next.has(a.asset_id)) next.delete(a.asset_id);
                          else next.add(a.asset_id);
                          return next;
                        });
                      }}
                      className={`relative p-2 rounded-lg border text-left text-xs transition-colors ${
                        selected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {selected && (
                        <span className="absolute top-1 right-1 w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center">
                          <CheckSquare className="w-3 h-3 text-white" />
                        </span>
                      )}
                      <div className="w-full h-10 bg-gray-100 rounded flex items-center justify-center mb-1.5">
                        {isImageType(a) ? (
                          <ImageIcon className="w-4 h-4 text-gray-400" />
                        ) : a.asset_type === 'video' ? (
                          <Film className="w-4 h-4 text-gray-400" />
                        ) : (
                          <FileText className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <p className="truncate text-gray-700 font-medium">{a.title || a.file_path?.split('/').pop()}</p>
                      <span className="text-gray-400">{assetTypeLabels[a.asset_type] || a.asset_type}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleExtract}
                disabled={extracting || assets.length === 0}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {extracting ? 'AI 提取中...' : selectedForExtract.size > 0 ? `提取选中 ${selectedForExtract.size} 个文件` : '提取全部文件'}
              </button>
              {extractMsg && (
                <span className={`text-xs ${extractMsg.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>{extractMsg}</span>
              )}
            </div>
          </div>

          {/* Existing extracted texts */}
          {assetTexts.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">共 {assetTexts.length} 个文件的提取结果</span>
                <button onClick={fetchTexts} className="text-xs text-blue-600 hover:underline">刷新</button>
              </div>
            {assetTexts.map((t) => (
              <div key={t.id} className="bg-white rounded-xl border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    t.file_type === 'image' ? 'bg-green-50 text-green-700' :
                    t.file_type === 'pdf' ? 'bg-purple-50 text-purple-700' :
                    'bg-red-50 text-red-700'
                  }`}>
                    {t.file_type === 'image' ? '图片' : t.file_type === 'pdf' ? 'PDF' : '视频'}
                  </span>
                  <span className="text-sm font-medium text-gray-700">{t.file_path}</span>
                  <span className="text-xs text-gray-400">{t.raw_text.length} 字</span>
                </div>
                <pre className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-60 overflow-y-auto font-sans leading-relaxed">
                  {t.raw_text || '(无文字内容)'}
                </pre>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => handleSingleClassify(t)}
                    disabled={classifyingTextId === t.id}
                    className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-xs font-medium hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    {classifyingTextId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {classifyingTextId === t.id ? '分类中...' : 'AI 分类'}
                  </button>
                  {msg && classifyingTextId === t.id && (
                    <span className={`text-xs ${msg.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>{msg}</span>
                  )}
                </div>
              </div>
            ))}
            </>
          )}
        </div>
        )
      )}

      {/* Asset Grid */}
      {viewMode === 'assets' && (loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">加载中...</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">暂无产品素材</p>
      ) : (
        Object.entries(grouped).map(([lineId, items]) => (
          <div key={lineId} className="bg-white rounded-xl border p-4">
            <h3 className="font-bold text-gray-900 mb-3">
              {getProductLineName(productLines, lineId)}
              <span className="text-sm font-normal text-gray-400 ml-2">{items.length} 个素材</span>
            </h3>
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((a) => (
                <div
                  key={a.asset_id}
                  className={`border rounded-lg p-3 transition-colors relative group ${selectedAssets.has(a.asset_id) ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'}`}
                >
                  {/* Checkbox */}
                  <div className="absolute top-2 left-2 z-10">
                    <button
                      onClick={() => setSelectedAssets((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.asset_id)) next.delete(a.asset_id); else next.add(a.asset_id);
                        return next;
                      })}
                      className="w-5 h-5 flex items-center justify-center rounded bg-white/80 hover:bg-white shadow-sm"
                    >
                      {selectedAssets.has(a.asset_id) ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-gray-400" />}
                    </button>
                  </div>
                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteOne(a.asset_id)}
                    className="absolute top-2 right-2 z-10 w-6 h-6 rounded bg-white/80 hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-600" />
                  </button>
                  {/* Card content */}
                  <div className="cursor-pointer" onClick={() => isImageType(a) && setPreviewAsset(a)}>
                    {isImageType(a) && (
                      <div className="mb-2 rounded-lg overflow-hidden bg-gray-100 aspect-video flex items-center justify-center">
                        <img src={getFileUrl(a)} alt={a.title} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      {assetTypeIcons[a.asset_type] || <FileText className="w-4 h-4 text-gray-500" />}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${assetTypeColors[a.asset_type] || 'bg-gray-100 text-gray-600'}`}>
                        {assetTypeLabels[a.asset_type] || a.asset_type}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 truncate">{a.title}</p>
                    <p className="text-xs text-gray-400 mt-1 truncate">{a.file_path}</p>
                    {!isImageType(a) && (
                      <a
                        href={getFileUrl(a)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                        onClick={(e) => e.stopPropagation()}
                      >
                        查看文件 →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      ))}

      {/* Product Line Management Modal */}
      {showPLModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-900">管理产品线</h3>
              <button onClick={() => setShowPLModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {productLines.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">暂无产品线</p>
              )}
              {productLines.map((pl) => (
                <div key={pl.product_line_id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{pl.name}</p>
                    {pl.description && <p className="text-xs text-gray-400 truncate">{pl.description}</p>}
                  </div>
                  <button
                    onClick={() => { setPlEditingId(pl.product_line_id); setPlForm({ name: pl.name, description: pl.description || '' }); }}
                    className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handlePLDelete(pl.product_line_id)}
                    className="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t shrink-0 space-y-3">
              <p className="text-sm font-medium text-gray-700">{plEditingId ? '编辑产品线' : '新建产品线'}</p>
              <input
                type="text"
                value={plForm.name}
                onChange={(e) => setPlForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="产品线名称 *"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={plForm.description}
                onChange={(e) => setPlForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="描述（可选）"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePLSave}
                  disabled={plSaving || !plForm.name.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {plSaving ? '保存中...' : plEditingId ? '保存修改' : '创建'}
                </button>
                {plEditingId && (
                  <button
                    onClick={() => { setPlEditingId(null); setPlForm({ name: '', description: '' }); }}
                    className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-900">上传素材</h3>
              <button onClick={() => setShowUploadModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">产品线 *</label>
                <ProductLineSelector
                  value={uploadLine}
                  onChange={(id) => setUploadLine(id)}
                  placeholder="请选择产品"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">素材类型 *</label>
                <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                  {Object.entries(assetTypeLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择文件</label>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center hover:border-blue-400 transition-colors cursor-pointer"
                  onClick={() => document.getElementById('asset-file-input')?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files);
                    setUploadFiles((prev) => [...prev, ...files]);
                  }}
                >
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">点击或拖拽文件到此处</p>
                  <p className="text-xs text-gray-400 mt-1">支持图片、PDF、视频文件，可多选</p>
                  <input
                    id="asset-file-input"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setUploadFiles((prev) => [...prev, ...files]);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {uploadFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">已选 {uploadFiles.length} 个文件</p>
                  {uploadFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                      <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="flex-1 truncate text-gray-700">{f.name}</span>
                      <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                      {uploadProgress[f.name] !== undefined && (
                        uploadProgress[f.name] === -1 ? (
                          <span className="text-xs text-red-500">失败</span>
                        ) : uploadProgress[f.name] === 100 ? (
                          <span className="text-xs text-green-600">✓</span>
                        ) : (
                          <span className="text-xs text-blue-600">{uploadProgress[f.name]}%</span>
                        )
                      )}
                      {!uploading && (
                        <button onClick={() => setUploadFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-end gap-3 shrink-0">
              <button onClick={() => setShowUploadModal(false)} className="px-4 py-2 border rounded-lg font-medium hover:bg-gray-50">取消</button>
              <button
                onClick={handleUpload}
                disabled={uploading || !uploadLine || uploadFiles.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? `上传中 (${Object.values(uploadProgress).filter((v) => v === 100).length}/${uploadFiles.length})` : `上传 ${uploadFiles.length} 个文件`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image preview overlay */}
      {previewAsset && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setPreviewAsset(null)}
        >
          <div className="relative max-w-4xl w-full my-8" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewAsset(null)}
              className="absolute -top-2 -right-2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-900 z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={getFileUrl(previewAsset)}
              alt={previewAsset.title}
              className="w-full rounded-lg"
            />
            <p className="text-white text-sm mt-2 text-center">{previewAsset.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface AdminDashboardProps {
  tab: AdminTab;
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.slate}`}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <p className="text-xs mt-1 opacity-70">{label}</p>
      {sub && <p className="text-xs mt-0.5 opacity-50">{sub}</p>}
    </div>
  );
}

function MonitorTab() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      getDashboard(),
      getDailyStats(days),
      getErrors(),
      getBackupStatus(),
    ])
      .then(([d, s, e, b]) => {
        if (d.code === 0 && d.data) setDashboard(d.data);
        if (s.code === 0 && s.data) setDailyStats(s.data.days);
        if (e.code === 0 && e.data) setErrors(e.data.errors);
        if (b.code === 0 && b.data) setBackup(b.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const maxUsers = Math.max(1, ...dailyStats.map((d) => d.new_users));
  const maxDebriefs = Math.max(1, ...dailyStats.map((d) => d.new_debriefs));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-400">加载中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Stat Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="用户总数" value={dashboard?.users.total ?? 0} sub={`活跃 ${dashboard?.users.active ?? 0}`} color="blue" />
        <StatCard label="复盘记录" value={dashboard?.debriefs.total ?? 0} sub={`完成 ${dashboard?.debriefs.completed ?? 0}`} color="green" />
        <StatCard label="AI 调用" value={dashboard?.ai_calls.total ?? 0} color="purple" />
        <StatCard label="测验尝试" value={dashboard?.quizzes.attempts ?? 0} sub={dashboard?.quizzes.avg_correct_rate ? `正确率 ${dashboard.quizzes.avg_correct_rate}%` : undefined} color="amber" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="产品线" value={dashboard?.knowledge.product_lines ?? 0} color="slate" />
        <StatCard label="知识条目" value={dashboard?.knowledge.items ?? 0} color="slate" />
        <StatCard label="话术" value={dashboard?.knowledge.scripts ?? 0} color="slate" />
        <StatCard label="素材" value={dashboard?.knowledge.assets ?? 0} color="slate" />
      </div>

      {/* ─── Daily Trend Chart ─── */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">每日趋势</h3>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${days === d ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {d} 天
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs text-gray-400 mb-3">新增用户</p>
            <div className="flex items-end gap-1 h-32">
              {dailyStats.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className="w-full bg-blue-200 rounded-t group-hover:bg-blue-400 transition-colors min-h-[2px]"
                    style={{ height: `${(d.new_users / maxUsers) * 100}%` }}
                  />
                  <span className="text-[10px] text-gray-400 mt-1 whitespace-nowrap">
                    {d.date.slice(5)}
                  </span>
                  <span className="absolute -top-5 text-[10px] font-medium text-blue-700 opacity-0 group-hover:opacity-100 transition-opacity">
                    {d.new_users}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-3">新增复盘</p>
            <div className="flex items-end gap-1 h-32">
              {dailyStats.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className="w-full bg-green-200 rounded-t group-hover:bg-green-400 transition-colors min-h-[2px]"
                    style={{ height: `${(d.new_debriefs / maxDebriefs) * 100}%` }}
                  />
                  <span className="text-[10px] text-gray-400 mt-1 whitespace-nowrap">
                    {d.date.slice(5)}
                  </span>
                  <span className="absolute -top-5 text-[10px] font-medium text-green-700 opacity-0 group-hover:opacity-100 transition-opacity">
                    {d.new_debriefs}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Recent Errors ─── */}
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-bold text-gray-900 mb-4">最近错误</h3>
        {errors.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">暂无错误记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="pb-2 font-normal">时间</th>
                  <th className="pb-2 font-normal">方法</th>
                  <th className="pb-2 font-normal">路径</th>
                  <th className="pb-2 font-normal">错误信息</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 text-gray-500 whitespace-nowrap">{e.time.slice(11, 19)}</td>
                    <td className="py-2 text-gray-400">{e.method}</td>
                    <td className="py-2 text-gray-400">{e.path}</td>
                    <td className="py-2 text-gray-600 max-w-xs truncate" title={e.message}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Backup Status ─── */}
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-bold text-gray-900 mb-4">数据库备份</h3>
        {backup?.latest ? (
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-400">最近备份：</span>
              <span className="text-gray-700 ml-1">{backup.latest.filename}</span>
            </div>
            <div>
              <span className="text-gray-400">大小：</span>
              <span className="text-gray-700 ml-1">{formatBytes(backup.latest.size_bytes)}</span>
            </div>
            <div>
              <span className="text-gray-400">时间：</span>
              <span className="text-gray-700 ml-1">{new Date(backup.latest.created_at).toLocaleString('zh-CN')}</span>
            </div>
            <div>
              <span className="text-gray-400">历史备份：</span>
              <span className="text-gray-700 ml-1">{backup.total_count} 份，共 {formatBytes(backup.total_size_bytes)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-4 text-center">暂无备份记录</p>
        )}
      </div>
    </div>
  );
}

export function AdminDashboard({ tab }: AdminDashboardProps) {
  return (
    <div className="fade-in">
      {tab === 'knowledge' && <KnowledgeBaseTab />}
      {tab === 'assets' && <ProductAssetsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'review' && <ReviewTab />}
      {tab === 'config' && <ConfigTab />}
      {tab === 'monitor' && <MonitorTab />}
    </div>
  );
}
