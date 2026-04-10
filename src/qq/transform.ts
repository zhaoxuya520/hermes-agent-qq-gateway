import { splitText, stripQQMentions } from "../utils/text.js";
import type {
  C2CMessageEvent,
  GroupAtMessageEvent,
  GuildAtMessageEvent,
  GuildDirectMessageEvent,
  NormalizedInboundMessage,
  QQMessageAttachment,
} from "./types.js";

export interface NormalizeOptions {
  conversationPrefix: string;
}

function formatAttachments(attachments: QQMessageAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) {
    return "";
  }

  const lines = attachments.map((attachment) => {
    const pieces = [
      attachment.filename ?? "attachment",
      attachment.content_type,
      attachment.url,
    ];
    if (attachment.asr_refer_text) {
      pieces.push(`asr=${attachment.asr_refer_text}`);
    }
    return `- ${pieces.filter(Boolean).join(" | ")}`;
  });

  return `[QQ attachments]\n${lines.join("\n")}`;
}

function combineText(content: string, attachments?: QQMessageAttachment[]): string {
  const sections = [stripQQMentions(content), formatAttachments(attachments)].filter(Boolean);
  return sections.join("\n\n").trim();
}

export function buildConversationId(
  prefix: string,
  kind: "c2c" | "group" | "guild" | "dm",
  id: string,
): string {
  return `${prefix}:${kind}:${id}`;
}

export function normalizeC2CEvent(
  event: C2CMessageEvent,
  options: NormalizeOptions,
): NormalizedInboundMessage | null {
  const text = combineText(event.content, event.attachments);
  if (!text) {
    return null;
  }
  return {
    kind: "c2c",
    conversationId: buildConversationId(options.conversationPrefix, "c2c", event.author.user_openid),
    messageId: event.id,
    senderId: event.author.user_openid,
    text,
    rawText: event.content,
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
  const text = combineText(event.content, event.attachments);
  if (!text) {
    return null;
  }
  return {
    kind: "group",
    conversationId: buildConversationId(options.conversationPrefix, "group", event.group_openid),
    messageId: event.id,
    senderId: event.author.member_openid,
    text,
    rawText: event.content,
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
  const text = combineText(event.content, event.attachments);
  if (!text) {
    return null;
  }
  return {
    kind: "guild",
    conversationId: buildConversationId(options.conversationPrefix, "guild", event.channel_id),
    messageId: event.id,
    senderId: event.author.id,
    senderName: event.author.username,
    text,
    rawText: event.content,
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
  const text = combineText(event.content, event.attachments);
  if (!text) {
    return null;
  }
  return {
    kind: "dm",
    conversationId: buildConversationId(options.conversationPrefix, "dm", event.guild_id),
    messageId: event.id,
    senderId: event.author.id,
    senderName: event.author.username,
    text,
    rawText: event.content,
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
