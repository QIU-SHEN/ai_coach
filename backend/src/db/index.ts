import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ai_sales_coach',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

// MariaDB longtext columns (migrated from MySQL JSON) are returned as raw strings.
// Auto-parse any string that looks like a JSON array or object.
function tryParseJson(value: unknown): unknown {
  if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
    try {
      return JSON.parse(value);
    } catch {
      // not valid JSON, keep as-is
    }
  }
  return value;
}

export function parseJsonRows(rows: any[]): any[] {
  return rows.map((row) => {
    const parsed: any = {};
    for (const [key, value] of Object.entries(row)) {
      parsed[key] = tryParseJson(value);
    }
    return parsed;
  });
}

export async function initDb() {
  // 1. users
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      user_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(50) NOT NULL,
      role VARCHAR(20) NOT NULL,
      employee_id VARCHAR(50),
      department VARCHAR(100),
      avatar_url VARCHAR(500),
      phone VARCHAR(20),
      email VARCHAR(100),
      manager_id CHAR(36) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // 2. practice_records
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS practice_records (
      record_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      user_id CHAR(36) NOT NULL,
      audio_path VARCHAR(500) NOT NULL,
      duration INT NOT NULL DEFAULT 0,
      practice_type VARCHAR(20) NOT NULL DEFAULT 'intro',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      product_line VARCHAR(100) NOT NULL,
      transcript TEXT,
      transcript_segments JSON,
      overall_score DECIMAL(4,1),
      weak_points JSON,
      asr_engine VARCHAR(50),
      asr_task_id VARCHAR(200),
      error_code VARCHAR(50),
      error_message VARCHAR(500),
      fluency_score INT,
      evaluation_result JSON,
      dialogue_history JSON,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // 3. dialogue_rounds
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dialogue_rounds (
      round_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      record_id CHAR(36) NOT NULL,
      round_number INT NOT NULL,
      customer_question TEXT NOT NULL,
      sales_reply TEXT,
      difficulty VARCHAR(20) NOT NULL,
      expected_focus TEXT,
      score INT,
      feedback TEXT,
      strengths JSON,
      weaknesses JSON,
      missed_points JSON,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_record_round (record_id, round_number),
      FOREIGN KEY (record_id) REFERENCES practice_records(record_id) ON DELETE CASCADE
    )
  `);

  // Migration: add new columns for V2 flow
  const migrations = [
    'ALTER TABLE dialogue_rounds ADD COLUMN reaction_ms INT DEFAULT 0',
    'ALTER TABLE dialogue_rounds ADD COLUMN difficulty_adjusted BOOLEAN DEFAULT FALSE',
    'ALTER TABLE dialogue_rounds ADD COLUMN adjust_reason VARCHAR(200)',
    'ALTER TABLE practice_records ADD COLUMN pre_analysis JSON',
    'ALTER TABLE practice_records ADD COLUMN initial_scores JSON',
    'ALTER TABLE practice_records ADD COLUMN conversation_metrics JSON',
    'ALTER TABLE practice_records ADD COLUMN is_showcase TINYINT(1) DEFAULT 0',
    'ALTER TABLE practice_records ADD COLUMN showcase_comment TEXT DEFAULT NULL',
    'ALTER TABLE practice_records ADD COLUMN training_plan JSON DEFAULT NULL',
'ALTER TABLE practice_records ADD COLUMN audio_type VARCHAR(20) DEFAULT \'monologue\'',
    'ALTER TABLE dialogue_rounds ADD COLUMN audio_reply_path VARCHAR(500) DEFAULT NULL',
    'ALTER TABLE product_lines ADD COLUMN cover_image_asset_id CHAR(36) DEFAULT NULL',
  ];
  for (const sql of migrations) {
    await pool.execute(sql).catch(() => { /* column already exists */ });
  }

  // 4. product_lines (with hierarchy support)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS product_lines (
      product_line_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      parent_id CHAR(36) DEFAULT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      level INT NOT NULL DEFAULT 2,
      sort_order INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES product_lines(product_line_id)
    )
  `);

  // Migration: add hierarchy columns if they don't exist (for existing installations)
  const hierarchyMigrations = [
    'ALTER TABLE product_lines ADD COLUMN parent_id CHAR(36) DEFAULT NULL',
    'ALTER TABLE product_lines ADD COLUMN level INT NOT NULL DEFAULT 2',
    'ALTER TABLE product_lines ADD COLUMN sort_order INT NOT NULL DEFAULT 0',
    'ALTER TABLE product_lines DROP INDEX name',
    'ALTER TABLE product_lines ADD UNIQUE KEY uk_name_parent (name, parent_id)',
  ];
  for (const sql of hierarchyMigrations) {
    await pool.execute(sql).catch(() => { /* column/index already exists */ });
  }

  // ── Product Lines Hierarchy Migration ──
  // Check if proper root categories already exist
  const [rootCheck]: any = await pool.execute("SELECT 1 FROM product_lines WHERE name = '商用净水' AND level = 1 LIMIT 1");
  if (rootCheck.length === 0) {
    // Step 1: Demote existing series nodes from level=1 to level=2
    await pool.execute("UPDATE product_lines SET level = 2 WHERE level = 1 AND parent_id IS NULL");

    // Step 2: Insert root categories (level=1)
    const commercialId = uuidv4();
    const householdId = uuidv4();
    await pool.execute(
      'INSERT INTO product_lines (product_line_id, name, level, sort_order, status) VALUES (?, ?, 1, 1, "active")',
      [commercialId, '商用净水']
    );
    await pool.execute(
      'INSERT INTO product_lines (product_line_id, name, level, sort_order, status) VALUES (?, ?, 1, 2, "active")',
      [householdId, '家用净水']
    );

    // Step 3: Assign existing series nodes to root categories
    const commercialSeries = ['勇士系列','名士系列','力士系列','爵士系列','直饮机系列','新款系列','HOTSPOT系列','台式系列','餐饮系列','WELL系列','卫士系列','净水系列'];
    const householdSeries = ['小白鲸系列','小蓝鲸系列','P2系列','REAL系列','NOVA系列','智享喝系列','其他'];

    for (const name of commercialSeries) {
      await pool.execute('UPDATE product_lines SET parent_id = ? WHERE name = ? AND level = 2', [commercialId, name]);
    }
    for (const name of householdSeries) {
      await pool.execute('UPDATE product_lines SET parent_id = ? WHERE name = ? AND level = 2', [householdId, name]);
    }

    // Step 4: Insert new series nodes (level=2) under root categories
    const newSeries = [
      { name: '立式直饮系列', parent: commercialId, sort: 1 },
      { name: '高端办公系列', parent: commercialId, sort: 2 },
      { name: '茶饮咖啡系列', parent: commercialId, sort: 3 },
      { name: '中央厨房系列', parent: commercialId, sort: 4 },
      { name: '1+N多点位饮水系列', parent: commercialId, sort: 5 },
      { name: '全屋净水', parent: householdId, sort: 1 },
      { name: '厨下净水', parent: householdId, sort: 2 },
      { name: '桌面净水', parent: householdId, sort: 3 },
    ];
    const seriesIdMap: Record<string, string> = {};
    for (const s of newSeries) {
      const id = uuidv4();
      seriesIdMap[s.name] = id;
      await pool.execute(
        'INSERT INTO product_lines (product_line_id, name, parent_id, level, sort_order, status) VALUES (?, ?, ?, 2, ?, "active")',
        [id, s.name, s.parent, s.sort]
      );
    }

    // Step 5: Reassign product nodes to new series and upgrade to level=3
    const productMoves: Record<string, string> = {
      '勇士K6K9 净水器': seriesIdMap['立式直饮系列'],
      '新款H7 饮水机': seriesIdMap['立式直饮系列'],
      '爵士H5 饮水机': seriesIdMap['立式直饮系列'],
      '名士K2 净水器': seriesIdMap['立式直饮系列'],
      '名士N5 净水器': seriesIdMap['立式直饮系列'],
      '直饮机H8': seriesIdMap['立式直饮系列'],
      '直饮机H3': seriesIdMap['立式直饮系列'],
      'HOTSPOT 即热饮水机': seriesIdMap['高端办公系列'],
      '台式气泡机': seriesIdMap['高端办公系列'],
      '商用净水主机P2-MC': seriesIdMap['茶饮咖啡系列'],
      '商用净水主机P5-MC': seriesIdMap['茶饮咖啡系列'],
      '餐饮微滤机': seriesIdMap['茶饮咖啡系列'],
      'WELL3 商用净水': seriesIdMap['中央厨房系列'],
      '力士D8 饮水机': seriesIdMap['1+N多点位饮水系列'],
      '力士T3 饮水机': seriesIdMap['1+N多点位饮水系列'],
      '小白鲸2.0 净水器': seriesIdMap['全屋净水'],
      '小蓝鲸3F/4F 净水器': seriesIdMap['全屋净水'],
      'P2太极款': seriesIdMap['厨下净水'],
      '智享喝X6': seriesIdMap['桌面净水'],
      'NOVA 苏打水机': seriesIdMap['桌面净水'],
      'REAL3 净水器': seriesIdMap['桌面净水'],
    };

    for (const [productName, newParentId] of Object.entries(productMoves)) {
      await pool.execute('UPDATE product_lines SET parent_id = ?, level = 3 WHERE name = ?', [newParentId, productName]);
    }
  }

  // 5. product_knowledge
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS product_knowledge (
      knowledge_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      product_line_id CHAR(36),
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(50),
      tags JSON,
      source VARCHAR(50) DEFAULT 'manual',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 6. sales_scripts
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sales_scripts (
      script_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      product_line_id CHAR(36),
      title VARCHAR(200) NOT NULL,
      scene VARCHAR(100),
      content TEXT NOT NULL,
      tags JSON,
      source VARCHAR(20) DEFAULT 'manual',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 7. training_materials
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS training_materials (
      material_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      title VARCHAR(200) NOT NULL,
      type VARCHAR(20) NOT NULL,
      duration VARCHAR(20),
      file_url VARCHAR(500),
      description TEXT,
      tags JSON,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      product_line_id CHAR(36),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 8. product_assets
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS product_assets (
      asset_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      product_line_id CHAR(36) NOT NULL,
      title VARCHAR(200) NOT NULL,
      asset_type VARCHAR(20) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      file_url VARCHAR(500),
      description TEXT,
      sort_order INT DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 8.5 product_asset_texts (used by ai-extract-texts)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS product_asset_texts (
      id CHAR(36) PRIMARY KEY,
      product_line_id CHAR(36) NOT NULL,
      asset_id CHAR(36),
      file_path VARCHAR(500) NOT NULL,
      file_type VARCHAR(20) NOT NULL,
      raw_text LONGTEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 9. selling_points
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS selling_points (
      point_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      product_line_id CHAR(36),
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL,
      keywords JSON,
      priority INT DEFAULT 5,
      category VARCHAR(50),
      source VARCHAR(50) DEFAULT 'manual',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 10. product_specs
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS product_specs (
      spec_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      product_line_id CHAR(36),
      spec_name VARCHAR(100) NOT NULL,
      spec_value VARCHAR(200) NOT NULL,
      unit VARCHAR(50),
      common_mistake TEXT,
      keywords JSON,
      source VARCHAR(50) DEFAULT 'manual',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 11. sales_scenarios
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sales_scenarios (
      scenario_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      product_line_id CHAR(36),
      title VARCHAR(200) NOT NULL,
      scene_type VARCHAR(50),
      content TEXT NOT NULL,
      key_takeaway TEXT,
      keywords JSON,
      source VARCHAR(50) DEFAULT 'manual',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Seed mock users (password: '123456')
  const mockUsers = [
    { username: 'zhangsan', name: '张三', role: 'employee', employee_id: 'SALES-2024-001' },
    { username: 'lisi', name: '李四', role: 'manager', employee_id: 'MGR-2024-001' },
    { username: 'wangwu', name: '王五', role: 'admin', employee_id: 'ADM-2024-001' },
  ];
  const correctHash = await bcrypt.hash('123456', 10);
  for (const u of mockUsers) {
    const [rows]: any = await pool.execute('SELECT 1 FROM users WHERE username = ?', [u.username]);
    if (rows.length === 0) {
      await pool.execute(
        `INSERT INTO users (username, password_hash, name, role, employee_id, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [u.username, correctHash, u.name, u.role, u.employee_id]
      );
    } else {
      await pool.execute('UPDATE users SET password_hash = ? WHERE username = ?', [correctHash, u.username]);
    }
  }

  // Seed product lines
  const productLines = [
    { name: 'HOTSPOT 即热饮水机', description: '即热式饮水机，4L/8L 规格' },
    { name: 'NOVA 苏打水机', description: '苏打水/气泡水机' },
    { name: 'P2太极款', description: '太极款饮水机' },
    { name: 'REAL3 净水器', description: 'RO 反渗透净水器' },
    { name: 'WELL3 商用净水', description: '商用净水系统' },
    { name: '餐饮微滤机', description: '餐饮专用微滤设备' },
    { name: '爵士H5 饮水机', description: '爵士系列饮水机' },
    { name: '名士K2 净水器', description: '名士系列净水器' },
    { name: '名士N5 净水器', description: '名士系列净水器' },
    { name: '力士D8 饮水机', description: '力士系列饮水机' },
    { name: '力士T3 饮水机', description: '力士系列饮水机' },
    { name: '卫士P2 净水器', description: '卫士系列净水器' },
    { name: '勇士E6-PLUS 商用机', description: '勇士系列商用净水机' },
    { name: '勇士K5 净水器', description: '勇士系列家用净水器' },
    { name: '小白鲸2.0 净水器', description: '小白鲸系列净水器' },
    { name: '小蓝鲸3F/4F 净水器', description: '小蓝鲸系列净水器' },
    { name: '新款H7 饮水机', description: 'H7 系列饮水机' },
    { name: '直饮机H3', description: 'H3 直饮机' },
    { name: '直饮机H8', description: 'H8 直饮机（40L/60L）' },
    { name: '智享喝X6', description: '智享喝系列饮水机' },
    { name: '台式气泡机', description: '台式气泡水机' },
  ];
  for (const pl of productLines) {
    const [rows]: any = await pool.execute('SELECT 1 FROM product_lines WHERE name = ?', [pl.name]);
    if (rows.length === 0) {
      await pool.execute('INSERT INTO product_lines (name, description) VALUES (?, ?)', [pl.name, pl.description]);
    }
  }

  // debrief_records table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS debrief_records (
      record_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      user_id CHAR(36) NOT NULL,
      product_line_id CHAR(36),
      title VARCHAR(255) NOT NULL,
      content TEXT,
      audio_path VARCHAR(500),
      transcript TEXT,
      analysis JSON,
      training_plan JSON,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migrate: add product_line_id if table already exists without it
  await pool.execute('ALTER TABLE debrief_records ADD COLUMN product_line_id CHAR(36)').catch(() => { /* column already exists */ });

  // Migration: add manager_id to users if not exists
  await pool.execute('ALTER TABLE users ADD COLUMN manager_id CHAR(36) NULL').catch(() => { /* column already exists */ });
  await pool.execute('CREATE INDEX idx_users_manager ON users(manager_id)').catch(() => { /* index already exists */ });

  // settings table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // product_quizzes
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS product_quizzes (
      quiz_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      product_line_id CHAR(36),
      material_id CHAR(36),
      question TEXT NOT NULL,
      options JSON NOT NULL,
      correct_index INT NOT NULL,
      explanation TEXT NOT NULL,
      difficulty VARCHAR(20) DEFAULT 'medium',
      category VARCHAR(50),
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_line_id) REFERENCES product_lines(product_line_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migration: add material_id to product_quizzes if not exists
  await pool.execute('ALTER TABLE product_quizzes ADD COLUMN material_id CHAR(36) NULL').catch(() => { /* column already exists */ });
  await pool.execute('CREATE INDEX idx_quizzes_material ON product_quizzes(material_id)').catch(() => { /* index already exists */ });
  // Migration: make product_line_id nullable (material-based quizzes may not have a product line)
  await pool.execute('ALTER TABLE product_quizzes MODIFY COLUMN product_line_id CHAR(36) NULL').catch(() => { /* already nullable */ });
  // Migration: ensure status column can hold 'deleted' (fix ENUM restriction)
  await pool.execute("ALTER TABLE product_quizzes MODIFY COLUMN status VARCHAR(20) DEFAULT 'active'").catch(() => { /* already modified */ });

  // quiz_attempts
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      attempt_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      user_id CHAR(36) NOT NULL,
      quiz_id CHAR(36) NOT NULL,
      selected_index INT,
      is_correct BOOLEAN,
      attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (quiz_id) REFERENCES product_quizzes(quiz_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // debrief_records migration
  await pool.execute(`ALTER TABLE debrief_records ADD COLUMN debrief_mode VARCHAR(30) NOT NULL DEFAULT 'post_meeting'`).catch(() => { /* already exists */ });
  await pool.execute(`ALTER TABLE debrief_records MODIFY COLUMN debrief_mode VARCHAR(50) NOT NULL DEFAULT 'post_meeting'`).catch(() => { /* already correct type */ });
  await pool.execute(`ALTER TABLE debrief_records ADD COLUMN speaker_diagram JSON DEFAULT NULL`).catch(() => { /* already exists */ });

  // debrief_practice_meta extension table (for merged call_recording flow)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS debrief_practice_meta (
      meta_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      record_id CHAR(36) NOT NULL UNIQUE,
      duration INT NOT NULL DEFAULT 0,
      practice_type VARCHAR(20) NOT NULL DEFAULT 'intro',
      audio_type VARCHAR(20) DEFAULT 'monologue',
      product_line VARCHAR(100),
      transcript_segments JSON,
      overall_score DECIMAL(4,1),
      weak_points JSON,
      asr_engine VARCHAR(50),
      asr_task_id VARCHAR(200),
      error_code VARCHAR(50),
      error_message VARCHAR(500),
      fluency_score INT,
      evaluation_result JSON,
      dialogue_history JSON,
      pre_analysis JSON,
      initial_scores JSON,
      conversation_metrics JSON,
      is_showcase TINYINT(1) DEFAULT 0,
      showcase_comment TEXT,
      review_comment TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (record_id) REFERENCES debrief_records(record_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
      user_id CHAR(36) NOT NULL,
      email VARCHAR(100) NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migration: add customer options fields for dialogue scenarios
  await pool.execute(`ALTER TABLE practice_records ADD COLUMN customer_knowledge VARCHAR(20) DEFAULT NULL`).catch(() => { /* column already exists */ });
  await pool.execute(`ALTER TABLE practice_records ADD COLUMN customer_type VARCHAR(20) DEFAULT NULL`).catch(() => { /* column already exists */ });
  await pool.execute(`ALTER TABLE debrief_practice_meta ADD COLUMN customer_knowledge VARCHAR(20) DEFAULT NULL`).catch(() => { /* column already exists */ });
  await pool.execute(`ALTER TABLE debrief_practice_meta ADD COLUMN customer_type VARCHAR(20) DEFAULT NULL`).catch(() => { /* column already exists */ });

  // Migrate dialogue_rounds FK from practice_records to debrief_records
  await pool.execute(`ALTER TABLE dialogue_rounds DROP FOREIGN KEY dialogue_rounds_ibfk_1`).catch(() => { /* may not exist */ });
  await pool.execute(`ALTER TABLE dialogue_rounds ADD FOREIGN KEY (record_id) REFERENCES debrief_records(record_id) ON DELETE CASCADE`).catch(() => { /* already exists */ });

  // Seed default settings
  const defaultSettings = [
    { key: 'asr_engine', value: 'whisper' },
    { key: 'wecom_notify_enabled', value: '0' },
    { key: 'wecom_webhook_url', value: '' },
  ];
  for (const s of defaultSettings) {
    const [rows]: any = await pool.execute('SELECT 1 FROM settings WHERE setting_key = ?', [s.key]);
    if (rows.length === 0) {
      await pool.execute('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', [s.key, s.value]);
    }
  }

  // Seed default email for demo accounts (for forgot-password testing)
  const demoEmails = [
    { username: 'zhangsan', email: '1347754804@qq.com' },
    { username: 'lisi', email: '1347754804@qq.com' },
    { username: 'wangwu', email: '1347754804@qq.com' },
  ];
  for (const d of demoEmails) {
    await pool.execute(
      "UPDATE users SET email = ? WHERE username = ? AND (email IS NULL OR email = '')",
      [d.email, d.username]
    ).catch(() => { /* ignore errors */ });
  }

  // Module 4: extract overall_score from analysis JSON into a dedicated column
  await pool.execute('ALTER TABLE debrief_records ADD COLUMN overall_score DECIMAL(4,1) DEFAULT NULL').catch(() => {});
  // Backfill existing post_meeting records that already have analysis JSON
  await pool.execute(`
    UPDATE debrief_records
    SET overall_score = CAST(JSON_UNQUOTE(JSON_EXTRACT(analysis, '$.overallScore')) AS DECIMAL(4,1))
    WHERE debrief_mode = 'post_meeting' AND analysis IS NOT NULL AND overall_score IS NULL
      AND JSON_VALID(analysis) AND JSON_EXTRACT(analysis, '$.overallScore') IS NOT NULL
  `).catch(() => {});

  // Module 4: performance indexes for high-frequency queries
  const perfIndexMigrations = [
    'CREATE INDEX idx_debrief_user_created ON debrief_records(user_id, created_at)',
    'CREATE INDEX idx_debrief_mode_status ON debrief_records(debrief_mode, status)',
    'CREATE INDEX idx_meta_showcase ON debrief_practice_meta(is_showcase)',
    'CREATE INDEX idx_assets_pline_status ON product_assets(product_line_id, status)',
    'CREATE INDEX idx_quizzes_pline_status ON product_quizzes(product_line_id, status)',
    'CREATE INDEX idx_attempts_user ON quiz_attempts(user_id)',
  ];
  for (const sql of perfIndexMigrations) {
    await pool.execute(sql).catch(() => { /* index already exists */ });
  }

  console.log('Database initialized (MySQL)');
}
