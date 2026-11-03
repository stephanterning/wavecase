import { StreamRenderer } from "./stream-renderer";
import { streamRate } from "../domain/audio-stream";
declare const currentTime: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class PlaybackProcessor extends AudioWorkletProcessor {
  private renderer = new StreamRenderer();
  private elapsed = 0;
  private state = "";
  private disposed = false;
  constructor() {
    super();
    if (sampleRate !== streamRate)
      throw new Error("Unsupported playback sample rate");
    this.port.onmessage = ({ data }) => {
      const r = this.renderer;
      switch (data.type) {
        case "configure":
          r.frames = data.frames;
          r.channels = data.channels;
          break;
        case "chunk":
          r.chunks.set(data.index, new Float32Array(data.bytes));
          break;
        case "evict":
          for (const index of data.indices) r.chunks.delete(index);
          break;
        case "loop":
          r.loop = data.value;
          break;
        case "seek":
          r.seek(data.frame, data.playing, data.generation, data.fade);
          break;
        case "pause":
          r.pause(data.generation);
          break;
        case "dispose":
          this.disposed = true;
          r.chunks.clear();
          break;
      }
      this.state = "";
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.disposed) return false;
    const output = outputs[0];
    this.renderer.render(output);
    this.elapsed += output[0].length;
    const r = this.renderer;
    const state = [r.generation, r.playing, r.waiting, r.ended, r.loops].join(
      ":",
    );
    if (state !== this.state || (r.playing && this.elapsed >= streamRate / 4)) {
      this.state = state;
      this.elapsed = 0;
      this.port.postMessage({
        generation: r.generation,
        frame: r.frame,
        playing: r.playing,
        waiting: r.waiting,
        ended: r.ended,
        loops: r.loops,
        clock: currentTime + output[0].length / sampleRate,
      });
    }
    return true;
  }
}
registerProcessor("wavecase-playback", PlaybackProcessor);
