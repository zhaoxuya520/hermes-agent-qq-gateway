import WebSocket from "ws";
import type { GatewayConfig, QQAccountConfig } from "../config.js";
import { HermesClient } from "../hermes/client.js";
import { JsonStateStore } from "../state/store.js";
import type { Logger } from "../utils/logger.js";
import { ExpiringSet, SerialTaskQueue } from "../utils/queue.js";
import { QQApiClient } from "./api.js";
import { QQAttachmentService } from "./attachments.js";
import { handleBuiltinCommand } from "./commands.js";
import {
  normalizeC2CEvent,
  normalizeGroupEvent,
  normalizeGuildAtEvent,
  normalizeGuildDmEvent,
} from "./transform.js";
import type {
  C2CMessageEvent,
  GroupAtMessageEvent,
  GuildAtMessageEvent,
  GuildDirectMessageEvent,
  NormalizedInboundMessage,
  QQDispatchEnvelope,
  QQHelloPayload,
  QQReadyPayload,
} from "./types.js";

const INTENTS = {
  PUBLIC_GUILD_MESSAGES: 2 ** 30,
  DIRECT_MESSAGE: 2 ** 12,
  GROUP_AND_C2C: 2 ** 25,
};

const FULL_INTENTS =
  INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.DIRECT_MESSAGE | INTENTS.GROUP_AND_C2C;
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
const DEFAULT_ERROR_REPLY = "Hermes could not process that message right now. Please try again soon.";

export class QQGatewayBridge {
  private readonly dedupe: ExpiringSet;
  private readonly queue = new SerialTaskQueue();
  private ws?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private sessionPersistTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private stopped = false;
  private lastSeq: number | null = null;
  private sessionId: string | null = null;
  private accessToken: string | null = null;

  constructor(
    private readonly config: GatewayConfig,
    readonly account: QQAccountConfig,
    private readonly qq: QQApiClient,
    private readonly hermes: HermesClient,
    private readonly state: JsonStateStore,
    private readonly attachments: QQAttachmentService,
    private readonly logger: Logger,
  ) {
    this.dedupe = new ExpiringSet(this.config.qq.dedupeTtlMs);
  }

  async start(): Promise<void> {
    this.stopped = false;
    const persisted = await this.state.loadSession(this.account.id);
    if (persisted) {
      this.sessionId = persisted.sessionId;
      this.lastSeq = persisted.lastSeq;
      this.logger.info(
        `Loaded persisted session for ${this.account.id}: ${this.sessionId ?? "none"}`,
      );
    }
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    if (this.sessionPersistTimer) {
      clearTimeout(this.sessionPersistTimer);
      this.sessionPersistTimer = undefined;
    }
    await this.persistSessionNow();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000, "shutdown");
      this.ws = undefined;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      this.accessToken = await this.qq.getAccessToken();
      const gatewayUrl = await this.qq.getGatewayUrl();
      const ws = new WebSocket(gatewayUrl);
      this.ws = ws;

      ws.on("open", () => {
        this.logger.info(`QQ gateway websocket connected for ${this.account.id}`);
        this.reconnectAttempt = 0;
      });

      ws.on("message", (raw) => {
        void this.handleSocketMessage(raw.toString("utf8"));
      });

