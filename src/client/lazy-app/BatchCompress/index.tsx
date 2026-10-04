import type SnackBarElement from 'shared/custom-els/snack-bar';

import { h, Component } from 'preact';

import WorkerBridge from '../worker-bridge';
import { assertSignal, sniffMimeType } from '../util';
import { SupportedMime, decodeImage, encodeImage } from './codec';
import * as style from './style.css';
import 'add-css:./style.css';
import { Theme, currentTheme, applyTheme } from './theme';
import { batchConcurrency } from 'shared/batch-budget';
import { isAnimatedImage } from '../util/image-container';
import {
  DirectoryHandle,
  loadDirectory,
  rememberDirectory,
  forgetDirectory,
  authorizeDirectory,
  pickDirectory,
  writeUniqueFile,
} from './output-directory';

type JobStatus = 'queued' | 'compressing' | 'done' | 'error' | 'cancelled';

interface Job {
  id: number;
  file: File;
  status: JobStatus;
  outputName?: string;
  outputSize?: number;
  message?: string;
}

interface Props {
  showSnack: SnackBarElement['showSnackbar'];
}

interface State {
  theme: Theme;
  jobs: Job[];
  dragging: boolean;
  running: boolean;
  finished: boolean;
  beforeInstallEvent?: BeforeInstallPromptEvent;
  directory?: DirectoryHandle;
  directoryBusy: boolean;
  stopped: boolean;
}

const supportedMimes = new Set<SupportedMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function savingPercent(input: number, output: number): string {
  return `${Math.max(0, ((input - output) / input) * 100).toFixed(1)}%`;
}

function outputName(fileName: string, mime: SupportedMime): string {
  const extension: Record<SupportedMime, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  const baseName = fileName.replace(/\.[^.]*$/, '') || 'image';
  return `${baseName}-compressed.${extension[mime]}`;
}

export default class BatchCompress extends Component<Props, State> {
  state: State = {
    theme: currentTheme(),
    jobs: [],
    dragging: false,
    running: false,
    finished: false,
    directoryBusy: true,
    stopped: false,
  };

  private nextId = 1;
  private fileInput?: HTMLInputElement;
  private controller?: AbortController;
  private busy = false;
  private unmounted = false;

  componentDidMount() {
    window.addEventListener('storage', this.onThemeStorage);
    loadDirectory()
      .then((directory) => {
        if (!this.unmounted) this.setState({ directory });
      })
      .catch(() => {
        this.props.showSnack('無法讀取已儲存的輸出資料夾，請重新選擇', {
          timeout: 5000,
        });
      })
      .finally(() => {
        if (!this.unmounted) this.setState({ directoryBusy: false });
      });
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    window.addEventListener('appinstalled', this.onAppInstalled);
  }

