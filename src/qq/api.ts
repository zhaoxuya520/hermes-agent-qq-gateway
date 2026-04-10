import path from "node:path";
import type { GatewayConfig, QQAccountConfig } from "../config.js";
import type { Logger } from "../utils/logger.js";
import { parseOutgoingReply } from "./outbound.js";
import { splitOutgoingText } from "./transform.js";
import type {
  QQGatewayInfo,
  QQMediaItem,
  QQMessageResponse,
  QQTarget,
  QQTokenResponse,
} from "./types.js";

const USER_AGENT = `hermes-agent-qq-gateway/${process.env.npm_package_version ?? "dev"} (Node/${process.versions.node})`;

interface TokenCache {
  token: string;
  expiresAt: number;
}

enum MediaFileType {
  IMAGE = 1,
  VIDEO = 2,
  VOICE = 3,
  FILE = 4,
}

interface UploadMediaResponse {
  file_uuid: string;
  file_info: string;
  ttl: number;
}

function basenameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const name = path.basename(parsed.pathname);
    return name && name !== "/" ? name : undefined;
  } catch {
    return undefined;
  }
}

function buildProactiveTextBody(text: string): Record<string, unknown> {
  return {
    content: text,
    msg_type: 0,
  };
}

export class QQApiClient {
  private tokenCache?: TokenCache;

  constructor(
    private readonly platformConfig: GatewayConfig["qq"],
    readonly account: QQAccountConfig,
    private readonly logger: Logger,
  ) {}

  get accountId(): string {
    return this.account.id;
  }

  async getGatewayUrl(): Promise<string> {
    const accessToken = await this.getAccessToken();
    const response = await this.request<QQGatewayInfo>(accessToken, "GET", "/gateway");
    return response.url;
  }

  async sendReply(target: QQTarget, text: string): Promise<void> {
    const parsed = parseOutgoingReply(text);
    const chunks = splitOutgoingText(parsed.text, this.platformConfig.textChunkLimit);
    for (const chunk of chunks) {
      await this.sendTextChunk(target, chunk);
    }

    for (const media of parsed.media) {
      await this.sendMedia(target, media);
    }
  }

  async sendProactive(kind: "c2c" | "group", to: string, text: string): Promise<void> {
    const parsed = parseOutgoingReply(text);
    const target: QQTarget =
      kind === "c2c"
        ? {
            kind: "c2c",
            openid: to,
          }
        : {
            kind: "group",
            groupOpenid: to,
          };

    const chunks = splitOutgoingText(parsed.text, this.platformConfig.textChunkLimit);
    for (const chunk of chunks) {
      await this.sendTextChunk(target, chunk);
    }

    for (const media of parsed.media) {
      await this.sendMedia(target, media);
    }
  }

  async sendTyping(target: QQTarget): Promise<void> {
    if (target.kind !== "c2c" || !target.replyToMessageId) {
      return;
    }
    const accessToken = await this.getAccessToken();
    await this.request(
      accessToken,
      "POST",
      `/v2/users/${target.openid}/messages`,
      {
        msg_type: 6,
        input_notify: {
          input_type: 1,
          input_second: 60,
        },
        msg_id: target.replyToMessageId,
        msg_seq: this.nextSequence(),
      },
    );
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    const refreshAheadMs = 5 * 60 * 1000;
    if (
      !forceRefresh &&
      this.tokenCache &&
      Date.now() < this.tokenCache.expiresAt - refreshAheadMs
    ) {
      return this.tokenCache.token;
    }

    const response = await fetch(this.platformConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        appId: this.account.appId,
        clientSecret: this.account.clientSecret,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`QQ token API ${response.status}: ${raw}`);
    }

    const parsed = JSON.parse(raw) as QQTokenResponse;
    if (!parsed.access_token) {
      throw new Error(`QQ token API returned no access_token: ${raw}`);
    }

    this.tokenCache = {
      token: parsed.access_token,
      expiresAt: Date.now() + (parsed.expires_in ?? 7200) * 1000,
    };