      ws.on("close", (code, reason) => {
        this.logger.warn(
          `QQ gateway websocket closed for ${this.account.id} (${code}) ${reason.toString()}`,
        );
        if (code === 4004) {
          this.logger.warn("QQ gateway reported invalid token, refreshing before reconnect");
          this.qq.invalidateToken();
        }
        if (code === 4006 || code === 4007 || code === 4009) {
          this.logger.warn("QQ gateway reported invalid resume state, resetting session");
          void this.resetSessionState();
        }
        this.cleanupSocket();
        if (!this.stopped && code !== 1000) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (error) => {
        this.logger.error(`QQ gateway websocket error for ${this.account.id}`, error);
      });
    } catch (error) {
      this.logger.error(`Failed to connect QQ gateway for ${this.account.id}`, error);
      this.scheduleReconnect();
    }
  }

  private cleanupSocket(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = undefined;
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.stopped) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay =
      delayMs ?? RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.logger.info(`Scheduling QQ gateway reconnect for ${this.account.id} in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private async handleSocketMessage(rawMessage: string): Promise<void> {
    const payload = JSON.parse(rawMessage) as QQDispatchEnvelope<unknown>;
    if (typeof payload.s === "number") {
      this.lastSeq = payload.s;
      this.scheduleSessionPersist();
    }

    switch (payload.op) {
      case 10:
        await this.handleHello(payload.d as QQHelloPayload);
        return;
      case 0:
        await this.handleDispatch(payload.t, payload.d);
        return;
      case 7:
        this.logger.info(`QQ gateway requested reconnect for ${this.account.id}`);
        this.ws?.close(4000, "server_reconnect");
        return;
      case 9:
        this.logger.warn(`QQ gateway session invalid for ${this.account.id}, re-identifying`);
        await this.resetSessionState();
        this.ws?.close(4001, "invalid_session");
        return;
      case 11:
        this.logger.debug(`QQ heartbeat ack for ${this.account.id}`);
        return;
      default:
        this.logger.debug(`QQ gateway op=${payload.op} ignored for ${this.account.id}`);
    }
  }

  private async handleHello(payload: QQHelloPayload): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.accessToken) {
      return;
    }

    if (this.sessionId && this.lastSeq !== null) {
      this.ws.send(
        JSON.stringify({
          op: 6,
          d: {
            token: `QQBot ${this.accessToken}`,
            session_id: this.sessionId,
            seq: this.lastSeq,
          },
        }),
      );
    } else {
      this.ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token: `QQBot ${this.accessToken}`,
            intents: FULL_INTENTS,
            shard: [0, 1],
          },
        }),
      );
    }

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    this.heartbeat = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
      }
    }, payload.heartbeat_interval);
  }

  private async handleDispatch(type: string | undefined, data: unknown): Promise<void> {
    if (!type) {
      return;
    }

    if (type === "READY") {
      const ready = data as QQReadyPayload;
      this.sessionId = ready.session_id;
      this.logger.info(`QQ gateway ready for ${this.account.id} (session ${this.sessionId})`);
      this.scheduleSessionPersist();
      return;
    }

    if (type === "RESUMED") {
      this.logger.info(`QQ gateway session resumed for ${this.account.id}`);
      this.scheduleSessionPersist();
      return;
    }

    let normalized: NormalizedInboundMessage | null = null;

    if (type === "C2C_MESSAGE_CREATE" && this.account.enableC2C) {
      normalized = normalizeC2CEvent(data as C2CMessageEvent, {
        accountId: this.account.id,
        conversationPrefix: this.config.hermes.conversationPrefix,
      });
    } else if (type === "GROUP_AT_MESSAGE_CREATE" && this.account.enableGroupAt) {
      normalized = normalizeGroupEvent(data as GroupAtMessageEvent, {
        accountId: this.account.id,
        conversationPrefix: this.config.hermes.conversationPrefix,
      });
    } else if (type === "AT_MESSAGE_CREATE" && this.account.enableGuildAt) {
      const event = data as GuildAtMessageEvent;
      if (!event.author.bot) {
        normalized = normalizeGuildAtEvent(event, {
          accountId: this.account.id,
          conversationPrefix: this.config.hermes.conversationPrefix,
        });
      }
    } else if (type === "DIRECT_MESSAGE_CREATE" && this.account.enableGuildDm) {
      normalized = normalizeGuildDmEvent(data as GuildDirectMessageEvent, {
        accountId: this.account.id,
        conversationPrefix: this.config.hermes.conversationPrefix,
      });
    }

    if (!normalized) {
      return;
    }

    if (!this.isAllowedSender(normalized.senderId)) {
      this.logger.warn(
        `Ignoring unauthorized sender ${normalized.senderId} for account ${this.account.id}`,
      );
      return;
    }

    if (this.dedupe.has(normalized.messageId)) {
      this.logger.debug(`Skipping duplicate QQ message ${normalized.messageId}`);
      return;
    }
    this.dedupe.add(normalized.messageId);

    await this.state.recordKnownUser({
      accountId: this.account.id,
      kind: normalized.kind,
      senderId: normalized.senderId,
      senderName: normalized.senderName,
      ...(normalized.target.kind === "c2c" ? { openid: normalized.target.openid } : {}),
      ...(normalized.target.kind === "group"
        ? { groupOpenid: normalized.target.groupOpenid }
        : {}),
      ...(normalized.target.kind === "guild"
        ? { channelId: normalized.target.channelId }
        : {}),
      ...(normalized.target.kind === "dm" ? { guildId: normalized.target.guildId } : {}),
      lastSeenAt: new Date().toISOString(),
    });

    void this.queue.run(normalized.conversationId, async () => {
      await this.processMessage(normalized);
    });
  }

  private async processMessage(message: NormalizedInboundMessage): Promise<void> {
    const scoped = this.logger.child(message.conversationId);
    scoped.info(`Inbound ${message.kind} message from ${message.senderId}`);

    try {
      const builtinReply = await handleBuiltinCommand({
        account: this.account,
        message,
        qq: this.qq,
        state: this.state,
        logger: scoped,
        sessionId: this.sessionId,
        lastSeq: this.lastSeq,
      });

      if (builtinReply !== null) {
        await this.qq.sendReply(message.target, builtinReply);
        scoped.info("Built-in command handled locally");
        return;
      }

      if (message.kind === "c2c") {
        try {
          await this.qq.sendTyping(message.target);
        } catch (error) {
          scoped.warn("Failed to send QQ typing indicator", error);
        }
      }

      const attachmentPrompt = await this.attachments.buildAttachmentPrompt(
        this.account.id,
        message.messageId,
        message.attachments,
      );
      const hermesInput = [message.text, attachmentPrompt].filter(Boolean).join("\n\n");

      const reply = await this.hermes.respond(message.conversationId, hermesInput);
      await this.qq.sendReply(message.target, reply.text);
      scoped.info(`Sent Hermes reply${reply.responseId ? ` (${reply.responseId})` : ""}`);
    } catch (error) {
      scoped.error("Failed to process QQ message", error);
      try {
        await this.qq.sendReply(message.target, DEFAULT_ERROR_REPLY);
      } catch (sendError) {
        scoped.error("Failed to send QQ fallback reply", sendError);
      }
    }
  }

  private isAllowedSender(senderId: string): boolean {
    return this.account.allowFrom.includes("*") || this.account.allowFrom.includes(senderId);
  }

  private scheduleSessionPersist(): void {
    if (this.sessionPersistTimer) {
      clearTimeout(this.sessionPersistTimer);
    }
    this.sessionPersistTimer = setTimeout(() => {
      this.sessionPersistTimer = undefined;
      void this.persistSessionNow();
    }, 250);
  }

  private async persistSessionNow(): Promise<void> {
    await this.state.saveSession(this.account.id, this.sessionId, this.lastSeq);
  }

  private async resetSessionState(): Promise<void> {
    this.sessionId = null;
    this.lastSeq = null;
    await this.state.clearSession(this.account.id);
  }
}
