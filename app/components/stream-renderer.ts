import {
  streamChannels,
  streamRate,
  streamChunkFrames,
} from "../domain/audio-stream";

/** Runs on the audio thread. Segment boundaries and repeats never wait for JS timers. */
export class StreamRenderer {
  chunks = new Map<number, Float32Array>();
  frame = 0;
  frames = 0;
  channels = streamChannels;
  playing = false;
  waiting = false;
  loop = false;
  ended = false;
  loops = 0;
  generation = 0;
  private previous = 0;
  private previousChunks = new Map<number, Float32Array>();
  private fade = 0;
  private tail = 0;
  private readonly ramp = Math.round(streamRate * 0.005);

  seek(frame: number, playing: boolean, generation: number, fade: boolean) {
    this.capturePrevious();
    this.fade = fade && this.playing ? this.ramp : 0;
    this.tail = 0;
    this.frame = Math.min(this.frames, Math.max(0, frame));
    this.playing = playing;
    this.waiting = false;
    this.ended = false;
    this.generation = generation;
  }
  pause(generation: number) {
    this.capturePrevious();
    this.tail = this.playing && !this.waiting ? this.ramp : 0;
    this.fade = 0;
    this.playing = false;
    this.generation = generation;
  }
  private capturePrevious() {
    this.previous = this.frame;
    this.previousChunks.clear();
    const current = Math.floor(this.frame / streamChunkFrames);
    for (const index of [current, current + 1, 0]) {
      const chunk = this.chunks.get(index);
      if (chunk) this.previousChunks.set(index, chunk);
    }
  }
  private value(frame: number, channel: number, chunks = this.chunks) {
    if (frame >= this.frames && this.loop) frame %= this.frames;
    const index = Math.floor(frame / streamChunkFrames);
    return (
      chunks.get(index)?.[
        (frame - index * streamChunkFrames) * this.channels + channel
      ] ?? 0
    );
  }
  render(outputs: Float32Array[]) {
    for (let i = 0; i < outputs[0].length; i++) {
      if (this.playing && this.frame >= this.frames) {
        if (this.loop) {
          if (this.chunks.has(0)) {
            this.frame = 0;
            this.loops++;
          }
        } else {
          this.playing = false;
          this.ended = true;
        }
      }
      const available =
        this.frame < this.frames &&
        this.chunks.has(Math.floor(this.frame / streamChunkFrames));
      this.waiting = this.playing && !available;
      for (let channel = 0; channel < outputs.length; channel++) {
        let value = 0;
        if (this.playing && available) {
          const fraction = this.fade / this.ramp;
          value =
            this.value(this.frame, channel) * (1 - fraction) +
            this.value(this.previous, channel, this.previousChunks) * fraction;
        } else if (this.tail)
          value =
            (this.value(this.previous, channel, this.previousChunks) *
              this.tail) /
            this.ramp;
        outputs[channel][i] = value;
      }
      if (this.playing && available) this.frame++;
      if (this.fade) {
        this.previous++;
        this.fade--;
      }
      if (this.tail) {
        this.previous++;
        this.tail--;
      }
    }
    if (!this.fade && !this.tail) this.previousChunks.clear();
  }
}