  componentWillUnmount() {
    window.removeEventListener('storage', this.onThemeStorage);
    this.unmounted = true;
    this.controller?.abort();
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPrompt,
    );
    window.removeEventListener('appinstalled', this.onAppInstalled);
  }

  private onThemeStorage = (event: StorageEvent) => {
    if (event.key !== 'squoosh-theme' && event.key !== null) return;
    const theme =
      event.newValue === 'dark'
        ? 'dark'
        : event.newValue === 'light'
        ? 'light'
        : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    document.documentElement.dataset.theme = theme;
    this.setState({ theme });
  };

  private onThemeChange = (event: Event) => {
    const theme = (event.currentTarget as HTMLSelectElement).value as Theme;
    this.setState({ theme });
    if (!applyTheme(theme))
      this.props.showSnack('已切換主題，但瀏覽器無法記住設定', {
        timeout: 5000,
      });
  };

  private onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.controller) return;
    event.preventDefault();
    event.returnValue = '';
  };

  private saveDirectory = async (directory: DirectoryHandle) => {
    this.setState({ directory });
    try {
      await rememberDirectory(directory);
    } catch {
      this.props.showSnack('此資料夾可在本次使用，但瀏覽器無法記住設定', {
        timeout: 5000,
      });
    }
  };

  private chooseDirectory = async () => {
    if (this.busy || this.state.directoryBusy) return;
    this.busy = true;
    this.setState({ directoryBusy: true });
    try {
      await this.saveDirectory(await pickDirectory());
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.props.showSnack(
          error instanceof Error ? error.message : '無法開啟資料夾',
          { timeout: 5000 },
        );
      }
    } finally {
      this.busy = false;
      this.setState({ directoryBusy: false });
    }
  };

  private clearDirectory = async () => {
    if (this.busy || this.state.directoryBusy) return;
    this.busy = true;
    this.setState({ directoryBusy: true });
    try {
      await forgetDirectory();
      this.setState({ directory: undefined });
    } catch {
      this.props.showSnack('無法清除資料夾設定，請再試一次', { timeout: 5000 });
    } finally {
      this.busy = false;
      this.setState({ directoryBusy: false });
    }
  };

  private cancel = () => this.controller?.abort();

  private onBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
    event.preventDefault();
    this.setState({ beforeInstallEvent: event });
  };

  private onAppInstalled = () => {
    this.setState({ beforeInstallEvent: undefined });
  };

  private install = async () => {
    const event = this.state.beforeInstallEvent;
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    this.setState({ beforeInstallEvent: undefined });
  };

  private addFiles = (files: FileList | File[]) => {
    if (this.busy) return;
    const jobs = Array.from(files).map((file) => ({
      id: this.nextId++,
      file,
      status: 'queued' as const,
    }));
    if (!jobs.length) return;
    this.setState({
      jobs: [...this.state.jobs, ...jobs],
      finished: false,
    });
  };

  private onFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files) this.addFiles(input.files);
    input.value = '';
  };

  private onDrop = (event: DragEvent) => {
    event.preventDefault();
    this.setState({ dragging: false });
    if (event.dataTransfer?.files) this.addFiles(event.dataTransfer.files);
  };

  private removeJob = (id: number) => {
    if (this.busy) return;
    this.setState({ jobs: this.state.jobs.filter((job) => job.id !== id) });
  };

  private clearJobs = () => {
    if (!this.state.running) {
      this.setState({ jobs: [], finished: false });
    }
  };

  private updateJob = (id: number, update: Partial<Job>) => {
    if (this.unmounted) return;
    this.setState((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id ? { ...job, ...update } : job,
      ),
    }));
  };

  private processJob = async (
    job: Job,
    directory: DirectoryHandle,
    workerBridge: WorkerBridge,
    signal: AbortSignal,
  ): Promise<void> => {
    this.updateJob(job.id, {
      status: 'compressing',
      outputName: undefined,
      outputSize: undefined,
      message: undefined,
    });

    try {
      if (job.file.size > 128 * 1024 * 1024)
        throw Error('單張圖片超過 128 MB 上限');
      const detectedMime = await sniffMimeType(job.file);
      if (!supportedMimes.has(detectedMime as SupportedMime)) {
        throw Error('不支援此檔案格式');
      }
      const mime = detectedMime as SupportedMime;
      const animated = await isAnimatedImage(job.file, mime);
      assertSignal(signal);
      let result: Blob = job.file;
      if (!animated) {
        const image = await decodeImage(signal, job.file, mime, workerBridge);
        const compressed = await encodeImage(signal, image, mime, workerBridge);
        if (!compressed.size) throw Error('編碼器未產生有效圖片');
        if (compressed.size < job.file.size) result = compressed;
      }
      const outputFileName = await writeUniqueFile(
        directory,
        outputName(job.file.name, mime),
        result,
        signal,
      );
      this.updateJob(job.id, {
        status: 'done',
        outputSize: result.size,
        outputName: outputFileName,
        message: animated
          ? '保留動畫，已原樣複製'
          : result === job.file
          ? '原檔已是較小版本，已直接複製'
          : undefined,
      });
    } catch (error) {
      this.updateJob(job.id, {
        status: signal.aborted ? 'cancelled' : 'error',
        message: signal.aborted
          ? '已取消，可再次壓縮'
          : error instanceof Error
          ? error.message
          : '壓縮失敗',
      });
    }
  };

  private start = async () => {
    if (this.busy || this.state.directoryBusy) return;
    const jobs = this.state.jobs.filter((job) => job.status !== 'done');
    if (!jobs.length) return;
    this.busy = true;
    this.setState({ directoryBusy: true, stopped: false });
    try {
      let directory = this.state.directory;
      if (directory) {
        await authorizeDirectory(directory);
      } else {
        directory = await pickDirectory();
        await this.saveDirectory(directory);
      }
      if (this.unmounted) return;
      const controller = new AbortController();
      this.controller = controller;
      this.setState({ running: true, finished: false, directoryBusy: false });
      let nextIndex = 0;
      await Promise.all(
        Array.from({ length: batchConcurrency() }, async () => {
          const bridge = new WorkerBridge();
          try {
            while (!controller.signal.aborted) {
              const job = jobs[nextIndex++];
              if (!job) break;
              await this.processJob(job, directory!, bridge, controller.signal);
            }
          } finally {
            bridge.dispose();
          }
        }),
      );
      if (!this.unmounted)
        this.setState({ finished: true, stopped: controller.signal.aborted });
    } catch (error) {
      if (
        !(error instanceof DOMException && error.name === 'AbortError') &&
        !this.unmounted
      ) {
        this.props.showSnack(
          error instanceof Error ? error.message : '無法開始壓縮',
          { timeout: 6000 },
        );
      }
    } finally {
      this.controller = undefined;
      this.busy = false;
      if (!this.unmounted)
        this.setState({ running: false, directoryBusy: false });
    }
  };

  render(
    {}: Props,
    {
      jobs,
      dragging,
      running,
      finished,
      beforeInstallEvent,
      directory,
      directoryBusy,
      stopped,
    }: State,
  ) {
    const doneCount = jobs.filter((job) => job.status === 'done').length;
    const errorCount = jobs.filter((job) => job.status === 'error').length;
    const hasPendingJobs = jobs.some((job) => job.status !== 'done');

    return (
      <main class={style.page}>
        <header class={style.header}>
          <label class={style.themePicker}>
            外觀
            <select
              aria-label="外觀主題"
              value={this.state.theme}
              onChange={this.onThemeChange}
            >
              <option value="light">明亮</option>
              <option value="dark">暗色</option>
            </select>
          </label>
          <div class={style.brand}>Squoosh</div>
          <h1>批次圖片壓縮</h1>
          <p>圖片只會在這台電腦上處理，不會上傳。</p>
          {beforeInstallEvent && (
            <button class={style.installButton} onClick={this.install}>
              安裝到 Windows
            </button>
          )}
        </header>

        <section
          class={`${style.dropZone} ${dragging ? style.dragging : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            this.setState({ dragging: true });
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) {
              this.setState({ dragging: false });
            }
          }}
          onDrop={this.onDrop}
        >
          <input
            ref={(input) => (this.fileInput = input || undefined)}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif"
            multiple
            onChange={this.onFileChange}
          />
          <div class={style.dropIcon}>＋</div>
          <strong>將圖片拖到這裡</strong>
          <span>支援 JPG、PNG、WebP、AVIF</span>
          <button
            type="button"
            disabled={running || directoryBusy}
            onClick={() => this.fileInput?.click()}
          >
            選取圖片
          </button>
        </section>

        <section class={style.outputSettings} aria-label="輸出資料夾設定">
          <div>
            <strong>預設輸出資料夾</strong>
            <span data-output-directory>
              {directory ? directory.name : '尚未設定，開始壓縮時選擇'}
            </span>
            <small>會記住此資料夾；瀏覽器需要時會再次要求寫入授權。</small>
          </div>
          <div class={style.actions}>
            <button
              class={style.secondaryButton}
              disabled={running || directoryBusy}
              onClick={this.chooseDirectory}
            >
              {directory ? '變更資料夾' : '選擇資料夾'}
            </button>
            {directory && (
              <button
                class={style.secondaryButton}
                disabled={running || directoryBusy}
                onClick={this.clearDirectory}
              >
                清除設定
              </button>
            )}
          </div>
        </section>

        <section class={style.workspace}>
          <div class={style.toolbar}>
            <div>
              <strong>{jobs.length} 張圖片</strong>
              {running && (
                <span>正在處理，最多同時 {batchConcurrency()} 張…</span>
              )}
              {finished && (
                <span>
                  {stopped ? '已停止，' : ''}完成 {doneCount} 張
                  {errorCount ? `，失敗 ${errorCount} 張` : ''}
                </span>
              )}
            </div>
            <div class={style.actions}>
              <button
                type="button"
                class={style.secondaryButton}
                disabled={!jobs.length || running || directoryBusy}
                onClick={this.clearJobs}
              >
                清空
              </button>
              <button
                type="button"
                class={style.primaryButton}
                disabled={!hasPendingJobs || running || directoryBusy}
                onClick={this.start}
              >
                {running ? '壓縮中…' : '全部壓縮'}
              </button>
              {running && (
                <button
                  type="button"
                  class={style.secondaryButton}
                  onClick={this.cancel}
                >
                  取消壓縮
                </button>
              )}
            </div>
          </div>

          {jobs.length ? (
            <ul class={style.jobs}>
              {jobs.map((job) => (
                <li class={style.job} key={job.id}>
                  <div class={style.fileInfo}>
                    <strong title={job.file.name}>{job.file.name}</strong>
                    <span>{prettyBytes(job.file.size)}</span>
                  </div>
                  <div class={style.result}>
                    {job.status === 'queued' && <span>等待壓縮</span>}
                    {job.status === 'cancelled' && <span>已取消</span>}
                    {job.status === 'compressing' && (
                      <span class={style.processing}>壓縮中…</span>
                    )}
                    {job.status === 'done' &&
                      job.outputSize !== undefined && [
                        <strong key="size">
                          {prettyBytes(job.outputSize)}
                        </strong>,
                        <span key="saving">
                          節省 {savingPercent(job.file.size, job.outputSize)}
                        </span>,
                      ]}
                    {job.status === 'error' && (
                      <strong class={style.error}>處理失敗</strong>
                    )}
                    {job.message && <small>{job.message}</small>}
                    {job.outputName && <small>{job.outputName}</small>}
                  </div>
                  <button
                    type="button"
                    class={style.removeButton}
                    aria-label={`移除 ${job.file.name}`}
                    title="移除"
                    disabled={running || directoryBusy}
                    onClick={() => this.removeJob(job.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div class={style.empty}>尚未加入圖片</div>
          )}
        </section>
      </main>
    );
  }
}
