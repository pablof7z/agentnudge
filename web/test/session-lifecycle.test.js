import assert from "node:assert/strict";
import test from "node:test";

import { endSessionRequestUrl } from "../src/session-lifecycle.js";

test("ends only the session embedded in the widget endpoint", () => {
  assert.equal(
    endSessionRequestUrl("http://127.0.0.1:4317/lima?ignored=yes"),
    "http://127.0.0.1:4317/lima/session",
  );
});
