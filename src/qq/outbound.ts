export interface ParsedOutgoingReply {
  text: string;
  imageUrls: string[];
}

const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\((https?:\/\/[^\s)]+|data:image\/[^)]+)\)/gi;
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
  const imageUrls: string[] = [];

  let working = input.replace(MARKDOWN_IMAGE_RE, (_match, url: string) => {
    imageUrls.push(url.trim());
    return "";
  });

  const keptLines: string[] = [];
  for (const line of working.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && isImageLikeUrl(trimmed)) {
      imageUrls.push(trimmed);
      continue;
    }
    keptLines.push(line);
  }

  const dedupedImageUrls = [...new Set(imageUrls)];

  return {
    text: normalizeText(keptLines.join("\n")),
    imageUrls: dedupedImageUrls,
  };
}
