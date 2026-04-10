#!/usr/bin/env node

import "dotenv/config";
import { loadConfig } from "./config.js";
import { HermesClient } from "./hermes/client.js";
import { QQApiClient } from "./qq/api.js";
import { QQGatewayBridge } from "./qq/gateway.js";
import { createLogger } from "./utils/logger.js";

function buildSystemPrompt(customPrompt?: string): string {
  const platformPrompt =
    "You are replying inside QQ Official Bot chats. Keep replies in plain text, avoid excessive markdown, and prefer concise answers unless the user asks for detail.";
  return customPrompt ? `${customPrompt}\n\n${platformPrompt}` : platformPrompt;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.runtime.logLevel);

  const hermes = new HermesClient({
    baseUrl: config.hermes.baseUrl,
    apiKey: config.hermes.apiKey,
    model: config.hermes.model,
    systemPrompt: buildSystemPrompt(config.hermes.systemPrompt),
    requestTimeoutMs: config.hermes.requestTimeoutMs,
    logger: logger.child("hermes"),
  });

  const qq = new QQApiClient(config.qq, logger.child("qq"));
  const bridge = new QQGatewayBridge(config, qq, hermes, logger.child("bridge"));

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down`);
    await bridge.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await bridge.start();
  logger.info("Hermes QQ gateway started");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
