import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { pool } from './db';
import { uploadToOss, OSS_PUBLIC_URL } from './services/oss';

async function main() {
  await pool.getConnection();
  console.log('Connected to DB');

  // 1. practice_records.audio_path
  console.log('\n--- Migrating practice_records.audio_path ---');
  const [practiceRows]: any = await pool.execute(
    "SELECT record_id, audio_path FROM practice_records WHERE audio_path IS NOT NULL AND audio_path NOT LIKE 'http%'"
  );
  console.log(`Found ${practiceRows.length} practice records to migrate`);
  for (const row of practiceRows) {
    const localPath = path.resolve(process.cwd(), row.audio_path.replace(/^\//, '').replace(/\\/g, '/'));
    if (!fs.existsSync(localPath)) {
      console.warn('[SKIP] File not found:', localPath, 'record:', row.record_id);
      continue;
    }
    const ext = path.extname(localPath).slice(1);
    const ossKey = 'practices/' + row.record_id + '.' + ext;
    try {
      await uploadToOss(localPath, ossKey);
      const ossUrl = OSS_PUBLIC_URL + '/' + ossKey;
      await pool.execute('UPDATE practice_records SET audio_path = ? WHERE record_id = ?', [ossUrl, row.record_id]);
      console.log('[OK] practice', row.record_id, '->', ossUrl);
    } catch (err: any) {
      console.error('[FAIL] practice', row.record_id, err.message);
    }
  }

  // 2. debrief_records.audio_path
  console.log('\n--- Migrating debrief_records.audio_path ---');
  const [debriefRows]: any = await pool.execute(
    "SELECT record_id, audio_path FROM debrief_records WHERE audio_path IS NOT NULL AND audio_path NOT LIKE 'http%'"
  );
  console.log(`Found ${debriefRows.length} debrief records to migrate`);
  for (const row of debriefRows) {
    const localPath = path.resolve(process.cwd(), row.audio_path.replace(/^\//, '').replace(/\\/g, '/'));
    if (!fs.existsSync(localPath)) {
      console.warn('[SKIP] File not found:', localPath, 'record:', row.record_id);
      continue;
    }
    const ext = path.extname(localPath).slice(1);
    const ossKey = 'debriefs/' + row.record_id + '.' + ext;
    try {
      await uploadToOss(localPath, ossKey);
      const ossUrl = OSS_PUBLIC_URL + '/' + ossKey;
      await pool.execute('UPDATE debrief_records SET audio_path = ? WHERE record_id = ?', [ossUrl, row.record_id]);
      console.log('[OK] debrief', row.record_id, '->', ossUrl);
    } catch (err: any) {
      console.error('[FAIL] debrief', row.record_id, err.message);
    }
  }

  // 3. product_assets.file_path
  console.log('\n--- Migrating product_assets.file_path ---');
  const [assetRows]: any = await pool.execute(
    "SELECT asset_id, file_path, file_url FROM product_assets WHERE file_path IS NOT NULL AND file_path NOT LIKE 'http%'"
  );
  console.log(`Found ${assetRows.length} product assets to migrate`);

  const PRODUCT_DATA_ROOT = path.resolve(process.cwd(), '../辅助员工提升销售能力AI员工/产品资料');

  for (const row of assetRows) {
    let localPath: string;
    let ossKey: string;

    if (row.file_path.startsWith('uploads/') || row.file_path.startsWith('uploads\\')) {
      localPath = path.resolve(process.cwd(), row.file_path.replace(/\\/g, '/'));
      const ext = path.extname(localPath).slice(1);
      ossKey = 'assets/' + row.asset_id + '.' + ext;
    } else {
      localPath = path.join(PRODUCT_DATA_ROOT, row.file_path);
      const cleanPath = row.file_path.replace(/[\\/]/g, '_');
      ossKey = 'assets/legacy/' + row.asset_id + '_' + cleanPath;
    }

    if (!fs.existsSync(localPath)) {
      console.warn('[SKIP] File not found:', localPath, 'asset:', row.asset_id);
      continue;
    }
    try {
      await uploadToOss(localPath, ossKey);
      const ossUrl = OSS_PUBLIC_URL + '/' + ossKey;
      await pool.execute(
        'UPDATE product_assets SET file_path = ?, file_url = ? WHERE asset_id = ?',
        [ossUrl, ossUrl, row.asset_id]
      );
      console.log('[OK] asset', row.asset_id, '->', ossUrl);
    } catch (err: any) {
      console.error('[FAIL] asset', row.asset_id, err.message);
    }
  }

  // 4. dialogue_rounds.audio_reply_path
  console.log('\n--- Migrating dialogue_rounds.audio_reply_path ---');
  const [voiceRows]: any = await pool.execute(
    "SELECT record_id, round_number, audio_reply_path FROM dialogue_rounds WHERE audio_reply_path IS NOT NULL AND audio_reply_path NOT LIKE 'http%'"
  );
  console.log(`Found ${voiceRows.length} voice replies to migrate`);
  for (const row of voiceRows) {
    if (!row.audio_reply_path.startsWith('uploads/')) {
      console.warn('[SKIP] Non-uploads path:', row.audio_reply_path, 'round:', row.record_id, row.round_number);
      continue;
    }
    const localPath = path.resolve(process.cwd(), row.audio_reply_path.replace(/\\/g, '/'));
    if (!fs.existsSync(localPath)) {
      console.warn('[SKIP] File not found:', localPath, 'round:', row.record_id, row.round_number);
      continue;
    }
    const ext = path.extname(localPath).slice(1);
    const ossKey = 'voice-replies/' + row.record_id + '_' + row.round_number + '.' + ext;
    try {
      await uploadToOss(localPath, ossKey);
      const ossUrl = OSS_PUBLIC_URL + '/' + ossKey;
      await pool.execute(
        'UPDATE dialogue_rounds SET audio_reply_path = ? WHERE record_id = ? AND round_number = ?',
        [ossUrl, row.record_id, row.round_number]
      );
      console.log('[OK] voice-reply', row.record_id, 'round', row.round_number, '->', ossUrl);
    } catch (err: any) {
      console.error('[FAIL] voice-reply', row.record_id, row.round_number, err.message);
    }
  }

  console.log('\nMigration done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
