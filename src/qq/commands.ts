import { readFileSync } from "node:fs";
import path from "node:path";
import type { QQAccountConfig } from "../config.js";
import { JsonStateStore } from "../state/store.js";
import type { Logger } from "../utils/logger.js";
import { QQApiClient } from "./api.js";
import type { NormalizedInboundMessage, QQKnownUserKind } from "./types.js";

const PACKAGE_JSON_PATH = path.resolve(process.cwd(), "package.json");

function packageVersion(): string {
  try {
    const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function firstToken(input: string): [string, string] {
  const trimmed = input.trim();
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    return [trimmed, ""];
  }
  return [trimmed.slice(0, firstSpace), trimmed.slice(firstSpace + 1).trim()];
}

function formatKnownUsers(lines: string[]): string {
  return lines.length > 0 ? lines.join("\n") : "No known users yet.";
}

export interface CommandContext {
  account: QQAccountConfig;
  message: NormalizedInboundMessage;
  qq: QQApiClient;
  state: JsonStateStore;
  logger: Logger;
  sessionId: string | null;
  lastSeq: number | null;
}

export async function handleBuiltinCommand(context: CommandContext): Promise<string | null> {
  const raw = context.message.rawText.trim();
  if (!raw.startsWith("/bot-")) {
    return null;
  }

  const [command, remainder] = firstToken(raw);

  switch (command) {
    case "/bot-help":
      return [
        "Built-in commands:",
        "/bot-help",
        "/bot-ping",
        "/bot-version",
        "/bot-status",
        "/bot-users [c2c|group|guild|dm]",
        "/bot-send <c2c|group> <target> <message>",
        "/bot-broadcast <c2c|group> <message>",
      ].join("\n");
    case "/bot-ping":
      return `pong ${new Date().toISOString()}`;
    case "/bot-version":
      return `hermes-agent-qq-gateway ${packageVersion()}`;
    case "/bot-status": {
      const knownUsers = await context.state.countKnownUsers(context.account.id);
      return [
        `account: ${context.account.id}`,
        `session_id: ${context.sessionId ?? "none"}`,
        `last_seq: ${context.lastSeq ?? "none"}`,
        `known_users: ${knownUsers}`,
      ].join("\n");
    }
    case "/bot-users": {
      const kind = remainder ? (remainder.split(/\s+/)[0] as QQKnownUserKind) : undefined;
      const users = await context.state.listKnownUsers(context.account.id, kind);
      const lines = users.slice(0, 20).map((user) => {
        const target =
          user.kind === "group"
            ? user.groupOpenid
            : user.kind === "guild"
              ? user.channelId
              : user.kind === "dm"
                ? user.guildId
                : user.openid;
        return `- ${user.kind} | ${target ?? user.senderId} | ${user.senderName ?? user.senderId}`;
      });
      return formatKnownUsers(lines);
    }
    case "/bot-send": {
      const [type, tail] = firstToken(remainder);
      const [to, messageText] = firstToken(tail);
      if ((type !== "c2c" && type !== "group") || !to || !messageText) {
        return "Usage: /bot-send <c2c|group> <target> <message>";
      }
      await context.qq.sendProactive(type, to, messageText);
      return `Sent proactive ${type} message to ${to}`;
    }
    case "/bot-broadcast": {
      const [type, messageText] = firstToken(remainder);
      if ((type !== "c2c" && type !== "group") || !messageText) {
        return "Usage: /bot-broadcast <c2c|group> <message>";
      }
      const users = await context.state.listKnownUsers(context.account.id, type);
      if (users.length === 0) {
        return `No known ${type} users available for broadcast.`;
      }
      let sent = 0;
      for (const user of users) {
        const target = type === "group" ? user.groupOpenid : user.openid;
        if (!target) {
          continue;
        }
        try {
          await context.qq.sendProactive(type, target, messageText);
          sent += 1;
        } catch (error) {
          context.logger.warn(`Broadcast failed for ${type}:${target}`, error);
        }
      }
      return `Broadcast finished. Sent to ${sent} ${type} target(s).`;
    }
    default:
      return "Unknown command. Use /bot-help.";
  }
}
