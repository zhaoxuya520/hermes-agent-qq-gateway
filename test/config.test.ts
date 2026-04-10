import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("loadConfig supports QQBOT_ACCOUNTS_JSON", () => {
  const config = loadConfig({
    HERMES_API_KEY: "k",
    QQBOT_ACCOUNTS_JSON: JSON.stringify([
      {
        id: "bot-a",
        appId: "1",
        clientSecret: "s1",
      },
      {
        id: "bot-b",
        appId: "2",
        clientSecret: "s2",
        allowFrom: ["u1", "u2"],
      },
    ]),
  });

  assert.equal(config.qq.accounts.length, 2);
  assert.equal(config.qq.accounts[1]?.id, "bot-b");
  assert.deepEqual(config.qq.accounts[1]?.allowFrom, ["u1", "u2"]);
});
