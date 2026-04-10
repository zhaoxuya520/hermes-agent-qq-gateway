export type LogLevel = "debug" | "info" | "warn" | "error";

export interface GatewayConfig {
  hermes: {
    baseUrl: string;
    apiKey: string;
    model: string;
    systemPrompt?: string;
    conversationPrefix: string;
    requestTimeoutMs: number;
  };
  qq: {
    appId: string;
    clientSecret: string;
    apiBase: string;
    tokenUrl: string;
    textChunkLimit: number;
    enableC2C: boolean;
    enableGroupAt: boolean;
    enableGuildAt: boolean;
    enableGuildDm: boolean;
    dedupeTtlMs: number;
  };
  runtime: {
    logLevel: LogLevel;
  };
}

function readRequired(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readOptional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  throw new Error(`Invalid boolean for ${key}: ${env[key]}`);
}

function readNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum = 1,
): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`Invalid number for ${key}: ${env[key]}`);
  }
  return value;
}

function normalizeHermesBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  if (!raw) {
    return "info";
  }
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  throw new Error(`Invalid LOG_LEVEL: ${env.LOG_LEVEL}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    hermes: {
      baseUrl: normalizeHermesBaseUrl(
        env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:8642/v1",
      ),
      apiKey: readRequired(env, "HERMES_API_KEY"),
      model: env.HERMES_MODEL?.trim() || "hermes-agent",
      systemPrompt: readOptional(env, "HERMES_SYSTEM_PROMPT"),
      conversationPrefix: env.HERMES_CONVERSATION_PREFIX?.trim() || "qqbot",
      requestTimeoutMs: readNumber(env, "QQBOT_REQUEST_TIMEOUT_MS", 120_000, 1_000),
    },
    qq: {
      appId: readRequired(env, "QQBOT_APP_ID"),
      clientSecret: readRequired(env, "QQBOT_CLIENT_SECRET"),
      apiBase: env.QQBOT_API_BASE?.trim() || "https://api.sgroup.qq.com",
      tokenUrl: env.QQBOT_TOKEN_URL?.trim() || "https://bots.qq.com/app/getAppAccessToken",
      textChunkLimit: readNumber(env, "QQBOT_TEXT_CHUNK_LIMIT", 4_500, 100),
      enableC2C: readBoolean(env, "QQBOT_ENABLE_C2C", true),
      enableGroupAt: readBoolean(env, "QQBOT_ENABLE_GROUP_AT", true),
      enableGuildAt: readBoolean(env, "QQBOT_ENABLE_GUILD_AT", true),
      enableGuildDm: readBoolean(env, "QQBOT_ENABLE_GUILD_DM", true),
      dedupeTtlMs: readNumber(env, "QQBOT_DEDUPE_TTL_MS", 600_000, 1_000),
    },
    runtime: {
      logLevel: readLogLevel(env),
    },
  };
}
