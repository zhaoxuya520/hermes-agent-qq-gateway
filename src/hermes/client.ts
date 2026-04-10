import type { Logger } from "../utils/logger.js";

export interface HermesClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  requestTimeoutMs: number;
  logger: Logger;
}

interface HermesOutputTextPart {
  type: string;
  text?: string;
}

interface HermesOutputMessage {
  type: string;
  role?: string;
  content?: HermesOutputTextPart[];
}

interface HermesResponsesPayload {
  id?: string;
  output?: HermesOutputMessage[];
}

export interface HermesReply {
  responseId?: string;
  text: string;
}

export function extractAssistantText(payload: HermesResponsesPayload): string {
  const parts: string[] = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message" || item.role !== "assistant") {
      continue;
    }
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) {
        parts.push(part.text);
      }
    }
  }
  return parts.join("\n\n").trim();
}

export class HermesClient {
  constructor(private readonly options: HermesClientOptions) {}

  async respond(conversation: string, input: string): Promise<HermesReply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);

    const body = {
      model: this.options.model,
      conversation,
      input,
      store: true,
      truncation: "auto",
      ...(this.options.systemPrompt ? { instructions: this.options.systemPrompt } : {}),
    };

    try {
      const response = await fetch(`${this.options.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Hermes API ${response.status}: ${raw}`);
      }

      const parsed = JSON.parse(raw) as HermesResponsesPayload;
      const text = extractAssistantText(parsed);
      if (!text) {
        throw new Error("Hermes API returned an empty assistant response");
      }

      return {
        responseId: parsed.id,
        text,
      };
    } catch (error) {
      this.options.logger.error("Hermes request failed", error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
