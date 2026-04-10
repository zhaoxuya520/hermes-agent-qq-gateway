import test from "node:test";
import assert from "node:assert/strict";
import { isImageLikeUrl, parseOutgoingReply } from "../src/qq/outbound.js";

test("parseOutgoingReply extracts markdown image", () => {
  const parsed = parseOutgoingReply("这里有图\n\n![cat](https://example.com/cat.png)\n\n看完告诉我。");
  assert.deepEqual(parsed.imageUrls, ["https://example.com/cat.png"]);
  assert.equal(parsed.text, "这里有图\n\n看完告诉我。");
});

test("parseOutgoingReply extracts standalone image urls", () => {
  const parsed = parseOutgoingReply("第一行\nhttps://example.com/a.webp\n第二行");
  assert.deepEqual(parsed.imageUrls, ["https://example.com/a.webp"]);
  assert.equal(parsed.text, "第一行\n第二行");
});

test("isImageLikeUrl accepts data urls", () => {
  assert.equal(isImageLikeUrl("data:image/png;base64,AAAA"), true);
});
