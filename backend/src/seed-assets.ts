import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ai_sales_coach',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

const PRODUCT_DATA_ROOT = path.resolve(process.cwd(), '../辅助员工提升销售能力AI员工/产品资料');

// Map directory names to product line names in DB
const DIR_TO_PRODUCT: Record<string, string | null> = {
  'HOTSPOT': 'HOTSPOT 即热饮水机',
  'P2太极款': 'P2太极款',
  'REAL3': 'REAL3 净水器',
  'WELL3商用': 'WELL3 商用净水',
  '力士D8': '力士D8 饮水机',
  '力士T3': '力士T3 饮水机',
  '勇士E6-PLUS': '勇士E6-PLUS 商用机',
  '勇士E9-PLUS': null, // no matching product line yet
  '勇士K5': '勇士K5 净水器',
  '勇士K6K9': null,
  '卫士P2': '卫士P2 净水器',
  '台式气泡机': '台式气泡机',
  '名士K2': '名士K2 净水器',
  '名士N5': '名士N5 净水器',
  '商用净水主机P2-MC': null,
  '商用净水主机P5-MC': null,
  '小白鲸2.0': '小白鲸2.0 净水器',
  '小蓝鲸3F4F': '小蓝鲸3F/4F 净水器',
  '新款H7': '新款H7 饮水机',
  '智享喝X6': '智享喝X6',
  '爵士H5': '爵士H5 饮水机',
  '直饮机H3': '直饮机H3',
  '直饮机H8': '直饮机H8',
  '餐饮微滤机': '餐饮微滤机',
};

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mov']);

function guessAssetType(fileName: string, ext: string): string {
  if (ext === '.pdf') {
    if (/三折页|折页|DM|单页/.test(fileName)) return 'brochure';
    if (/详情页/.test(fileName)) return 'detail_page';
    return 'manual';
  }
  if (IMAGE_EXTS.has(ext)) {
    if (/详情页|头图|主图/.test(fileName)) return 'detail_page';
    if (/高清图|透明图/.test(fileName)) return 'image';
    if (/长图/.test(fileName)) return 'detail_page';
    return 'image';
  }
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ext === '.docx' || ext === '.doc') return 'manual';
  return 'image';
}

async function getDirFiles(dirPath: string, relativeTo: string): Promise<Array<{ filePath: string; title: string; assetType: string }>> {
  const results: Array<{ filePath: string; title: string; assetType: string }> = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  let sortOrder = 0;
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const subResults = await getDirFiles(fullPath, relativeTo);
      results.push(...subResults);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext) && ext !== '.pdf' && !VIDEO_EXTS.has(ext) && ext !== '.docx' && ext !== '.doc') continue;

      const relativePath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');
      const assetType = guessAssetType(entry.name, ext);
      const title = path.basename(entry.name, ext);

      results.push({ filePath: relativePath, title, assetType });
    }
  }
  return results;
}

async function main() {
  // First, add missing product lines
  const missingProducts = [
    { name: '勇士E9-PLUS 商用机', description: '勇士E9-PLUS 商用净水机' },
    { name: '勇士K6K9 净水器', description: '勇士K6/K9系列净水器' },
    { name: '商用净水主机P2-MC', description: '商用净水主机P2-MC' },
    { name: '商用净水主机P5-MC', description: '商用净水主机P5-MC' },
  ];

  for (const pl of missingProducts) {
    const [rows]: any = await pool.execute('SELECT 1 FROM product_lines WHERE name = ?', [pl.name]);
    if (rows.length === 0) {
      await pool.execute('INSERT INTO product_lines (name, description) VALUES (?, ?)', [pl.name, pl.description]);
      console.log(`Added product line: ${pl.name}`);
    }
    // Update mapping
    for (const [dir, plName] of Object.entries(DIR_TO_PRODUCT)) {
      if (plName === null) {
        const match = missingProducts.find(p => p.name.includes(dir.replace(/商用净水主机/, '').replace(/勇士/, '').split('-')[0]));
        // simple heuristic matching
      }
    }
  }

  // Update mappings for newly added lines
  DIR_TO_PRODUCT['勇士E9-PLUS'] = '勇士E9-PLUS 商用机';
  DIR_TO_PRODUCT['勇士K6K9'] = '勇士K6K9 净水器';
  DIR_TO_PRODUCT['商用净水主机P2-MC'] = '商用净水主机P2-MC';
  DIR_TO_PRODUCT['商用净水主机P5-MC'] = '商用净水主机P5-MC';

  // Get product line IDs
  const [plRows]: any = await pool.execute('SELECT product_line_id, name FROM product_lines');
  const plMap = new Map<string, string>();
  for (const row of plRows) {
    plMap.set(row.name, row.product_line_id);
  }

  // Clear existing assets
  await pool.execute('DELETE FROM product_asset_texts');
  await pool.execute('DELETE FROM product_assets');
  console.log('Cleared existing product_assets');

  let totalAssets = 0;

  for (const [dirName, productName] of Object.entries(DIR_TO_PRODUCT)) {
    if (productName === null) continue;
    const dirPath = path.join(PRODUCT_DATA_ROOT, dirName);
    if (!fs.existsSync(dirPath)) {
      console.warn(`Directory not found: ${dirName}`);
      continue;
    }

    const productLineId = plMap.get(productName);
    if (!productLineId) {
      console.warn(`No product_line_id for: ${productName} (dir: ${dirName})`);
      continue;
    }

    const files = await getDirFiles(dirPath, PRODUCT_DATA_ROOT);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const assetId = uuidv4();
      await pool.execute(
        `INSERT INTO product_assets (asset_id, product_line_id, title, asset_type, file_path, sort_order, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [assetId, productLineId, file.title, file.assetType, file.filePath, i]
      );
      totalAssets++;
    }
    console.log(`${dirName}: ${files.length} assets`);
  }

  console.log(`\nTotal assets inserted: ${totalAssets}`);

  // Also seed the NOVA product line assets (under HOTSPOT/NOVA气泡水机)
  // And HOTSPOT开水机, 组合方案
  // The NOVA line maps to HOTSPOT directory, handle subdirs
  // Actually NOVA is mapped to HOTSPOT 即热饮水机 but NOVA气泡水机 is a separate sub-brand
  // Let's check if NOVA 苏打水机 already has assets via the HOTSPOT scan
  // It should since we scanned HOTSPOT dir recursively

  await pool.end();
}

main().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
