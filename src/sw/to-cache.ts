// Give TypeScript the correct global.
declare var self: ServiceWorkerGlobalScope;

function subtractSets<T extends any>(set1: Set<T>, set2: Set<T>): Set<T> {
  const result = new Set(set1);
  for (const item of set2) result.delete(item);
  return result;
}

// Initial app stuff
import * as initialApp from 'entry-data:client/initial-app';
import swUrl from 'service-worker:sw';
import * as batchCompress from 'entry-data:client/lazy-app/BatchCompress';
import * as swBridge from 'entry-data:client/lazy-app/sw-bridge';

// The processors and codecs
// Simple stuff everyone gets:
import * as featuresWorker from 'entry-data:../features-worker';

import { codecEntries } from './codec-cache';

export function shouldCacheDynamically(url: string) {
  return url.startsWith('/c/demo-');
}

let initialJs = new Set([
  batchCompress.main,
  ...batchCompress.deps,
  swBridge.main,
  ...swBridge.deps,
]);
initialJs = subtractSets(
  initialJs,
  new Set([
    initialApp.main,
    ...initialApp.deps.filter(
      (item) =>
        // Exclude JS deps that have been inlined:
        item.endsWith('.js') ||
        // As well as large image deps we want to keep dynamic:
        shouldCacheDynamically(item),
    ),
    // Exclude features Worker itself - it's referenced from the main app,
    // but is meant to be cached lazily.
    featuresWorker.main,
    // Also exclude Service Worker itself (we're inside right now).
    swUrl,
  ]),
);

export const initial = ['/', ...initialJs];

// Service workers and processing workers have different capabilities.
// Cache all shipped variants so offline selection cannot request an absent codec.
export const theRest = Promise.resolve([
  ...new Set(
    [featuresWorker, ...codecEntries].flatMap((entry) => [
      entry.main,
      ...entry.deps,
    ]),
  ),
]);
