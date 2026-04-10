import test from "node:test";
import assert from "node:assert/strict";
import { isImageLikeUrl, parseOutgoingReply } from "../src/qq/outbound.js";

test("parseOutgoingReply extracts markdown image", () => {
  const parsed = parseOutgoingReply("Here is an image.\n\n![cat](https://example.com/cat.png)\n\nDone.");
  assert.deepEqual(parsed.media, [{ type: "image", url: "https://example.com/cat.png" }]);
  assert.equal(parsed.text, "Here is an image.\n\nDone.");
});

test("parseOutgoingReply extracts standalone image urls", () => {
  const parsed = parseOutgoingReply("line one\nhttps://example.com/a.webp\nline two");
  assert.deepEqual(parsed.media, [{ type: "image", url: "https://example.com/a.webp" }]);
  assert.equal(parsed.text, "line one\nline two");
});

test("parseOutgoingReply extracts qq media tags", () => {
  const parsed = parseOutgoingReply(
    "Please listen.\n[qq:voice](https://example.com/test.mp3)\n[qq:file report.pdf](https://example.com/report.pdf)",
  );
  assert.deepEqual(parsed.media, [
    { type: "voice", url: "https://example.com/test.mp3" },
    { type: "file", url: "https://example.com/report.pdf", fileName: "report.pdf" },
  ]);
  assert.equal(parsed.text, "Please listen.");
});

test("isImageLikeUrl accepts data urls", () => {
  assert.equal(isImageLikeUrl("data:image/png;base64,AAAA"), true);
});