    return parsed.access_token;
  }

  invalidateToken(): void {
    this.tokenCache = undefined;
  }

  private async sendMedia(target: QQTarget, media: QQMediaItem): Promise<QQMessageResponse | void> {
    if (target.kind === "guild" || target.kind === "dm") {
      return this.sendTextChunk(target, media.url);
    }

    const accessToken = await this.getAccessToken();
    const uploadPath =
      target.kind === "c2c"
        ? `/v2/users/${target.openid}/files`
        : `/v2/groups/${target.groupOpenid}/files`;
    const upload = await this.uploadMedia(accessToken, uploadPath, media);
    const messagePath =
      target.kind === "c2c"
        ? `/v2/users/${target.openid}/messages`
        : `/v2/groups/${target.groupOpenid}/messages`;

    const body: Record<string, unknown> = {
      msg_type: 7,
      media: { file_info: upload.file_info },
    };

    if (target.replyToMessageId) {
      body.msg_id = target.replyToMessageId;
      body.msg_seq = this.nextSequence();
    }

    return this.request(accessToken, "POST", messagePath, body);
  }

  private async sendTextChunk(target: QQTarget, text: string): Promise<QQMessageResponse> {
    const accessToken = await this.getAccessToken();

    switch (target.kind) {
      case "c2c":
        return this.request(accessToken, "POST", `/v2/users/${target.openid}/messages`, {
          ...(target.replyToMessageId
            ? {
                content: text,
                msg_type: 0,
                msg_id: target.replyToMessageId,
                msg_seq: this.nextSequence(),
              }
            : buildProactiveTextBody(text)),
        });
      case "group":
        return this.request(accessToken, "POST", `/v2/groups/${target.groupOpenid}/messages`, {
          ...(target.replyToMessageId
            ? {
                content: text,
                msg_type: 0,
                msg_id: target.replyToMessageId,
                msg_seq: this.nextSequence(),
              }
            : buildProactiveTextBody(text)),
        });
      case "guild":
        return this.request(accessToken, "POST", `/channels/${target.channelId}/messages`, {
          content: text,
          ...(target.replyToMessageId ? { msg_id: target.replyToMessageId } : {}),
        });
      case "dm":
        return this.request(accessToken, "POST", `/dms/${target.guildId}/messages`, {
          content: text,
          ...(target.replyToMessageId ? { msg_id: target.replyToMessageId } : {}),
        });
    }
  }

  private async uploadMedia(
    accessToken: string,
    pathName: string,
    media: QQMediaItem,
  ): Promise<UploadMediaResponse> {
    const body: Record<string, unknown> = {
      file_type: this.mediaFileType(media.type),
      srv_send_msg: false,
    };

    if (media.url.startsWith("data:")) {
      const match = media.url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        throw new Error(`Invalid base64 data URL for ${media.type}`);
      }
      body.file_data = match[2];
    } else {
      body.url = media.url;
    }

    if (media.type === "file") {
      body.file_name = media.fileName ?? basenameFromUrl(media.url) ?? "attachment.bin";
    }

    return this.request(accessToken, "POST", pathName, body);
  }

  private mediaFileType(type: QQMediaItem["type"]): MediaFileType {
    switch (type) {
      case "image":
        return MediaFileType.IMAGE;
      case "voice":
        return MediaFileType.VOICE;
      case "video":
        return MediaFileType.VIDEO;
      case "file":
        return MediaFileType.FILE;
    }
  }

  private async request<T>(
    accessToken: string,
    method: string,
    pathName: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.platformConfig.apiBase}${pathName}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const raw = await response.text();
    if (response.status === 401) {
      this.logger.warn("QQ access token rejected, forcing refresh");
      this.tokenCache = undefined;
    }
    if (!response.ok) {
      throw new Error(`QQ API ${response.status} ${pathName}: ${raw}`);
    }
    return JSON.parse(raw) as T;
  }

  private nextSequence(): number {
    return Math.floor(Math.random() * 65_535);
  }
}
