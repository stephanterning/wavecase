type Job = {
  priority: number;
  signal: AbortSignal;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};
let active = 0;
let speculative = false;
const jobs: Job[] = [];
function pump() {
  jobs.sort((a, b) => a.priority - b.priority);
  for (let i = 0; i < jobs.length && active < 2;) {
    const job = jobs[i];
    if (job.signal.aborted) {
      jobs.splice(i, 1);
      job.reject(job.signal.reason);
      continue;
    }
    if (job.priority === 2 && speculative) {
      i++;
      continue;
    }
    jobs.splice(i, 1);
    active++;
    if (job.priority === 2) speculative = true;
    void job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        if (job.priority === 2) speculative = false;
        pump();
      });
  }
}
/** Two transfers at most; speculative A/B traffic can occupy only one slot. */
export function download(
  priority: number,
  signal: AbortSignal,
  run: () => Promise<void>,
) {
  return new Promise<void>((resolve, reject) => {
    jobs.push({ priority, signal, run, resolve, reject });
    pump();
  });
}
