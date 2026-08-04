import test from "node:test";
import assert from "node:assert/strict";

import { replyImageLabel, replyImageRequestUrl } from "../src/reply-images.js";

const image = {
  id: "bd44c39a-a9d4-4e3a-80d2-983844d44f7f",
  fileName: "updated-layout.png",
  mediaType: "image/png",
  assetPath: "/lima/reply-assets/bd44c39a-a9d4-4e3a-80d2-983844d44f7f",
};

test("constructs only the expected same-session reply image URL", () => {
  assert.equal(
    replyImageRequestUrl("http://127.0.0.1:4317/lima", "lima", image),
    "http://127.0.0.1:4317/lima/reply-assets/bd44c39a-a9d4-4e3a-80d2-983844d44f7f",
  );
  assert.equal(
    replyImageRequestUrl("http://127.0.0.1:4317/lima", "bravo", image),
    null,
  );
  assert.equal(
    replyImageRequestUrl("http://127.0.0.1:4317/lima", "lima", {
      ...image,
      assetPath: "https://example.com/tracker.png",
    }),
    null,
  );
});

test("uses a useful accessible label for reply images", () => {
  assert.equal(replyImageLabel(image), "updated-layout.png");
  assert.equal(replyImageLabel({}), "Attached image");
});
