import { pool } from '../src/db';

async function migrate() {
  const [result]: any = await pool.execute(`
    UPDATE practice_records
    SET overall_score = JSON_UNQUOTE(JSON_EXTRACT(evaluation_result, '$.overallScore'))
    WHERE overall_score IS NULL
      AND evaluation_result IS NOT NULL
      AND JSON_EXTRACT(evaluation_result, '$.overallScore') IS NOT NULL
  `);
  console.log('Migrated rows:', result.affectedRows);
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
