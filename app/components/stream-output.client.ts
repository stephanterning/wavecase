const modules = new WeakMap<AudioContext, Promise<void>>();
export async function createOutput(context: AudioContext, channels: number) {
  let loaded = modules.get(context);
  if (!loaded) {
    loaded = import("./stream-worklet.ts?worker&url").then((module) =>
      context.audioWorklet.addModule(module.default),
    );
    modules.set(context, loaded);
    void loaded.catch(() => modules.delete(context));
  }
  await loaded;
  return new AudioWorkletNode(context, "wavecase-playback", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
  });
}
