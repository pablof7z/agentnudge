import assert from "node:assert/strict";
import test from "node:test";

import { awaitingAgentAfterMessages } from "../src/chat-state.js";

test("keeps the activity indicator after the latest user message", () => {
  assert.equal(awaitingAgentAfterMessages([{ role: "agent" }, { role: "user" }]), true);
  assert.equal(awaitingAgentAfterMessages([{ role: "user" }, { role: "agent" }]), false);
});

test("preserves optimistic activity before the sent message is polled", () => {
  assert.equal(awaitingAgentAfterMessages([], true), true);
  assert.equal(awaitingAgentAfterMessages([], false), false);
});
