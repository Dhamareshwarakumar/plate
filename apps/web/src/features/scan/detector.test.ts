import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDetector, normalizeDetections } from './detector';

const zxing = vi.hoisted(() => ({ created: 0 }));
vi.mock('./zxing-detector', () => ({
  createZxingDetector: async () => {
    zxing.created += 1;
    return { engine: 'zxing', intervalMs: 220, detect: async () => [], dispose: () => undefined };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  zxing.created = 0;
});

describe('normalizeDetections', () => {
  it('keeps valid retail codes once, normalised, and drops other formats and misreads', () => {
    expect(
      normalizeDetections([
        { rawValue: '5000159484695', format: 'ean_13' },
        { rawValue: '5000159484695', format: 'ean_13' },
        { rawValue: '049000006346', format: 'upc_a' },
        { rawValue: '5000159484694', format: 'ean_13' },
        { rawValue: 'https://example.com', format: 'qr_code' },
      ]),
    ).toEqual(['5000159484695', '0049000006346']);
  });
});

describe('createDetector', () => {
  it('uses the native BarcodeDetector when it supports every retail format', async () => {
    const detect = vi.fn(async () => [{ rawValue: '96385074', format: 'ean_8' }]);
    class FakeBarcodeDetector {
      static getSupportedFormats = async () => ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'];
      detect = detect;
    }
    vi.stubGlobal('BarcodeDetector', FakeBarcodeDetector);

    const detector = await createDetector();
    expect(detector.engine).toBe('native');
    expect(await detector.detect({} as HTMLVideoElement)).toEqual(['96385074']);
    expect(zxing.created).toBe(0);
  });

  it('falls back to zxing-wasm when the native class is missing or cannot read retail codes', async () => {
    vi.stubGlobal('BarcodeDetector', undefined);
    expect((await createDetector()).engine).toBe('zxing');

    class EmptyDetector {
      static getSupportedFormats = async () => [] as string[];
      detect = async () => [];
    }
    vi.stubGlobal('BarcodeDetector', EmptyDetector);
    expect((await createDetector()).engine).toBe('zxing');
    expect(zxing.created).toBe(2);
  });
});
