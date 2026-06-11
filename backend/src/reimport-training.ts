import fs from 'fs';
import mysql from 'mysql2/promise';
import { aiParseTrainingDoc } from './services/ai-parse-training';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
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

  const rawText = fs.readFileSync('tmp_training_text.txt', 'utf-8');
  console.log(`Raw text length: ${rawText.length} chars`);

  // Clear old AI-generated data from all tables
  await pool.execute("DELETE FROM selling_points WHERE source = 'ai'");
  await pool.execute("DELETE FROM sales_scripts WHERE source = 'ai'");
  await pool.execute("DELETE FROM product_specs WHERE source = 'ai'");
  await pool.execute("DELETE FROM sales_scenarios WHERE source = 'ai'");
  console.log('Cleared old AI-generated data');

  const result = await aiParseTrainingDoc(rawText);
  console.log('Parse result:', JSON.stringify(result, null, 2));

  // Verify counts
  const [sp]: any = await pool.execute("SELECT COUNT(*) as c FROM selling_points WHERE source='ai'");
  const [sc]: any = await pool.execute("SELECT COUNT(*) as c FROM sales_scripts WHERE source='ai'");
  const [ps]: any = await pool.execute("SELECT COUNT(*) as c FROM product_specs WHERE source='ai'");
  const [ss]: any = await pool.execute("SELECT COUNT(*) as c FROM sales_scenarios WHERE source='ai'");

  console.log(`\nDB counts: selling_points=${sp[0].c}, scripts=${sc[0].c}, specs=${ps[0].c}, scenarios=${ss[0].c}`);

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
