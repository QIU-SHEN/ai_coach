# AI 销售教练 — 后端服务

## 技术栈
- Node.js 20+ + Express 4
- TypeScript 5
- PostgreSQL 15+ (pg driver)
- ffmpeg (音频处理)
- MinIO / 阿里云 OSS (对象存储, MVP 阶段本地文件兜底)

## 快速开始

```bash
cd backend
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 中的 DATABASE_URL 和 ASR 相关配置

# 启动开发服务器
npm run dev
```

## 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/practices/upload` | 上传音频 |
| GET  | `/api/v1/practices/:record_id/status` | 查询 ASR 状态 |
| POST | `/api/v1/practices/:record_id/retry-asr` | 重试 ASR |

## 目录结构

```
src/
  app.ts              # 入口
  routes/
    practices.ts      # 练习相关路由
  services/
    storage.ts        # 文件存储
    audio.ts          # ffmpeg 音频分析
    asr.ts            # ASR 服务适配器
  db/
    index.ts          # PostgreSQL 连接与建表
  types/
    index.ts          # 类型定义
```

## MVP 注意事项

1. `services/asr.ts` 当前为模拟实现，需接入真实的阿里云 NLS SDK。
2. `services/storage.ts` 当前为本地磁盘存储，生产环境应切换为 MinIO / OSS。
3. `processAsr` 为简化版轮询实现，大规模生产建议引入队列（Bull / RabbitMQ）。
