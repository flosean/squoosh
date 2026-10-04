// Keep runtime worker exports and offline codec variants in one build manifest.
export const batchMethods = new Set([
  'mozjpegEncode',
  'oxipngEncode',
  'webpEncode',
  'avifEncode',
  'webpDecode',
  'avifDecode',
]);
export const batchCodecEntries = [
  'codecs/avif/dec/avif_dec',
  'codecs/webp/dec/webp_dec',
  'codecs/avif/enc/avif_enc',
  'codecs/oxipng/pkg/squoosh_oxipng',
  'codecs/oxipng/pkg-parallel/squoosh_oxipng',
  'codecs/webp/enc/webp_enc',
  'codecs/webp/enc/webp_enc_simd',
];
export const legacyCodecEntries = [
  'codecs/jxl/enc/jxl_enc',
  'codecs/jxl/enc/jxl_enc_mt',
  'codecs/jxl/enc/jxl_enc_mt_simd',
  'codecs/wp2/enc/wp2_enc',
  'codecs/wp2/enc/wp2_enc_mt',
  'codecs/wp2/enc/wp2_enc_mt_simd',
];
