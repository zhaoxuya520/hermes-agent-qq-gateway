function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export function isExplicitAttachmentRequest(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return false;
  }

  const patterns = [
    /(看|分析|识别|描述|读|读取|总结|提取|翻译|检查|打开|解释).*(图|图片|照片|文件|附件|pdf|文档|表格)/,
    /(图里|图片里|照片里|文件里|附件里|pdf里|文档里)/,
    /(帮我看|帮我分析|帮我读|看看这个|看下这个)/,
    /\b(analyze|describe|read|open|inspect|extract|summari[sz]e|translate)\b.*\b(image|picture|photo|file|attachment|document|pdf)\b/,
    /\bwhat(?:'s| is) in\b.*\b(image|picture|photo|file|attachment|document|pdf)\b/,
    /\blook at\b.*\b(image|picture|photo|file|attachment|document|pdf)\b/,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

export function composeHermesInput(options: {
  messageText: string;
  attachmentPrompt: string;
  autoAnalyzeAttachments: boolean;
}): string {
  const messageText = normalizeText(options.messageText);
  const attachmentPrompt = normalizeText(options.attachmentPrompt);

  if (!attachmentPrompt) {
    return messageText;
  }

  if (options.autoAnalyzeAttachments) {
    return [messageText, attachmentPrompt].filter(Boolean).join("\n\n");
  }

  if (!messageText) {
    return [
      "User sent one or more QQ attachments without any text.",
      "Do not inspect the attachment yet. Briefly ask what they want to do with it.",
      attachmentPrompt,
    ].join("\n\n");
  }

  if (isExplicitAttachmentRequest(messageText)) {
    return [
      messageText,
      "The user is explicitly asking about the attachment. Attachment details are below.",
      attachmentPrompt,
    ].join("\n\n");
  }

  return [
    messageText,
    "Attachment(s) are available below. Do not inspect or analyze them unless the user explicitly asks about the attachment or asks you to open, read, extract, or analyze it.",
    attachmentPrompt,
  ].join("\n\n");
}
