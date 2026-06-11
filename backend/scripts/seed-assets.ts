/**
 * Scan product data directory and seed product_assets table.
 * Usage: npx tsx scripts/seed-assets.ts
 */
import fs from 'fs';
import path from 'path';
import { pool } from '../src/db';

const PRODUCT_DATA_ROOT = path.resolve(
  process.cwd(),
  '../辅助员工提升销售能力AI员工/产品资料'
);

// Map directory name to product line name in DB
const DIR_TO_PRODUCT: Record<string, string> = {
  'HOTSPOT': 'HOTSPOT 即热饮水机',
  'NOVA气泡水机': 'NOVA 苏打水机',
  'P2太极款': 'P2太极款',
  'REAL3': 'REAL3 净水器',
  'WELL3商用': 'WELL3 商用净水',
  '餐饮微滤机': '餐饮微滤机',
  '爵士H5': '爵士H5 饮水机',
  '名士K2': '名士K2 净水器',
  '名士N5': '名士N5 净水器',
  '力士D8': '力士D8 饮水机',
  '力士T3': '力士T3 饮水机',
  '卫士P2': '卫士P2 净水器',
  '勇士E6-PLUS': '勇士E6-PLUS 商用机',
  '勇士K5': '勇士K5 净水器',
  '小白鲸2.0': '小白鲸2.0 净水器',
  '小蓝鲸3F4F': '小蓝鲸3F/4F 净水器',
  '新款H7': '新款H7 饮水机',
  '直饮机H3': '直饮机H3',
  '直饮机H8': '直饮机H8',
  '智享喝X6': '智享喝X6',
  '台式气泡机': '台式气泡机',
};

// Detect asset_type from file/folder name keywords
function detectAssetType(filePath: string, relativePath: string): string | null {
  const lower = relativePath.toLowerCase();
  const fname = path.basename(filePath).toLowerCase();

  if (fname.endsWith('.mp4')) return 'video';

  if (lower.includes('三折页')) return 'brochure';
  if (lower.includes('详情页')) return 'detail_page';
  if (lower.includes('说明书') || lower.includes('手册')) return 'manual';
  if (lower.includes('头图')) return 'banner';
  if (lower.includes('包装')) return 'packaging';
  if (lower.includes('高清图') || lower.includes('易拉宝')) return 'image';

  // Fallback by extension
  if (fname.endsWith('.pdf')) return 'brochure';
  if (/\.(jpg|jpeg|png|webp)$/i.test(fname)) return 'image';

  return null;
}

function generateTitle(productName: string, assetType: string, relativePath: string, idx: number): string {
  const base = productName;
  switch (assetType) {
    case 'brochure': return `${base} 三折页`;
    case 'detail_page': return `${base} 详情页 - ${idx}`;
    case 'manual': return `${base} 说明书`;
    case 'video': return `${base} 产品视频 ${idx}`;
    case 'banner': return `${base} 头图 - ${idx}`;
    case 'packaging': return `${base} 包装 - ${idx}`;
    case 'image': return `${base} 高清图 - ${idx}`;
    default: return `${base} 素材 - ${idx}`;
  }
}

async function main() {
  console.log('Scanning product data directory:', PRODUCT_DATA_ROOT);
  if (!fs.existsSync(PRODUCT_DATA_ROOT)) {
    console.error('Directory not found:', PRODUCT_DATA_ROOT);
    process.exit(1);
  }

  // Load product line IDs from DB
  const { rows: productLines } = await pool.query('SELECT product_line_id, name FROM product_lines');
  const nameToId = new Map(productLines.map((r: { product_line_id: string; name: string }) => [r.name, r.product_line_id]));

  // Clear old assets
  await pool.query('DELETE FROM product_assets');
  console.log('Cleared old product_assets');

  let totalInserted = 0;

  // Walk all top-level dirs
  const topDirs = fs.readdirSync(PRODUCT_DATA_ROOT).filter(d => {
    const full = path.join(PRODUCT_DATA_ROOT, d);
    return fs.statSync(full).isDirectory() && d !== '过往产品';
  });

  for (const dir of topDirs) {
    // Find matching product line
    const productName = DIR_TO_PRODUCT[dir];
    if (!productName) {
      console.log(`  SKIP (no mapping): ${dir}`);
      continue;
    }
    const productLineId = nameToId.get(productName);
    if (!productLineId) {
      console.log(`  SKIP (not in DB): ${productName}`);
      continue;
    }

    console.log(`Processing: ${dir} → ${productName}`);

    // Walk all files recursively
    const dirPath = path.join(PRODUCT_DATA_ROOT, dir);
    const typeCounters: Record<string, number> = {};

    function walkDir(currentPath: string) {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
          continue;
        }
        // Skip non-media files
        if (/\.(psd|ai|zip|rar|7z|ds_store|thm|lrc)$/i.test(entry.name)) return;

        const relativePath = path.relative(PRODUCT_DATA_ROOT, fullPath).replace(/\\/g, '/');
        const assetType = detectAssetType(fullPath, relativePath);
        if (!assetType) return;

        typeCounters[assetType] = (typeCounters[assetType] || 0) + 1;
        const title = generateTitle(productName, assetType, relativePath, typeCounters[assetType]);

        pool.query(
          `INSERT INTO product_assets (product_line_id, title, asset_type, file_path, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [productLineId, title, assetType, relativePath, typeCounters[assetType]]
        ).catch(err => console.error(`  ERROR: ${relativePath}`, err.message));

        totalInserted++;
      }
    }

    walkDir(dirPath);
  }

  // Wait a bit for all async inserts to complete
  await new Promise(r => setTimeout(r, 3000));
  console.log(`\nDone! Total assets inserted: ${totalInserted}`);

  const { rows: stats } = await pool.query(
    'SELECT asset_type, COUNT(*) as cnt FROM product_assets GROUP BY asset_type ORDER BY cnt DESC'
  );
  console.table(stats);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
