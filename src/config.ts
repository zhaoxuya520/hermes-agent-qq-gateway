import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface QQAccountConfig {
  id: string;
  name: string;
  appId: string;
  clientSecret: string;
  enableC2C: boolean;
  enableGroupAt: boolean;
  enableGuildAt: boolean;
  enableGuildDm: boolean;
  allowFrom: string[];
}

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
    apiBase: string;
    tokenUrl: string;
    textChunkLimit: number;
    dedupeTtlMs: number;
    dataDir: string;
    downloadAttachments: boolean;
    maxDownloadBytes: number;
    accounts: QQAccountConfig[];
  };
  runtime: {
    logLevel: LogLevel;
  };
}

interface RawAccountInput {
  id?: unknown;
  name?: unknown;
  appId?: unknown;
  clientSecret?: unknown;
  enableC2C?: unknown;
  enableGroupAt?: unknown;
  enableGuildAt?: unknown;
  enableGuildDm?: unknown;
  allowFrom?: unknown;
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

function readBooleanValue(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${raw}`);
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  return readBooleanValue(env[key], fallback);
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

function normalizeStringList(raw: unknown, fallback: string[]): string[] {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  if (Array.isArray(raw)) {
    const values = raw
      .map((value) => String(value).trim())
      .filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
  const values = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function normalizeAccount(
  account: RawAccountInput,
  defaults: Omit<QQAccountConfig, "id" | "name" | "appId" | "clientSecret">,
  index: number,
): QQAccountConfig {
  const appId = String(account.appId ?? "").trim();
  const clientSecret = String(account.clientSecret ?? "").trim();
  if (!appId || !clientSecret) {
    throw new Error(`QQBOT_ACCOUNTS_JSON account ${index} is missing appId or clientSecret`);
  }

  return {
    id: String(account.id ?? `account-${index + 1}`).trim() || `account-${index + 1}`,
    name: String(account.name ?? account.id ?? `Account ${index + 1}`).trim() || `Account ${index + 1}`,
    appId,
    clientSecret,
    enableC2C: readBooleanValue(account.enableC2C, defaults.enableC2C),
    enableGroupAt: readBooleanValue(account.enableGroupAt, defaults.enableGroupAt),
    enableGuildAt: readBooleanValue(account.enableGuildAt, defaults.enableGuildAt),
    enableGuildDm: readBooleanValue(account.enableGuildDm, defaults.enableGuildDm),
    allowFrom: normalizeStringList(account.allowFrom, defaults.allowFrom),
  };
}

function loadAccounts(
  env: NodeJS.ProcessEnv,
  defaults: Omit<QQAccountConfig, "id" | "name" | "appId" | "clientSecret">,
): QQAccountConfig[] {
  const rawAccounts = env.QQBOT_ACCOUNTS_JSON?.trim();
  if (rawAccounts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawAccounts);
    } catch (error) {
      throw new Error(`Failed to parse QQBOT_ACCOUNTS_JSON: ${String(error)}`);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("QQBOT_ACCOUNTS_JSON must be a non-empty JSON array");
    }

    return parsed.map((account, index) =>
      normalizeAccount((account ?? {}) as RawAccountInput, defaults, index),
    );
  }

  return [
    {
      id: env.QQBOT_DEFAULT_ACCOUNT_ID?.trim() || "default",
      name: env.QQBOT_DEFAULT_ACCOUNT_NAME?.trim() || "Default",
      appId: readRequired(env, "QQBOT_APP_ID"),
      clientSecret: readRequired(env, "QQBOT_CLIENT_SECRET"),
      ...defaults,
    },
  ];
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options?: { requireHermesApiKey?: boolean },
): GatewayConfig {
  const requireHermesApiKey = options?.requireHermesApiKey ?? true;
  const defaultAccountFlags = {
    enableC2C: readBoolean(env, "QQBOT_ENABLE_C2C", true),
    enableGroupAt: readBoolean(env, "QQBOT_ENABLE_GROUP_AT", true),
    enableGuildAt: readBoolean(env, "QQBOT_ENABLE_GUILD_AT", true),
    enableGuildDm: readBoolean(env, "QQBOT_ENABLE_GUILD_DM", true),
    allowFrom: normalizeStringList(env.QQBOT_ALLOW_FROM, ["*"]),
  };

  return {
    hermes: {
      baseUrl: normalizeHermesBaseUrl(
        env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:8642/v1",
      ),
      apiKey: requireHermesApiKey ? readRequired(env, "HERMES_API_KEY") : env.HERMES_API_KEY?.trim() || "",
      model: env.HERMES_MODEL?.trim() || "hermes-agent",
      systemPrompt: readOptional(env, "HERMES_SYSTEM_PROMPT"),
      conversationPrefix: env.HERMES_CONVERSATION_PREFIX?.trim() || "qqbot",
      requestTimeoutMs: readNumber(env, "QQBOT_REQUEST_TIMEOUT_MS", 120_000, 1_000),
    },
    qq: {
      apiBase: env.QQBOT_API_BASE?.trim() || "https://api.sgroup.qq.com",
      tokenUrl: env.QQBOT_TOKEN_URL?.trim() || "https://bots.qq.com/app/getAppAccessToken",
      textChunkLimit: readNumber(env, "QQBOT_TEXT_CHUNK_LIMIT", 4_500, 100),
      dedupeTtlMs: readNumber(env, "QQBOT_DEDUPE_TTL_MS", 600_000, 1_000),
      dataDir: path.resolve(env.QQBOT_DATA_DIR?.trim() || ".data"),
      downloadAttachments: readBoolean(env, "QQBOT_DOWNLOAD_ATTACHMENTS", true),
      maxDownloadBytes: readNumber(env, "QQBOT_MAX_DOWNLOAD_BYTES", 20 * 1024 * 1024, 1_024),
      accounts: loadAccounts(env, defaultAccountFlags),
    },
    runtime: {
      logLevel: readLogLevel(env),
    },
  };
}
