// Emscripten and wasm-bindgen-rayon create nested workers. Explicitly close
// those pools before releasing an idle processing worker, rather than waiting
// for browser garbage collection of the shared WASM memory.
const children = new Set<Worker>();
const NativeWorker = self.Worker;
self.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    children.add(this);
  }
  terminate() {
    children.delete(this);
    super.terminate();
  }
};
self.addEventListener('message', (event) => {
  if ((event as MessageEvent).data !== 'squoosh-dispose') return;
  for (const worker of children) worker.terminate();
  self.postMessage('squoosh-disposed');
  self.close();
});
export {};
