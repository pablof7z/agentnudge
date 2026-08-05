export const MAX_RECORDING_MS = 60_000;

export function transcriptionRequestUrl(endpoint, locale) {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/transcribe`;
  url.search = "";
  url.searchParams.set("locale", locale || "en-US");
  url.hash = "";
  return url.toString();
}

export function insertTranscript(value, selectionStart, selectionEnd, transcript) {
  const spoken = transcript.trim();
  if (!spoken) return { value, cursor: selectionStart };
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const leadingSpace = before && !/\s$/.test(before) && !/^[,.;:!?]/.test(spoken) ? " " : "";
  const trailingSpace = after && !/^\s/.test(after) && !/[\s([{]$/.test(spoken) ? " " : "";
  const inserted = `${leadingSpace}${spoken}${trailingSpace}`;
  return {
    value: `${before}${inserted}${after}`,
    cursor: before.length + inserted.length,
  };
}

export function encodeMonoPcm16Wav(chunks, sampleRate) {
  const samples = mergeSamples(chunks);
  if (!samples.length) throw new Error("No microphone audio was captured");
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class MicrophoneCapture {
  static async start({ mediaDevices, AudioContextClass } = {}) {
    const devices = mediaDevices || globalThis.navigator?.mediaDevices;
    const Context = AudioContextClass || globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!devices?.getUserMedia || !Context) {
      throw new Error("Microphone recording is not supported in this browser");
    }
    const stream = await devices.getUserMedia({ audio: true });
    try {
      const context = new Context();
      if (context.state === "suspended") await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silence = context.createGain();
      silence.gain.value = 0;
      const chunks = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);
      return new MicrophoneCapture(stream, context, source, processor, silence, chunks);
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
  }

  constructor(stream, context, source, processor, silence, chunks) {
    this.stream = stream;
    this.context = context;
    this.source = source;
    this.processor = processor;
    this.silence = silence;
    this.chunks = chunks;
    this.finished = false;
  }

  async stop() {
    if (this.finished) throw new Error("Microphone recording has already stopped");
    this.finished = true;
    const sampleRate = Math.round(this.context.sampleRate);
    this.cleanupGraph();
    await this.context.close();
    return encodeMonoPcm16Wav(this.chunks, sampleRate);
  }

  cancel() {
    if (this.finished) return;
    this.finished = true;
    this.cleanupGraph();
    this.context.close().catch(() => {});
  }

  cleanupGraph() {
    this.processor.onaudioprocess = null;
    for (const node of [this.source, this.processor, this.silence]) {
      try { node.disconnect(); } catch {}
    }
    for (const track of this.stream.getTracks()) track.stop();
  }
}

function mergeSamples(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
