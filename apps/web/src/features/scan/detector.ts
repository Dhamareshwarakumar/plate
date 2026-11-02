import { normalizeScannedCode, SCAN_FORMATS, type ScanFormat } from '@/lib/barcode';

/**
 * One decoder behind the scanner: the browser's Barcode Detection API when it exists and can read
 * retail codes (Chrome on Android and macOS, Edge), otherwise `zxing-wasm` in a lazily loaded chunk
 * (Safari, Firefox, Chrome on Windows/Linux). `detect` returns the codes of one video frame, already
 * checked and normalised (`lib/barcode.ts`); misreads are dropped here, never shown.
 */
export interface FrameDetector {
  readonly engine: 'native' | 'zxing';
  /** How long to wait between frames: native decoding is nearly free, WASM decoding is not. */
  readonly intervalMs: number;
  detect(video: HTMLVideoElement): Promise<string[]>;
  /** Releases what the detector holds (canvas, module); the sheet calls it when it closes. */
  dispose(): void;
}

// The Shape Detection API is not in TypeScript's DOM lib yet.
interface NativeDetectedBarcode {
  rawValue: string;
  format: string;
}
interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<NativeDetectedBarcode[]>;
}
interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

function nativeCtor(): NativeBarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof ctor === 'function' ? (ctor as NativeBarcodeDetectorCtor) : null;
}

const isScanFormat = (format: string): format is ScanFormat =>
  (SCAN_FORMATS as readonly string[]).includes(format);

/** Normalises and de-duplicates one frame's raw detections. */
export function normalizeDetections(
  hits: readonly { rawValue: string; format: string }[],
): string[] {
  const codes = new Set<string>();
  for (const hit of hits) {
    if (!isScanFormat(hit.format)) continue;
    const code = normalizeScannedCode(hit.rawValue, hit.format);
    if (code !== null) codes.add(code);
  }
  return [...codes];
}

/**
 * Picks the engine. Native is used only when the browser reports every retail format as
 * supported (Chrome on Linux exposes the class with an empty format list). Rejects when neither
 * engine can be set up, which the sheet shows as "unsupported".
 */
export async function createDetector(): Promise<FrameDetector> {
  const ctor = nativeCtor();
  if (ctor) {
    try {
      const supported = await ctor.getSupportedFormats();
      if (SCAN_FORMATS.every((format) => supported.includes(format))) {
        const detector = new ctor({ formats: [...SCAN_FORMATS] });
        return {
          engine: 'native',
          intervalMs: 120,
          detect: async (video) => normalizeDetections(await detector.detect(video)),
          dispose: () => undefined,
        };
      }
    } catch {
      // Fall through to the WASM decoder.
    }
  }
  const { createZxingDetector } = await import('./zxing-detector');
  return createZxingDetector();
}
