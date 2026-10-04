import { transfer } from 'comlink';
import WorkerBridge from '../worker-bridge';
import {
  assertSignal,
  abortable,
  canDecodeImageType,
  builtinDecode,
} from '../util';
import { defaultOptions as mozJPEGOptions } from 'features/encoders/mozJPEG/shared/meta';
import { defaultOptions as oxiPNGOptions } from 'features/encoders/oxiPNG/shared/meta';
import { defaultOptions as webPOptions } from 'features/encoders/webP/shared/meta';
import { defaultOptions as avifOptions } from 'features/encoders/avif/shared/meta';
export type SupportedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/avif';
export const MAX_PIXELS = 32_000_000;

export async function decodeImage(
  signal: AbortSignal,
  blob: Blob,
  mime: SupportedMime,
  workerBridge: WorkerBridge,
): Promise<ImageData> {
  assertSignal(signal);
  const canDecode = await abortable(signal, canDecodeImageType(mime));
  if (!canDecode && mime === 'image/avif') {
    return workerBridge.avifDecode(signal, blob);
  }
  if (!canDecode && mime === 'image/webp') {
    return workerBridge.webpDecode(signal, blob);
  }
  return builtinDecode(signal, blob, MAX_PIXELS);
}

export async function encodeImage(
  signal: AbortSignal,
  image: ImageData,
  mime: SupportedMime,
  workerBridge: WorkerBridge,
): Promise<Blob> {
  if (image.width * image.height > MAX_PIXELS)
    throw Error('圖片超過 3200 萬像素上限');
  transfer(image, [image.data.buffer]);
  switch (mime) {
    case 'image/jpeg':
      return new Blob(
        [await workerBridge.mozjpegEncode(signal, image, mozJPEGOptions)],
        { type: mime },
      );
    case 'image/png':
      return new Blob(
        [await workerBridge.oxipngEncode(signal, image, oxiPNGOptions)],
        { type: mime },
      );
    case 'image/webp':
      return new Blob(
        [await workerBridge.webpEncode(signal, image, webPOptions)],
        { type: mime },
      );
    case 'image/avif':
      return new Blob(
        [await workerBridge.avifEncode(signal, image, avifOptions)],
        { type: mime },
      );
  }
}
