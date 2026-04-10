import type { QQMediaItem } from "./types.js";

export interface ParsedOutgoingReply {
  text: string;
  media: QQMediaItem[];
}

const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\((https?:\/\/[^\s)]+|data:image\/[^)]+)\)/gi;
const QQ_MEDIA_RE = /\[qq:(image|voice|video|file)(?:\s+([^\]]+))?\]\(([^)]+)\)/gi;
const IMAGE_URL_RE =
  /^(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?\S*)?|data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+)$/i;

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isImageLikeUrl(input: string): boolean {
  return IMAGE_URL_RE.test(input.trim());
}

export function parseOutgoingReply(input: string): ParsedOutgoingReply {
  const media: QQMediaItem[] = [];

  let working = input.replace(QQ_MEDIA_RE, (_match, type: QQMediaItem["type"], fileName: string, url: string) => {
    media.push({
      type,
      url: url.trim(),
      ...(fileName ? { fileName: fileName.trim() } : {}),
    });
    return "";
  });

  working = working.replace(MARKDOWN_IMAGE_RE, (_match, url: string) => {
    media.push({ type: "image", url: url.trim() });
    return "";
  });

  const keptLines: string[] = [];
  for (const line of working.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && isImageLikeUrl(trimmed)) {
      media.push({ type: "image", url: trimmed });
      continue;
    }
    keptLines.push(line);
  }

  const dedupedMedia = media.filter((item, index) => {
    const key = `${item.type}:${item.url}:${item.fileName ?? ""}`;
    return media.findIndex((candidate) => {
      return `${candidate.type}:${candidate.url}:${candidate.fileName ?? ""}` === key;
    }) === index;
  });

  return {
    text: normalizeText(keptLines.join("\n")),
    media: dedupedMedia,
  };
}
