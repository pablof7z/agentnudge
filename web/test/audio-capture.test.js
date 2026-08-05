import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeMonoPcm16Wav,
  insertTranscript,
  transcriptionRequestUrl,
} from "../src/audio-capture.js";

test("builds a session-scoped transcription URL", () => {
  assert.equal(
    transcriptionRequestUrl("http://127.0.0.1:4317/lima?ignored=yes", "en-US"),
    "http://127.0.0.1:4317/lima/transcribe?locale=en-US",
  );
});

test("encodes browser samples as mono PCM WAV", async () => {
  const wav = encodeMonoPcm16Wav([new Float32Array([-1, 0, 1])], 16_000);
  const bytes = new Uint8Array(await wav.arrayBuffer());
  assert.equal(wav.type, "audio/wav");
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16_000);
  assert.equal(new DataView(bytes.buffer).getUint32(40, true), 6);
});

test("inserts a transcript at the current selection with natural spacing", () => {
  assert.deepEqual(insertTranscript("Fix please", 3, 3, "this"), {
    value: "Fix this please",
    cursor: 8,
  });
  assert.deepEqual(insertTranscript("Already ", 8, 8, "done."), {
    value: "Already done.",
    cursor: 13,
  });
});
