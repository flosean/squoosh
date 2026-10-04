/** Read container headers without loading the full compressed image into memory. */
export async function avifBrands(blob: Blob): Promise<string[]> {
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (
    header.length < 16 ||
    String.fromCharCode(...header.slice(4, 8)) !== 'ftyp'
  )
    return [];
  const view = new DataView(header.buffer);
  let size = view.getUint32(0);
  let offset = 8;
  if (size === 1) {
    size = view.getUint32(8) * 0x100000000 + view.getUint32(12);
    offset = 16;
  } else if (size === 0) {
    size = blob.size;
  }
  if (
    size < offset + 8 ||
    size > blob.size ||
    size > 65536 ||
    (size - offset) % 4
  )
    return [];
  const bytes = new Uint8Array(await blob.slice(offset, size).arrayBuffer());
  const brands = [String.fromCharCode(...bytes.slice(0, 4))];
  for (let i = 8; i < bytes.length; i += 4)
    brands.push(String.fromCharCode(...bytes.slice(i, i + 4)));
  return brands;
}

export async function isAnimatedImage(
  blob: Blob,
  mime: string,
): Promise<boolean> {
  if (mime === 'image/avif') return (await avifBrands(blob)).includes('avis');
  if (mime !== 'image/png' && mime !== 'image/webp') return false;
  const png = mime === 'image/png';
  let offset = png ? 8 : 12;
  for (let count = 0; count < 10000 && offset + 8 <= blob.size; count++) {
    const bytes = new Uint8Array(
      await blob.slice(offset, offset + 9).arrayBuffer(),
    );
    const view = new DataView(bytes.buffer);
    const type = String.fromCharCode(...bytes.slice(png ? 4 : 0, png ? 8 : 4));
    const size = view.getUint32(png ? 0 : 4, !png);
    if (
      (png && type === 'acTL') ||
      (!png && (type === 'ANIM' || type === 'ANMF'))
    )
      return true;
    if (!png && type === 'VP8X' && bytes.length > 8 && bytes[8] & 2)
      return true;
    if (png && (type === 'IDAT' || type === 'IEND')) return false;
    const next = offset + 8 + size + (png ? 4 : size % 2);
    if (next > blob.size) throw Error('圖片容器不完整');
    offset = next;
  }
  if (offset + 8 <= blob.size) throw Error('圖片容器包含過多區塊');
  return false;
}
