import { splitText, stripQQMentions } from "../utils/text.js";
import type {
  C2CMessageEvent,
  GroupAtMessageEvent,
  GuildAtMessageEvent,
  GuildDirectMessageEvent,
  NormalizedInboundMessage,
} from "./types.js";

export interface NormalizeOptions {
  accountId: string;
  conversationPrefix: string;
}

export function buildConversationId(
  prefix: string,
  accountId: string,
  kind: "c2c" | "group" | "guild" | "dm",
  id: string,
): string {
  return `${prefix}:${accountId}:${kind}:${id}`;
}

export function normalizeC2CEvent(
  event: C2CMessageEvent,
  options: NormalizeOptions,
): NormalizedInboundMessage | null {
  const text = stripQQMentions(event.content);
  if (!text && (!event.attachments || event.attachments.length === 0)) {
    return null;
  }
  return {
    accountId: options.accountId,
    kind: "c2c",
    conversationId: buildConversationId(
      options.conversationPrefix,
      options.accountId,
      "c2c",
      event.author.user_openid,
    ),
    messageId: event.id,
    senderId: event.author.user_openid,
    text,
    rawText: event.content,
    attachments: event.attachments,
    target: {
      kind: "c2c",
      openid: event.author.user_openid,
      replyToMessageId: event.id,
    },
  };
}

export function normalizeGroupEvent(
  event: GroupAtMessageEvent,
  options: NormalizeOptions,
): NormalizedInboundMessage | null {
  const text = stripQQMentions(event.content);
  if (!text && (!event.attachments || event.attachments.length === 0)) {
    return null;
  }
  return {
    accountId: options.accountId,
    kind: "group",
    conversationId: buildConversationId(
      options.conversationPrefix,
      options.accountId,
      "group",
      event.group_openid,
    ),
    messageId: event.id,
    senderId: event.author.member_openid,
    text,
    rawText: event.content,
    attachments: event.attachments,
    target: {
      kind: "group",
      groupOpenid: event.group_openid,
      replyToMessageId: event.id,
    },
  };
}

export function normalizeGuildAtEvent(
  event: GuildAtMessageEvent,
  options: NormalizeOptions,
): NormalizedInboundMessage | null {
  const text = stripQQMentions(event.content);
  if (!text && (!event.attachments || event.attachments.length === 0)) {
    return null;
  }
  return {
    accountId: options.accountId,
    kind: "guild",
    conversationId: buildConversationId(
      options.conversationPrefix,
      options.accountId,
      "guild",
      event.channel_id,
    ),
    messageId: event.id,
    senderId: event.author.id,
    senderName: event.author.username,
    text,
    rawText: event.content,
    attachments: event.attachments,
    target: {
      kind: "guild",
      channelId: event.channel_id,
      replyToMessageId: event.id,
    },
  };
}

export function normalizeGuildDmEvent(
  event: GuildDirectMessageEvent,
  options: NormalizeOptions,
): NormalizedInboundMessage | null {
  const text = stripQQMentions(event.content);
  if (!text && (!event.attachments || event.attachments.length === 0)) {
    return null;
  }
  return {
    accountId: options.accountId,
    kind: "dm",
    conversationId: buildConversationId(
      options.conversationPrefix,
      options.accountId,
      "dm",
      event.guild_id,
    ),
    messageId: event.id,
    senderId: event.author.id,
    senderName: event.author.username,
    text,
    rawText: event.content,
    attachments: event.attachments,
    target: {
      kind: "dm",
      guildId: event.guild_id,
      replyToMessageId: event.id,
    },
  };
}

export function splitOutgoingText(text: string, limit: number): string[] {
  return splitText(text, limit);
}
