# 本地代码需修改清单（生产环境兼容性修复）

> 以下修改在你本地代码里做好后，同步到服务器就不会再被覆盖，我也不用每次帮你补了。

---

## 一、后端修复

### 1. `backend/src/db/index.ts` — MariaDB JSON 字段自动反序列化

**在 `export const pool = ...` 之后、`export async function initDb()` 之前，添加：**

```typescript
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
```

**为什么：** MySQL 8 的 `JSON` 类型在 MariaDB 10.5 里变成 `longtext` + `json_valid` 约束，`mysql2` 驱动不会自动把 JSON 字符串解析为 JS 对象。后端直接把 `"[\"tag1\",\"tag2\"]"` 字符串吐给前端，前端调用 `.join()` 就会炸。

---

### 2. `backend/src/routes/knowledge.ts`

**把 `import { pool } from '../db';` 改为：**
```typescript
import { pool, parseJsonRows } from '../db';
```

**把 `query`  helper 函数改为：**
```typescript
async function query(sql: string, params?: unknown[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}
```

---

### 3. `backend/src/routes/training-units.ts`

**同样改 import：**
```typescript
import { pool, parseJsonRows } from '../db';
```

**同样改 `query`：**
```typescript
async function query(sql: string, params?: unknown[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}
```

---

### 4. `backend/src/routes/practices.ts`

**同样改 import：**
```typescript
import { pool, parseJsonRows } from '../db';
```

**同样改 `query`：**
```typescript
async function query(sql: string, params?: unknown[]) {
  const [rows] = await pool.execute(sql, params);
  return parseJsonRows(rows as any[]);
}
```

---

### 5. `backend/src/app.ts` — CORS 加上生产域名

**在 CORS origin 数组里添加你的域名：**
```typescript
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'https://qiushen.top',   // ← 添加这行
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);
```

---

### 6. `backend/src/services/storage.ts` — 音频路径不要存完整 URL

**把 `saveUpload` 函数改成返回相对路径：**

```typescript
export async function saveUpload(
  sourcePath: string,
  recordId: string,
  ext: string
): Promise<string> {
  await ensureUploadDir();
  const dest = path.join(UPLOAD_DIR, `${recordId}.${ext}`);
  await fs.promises.copyFile(sourcePath, dest);
  // 返回相对路径，不要带域名，这样换域名也不用改数据库
  return `/uploads/${recordId}.${ext}`;
}
```

**原来代码：**
```typescript
const baseUrl = process.env.STORAGE_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
return `${baseUrl}/uploads/${recordId}.${ext}`;
```

**为什么：** 原来存了完整 URL（`http://localhost:3000/uploads/xxx.mp3`），数据库导到生产环境后音频无法播放。返回 `/uploads/xxx.mp3` 相对路径，前端会自动拼接当前域名，换域名也不受影响。

> ⚠️ **注意：** 改完这个后，你本地的旧数据库里可能已经存了很多带 `localhost:3000` 的完整 URL。如果你重新 dump 导入生产环境，需要再跑一句 SQL 把旧数据清洗掉（或者我帮你跑）。新录制的音频会走相对路径，不会有这个问题。

---

## 二、前端修复（可选，build 时才报错）

### 7. `frontend/src/pages/admin/AdminDashboard.tsx:2`

**删掉未使用的导入：**
```typescript
// 原来：
import { Database, Shield, Search, ... } from 'lucide-react';
// 改为：
import { Search, ... } from 'lucide-react';
```

### 8. `frontend/src/pages/sales/PracticeSessionPage.tsx`

**删掉未使用的导入：**
```typescript
// 第 1 行：去掉 useCallback
import { useState, useRef, useEffect } from 'react';

// 第 3 行：去掉 Loader2
import { ArrowLeft, Send, AlertCircle } from 'lucide-react';
```

---

## 三、改完后的操作

本地改完后，同步到服务器，然后告诉我一声，我跑：

```bash
cd /www/wwwroot/ai-sales-coach/frontend && npm run build
cd /www/wwwroot/ai-sales-coach/backend && npm run build && pm2 restart ai-sales-coach-api
```

搞定。
