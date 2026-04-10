import fs from "node:fs/promises";
import path from "node:path";
import type { GatewayConfig } from "../config.js";
import { JsonStateStore } from "../state/store.js";
import type { Logger } from "../utils/logger.js";
import type { QQMessageAttachment } from "./types.js";

function sanitizeFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120) || "attachment.bin";
}

function guessExtension(contentType: string | undefined): string {
  if (!contentType) {
    return ".bin";
  }
  if (contentType.includes("png")) {
    return ".png";
  }
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return ".jpg";
  }
  if (contentType.includes("gif")) {
    return ".gif";
  }
  if (contentType.includes("webp")) {
    return ".webp";
  }
  if (contentType.includes("mpeg")) {
    return ".mp3";
  }
  if (contentType.includes("wav")) {
    return ".wav";
  }
  if (contentType.includes("ogg")) {
    return ".ogg";
  }
  if (contentType.includes("mp4")) {
    return ".mp4";
  }
  if (contentType.includes("pdf")) {
    return ".pdf";
  }
  return ".bin";
}

export class QQAttachmentService {
  constructor(
    private readonly config: GatewayConfig["qq"],
    private readonly state: JsonStateStore,
    private readonly logger: Logger,
  ) {}

  async buildAttachmentPrompt(
    accountId: string,
    messageId: string,
    attachments: QQMessageAttachment[] | undefined,
  ): Promise<string> {
    if (!attachments || attachments.length === 0) {
      return "";
    }

    const lines: string[] = ["[QQ attachments]"];
    let index = 0;

    for (const attachment of attachments) {
      index += 1;
      const summary = [
        attachment.filename ?? `attachment-${index}${guessExtension(attachment.content_type)}`,
        attachment.content_type,
        attachment.url,
      ];
      lines.push(`- ${summary.filter(Boolean).join(" | ")}`);

      if (attachment.asr_refer_text) {
        lines.push(`  transcript: ${attachment.asr_refer_text}`);
      }

      if (!this.config.downloadAttachments) {
        continue;
      }

      try {
        const localPath = await this.downloadAttachment(accountId, messageId, index, attachment);
        lines.push(`  local_path: ${localPath}`);
      } catch (error) {
        this.logger.warn(`Failed to cache attachment for ${accountId}/${messageId}`, error);
      }
    }

    return lines.join("\n");
  }

  private async downloadAttachment(
    accountId: string,
    messageId: string,
    index: number,
    attachment: QQMessageAttachment,
  ): Promise<string> {
    const dir = path.join(this.state.getAttachmentsDir(accountId), messageId);
    await fs.mkdir(dir, { recursive: true });

    const baseName = attachment.filename
      ? sanitizeFileName(attachment.filename)
      : `attachment-${index}${guessExtension(attachment.content_type)}`;
    const filePath = path.join(dir, baseName);

    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // continue
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Attachment download failed: ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > this.config.maxDownloadBytes) {
      throw new Error(
        `Attachment exceeds max size: ${contentLength} > ${this.config.maxDownloadBytes}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > this.config.maxDownloadBytes) {
      throw new Error(
        `Attachment exceeds max size after download: ${buffer.byteLength} > ${this.config.maxDownloadBytes}`,
      );
    }

    await fs.writeFile(filePath, buffer);
    return filePath;
  }
}
