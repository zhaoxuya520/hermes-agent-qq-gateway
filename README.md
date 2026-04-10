# hermes-agent-qq-gateway

一个独立的 Node.js 网关，把 QQ 官方 Bot API 接到 Hermes Agent 的 OpenAI 兼容 API Server 上。

当前这版的目标是稳定接入，而不是一次把所有媒体能力做满。

## 当前支持

- QQ C2C 私聊
- QQ 群聊 `@机器人`
- QQ 频道 `@机器人`
- QQ 频道私信
- Hermes 回复中的 Markdown 图片和独立图片 URL 自动转 QQ 图片消息
- 自动重连
- 消息去重
- 按会话串行调用 Hermes，避免上下文乱序
- 使用 Hermes `/v1/responses` 的 `conversation` 模式保留上下文

## 当前限制

- 入站附件会作为文本摘要附加给 Hermes，而不是自动下载成可直接分析的本地文件
- 出站图片目前优先支持 `C2C` 和 `群聊`，频道与频道私信暂时退化为发送链接
- 出站语音、文件、视频暂未实现

## 依赖

- Node.js 20+
- 一个已创建好的 QQ 官方机器人
- 一个已启动的 Hermes API Server

## Hermes 侧准备

根据 Hermes 官方文档，先启用 API Server：

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
hermes gateway
```

默认服务地址是 `http://127.0.0.1:8642/v1`。

## 环境变量

复制 `.env.example` 后按需填写：

```bash
QQBOT_APP_ID=your_app_id
QQBOT_CLIENT_SECRET=your_client_secret

HERMES_BASE_URL=http://127.0.0.1:8642/v1
HERMES_API_KEY=change-me-local-dev
HERMES_MODEL=hermes-agent
```

常用可选项：

- `QQBOT_ENABLE_C2C=true`
- `QQBOT_ENABLE_GROUP_AT=true`
- `QQBOT_ENABLE_GUILD_AT=true`
- `QQBOT_ENABLE_GUILD_DM=true`
- `QQBOT_TEXT_CHUNK_LIMIT=4500`
- `HERMES_CONVERSATION_PREFIX=qqbot`
- `HERMES_SYSTEM_PROMPT=...`
- `LOG_LEVEL=info`

## 本地运行

```bash
npm install
npm run build
node --env-file=.env dist/index.js
```

开发模式：

```bash
npm run dev
```

## 回复图片的约定

如果 Hermes 输出里包含下面任一种内容，网关会尝试发 QQ 图片消息：

```md
![cat](https://example.com/cat.png)
```

或单独一行图片 URL：

```text
https://example.com/cat.png
```

也支持 `data:image/...;base64,...` 形式。

## 服务器部署

### Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

### PM2

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
```

## 发布到 npm 前建议

- 把 `package.json` 里的 `name` 改成你自己的包名或 scope
- 选择正式 license
- 补上 README 里的部署拓扑和媒体能力说明
- 如果你准备支持图片/语音，建议下一步补：
  - 入站图片下载与缓存
  - 语音上传与转码
  - 文件和视频消息

## 大致架构

```text
QQ Official Bot Gateway
  -> WebSocket events
  -> normalize message
  -> Hermes /v1/responses
  -> send QQ reply
```
