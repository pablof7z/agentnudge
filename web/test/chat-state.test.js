import assert from "node:assert/strict";
import test from "node:test";

import { awaitingAgentAfterMessages, messageAuthorLabel } from "../src/chat-state.js";

test("keeps the activity indicator after the latest user message", () => {
  assert.equal(awaitingAgentAfterMessages([{ role: "agent" }, { role: "user" }]), true);
  assert.equal(awaitingAgentAfterMessages([{ role: "user" }, { role: "agent" }]), false);
});

test("preserves optimistic activity before the sent message is polled", () => {
  assert.equal(awaitingAgentAfterMessages([], true), true);
  assert.equal(awaitingAgentAfterMessages([], false), false);
});

test("labels inline review turns in the shared chat transcript", () => {
  assert.equal(messageAuthorLabel({ role: "user", reviewThreadId: "thread-2" }), "You · Feedback 2");
  assert.equal(messageAuthorLabel({ role: "agent", reviewThreadId: "thread-2" }), "Agent · Feedback 2");
  assert.equal(messageAuthorLabel({ role: "agent" }), "Agent");
});
