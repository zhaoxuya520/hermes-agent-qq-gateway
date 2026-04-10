import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationId,
  normalizeC2CEvent,
  splitOutgoingText,
} from "../src/qq/transform.js";

test("buildConversationId is stable", () => {
  assert.equal(buildConversationId("qqbot", "group", "abc"), "qqbot:group:abc");
});

test("normalizeC2CEvent strips qq mentions and appends attachments", () => {
  const message = normalizeC2CEvent(
    {
      id: "m1",
      content: "<@123456> 你好",
      timestamp: "2026-04-10T00:00:00Z",
      author: {
        id: "1",
        union_openid: "u1",
        user_openid: "openid-1",
      },
      attachments: [
        {
          content_type: "image/png",
          filename: "test.png",
          url: "https://example.com/test.png",
        },
      ],
    },
    { conversationPrefix: "qqbot" },
  );

  assert.ok(message);
  assert.equal(message?.conversationId, "qqbot:c2c:openid-1");
  assert.equal(
    message?.text,
    "你好\n\n[QQ attachments]\n- test.png | image/png | https://example.com/test.png",
  );
});

test("splitOutgoingText keeps chunks within limit", () => {
  const chunks = splitOutgoingText("12345 67890 12345", 6);
  assert.deepEqual(chunks, ["12345", "67890", "12345"]);
});
