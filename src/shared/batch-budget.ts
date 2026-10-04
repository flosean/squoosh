// CPU limits are shared by the queue and Rust thread pools. AVIF's native
// wrapper uses the same per-codec limit; its prestarted pool is capped at four.
export function batchConcurrency(
  cores = navigator.hardwareConcurrency || 2,
  memoryGB = (navigator as { deviceMemory?: number }).deviceMemory || 4,
) {
  return cores >= 4 && memoryGB >= 8 ? 2 : 1;
}

export function codecThreads(cores = navigator.hardwareConcurrency || 2) {
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}
