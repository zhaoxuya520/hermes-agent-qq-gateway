# hermes-agent-qq-gateway

A standalone Node.js gateway that connects QQ Official Bot to Hermes Agent through the Hermes OpenAI-compatible API server.

## What it does

- Receives QQ Official Bot events over the QQ gateway websocket
- Supports C2C, group @mentions, guild @mentions, and guild direct messages
- Sends the message into Hermes through `/v1/responses`
- Preserves conversation context with Hermes `conversation`
- Replies back to QQ with text and supported media

## Current feature set

- Multi-account support
- Session resume persistence across restarts
- Known-user persistence
- Built-in commands
- Proactive send CLI
- Attachment download and local cache for inbound files
- Outbound image, voice, video, and file tags for QQ C2C and group chats
- Docker and PM2 deployment files

## Built-in commands

- `/bot-help`
- `/bot-ping`
- `/bot-version`
- `/bot-status`
- `/bot-users [c2c|group|guild|dm]`
- `/bot-send <c2c|group> <target> <message>`
- `/bot-broadcast <c2c|group> <message>`

## Hermes output conventions

Use these formats when you want Hermes to send media:

```md
![image alt](https://example.com/cat.png)
[qq:voice](https://example.com/voice.mp3)
[qq:video](https://example.com/demo.mp4)
[qq:file report.pdf](https://example.com/report.pdf)
```

Standalone image URLs on their own line also become QQ image messages.

## Inbound attachments

When QQ attachments are present, the gateway can download them into the local data directory and append a prompt section like:

```text
[QQ attachments]
- photo.png | image/png | https://...
  local_path: /path/to/file
```

This gives Hermes a stable local path it can refer to in tool-enabled workflows.

## Quick start

### 1. Enable the Hermes API server

Example:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
hermes gateway
```

### 2. Configure the gateway

Copy the example file and edit it:

```bash
cp .env.example .env
```

Single-account mode:

```bash
QQBOT_APP_ID=your_app_id
QQBOT_CLIENT_SECRET=your_client_secret
HERMES_API_KEY=change-me-local-dev
```

Multi-account mode:

```bash
QQBOT_ACCOUNTS_JSON=[{"id":"default","name":"Default","appId":"111","clientSecret":"secret-1"},{"id":"ops","name":"Ops","appId":"222","clientSecret":"secret-2","allowFrom":["openid_a","openid_b"]}]
```

### 3. Run it

```bash
npm install
npm run build
node --env-file=.env dist/index.js serve
```

Development mode:

```bash
npm run dev
```

## CLI commands

Start the bridge:

```bash
node --env-file=.env dist/index.js serve
```

Send a proactive message:

```bash
node --env-file=.env dist/index.js send --account default --type c2c --to OPENID --message "hello from gateway"
```

List known users:

```bash
node --env-file=.env dist/index.js known-users --account default
```

## Environment variables

Core variables:

- `QQBOT_APP_ID`
- `QQBOT_CLIENT_SECRET`
- `QQBOT_ACCOUNTS_JSON`
- `HERMES_BASE_URL`
- `HERMES_API_KEY`
- `HERMES_MODEL`
- `HERMES_CONVERSATION_PREFIX`

Runtime and storage:

- `QQBOT_TEXT_CHUNK_LIMIT`
- `QQBOT_DEDUPE_TTL_MS`
- `QQBOT_REQUEST_TIMEOUT_MS`
- `QQBOT_DATA_DIR`
- `QQBOT_DOWNLOAD_ATTACHMENTS`
- `QQBOT_MAX_DOWNLOAD_BYTES`
- `QQBOT_ALLOW_FROM`
- `LOG_LEVEL`

## Deployment

### Docker Compose

```bash
docker compose up -d --build
```

### PM2

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
```

## Notes

- QQ proactive delivery may still be limited by QQ platform policy if the target has not interacted recently.
- Rich media delivery is best on C2C and group chats. Guild channels and guild DMs fall back to plain URLs for unsupported media.
- Attachment downloads are capped by `QQBOT_MAX_DOWNLOAD_BYTES`.
- Attachment-heavy requests can run longer than plain text. The default `QQBOT_REQUEST_TIMEOUT_MS` is `300000`.

## Verification

This repository is verified with:

```bash
npm run typecheck
npm test
npm run build
```
