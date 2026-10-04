import { wrap } from 'comlink';
import { BridgeMethods, methodNames } from './meta';
import workerURL from 'omt:../../../features-worker';
import type { ProcessorWorkerApi } from '../../../features-worker';
import { abortable } from '../util';

/** How long the worker should be idle before terminating. */
const workerTimeout = 10_000;

interface WorkerBridge extends BridgeMethods {}

class WorkerBridge {
  protected _queue = Promise.resolve() as Promise<unknown>;
  /** Worker instance associated with this processor. */
  protected _worker?: Worker;
  /** Comlinked worker API. */
  protected _workerApi?: ProcessorWorkerApi;
  /** ID from setTimeout */
  protected _workerTimeout?: number;
  protected _workerFailure?: Promise<never>;
  protected _rejectWorkerFailure?: (error: Error) => void;

  dispose() {
    clearTimeout(this._workerTimeout);
    this._rejectWorkerFailure?.(
      new DOMException('已停止圖片處理', 'AbortError'),
    );
    this._terminateWorker();
  }

  protected _terminateWorker() {
    if (!this._worker) return;
    const worker = this._worker;
    // A blocked native call cannot receive messages, so cancellation still has
    // a short hard-stop fallback. Idle workers acknowledge after closing pools.
    const timeout = setTimeout(() => worker.terminate(), 200);
    worker.addEventListener('message', (event) => {
      if (event.data !== 'squoosh-disposed') return;
      clearTimeout(timeout);
      worker.terminate();
    });
    worker.postMessage('squoosh-dispose');
    this._worker = undefined;
    this._workerApi = undefined;
  }

  protected _startWorker() {
    this._worker = new Worker(workerURL);
    const worker = this._worker;
    this._workerFailure = new Promise<never>((_, reject) => {
      this._rejectWorkerFailure = reject;
    });
    const onFailure = () => {
      if (this._worker !== worker) return;
      this._rejectWorkerFailure?.(
        Error('圖片處理程式載入或執行失敗，請重新載入後再試'),
      );
      this._terminateWorker();
    };
    this._worker.addEventListener('error', onFailure);
    this._worker.addEventListener('messageerror', onFailure);
    this._workerApi = wrap<ProcessorWorkerApi>(this._worker);
  }
}

for (const methodName of methodNames) {
  WorkerBridge.prototype[methodName] = function (
    this: WorkerBridge,
    signal: AbortSignal,
    ...args: any
  ) {
    this._queue = this._queue
      // Ignore any errors in the queue
      .catch(() => {})
      .then(async () => {
        if (signal.aborted) throw new DOMException('AbortError', 'AbortError');

        clearTimeout(this._workerTimeout);
        if (!this._worker) this._startWorker();

        const onAbort = () => this._terminateWorker();
        signal.addEventListener('abort', onAbort);

        return abortable(
          signal,
          Promise.race([
            // @ts-ignore - TypeScript can't figure this out
            this._workerApi![methodName](...args),
            this._workerFailure!,
          ]),
        ).finally(() => {
          // No longer care about aborting - this task is complete.
          signal.removeEventListener('abort', onAbort);

          // Start a timer to clear up the worker.
          this._workerTimeout = setTimeout(() => {
            this._terminateWorker();
          }, workerTimeout);
        });
      });

    return this._queue;
  } as any;
}

export default WorkerBridge;
