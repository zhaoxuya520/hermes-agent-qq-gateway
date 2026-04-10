import test from "node:test";
import assert from "node:assert/strict";
import { composeHermesInput, isExplicitAttachmentRequest } from "../src/qq/inbound.js";

test("isExplicitAttachmentRequest detects clear ask", () => {
  assert.equal(isExplicitAttachmentRequest("帮我看看这个图片"), true);
  assert.equal(isExplicitAttachmentRequest("please analyze this file"), true);
  assert.equal(isExplicitAttachmentRequest("hello"), false);
});

test("composeHermesInput asks for clarification on attachment-only input", () => {
  const result = composeHermesInput({
    messageText: "",
    attachmentPrompt: "[QQ attachments]\n- a.png | image/png | https://example.com/a.png",
    autoAnalyzeAttachments: false,
  });

  assert.match(result, /Do not inspect the attachment yet/);
  assert.match(result, /\[QQ attachments]/);
});

test("composeHermesInput preserves explicit attachment requests", () => {
  const result = composeHermesInput({
    messageText: "帮我看看这个图片",
    attachmentPrompt: "[QQ attachments]\n- a.png | image\/png | https://example.com/a.png",
    autoAnalyzeAttachments: false,
  });

  assert.match(result, /explicitly asking about the attachment/);
  assert.match(result, /帮我看看这个图片/);
});
