#!/usr/bin/env node

import "dotenv/config";
import { loadConfig, type QQAccountConfig } from "./config.js";
import { HermesClient } from "./hermes/client.js";
import { JsonStateStore } from "./state/store.js";
import { QQApiClient } from "./qq/api.js";
import { QQAttachmentService } from "./qq/attachments.js";
import { QQGatewayBridge } from "./qq/gateway.js";
import { createLogger } from "./utils/logger.js";

function buildSystemPrompt(customPrompt?: string): string {
  const platformPrompt = [
    "You are replying inside QQ Official Bot chats.",
    "Prefer plain text unless rich media would clearly help.",
    "If you need to send an image, use Markdown image syntax like ![alt](https://...).",
    "If you need to send voice, video, or file media, use [qq:voice](url), [qq:video](url), or [qq:file filename.ext](url).",
  ].join(" ");
  return customPrompt ? `${customPrompt}\n\n${platformPrompt}` : platformPrompt;
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, "true");
      continue;
    }
    flags.set(key, next);
    index += 1;
  }
  return flags;
}

function resolveAccount(config: ReturnType<typeof loadConfig>, accountId?: string): QQAccountConfig {
  if (!accountId) {
    return config.qq.accounts[0];
  }
  const account = config.qq.accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    throw new Error(`Unknown account: ${accountId}`);
  }
  return account;
}

async function runServe(config: ReturnType<typeof loadConfig>): Promise<void> {
  const logger = createLogger(config.runtime.logLevel);
  const state = new JsonStateStore(config.qq.dataDir, logger.child("state"));
  await state.init();

  const hermes = new HermesClient({
    baseUrl: config.hermes.baseUrl,
    apiKey: config.hermes.apiKey,
    model: config.hermes.model,
    systemPrompt: buildSystemPrompt(config.hermes.systemPrompt),
    requestTimeoutMs: config.hermes.requestTimeoutMs,
    logger: logger.child("hermes"),
  });

  const bridges = config.qq.accounts.map((account) => {
    const qqLogger = logger.child(`qq:${account.id}`);
    const qq = new QQApiClient(config.qq, account, qqLogger);
    const attachments = new QQAttachmentService(config.qq, state, logger.child(`attachments:${account.id}`));
    return new QQGatewayBridge(
      config,
      account,
      qq,
      hermes,
      state,
      attachments,
      logger.child(`bridge:${account.id}`),
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down`);
    await Promise.all(bridges.map((bridge) => bridge.stop()));
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await Promise.all(bridges.map((bridge) => bridge.start()));
  logger.info(`Hermes QQ gateway started with ${bridges.length} account(s)`);
}

async function runSend(config: ReturnType<typeof loadConfig>, args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const account = resolveAccount(config, flags.get("account"));
  const type = flags.get("type");
  const to = flags.get("to");
  const message = flags.get("message");
  if ((type !== "c2c" && type !== "group") || !to || !message) {
    throw new Error("Usage: hermes-qq-gateway send --type <c2c|group> --to <target> --message <text> [--account id]");
  }

  const logger = createLogger(config.runtime.logLevel);
  const qq = new QQApiClient(config.qq, account, logger.child(`qq:${account.id}`));
  await qq.sendProactive(type, to, message);
  console.log(`Sent ${type} proactive message via account ${account.id} to ${to}`);
}

async function runKnownUsers(config: ReturnType<typeof loadConfig>, args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const logger = createLogger(config.runtime.logLevel);
  const state = new JsonStateStore(config.qq.dataDir, logger.child("state"));
  await state.init();

  const accountId = flags.get("account");
  const kind = flags.get("kind") as "c2c" | "group" | "guild" | "dm" | undefined;
  const accounts = accountId ? [resolveAccount(config, accountId)] : config.qq.accounts;

  for (const account of accounts) {
    const users = await state.listKnownUsers(account.id, kind);
    console.log(`[${account.id}]`);
    if (users.length === 0) {
      console.log("  No known users.");
      continue;
    }
    for (const user of users) {
      const target =
        user.kind === "group"
          ? user.groupOpenid
          : user.kind === "guild"
            ? user.channelId
            : user.kind === "dm"
              ? user.guildId
              : user.openid;
      console.log(`  - ${user.kind} ${target ?? user.senderId} ${user.senderName ?? ""}`.trimEnd());
    }
  }
}

async function main(): Promise<void> {
  const [, , command = "serve", ...args] = process.argv;
  const config = loadConfig(process.env, {
    requireHermesApiKey: command === "serve",
  });

  if (command === "serve") {
    await runServe(config);
    return;
  }
  if (command === "send") {
    await runSend(config, args);
    return;
  }
  if (command === "known-users") {
    await runKnownUsers(config, args);
    return;
  }

  throw new Error(
    "Unknown command. Use one of: serve, send, known-users",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
