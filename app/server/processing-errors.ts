export class InvalidAudioError extends Error {}
// Keep in sync with the retryLimit of the processing queues in queue.ts.
const retryLimit = 3;
const systemFailure =
  /No space left|Disk quota exceeded|Too many open files|Resource temporarily unavailable|Input\/output error|Cannot allocate memory/;
// Only rejections of the upload itself are permanent: our own validation and
// FFmpeg tools exiting with an error on the input. Database, queue, file
// system and timeout failures are retried until the queue gives up.
export function invalidAudio(error: unknown) {
  if (error instanceof InvalidAudioError) return true;
  const failure = error as {
    code?: unknown;
    killed?: boolean;
    message?: string;
  };
  return (
    typeof failure?.code === "number" &&
    !failure.killed &&
    !systemFailure.test(failure.message ?? "")
  );
}
export function retryProcessing(error: unknown, job: { retryCount: number }) {
  return !invalidAudio(error) && job.retryCount < retryLimit;
}
