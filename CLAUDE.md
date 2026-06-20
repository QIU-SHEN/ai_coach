# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

**后端**（Node 20+，在 `backend/` 目录下执行）：
```bash
npm run dev          # 启动开发服务器（tsx watch，端口 3000）
npm run build        # TypeScript 编译（tsc）
npm run lint         # ESLint 检查
npm run db:migrate   # 运行数据库迁移脚本
```

**前端**（在 `frontend/` 目录下执行）：
```bash
npm run dev          # Vite 开发服务器（端口 5173/5174）
npm run build        # TypeScript + Vite 构建
npm run lint         # ESLint 检查
```

## 环境变量（`backend/.env`）

关键变量：
- `JWT_SECRET` — 启动时必须设置，缺失直接抛错
- `OPENAI_API_KEY` / `OPENAI_BASE_URL`（默认 `https://yunwu.ai`）/ `OPENAI_MODEL`（默认 `gpt-5.4`）
- `DB_HOST` / `DB_USER` / `DB_PASS` / `DB_NAME` — MySQL 连接
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` / `SMTP_FROM` — 邮件（密码重置）
- `ASR_ENGINE` / `ASR_APP_KEY` / `ASR_ACCESS_KEY_ID` / `ASR_ACCESS_KEY_SECRET` — 阿里云 ASR
- `MOCK_ASR=true` — 本地开发时跳过真实 ASR 调用
- OSS 存储：`STORAGE_ENDPOINT` / `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_BUCKET` 等

## 架构概览

AI 销售教练 — 面向销售人员的 AI 培训平台，包含练习评估、对话模拟、知识管理等功能。

**技术栈**：Express 4 + TypeScript (CommonJS, ES2022) / React 19 + TypeScript (ESM) + Vite 8 / MySQL (mysql2/promise) / Tailwind CSS 4 / Zustand / React Router v7

### 三种角色

- **employee**（销售）— 练习、复盘、学习、测验、对话模拟、销售能力诊断
- **manager**（管理者）— 团队管理、报表查看、知识库/资产管理
- **admin**（管理员）— 用户管理、系统配置，以及 manager 的所有功能

### 后端路由（全部挂载在 `/api/v1/` 下）

| 前缀 | 文件 | 用途 |
|------|------|------|
| `/api/v1/auth` | `routes/auth.ts` | 登录、注册、密码重置、个人资料 |
| `/api/v1/debriefs` | `routes/debriefs.ts` | 复盘记录、对话轮次、评估、培训计划、模拟对话 |
| `/api/v1/knowledge` | `routes/knowledge.ts` | 产品线、知识条目、话术、培训资料、产品资产 |
| `/api/v1/training` | `routes/training-units.ts` | 培训单元 |
| `/api/v1/settings` | `routes/settings.ts` | 应用设置 |
| `/api/v1/quizzes` | `routes/quizzes.ts` | 测验题目和答题记录 |

### 核心后端服务

**AI 层（两个独立封装）**：
- `openai-chat.ts` — `callOpenAIChat(prompt, systemMessage)` — 标准 Chat Completions API，绝大多数服务使用此函数
- `openai.ts` — `callOpenAIResponses(instructions, input)` — 新 Responses API（yunwu.ai/gpt-5.4）；同文件还导出 `extractJson<T>(text)` 用于从 AI 响应中解析 JSON

**AI 功能服务**（均调用 `callOpenAIChat`）：
- `ai-extract-texts.ts` — 从产品图片资产中提取文字，写入 `product_asset_texts` 表
- `ai-summarize.ts` — 产品资料摘要生成
- `ai-generate-description.ts` — `generateProductDescription()` — 基于提取文字生成产品介绍，更新 `product_lines.description`
- `ai-classify.ts` — 知识条目/资产 AI 分类
- `ai-parse-training.ts` — 培训材料 AI 解析
- `pre-analysis.ts` — `runPreAnalysis()` — 基于转录文本对销售能力六维度打分，生成对话策略（供对话训练使用）

**核心业务服务**：
- `debrief-analysis.ts` — AI 复盘分析、后台打分流水线（`runBackgroundAnalysis`）
- `scoring.ts` — `scoreSalesReply`（AI 打分）+ `calculatePersuasionScore`（启发式关键词打分）
- `prompts.ts` — AI prompt 模板（培训计划生成、客户模拟对话）
- `dialogue.ts` — 客户模拟对话逻辑
- `evaluation.ts` — 练习综合评估（`evaluatePractice`）
- `asr.ts` — 语音识别（阿里云 / Whisper）
- `fluency-score.ts` — 基于转录片段的流畅度评分
- `audio.ts` — 音频处理
- `storage.ts` / `oss.ts` — 文件上传和 OSS 存储
- `notify.ts` — 报表通知发送
- `mail.ts` — 密码重置邮件（nodemailer）
- `logger.ts` — 基于 pino 的结构化日志封装

### 前端路由（React Router v7，`App.tsx`）

认证页面：`/login`、`/forgot-password`、`/reset-password`

角色保护路由组：
- `/employee/**` — EmployeeLayout 布局
  - `/employee/home` — 首页
  - `/employee/learning/**` — 学习中心（产品概览、图片、文档、测验、材料预览）
  - `/employee/debrief/**` — 复盘中心（列表、新建、详情报告）
  - `/employee/diagnosis/**` — 销售能力诊断（DiagnosisLayout 子路由）
    - `assessment` — 能力测评
    - `training-plan` — 培训计划
    - `simulation` / `simulation/:recordId/chat` — 模拟对话
    - `debrief` — 诊断复盘
- `/manager/**` — ManagerLayout 布局（admin 也可访问）
  - `team` / `team/:id` — 团队列表/详情
  - `knowledge` / `assets/**` — 知识库和产品资产管理
- `/admin/**` — AdminLayout 布局
  - `users` / `config` — 用户管理和系统配置
  - 同 manager 的所有路由

根路径根据角色自动跳转：employee → `/employee/home`，manager → `/manager/team`，admin → `/admin/users`。

### 前端 API 调用模式

所有 API 调用使用 `api/auth.ts` 中的 `authHeaders()` 附加 `Bearer <token>`（token 存储在 localStorage）。基础 URL：`import.meta.env.VITE_API_BASE || 'http://localhost:3000'`。

响应格式：`{ code: number, message?: string, data?: T }`（code 为 `0` 表示成功）。

前端 API 模块：`api/auth.ts`、`api/debrief.ts`、`api/knowledge.ts`、`api/quiz.ts`、`api/settings.ts`。

前端全局状态通过 Zustand 管理，入口：`store/useAppStore.ts`（认证状态、用户信息、`restoreSession()`）。

### 数据库（MariaDB/MySQL）

连接池在 `db/index.ts` 中配置，字符集 `utf8mb4`。`initDb()` 幂等地创建 18 张表，并初始化 mock 用户（`zhangsan`/employee、`lisi`/manager、`wangwu`/admin，密码均为 `123456`）和 21 个产品线。

核心表：`users`、`debrief_records`、`debrief_practice_meta`、`dialogue_rounds`、`product_lines`、`product_knowledge`、`sales_scripts`、`training_materials`、`product_assets`、`product_asset_texts`、`product_quizzes`、`quiz_attempts`、`settings`。

`db/index.ts` 导出 `parseJsonRows()`，自动解析 MariaDB longtext 列中的 JSON 字符串。`db/query.ts` 导出纯 `query()` 辅助函数。`services/debrief-analysis.ts` 导出 `parseJsonField()` 用于单字段 JSON 解析。

### 认证与错误处理

JWT 认证通过 `middleware/auth.ts`，从请求头提取 Bearer token，使用 `JWT_SECRET` 环境变量验证（启动时未设置会直接抛错）。`AuthRequest` 扩展 Express `Request`，增加 `user: { userId, username, role }`。

`middleware/permission.ts` 提供三个权限辅助：
- `requireRole(...roles)` — 限制路由只有指定角色可访问
- `requireOwnerOrRole(userIdField, allowedRoles)` — 本人或指定角色可访问（用于复盘记录等属主资源）
- `getQueryUserId(req)` — 根据角色自动过滤查询范围（employee 只看自己，admin 可全局过滤，manager 返回 `'__MANAGER_SUBORDINATES__'`）

`middleware/error-handler.ts` 捕获 `AppError` 实例并返回结构化响应。`express-async-errors` 自动处理 async handler 的异常。`constants/errors.ts` 定义 `AppError` 类及标准错误码。

### 共享类型（`types/index.ts`）

关键类型：`ApiResponse<T>`、`UploadResponse`、`StatusResponse`、`TranscriptSegment`、`AsrResult`、`PracticeRecord`、`DebriefMode`（`'post_meeting' | 'call_recording' | 'simulation'`）。

### 关键模式

- 路由处理函数直接使用 `pool.execute()` 或通过 `db/query.ts` 中的 `query()` 辅助函数
- AI 调用通过 `services/openai-chat.ts` 的 `callOpenAIChat(prompt, systemMessage)` 统一发起（少数场景用 `openai.ts` 的 `callOpenAIResponses`）
- 文件上传使用 multer，临时目录 `uploads/tmp/`，通过 `saveUpload()` 转移
- `/uploads` 静态文件设置了明确 MIME 类型和 CORS 头
- 后台分析流水线：打分 → 评估 → 提取薄弱点 → 生成培训计划 → 保存 → 通知
