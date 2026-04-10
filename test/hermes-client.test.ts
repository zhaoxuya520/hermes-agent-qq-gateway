import test from "node:test";
import assert from "node:assert/strict";
import { extractAssistantText } from "../src/hermes/client.js";

test("extractAssistantText joins assistant output_text parts", () => {
  const text = extractAssistantText({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "第一段" },
          { type: "output_text", text: "第二段" },
        ],
      },
    ],
  });

  assert.equal(text, "第一段\n\n第二段");
});
