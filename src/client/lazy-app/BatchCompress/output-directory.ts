import { get, set, del } from 'idb-keyval';
import { assertSignal } from '../util';

export interface DirectoryHandle {
  readonly name: string;
  readonly kind: 'directory';
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }>;
  }>;
}

const storageKey = 'batch-output-directory-v1';

export async function loadDirectory(): Promise<DirectoryHandle | undefined> {
  const handle = await get<DirectoryHandle | undefined>(storageKey);
  return handle?.kind === 'directory' ? handle : undefined;
}

export function rememberDirectory(handle: DirectoryHandle): Promise<void> {
  return set(storageKey, handle);
}

export function forgetDirectory(): Promise<void> {
  return del(storageKey);
}

export async function authorizeDirectory(handle: DirectoryHandle) {
  const options = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(options)) === 'granted') return;
  if ((await handle.requestPermission(options)) !== 'granted') {
    throw Error('尚未取得輸出資料夾的寫入權限，請再次授權或變更資料夾');
  }
}

export function pickDirectory(): Promise<DirectoryHandle> {
  const picker = (window as any).showDirectoryPicker;
  if (!picker) throw Error('請使用最新版 Chrome 或 Edge 開啟此工具');
  return picker.call(window, { mode: 'readwrite', id: 'squoosh-output' });
}

/** Serialize name allocation AND writing across all same-origin windows. */
export async function writeUniqueFile(
  directory: DirectoryHandle,
  desiredName: string,
  data: Blob,
  signal: AbortSignal,
): Promise<string> {
  const locks = (navigator as any).locks;
  if (!locks) throw Error('瀏覽器不支援安全寫入，請使用最新版 Chrome 或 Edge');
  return locks.request('squoosh-batch-output', { signal }, async () => {
    for (let number = 1; ; number++) {
      assertSignal(signal);
      const dot = desiredName.lastIndexOf('.');
      const name =
        number === 1
          ? desiredName
          : `${desiredName.slice(0, dot)} (${number})${desiredName.slice(dot)}`;
      try {
        await directory.getFileHandle(name);
        continue;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TypeMismatchError')
          continue;
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError')
          throw error;
      }
      assertSignal(signal);
      const file = await directory.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      try {
        assertSignal(signal);
        await writable.write(data);
        assertSignal(signal);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      return name;
    }
  });
}
