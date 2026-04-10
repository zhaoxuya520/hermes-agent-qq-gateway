export interface QQTokenResponse {
  access_token?: string;
  expires_in?: number;
}

export interface QQGatewayInfo {
  url: string;
}

export interface QQMessageResponse {
  id: string;
  timestamp: string | number;
}

export interface QQMessageAttachment {
  content_type: string;
  filename?: string;
  size?: number;
  url: string;
  asr_refer_text?: string;
}

export interface QQDispatchEnvelope<T> {
  op: number;
  d?: T;
  s?: number;
  t?: string;
}

export interface QQHelloPayload {
  heartbeat_interval: number;
}

export interface QQReadyPayload {
  session_id: string;
}

export interface C2CMessageEvent {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    union_openid: string;
    user_openid: string;
  };
  attachments?: QQMessageAttachment[];
}

export interface GroupAtMessageEvent {
  id: string;
  content: string;
  timestamp: string;
  group_openid: string;
  author: {
    id: string;
    member_openid: string;
  };
  attachments?: QQMessageAttachment[];
}

export interface GuildAtMessageEvent {
  id: string;
  content: string;
  timestamp: string;
  channel_id: string;
  guild_id: string;
  author: {
    id: string;
    username?: string;
    bot?: boolean;
  };
  attachments?: QQMessageAttachment[];
}

export type GuildDirectMessageEvent = GuildAtMessageEvent;

export type QQTarget =
  | {
      kind: "c2c";
      openid: string;
      replyToMessageId: string;
    }
  | {
      kind: "group";
      groupOpenid: string;
      replyToMessageId: string;
    }
  | {
      kind: "guild";
      channelId: string;
      replyToMessageId: string;
    }
  | {
      kind: "dm";
      guildId: string;
      replyToMessageId: string;
    };

export interface NormalizedInboundMessage {
  kind: QQTarget["kind"];
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  text: string;
  target: QQTarget;
  rawText: string;
}
