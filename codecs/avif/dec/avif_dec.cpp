#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "avif/avif.h"

using namespace emscripten;

thread_local const val Uint8ClampedArray = val::global("Uint8ClampedArray");
thread_local const val ImageData = val::global("ImageData");

val decode(std::string avifimage) {
  avifImage* image = avifImageCreateEmpty();
  avifDecoder* decoder = avifDecoderCreate();
  if (!image || !decoder) {
    if (image)
      avifImageDestroy(image);
    if (decoder)
      avifDecoderDestroy(decoder);
    return val::null();
  }
  decoder->imageSizeLimit = 32000000;
  avifResult decodeResult =
      avifDecoderReadMemory(decoder, image, (uint8_t*)avifimage.c_str(), avifimage.length());
  // image is an independent copy of decoded data, decoder may be destroyed here
  avifDecoderDestroy(decoder);

  val result = val::null();

  if (decodeResult == AVIF_RESULT_OK) {
    // Convert to interleaved RGB(A)/BGR(A) using a libavif-allocated buffer.
    avifRGBImage rgb;
    avifRGBImageSetDefaults(&rgb,
                            image);  // Defaults to AVIF_RGB_FORMAT_RGBA which is what we want.
    rgb.depth = 8;  // Does not need to match image->depth. We always want 8-bit pixels.

    if (avifRGBImageAllocatePixels(&rgb) != AVIF_RESULT_OK) {
      avifImageDestroy(image);
      return val::null();
    }
    if (avifImageYUVToRGB(image, &rgb) != AVIF_RESULT_OK) {
      avifRGBImageFreePixels(&rgb);
      avifImageDestroy(image);
      return val::null();
    }

    // We want to create a *copy* of the decoded data to be owned by the JavaScript side.
    // For that, we perform `new Uint8Array(wasmMemBuffer, wasmPtr, wasmSize).slice()`:
    result = ImageData.new_(
        Uint8ClampedArray.new_(typed_memory_view(rgb.rowBytes * rgb.height, rgb.pixels)), rgb.width,
        rgb.height);

    // Now we can safely free the RGB pixels:
    avifRGBImageFreePixels(&rgb);
  }

  // Image has been converted to RGB, we don't need the original anymore.
  avifImageDestroy(image);

  return result;
}

EMSCRIPTEN_BINDINGS(my_module) {
  function("decode", &decode);
}
