import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ScanFormat } from '@/lib/barcode';
import { normalizeDetections, type FrameDetector } from './detector';

/**
 * The WASM fallback (D162). This module is its own chunk and is imported only when the browser has
 * no usable `BarcodeDetector`. The `.wasm` binary is served from this origin (Vite copies it into
 * `assets/` and the import above resolves to that URL) instead of the library's jsDelivr default,
 * so the CSP's `connect-src 'self'` holds and nothing leaves the Pi but Open Food Facts calls.
 */

const ZXING_FORMATS: Record<string, ScanFormat> = {
  EAN13: 'ean_13',
  EAN8: 'ean_8',
  UPCA: 'upc_a',
  UPCE: 'upc_e',
};

const READER_OPTIONS: ReaderOptions = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  maxNumberOfSymbols: 1,
};

/** Frames are decoded at most this wide: enough for ~5 px per EAN module, cheap on a phone. */
const MAX_FRAME_WIDTH = 960;

export async function createZxingDetector(): Promise<FrameDetector> {
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
    fireImmediately: true,
  });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable');

  return {
    engine: 'zxing',
    intervalMs: 220,
    async detect(video) {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (sourceWidth === 0 || sourceHeight === 0) return [];
      const scale = Math.min(1, MAX_FRAME_WIDTH / sourceWidth);
      const width = Math.round(sourceWidth * scale);
      const height = Math.round(sourceHeight * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.drawImage(video, 0, 0, width, height);
      const results = await readBarcodes(context.getImageData(0, 0, width, height), READER_OPTIONS);
      return normalizeDetections(
        results
          .filter((result) => result.isValid)
          .map((result) => ({
            rawValue: result.text,
            format: ZXING_FORMATS[result.format] ?? result.format,
          })),
      );
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
