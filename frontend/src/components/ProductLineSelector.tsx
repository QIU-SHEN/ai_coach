import { useState, useEffect } from 'react';
import { getProductLinesTree, type ProductLine } from '../api/knowledge';

interface ProductLineSelectorProps {
  value?: string;
  onChange: (productLineId: string, productLineName: string) => void;
  placeholder?: string;
  className?: string;
}

export function ProductLineSelector({ value, onChange, placeholder = '选择产品', className = '' }: ProductLineSelectorProps) {
  const [tree, setTree] = useState<ProductLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    getProductLinesTree()
      .then((res) => {
        if (res.code === 0 && res.data) {
          const treeData = res.data.tree || [];
          setTree(treeData);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  // When external value changes, find which category it belongs to
  useEffect(() => {
    if (!value || tree.length === 0) return;
    for (const cat of tree) {
      // Check if value is in any grandchild (level 3)
      const found = cat.children?.some((series) =>
        series.children?.some((product) => product.product_line_id === value)
      );
      if (found) {
        setCategoryId(cat.product_line_id);
        return;
      }
    }
  }, [value, tree]);

  // Level 1 items are the categories (e.g., 净水系列, 台式系列)
  const categories = tree;

  // All level-3 products under the selected category (flattened across all series)
  const products = categoryId
    ? tree
        .find((c) => c.product_line_id === categoryId)
        ?.children?.flatMap((series) => series.children || []) || []
    : [];

  const handleCategoryChange = (newCategoryId: string) => {
    setCategoryId(newCategoryId);
    onChange('', '');
  };

  if (error) {
    return (
      <div className={`text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 ${className}`}>
        产品线加载失败：{error}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <select
        value={categoryId}
        onChange={(e) => handleCategoryChange(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        disabled={loading}
      >
        <option value="">{loading ? '加载中...' : '选择系列'}</option>
        {categories.map((cat) => (
          <option key={cat.product_line_id} value={cat.product_line_id}>
            {cat.name}
          </option>
        ))}
      </select>
      <select
        value={value || ''}
        onChange={(e) => {
          const id = e.target.value;
          const name = products.find((p) => p.product_line_id === id)?.name || '';
          onChange(id, name);
        }}
        className="border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        disabled={!categoryId || loading}
      >
        <option value="">{placeholder}</option>
        {products.map((pl) => (
          <option key={pl.product_line_id} value={pl.product_line_id}>
            {pl.name}
          </option>
        ))}
      </select>
    </div>
  );
}
