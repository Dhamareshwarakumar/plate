import { describe, expect, it } from 'vitest';
import { base64Bytes, MAX_EDGE, scaleToFit } from './image';

describe('scaleToFit', () => {
  it('shrinks the longer edge to the limit and keeps the ratio', () => {
    expect(scaleToFit(4032, 3024, MAX_EDGE)).toEqual({ width: 1280, height: 960 });
    expect(scaleToFit(3024, 4032, MAX_EDGE)).toEqual({ width: 960, height: 1280 });
    expect(scaleToFit(4000, 1000, 1280)).toEqual({ width: 1280, height: 320 });
  });

  it('never scales up and tolerates a zero-sized bitmap', () => {
    expect(scaleToFit(640, 480, MAX_EDGE)).toEqual({ width: 640, height: 480 });
    expect(scaleToFit(1280, 720, MAX_EDGE)).toEqual({ width: 1280, height: 720 });
    expect(scaleToFit(0, 0, MAX_EDGE)).toEqual({ width: 0, height: 0 });
  });
});

describe('base64Bytes', () => {
  it('returns the decoded size, padding excluded', () => {
    expect(base64Bytes(btoa('a'))).toBe(1);
    expect(base64Bytes(btoa('ab'))).toBe(2);
    expect(base64Bytes(btoa('abc'))).toBe(3);
    expect(base64Bytes(btoa('abcd'))).toBe(4);
    expect(base64Bytes('')).toBe(0);
  });

  it('matches the one-pixel PNG the API tests use', () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    expect(base64Bytes(png)).toBe(70);
  });
});
