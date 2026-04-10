import type { GatewayConfig } from "../config.js";
import type { Logger } from "../utils/logger.js";
import { parseOutgoingReply } from "./outbound.js";
import { splitOutgoingText } from "./transform.js";
import type {
  QQGatewayInfo,
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
}

interface UploadMediaResponse {
  file_uuid: string;
  file_info: string;
  ttl: number;
}

export class QQApiClient {
  private tokenCache?: TokenCache;

  constructor(
    private readonly config: GatewayConfig["qq"],
    private readonly logger: Logger,
  ) {}

  async getGatewayUrl(): Promise<string> {
    const accessToken = await this.getAccessToken();
    const response = await this.request<QQGatewayInfo>(accessToken, "GET", "/gateway");
    return response.url;
  }

  async sendReply(target: QQTarget, text: string): Promise<void> {
    const supportsImage = target.kind === "c2c" || target.kind === "group";
    const parsed = supportsImage ? parseOutgoingReply(text) : { text, imageUrls: [] };

    const chunks = splitOutgoingText(parsed.text, this.config.textChunkLimit);
    for (const chunk of chunks) {
      await this.sendTextChunk(target, chunk);
    }

    for (const imageUrl of parsed.imageUrls) {
      await this.sendImage(target, imageUrl);
    }
  }

  async sendTyping(target: QQTarget): Promise<void> {
    if (target.kind !== "c2c") {
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

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        appId: this.config.appId,
        clientSecret: this.config.clientSecret,
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

  private async sendImage(
    target: QQTarget,
    imageUrl: string,
  ): Promise<QQMessageResponse | void> {
    const accessToken = await this.getAccessToken();
    switch (target.kind) {
      case "c2c": {
        const upload = await this.uploadC2CMedia(accessToken, target.openid, imageUrl);
        return this.request(accessToken, "POST", `/v2/users/${target.openid}/messages`, {
          msg_type: 7,
          media: { file_info: upload.file_info },
          msg_id: target.replyToMessageId,
          msg_seq: this.nextSequence(),
        });
      }
      case "group": {
        const upload = await this.uploadGroupMedia(accessToken, target.groupOpenid, imageUrl);
        return this.request(accessToken, "POST", `/v2/groups/${target.groupOpenid}/messages`, {
          msg_type: 7,
          media: { file_info: upload.file_info },
          msg_id: target.replyToMessageId,
          msg_seq: this.nextSequence(),
        });
      }
      case "guild":
      case "dm":
        return this.sendTextChunk(target, imageUrl);
    }
  }

  private async sendTextChunk(target: QQTarget, text: string): Promise<QQMessageResponse> {
    const accessToken = await this.getAccessToken();

    switch (target.kind) {
      case "c2c":
        return this.request(accessToken, "POST", `/v2/users/${target.openid}/messages`, {
          content: text,
          msg_type: 0,
          msg_id: target.replyToMessageId,
          msg_seq: this.nextSequence(),
        });
      case "group":
        return this.request(accessToken, "POST", `/v2/groups/${target.groupOpenid}/messages`, {
          content: text,
          msg_type: 0,
          msg_id: target.replyToMessageId,
          msg_seq: this.nextSequence(),
        });
      case "guild":
        return this.request(accessToken, "POST", `/channels/${target.channelId}/messages`, {
          content: text,
          msg_id: target.replyToMessageId,
        });
      case "dm":
        return this.request(accessToken, "POST", `/dms/${target.guildId}/messages`, {
          content: text,
          msg_id: target.replyToMessageId,
        });
    }
  }

  private async uploadC2CMedia(
    accessToken: string,
    openid: string,
    imageUrl: string,
  ): Promise<UploadMediaResponse> {
    return this.uploadMedia(accessToken, `/v2/users/${openid}/files`, imageUrl);
  }

  private async uploadGroupMedia(
    accessToken: string,
    groupOpenid: string,
    imageUrl: string,
  ): Promise<UploadMediaResponse> {
    return this.uploadMedia(accessToken, `/v2/groups/${groupOpenid}/files`, imageUrl);
  }

  private async uploadMedia(
    accessToken: string,
    path: string,
    imageUrl: string,
  ): Promise<UploadMediaResponse> {
    if (imageUrl.startsWith("data:")) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        throw new Error("Invalid base64 image data URL");
      }
      return this.request(accessToken, "POST", path, {
        file_type: MediaFileType.IMAGE,
        file_data: match[2],
        srv_send_msg: false,
      });
    }

    return this.request(accessToken, "POST", path, {
      file_type: MediaFileType.IMAGE,
      url: imageUrl,
      srv_send_msg: false,
    });
  }

  private async request<T>(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.apiBase}${path}`;
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
      throw new Error(`QQ API ${response.status} ${path}: ${raw}`);
    }
    return JSON.parse(raw) as T;
  }

  private nextSequence(): number {
    return Math.floor(Math.random() * 65_535);
  }
}
