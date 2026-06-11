import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, X } from 'lucide-react';
import { getProductLinesTree, createProductLine, deleteProductLine, type ProductLine } from '../api/knowledge';

type CreateMode = 'series' | 'product';

interface ProductMaterialsViewProps {
  basePath?: string;
  allowCreateLine?: boolean;
}

export function ProductMaterialsView({ basePath = '/employee/learning/product', allowCreateLine = false }: ProductMaterialsViewProps) {
  const navigate = useNavigate();
  const [productTree, setProductTree] = useState<ProductLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState<ProductLine[]>([]);

  // Create line modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createParentNode, setCreateParentNode] = useState<ProductLine | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>('series');
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [selectedSeriesId, setSelectedSeriesId] = useState('');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Delete select modal
  const [showDeleteSelectModal, setShowDeleteSelectModal] = useState(false);
  const [deleteSelectNode, setDeleteSelectNode] = useState<ProductLine | null>(null);

  useEffect(() => {
    loadTree();
  }, []);

  function loadTree() {
    setLoading(true);
    getProductLinesTree()
      .then((res) => {
        if (res.code === 0 && res.data) {
          setProductTree(res.data.tree || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const currentNode = path.length > 0 ? path[path.length - 1] : null;
  const children = currentNode ? (currentNode.children || []) : productTree;

  const handleEnter = (node: ProductLine) => {
    const hasChildren = (node.children || []).length > 0;
    if (hasChildren) {
      setPath([...path, node]);
    } else {
      // Navigate to product overview page
      navigate(`${basePath}/${node.product_line_id}`);
    }
  };

  const handleBack = () => {
    setPath(path.slice(0, -1));
  };

  function openCreateModal(parentNode?: ProductLine) {
    setCreateParentNode(parentNode || null);
    setCreateMode('series');
    setCreateName('');
    setCreateDesc('');
    setCreateError('');
    setSelectedSeriesId('');
    setShowCreateModal(true);
  }

  async function handleCreateLine() {
    if (!createName.trim()) {
      setCreateError('请输入名称');
      return;
    }

    let parentId: string | undefined;
    if (createMode === 'product') {
      if (selectedSeriesId) {
        parentId = selectedSeriesId;
      } else if (createParentNode && (createParentNode.children || []).length > 0) {
        setCreateError('请选择所属系列');
        return;
      }
    } else if (createParentNode) {
      parentId = createParentNode.product_line_id;
    }

    setCreateLoading(true);
    setCreateError('');
    try {
      const res = await createProductLine(
        createName.trim(),
        createDesc.trim() || undefined,
        parentId
      );
      if (res.code === 0) {
        setShowCreateModal(false);
        setCreateName('');
        setCreateDesc('');
        setSelectedSeriesId('');
        loadTree();
      } else {
        setCreateError(res.data?.name || '创建失败');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await deleteProductLine(deleteTarget.id);
      if (res.code === 0) {
        setDeleteTarget(null);
        loadTree();
      } else {
        alert(res.message || '删除失败');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400 py-8 text-center">加载中...</p>;
  }

  // Root level: expand full tree (category → series → products)
  if (!currentNode) {
    return (
      <div className="space-y-8">
        {productTree.map((cat) => (
          <div key={cat.product_line_id}>
            {/* Category title */}
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">{cat.name}</h3>
              {allowCreateLine && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openCreateModal(cat)}
                    className="p-1 hover:bg-blue-50 rounded text-blue-600 transition-colors"
                    title={`在「${cat.name}」下添加`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setDeleteSelectNode(cat); setShowDeleteSelectModal(true); }}
                    className="p-1 hover:bg-red-50 rounded text-red-500 transition-colors"
                    title={`删除「${cat.name}」下的系列或产品`}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Series + Products */}
            <div className="space-y-4">
              {(cat.children || [])
                .filter((child) => {
                  const hasChildren = Array.isArray(child.children) && child.children.length > 0;
                  const isEmptySeries = Array.isArray(child.children) && child.children.length === 0;
                  const isLeafProduct = child.children === undefined || child.children === null;
                  return hasChildren || isEmptySeries || isLeafProduct;
                })
                .map((series) => {
                  const products = series.children || [];
                  const isLeafProduct = products.length === 0;

                  if (isLeafProduct) {
                    return (
                      <button
                        key={series.product_line_id}
                        onClick={() => handleEnter(series)}
                        className="text-sm text-gray-600 hover:text-blue-600 hover:underline transition-colors mr-4"
                      >
                        {series.name}
                      </button>
                    );
                  }

                  return (
                    <div key={series.product_line_id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-gray-700 min-w-[7rem]">{series.name}</span>
                      <span className="text-gray-300">·</span>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {products.map((product) => (
                          <button
                            key={product.product_line_id}
                            onClick={() => handleEnter(product)}
                            className="text-sm text-gray-600 hover:text-blue-600 hover:underline transition-colors"
                          >
                            {product.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}

        {productTree.length === 0 && !loading && (
          <div className="text-sm text-gray-400 py-8 text-center">
            暂无产品分类数据
          </div>
        )}

        {/* Create Line Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">
                  {createParentNode ? `在「${createParentNode.name}」下添加` : '新建产品线'}
                </h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="space-y-4">
                {/* Mode selector: only when parent is a category with children (series) */}
                {createParentNode && (createParentNode.children || []).length > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setCreateMode('series'); setSelectedSeriesId(''); }}
                      className={`flex-1 px-3 py-2 text-sm rounded-lg border font-medium transition-colors ${
                        createMode === 'series'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      新建系列
                    </button>
                    <button
                      onClick={() => setCreateMode('product')}
                      className={`flex-1 px-3 py-2 text-sm rounded-lg border font-medium transition-colors ${
                        createMode === 'product'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      添加产品
                    </button>
                  </div>
                )}

                {/* Series selector when adding product to category */}
                {createMode === 'product' && createParentNode && (createParentNode.children || []).length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">所属系列 *</label>
                    <select
                      value={selectedSeriesId}
                      onChange={(e) => setSelectedSeriesId(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">请选择系列</option>
                      {(createParentNode.children || []).map((s) => (
                        <option key={s.product_line_id} value={s.product_line_id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    名称 *
                  </label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder={
                      createMode === 'product'
                        ? '例如：勇士K6'
                        : createParentNode
                        ? '例如：立式直饮系列'
                        : '例如：商用净水'
                    }
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                  <input
                    type="text"
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                    placeholder="可选"
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {createError && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{createError}</div>}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 px-4 py-2 border rounded-lg font-medium hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateLine}
                    disabled={createLoading || !createName.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createLoading ? '创建中...' : '创建'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Select Modal */}
        {showDeleteSelectModal && deleteSelectNode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">
                  删除「{deleteSelectNode.name}」下的内容
                </h3>
                <button
                  onClick={() => setShowDeleteSelectModal(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 space-y-4">
                {(deleteSelectNode.children || []).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">暂无内容可删除</p>
                ) : (
                  (deleteSelectNode.children || []).map((series) => (
                    <div key={series.product_line_id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-800">{series.name}</span>
                        <button
                          onClick={() => setDeleteTarget({ id: series.product_line_id, name: series.name })}
                          className="text-xs text-red-600 hover:text-red-700 px-2 py-1 hover:bg-red-50 rounded transition-colors"
                        >
                          删除系列
                        </button>
                      </div>
                      {(series.children || []).length > 0 && (
                        <div className="space-y-1 pl-3 border-l-2 border-gray-100">
                          {series.children!.map((product) => (
                            <div key={product.product_line_id} className="flex items-center justify-between">
                              <span className="text-sm text-gray-600">{product.name}</span>
                              <button
                                onClick={() => setDeleteTarget({ id: product.product_line_id, name: product.name })}
                                className="text-xs text-red-600 hover:text-red-700 px-2 py-1 hover:bg-red-50 rounded transition-colors"
                              >
                                删除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteTarget && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">确认删除</h3>
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-6">
                确定要删除「{deleteTarget.name}」吗？此操作不可恢复。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 px-4 py-2 border rounded-lg font-medium hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteLoading}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteLoading ? '删除中...' : '删除'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Breadcrumb + series/products for deeper navigation (if user drills down)
  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <button onClick={() => setPath([])} className="hover:text-blue-600">全部</button>
        {path.map((node, idx) => (
          <span key={node.product_line_id} className="flex items-center gap-1">
            <span className="text-gray-300">/</span>
            {idx === path.length - 1 ? (
              <span className="text-gray-900 font-medium">{node.name}</span>
            ) : (
              <button onClick={() => setPath(path.slice(0, idx + 1))} className="hover:text-blue-600">
                {node.name}
              </button>
            )}
          </span>
        ))}
      </div>

      <button
        onClick={handleBack}
        className="text-sm text-gray-500 hover:text-blue-600"
      >
        ← 返回上一级
      </button>

      {/* Child nodes */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {children.map((child) => (
          <button
            key={child.product_line_id}
            onClick={() => handleEnter(child)}
            className="text-base text-gray-700 hover:text-blue-600 hover:underline transition-colors"
          >
            {child.name}
          </button>
        ))}
      </div>

      {children.length === 0 && !loading && (
        <div className="text-sm text-gray-400 py-8 text-center">
          该分类下暂无产品
        </div>
      )}
    </div>
  );
}
