import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';

import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import * as style from './style.css';
import 'add-css:./style.css';
import 'shared/custom-els/snack-bar';
import 'shared/custom-els/loading-spinner';

const batchCompressPromise = import('client/lazy-app/BatchCompress');
const swBridgePromise = import('client/lazy-app/sw-bridge');

interface Props {}

interface State {
  BatchCompress?: typeof import('client/lazy-app/BatchCompress').default;
  loadFailed?: boolean;
}

export default class App extends Component<Props, State> {
  state: State = {};

  snackbar?: SnackBarElement;

  constructor() {
    super();

    batchCompressPromise
      .then((module) => this.setState({ BatchCompress: module.default }))
      .catch(() => this.setState({ loadFailed: true }));

    swBridgePromise
      .then(({ offliner }) => offliner(this.showSnack))
      .catch(() => {
        this.showSnack('離線資源尚未準備完成，請保持啟動器開啟並重新載入', {
          timeout: 6000,
        });
      });
  }

  private showSnack = (
    message: string,
    options: SnackOptions = {},
  ): Promise<string> => {
    if (!this.snackbar) throw Error('Snackbar missing');
    return this.snackbar.showSnackbar(message, options);
  };

  render({}: Props, { BatchCompress, loadFailed }: State) {
    return (
      <div class={style.app}>
        {BatchCompress ? (
          <BatchCompress showSnack={this.showSnack} />
        ) : (
          <div class={style.loader}>
            {loadFailed ? (
              <div role="alert">
                <p>無法載入批次壓縮工具</p>
                <button onClick={() => location.reload()}>重新載入</button>
              </div>
            ) : (
              <div>
                <loading-spinner />
                <p>正在載入批次壓縮工具…</p>
              </div>
            )}
          </div>
        )}
        <snack-bar ref={linkRef(this, 'snackbar')} />
      </div>
    );
  }
}
