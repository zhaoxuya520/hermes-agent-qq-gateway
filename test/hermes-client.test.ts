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
          { type: "output_text", text: "part one" },
          { type: "output_text", text: "part two" },
        ],
      },
    ],
  });

  assert.equal(text, "part one\n\npart two");
});
