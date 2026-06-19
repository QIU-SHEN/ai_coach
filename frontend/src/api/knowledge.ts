import { authHeaders } from './auth';
import { API_BASE } from './config';

export interface ProductLine {
  product_line_id: string;
  name: string;
  description?: string;
  status: string;
  parent_id?: string | null;
  level?: number;
  sort_order?: number;
  cover_image_asset_id?: string | null;
  children?: ProductLine[];
}

export interface ProductLinesResult {
  code: number;
  data: {
    list: ProductLine[];
  };
}

export interface KnowledgeItem {
  knowledge_id: string;
  product_line_id: string;
  title: string;
  content: string;
  category: string;
  tags?: string[];
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface ScriptItem {
  script_id: string;
  product_line_id: string;
  title: string;
  scene: string;
  content: string;
  tags?: string[];
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface MaterialItem {
  material_id: string;
  title: string;
  type: 'video' | 'pdf' | 'audio' | 'article';
  duration?: string;
  file_url?: string;
  description?: string;
  tags?: string[];
  status: string;
  product_line_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PaginatedResult<T> {
  code: number;
  data: {
    list: T[];
    total: number;
    page: number;
    limit: number;
  };
}

// --- Structured Training Units ---

export interface SellingPoint {
  point_id: string;
  product_line_id?: string;
  title: string;
  description: string;
  keywords?: string[];
  priority: number;
  category: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProductSpec {
  spec_id: string;
  product_line_id?: string;
  spec_name: string;
  spec_value: string;
  unit?: string;
  common_mistake?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SalesScenario {
  scenario_id: string;
  product_line_id?: string;
  title: string;
  scene_type: string;
  content: string;
  key_takeaway?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TrainingUnitsSummary {
  selling_points: { count: number; examples: string[] };
  scripts: { count: number; examples: string[] };
  specs: { count: number; examples: string[] };
  scenarios: { count: number; examples: string[] };
}

export interface TrainingUnitsSummaryResult {
  code: number;
  data: TrainingUnitsSummary;
}

export interface TrainingPlanResult {
  code: number;
  data: {
    weekly: Array<{
      day: string;
      title: string;
      type: string;
      duration?: string;
    }>;
    monthly: Array<{
      week: number;
      title: string;
      target: string;
    }>;
    recommendations: Array<{
      topic: string;
      reason: string;
    }>;
    recommended_materials: Array<{
      material_id: string;
      title: string;
      type: string;
      duration: string;
      description: string;
    }>;
  };
}

export async function getProductLines(): Promise<ProductLinesResult> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ProductLinesResult;
}

export async function getProductLinesTree(): Promise<{ code: number; data: { tree: ProductLine[] } }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/tree`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: { tree: ProductLine[] } };
}

export async function createProductLine(name: string, description?: string, parent_id?: string | null, level?: number, sort_order?: number): Promise<{ code: number; data: ProductLine }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, description, parent_id, level, sort_order }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: ProductLine };
}

export async function updateProductLine(id: string, name: string, description?: string, status?: string, parent_id?: string | null, level?: number, sort_order?: number): Promise<{ code: number; data: ProductLine }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, description, status, parent_id, level, sort_order }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: ProductLine };
}

export async function deleteProductLine(id: string): Promise<{ code: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message: string };
}

export async function getKnowledgeById(id: string): Promise<{ code: number; data?: KnowledgeItem }> {
  const res = await fetch(`${API_BASE}/api/v1/knowledge/${id}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: KnowledgeItem };
}

export async function getKnowledge(params?: { product_line_id?: string; category?: string; page?: number; limit?: number }): Promise<PaginatedResult<KnowledgeItem>> {
  const qs = new URLSearchParams();
  if (params?.product_line_id) qs.set('product_line_id', params.product_line_id);
  if (params?.category) qs.set('category', params.category);
  qs.set('page', String(params?.page ?? 1));
  qs.set('limit', String(params?.limit ?? 20));
  const res = await fetch(`${API_BASE}/api/v1/knowledge?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PaginatedResult<KnowledgeItem>;
}

export async function createKnowledge(input: Omit<KnowledgeItem, 'knowledge_id' | 'created_at' | 'updated_at'>): Promise<{ code: number; message?: string; data?: KnowledgeItem }> {
  const res = await fetch(`${API_BASE}/api/v1/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string; data?: KnowledgeItem };
}

export async function updateKnowledge(id: string, input: Partial<Omit<KnowledgeItem, 'knowledge_id' | 'created_at' | 'updated_at'>>): Promise<{ code: number; message?: string; data?: KnowledgeItem }> {
  const res = await fetch(`${API_BASE}/api/v1/knowledge/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string; data?: KnowledgeItem };
}

export async function deleteKnowledge(id: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/knowledge/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string };
}

export async function getScriptById(id: string): Promise<{ code: number; data?: ScriptItem }> {
  const res = await fetch(`${API_BASE}/api/v1/scripts/${id}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: ScriptItem };
}

export async function getScripts(params?: { product_line_id?: string; scene?: string; page?: number; limit?: number }): Promise<PaginatedResult<ScriptItem>> {
  const qs = new URLSearchParams();
  if (params?.product_line_id) qs.set('product_line_id', params.product_line_id);
  if (params?.scene) qs.set('scene', params.scene);
  qs.set('page', String(params?.page ?? 1));
  qs.set('limit', String(params?.limit ?? 20));
  const res = await fetch(`${API_BASE}/api/v1/scripts?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PaginatedResult<ScriptItem>;
}

export async function createScript(input: Omit<ScriptItem, 'script_id' | 'created_at' | 'updated_at'>): Promise<{ code: number; message?: string; data?: ScriptItem }> {
  const res = await fetch(`${API_BASE}/api/v1/scripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string; data?: ScriptItem };
}

export async function updateScript(id: string, input: Partial<Omit<ScriptItem, 'script_id' | 'created_at' | 'updated_at'>>): Promise<{ code: number; message?: string; data?: ScriptItem }> {
  const res = await fetch(`${API_BASE}/api/v1/scripts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string; data?: ScriptItem };
}

export async function deleteScript(id: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/scripts/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string };
}

export async function getMaterialById(id: string): Promise<{ code: number; data?: MaterialItem }> {
  const res = await fetch(`${API_BASE}/api/v1/materials/${id}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data?: MaterialItem };
}

export async function getMaterials(params?: { type?: string; page?: number; limit?: number }): Promise<PaginatedResult<MaterialItem>> {
  const qs = new URLSearchParams();
  if (params?.type) qs.set('type', params.type);
  qs.set('page', String(params?.page ?? 1));
  qs.set('limit', String(params?.limit ?? 20));
  const res = await fetch(`${API_BASE}/api/v1/materials?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PaginatedResult<MaterialItem>;
}

export async function createMaterial(input: {
  title: string;
  type: MaterialItem['type'];
  duration?: string;
  description?: string;
  tags?: string[];
  status?: string;
  product_line_id?: string;
  file?: File;
}): Promise<{ code: number; message?: string; data?: MaterialItem }> {
  const formData = new FormData();
  formData.append('title', input.title);
  formData.append('type', input.type);
  if (input.duration) formData.append('duration', input.duration);
  if (input.description) formData.append('description', input.description);
  if (input.tags && input.tags.length > 0) formData.append('tags', JSON.stringify(input.tags));
  if (input.status) formData.append('status', input.status);
  if (input.product_line_id) formData.append('product_line_id', input.product_line_id);
  if (input.file) formData.append('file', input.file);

  const res = await fetch(`${API_BASE}/api/v1/materials`, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string; data?: MaterialItem };
}

export async function updateMaterial(id: string, input: Partial<Omit<MaterialItem, 'material_id' | 'created_at' | 'updated_at'>>): Promise<{ code: number; message?: string; data?: MaterialItem }> {
  const res = await fetch(`${API_BASE}/api/v1/materials/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string; data?: MaterialItem };
}

export async function deleteMaterial(id: string): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/materials/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string };
}

export async function getSellingPoints(params?: { product_line_id?: string; category?: string; page?: number; limit?: number }): Promise<PaginatedResult<SellingPoint>> {
  const qs = new URLSearchParams();
  if (params?.product_line_id) qs.set('product_line_id', params.product_line_id);
  if (params?.category) qs.set('category', params.category);
  qs.set('page', String(params?.page ?? 1));
  qs.set('limit', String(params?.limit ?? 20));
  const res = await fetch(`${API_BASE}/api/v1/selling-points?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PaginatedResult<SellingPoint>;
}

export async function getProductSpecs(params?: { product_line_id?: string; page?: number; limit?: number }): Promise<PaginatedResult<ProductSpec>> {
  const qs = new URLSearchParams();
  if (params?.product_line_id) qs.set('product_line_id', params.product_line_id);
  qs.set('page', String(params?.page ?? 1));
  qs.set('limit', String(params?.limit ?? 20));
  const res = await fetch(`${API_BASE}/api/v1/product-specs?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PaginatedResult<ProductSpec>;
}

export async function getSalesScenarios(params?: { product_line_id?: string; scene_type?: string; page?: number; limit?: number }): Promise<PaginatedResult<SalesScenario>> {
  const qs = new URLSearchParams();
  if (params?.product_line_id) qs.set('product_line_id', params.product_line_id);
  if (params?.scene_type) qs.set('scene_type', params.scene_type);
  qs.set('page', String(params?.page ?? 1));
  qs.set('limit', String(params?.limit ?? 20));
  const res = await fetch(`${API_BASE}/api/v1/sales-scenarios?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PaginatedResult<SalesScenario>;
}

export async function getTrainingUnitsSummary(): Promise<TrainingUnitsSummaryResult> {
  const res = await fetch(`${API_BASE}/api/v1/training-units/summary`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as TrainingUnitsSummaryResult;
}

export async function getTrainingPlan(recordId: string): Promise<TrainingPlanResult> {
  const res = await fetch(`${API_BASE}/api/v1/practices/${recordId}/training-plan`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as TrainingPlanResult;
}

// --- AI Dedup ---

export interface DedupItem {
  id: string;
  title: string;
  keep: boolean;
}

export interface DedupGroup {
  table: string;
  items: DedupItem[];
  reason: string;
}

export interface DedupResult {
  code: number;
  data: {
    groups: DedupGroup[];
    total_groups: number;
    total_duplicates: number;
  };
}

export async function aiDedup(productLineId: string, tables: string[]): Promise<DedupResult> {
  const res = await fetch(`${API_BASE}/api/v1/knowledge/dedup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ product_line_id: productLineId, tables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DedupResult;
}

export async function batchDeleteKnowledge(items: { table: string; id: string }[]): Promise<{ code: number; data: { deleted_count: number } }> {
  const res = await fetch(`${API_BASE}/api/v1/knowledge/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: { deleted_count: number } };
}

// --- Product Assets ---

export interface ProductAsset {
  asset_id: string;
  product_line_id: string;
  title: string;
  asset_type: 'brochure' | 'detail_page' | 'image' | 'video' | 'manual' | 'packaging' | 'banner';
  file_path: string;
  file_url?: string;
  description?: string;
  sort_order: number;
  status: string;
  created_at?: string;
}

export async function getProductAssets(params?: { product_line_id?: string; asset_type?: string; page?: number; limit?: number }): Promise<PaginatedResult<ProductAsset>> {
  const qs = new URLSearchParams();
  if (params?.product_line_id) qs.set('product_line_id', params.product_line_id);
  if (params?.asset_type) qs.set('asset_type', params.asset_type);
  qs.set('page', String(params?.page ?? 1));
  qs.set('limit', String(params?.limit ?? 50));
  const res = await fetch(`${API_BASE}/api/v1/product-assets?${qs.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PaginatedResult<ProductAsset>;
}

export async function uploadAsset(
  file: File,
  productLineId: string,
  assetType: string,
  title?: string,
  onProgress?: (percent: number) => void
): Promise<{ code: number; data: ProductAsset; message?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('product_line_id', productLineId);
    formData.append('asset_type', assetType);
    if (title) formData.append('title', title);

    xhr.open('POST', `${API_BASE}/api/v1/product-assets/upload`);
    const headers = authHeaders();
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.floor((event.loaded / event.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && json.code === 0) {
          resolve(json);
        } else {
          reject(new Error(json.message || `上传失败 (${xhr.status})`));
        }
      } catch {
        reject(new Error('Invalid JSON response'));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    xhr.send(formData);
  });
}

export async function deleteAsset(assetId: string): Promise<{ code: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/product-assets/${assetId}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message: string };
}

export async function batchDeleteAssets(assetIds: string[]): Promise<{ code: number; data: { deleted_count: number } }> {
  const res = await fetch(`${API_BASE}/api/v1/product-assets/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ asset_ids: assetIds }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: { deleted_count: number } };
}

// --- AI Pipeline ---

export interface AiSummaryItem {
  category: string;
  title: string;
  content: string;
  tags: string[];
}

export interface AiClassifyItem {
  title: string;
  content: string;
  source_file: string;
  tags?: string[];
}

export interface AiClassifyCategory {
  category: string;
  items: AiClassifyItem[];
}

export interface AiClassifyResult {
  code: number;
  data: {
    product_line_id: string;
    product_name: string;
    source_file_count: number;
    categories: AiClassifyCategory[];
  };
}

export async function aiClassify(productLineId: string, assetIds?: string[]): Promise<AiClassifyResult> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/ai-classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(assetIds && assetIds.length > 0 ? { asset_ids: assetIds } : undefined),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AiClassifyResult;
}

export async function aiTag(productLineId: string, categories: AiClassifyCategory[]): Promise<AiClassifyResult> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/ai-tag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ categories }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AiClassifyResult;
}

export async function saveSummaries(productLineId: string, summaries: AiSummaryItem[], mode?: 'full' | 'append'): Promise<{ code: number; message?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/save-summaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ summaries, mode }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; message?: string };
}

// --- Asset Texts (Step 1 OCR results) ---

export interface AssetText {
  id: string;
  file_path: string;
  file_type: 'image' | 'pdf' | 'video';
  raw_text: string;
  created_at?: string;
}

export interface AssetTextsResult {
  code: number;
  data: {
    product_line_id: string;
    product_name: string;
    total: number;
    texts: AssetText[];
  };
}

export async function getAssetTexts(productLineId: string): Promise<AssetTextsResult> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/asset-texts`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AssetTextsResult;
}

export async function aiExtractTexts(productLineId: string, assetIds?: string[]): Promise<{ code: number; data: { product_line_id: string; product_name: string; extracted_count: number; texts: Array<{ file_path: string; file_type: string; char_count: number }> } }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/ai-extract-texts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(assetIds && assetIds.length > 0 ? { asset_ids: assetIds } : undefined),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json());
}

export async function setProductCoverImage(productLineId: string, assetId: string): Promise<{ code: number; data: { cover_image_asset_id: string; file_path: string } }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/cover-image`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ asset_id: assetId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { code: number; data: { cover_image_asset_id: string; file_path: string } };
}

export async function generateProductDescription(productLineId: string, assetIds?: string[]): Promise<{ code: number; data: { description: string } }> {
  const res = await fetch(`${API_BASE}/api/v1/product-lines/${productLineId}/generate-description`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(assetIds ? { asset_ids: assetIds } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json());
}

export async function fetchMaterialPdf(id: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API_BASE}/api/v1/materials/${id}/download`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function downloadMaterial(materialId: string, title: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/materials/${materialId}/download`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`下载失败: ${res.status}`);
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
