export function stripQQMentions(input: string): string {
  return input
    .replace(/<@!?\d+>/g, " ")
    .replace(/\u200b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitText(input: string, limit: number): string[] {
  const text = input.trim();
  if (!text) {
    return [];
  }
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) {
      cut = rest.lastIndexOf(" ", limit);
    }
    if (cut < limit * 0.5) {
      cut = limit;
    }

    const chunk = rest.slice(0, cut).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    rest = rest.slice(cut).trim();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks;
}
