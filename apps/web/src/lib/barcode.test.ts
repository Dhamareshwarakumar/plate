import { describe, expect, it } from 'vitest';
import {
  expandUpcE,
  gs1CheckDigit,
  isValidGtin,
  normalizeScannedCode,
  sameBarcode,
} from './barcode';

describe('gs1CheckDigit / isValidGtin', () => {
  it('computes the check digit of EAN-13, UPC-A, EAN-8 and GTIN-14 bodies', () => {
    expect(gs1CheckDigit('500015948469')).toBe(5); // Twix 5000159484695
    expect(gs1CheckDigit('04900000634')).toBe(6); // Coca-Cola UPC-A 049000006346
    expect(gs1CheckDigit('9638507')).toBe(4); // EAN-8 96385074
    expect(gs1CheckDigit('1234567890123')).toBe(1); // GTIN-14 12345678901231
    expect(gs1CheckDigit('0000000')).toBe(0);
  });

  it('accepts codes whose last digit matches and rejects everything else', () => {
    expect(isValidGtin('5000159484695')).toBe(true);
    expect(isValidGtin('049000006346')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('12345678901231')).toBe(true);
    expect(isValidGtin('5000159484694')).toBe(false); // one off
    expect(isValidGtin('5000159484659')).toBe(false); // transposed
    expect(isValidGtin('500015948469')).toBe(false); // 12 digits but not a UPC-A
    expect(isValidGtin('1234567')).toBe(false); // wrong length
    expect(isValidGtin('500015948469x')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });
});

describe('expandUpcE', () => {
  it('expands every compression pattern and appends the UPC-A check digit', () => {
    // Manufacturer 12345, product 00006 (last digit 5–9 pattern): the literal vector.
    expect(expandUpcE('123456')).toBe('012345000065');
    expect(expandUpcE('0123456')).toBe('012345000065');
    expect(expandUpcE('01234565')).toBe('012345000065'); // with its check digit
    const withCheck = (body: string) => body + String(gs1CheckDigit(body));
    expect(expandUpcE('0123450')).toBe(withCheck('01200000345')); // manufacturer ends in 000
    expect(expandUpcE('0123453')).toBe(withCheck('01230000045')); // manufacturer ends in 00
    expect(expandUpcE('0123454')).toBe(withCheck('01234000005')); // manufacturer ends in 0
    expect(expandUpcE('1123456')).toBe(withCheck('11234500006')); // number system 1
  });

  it('rejects number systems other than 0/1, wrong lengths, non-digits and a bad check digit', () => {
    expect(expandUpcE('2123456')).toBeNull();
    expect(expandUpcE('12345')).toBeNull();
    expect(expandUpcE('012345678')).toBeNull();
    expect(expandUpcE('01234a6')).toBeNull();
    expect(expandUpcE('01234566')).toBeNull();
  });
});

describe('normalizeScannedCode', () => {
  it('keeps EAN-13 and EAN-8 as printed', () => {
    expect(normalizeScannedCode('5000159484695', 'ean_13')).toBe('5000159484695');
    expect(normalizeScannedCode(' 96385074 ', 'ean_8')).toBe('96385074');
  });

  it("pads UPC-A to Open Food Facts' 13-digit form, whichever format the detector reported", () => {
    expect(normalizeScannedCode('049000006346', 'upc_a')).toBe('0049000006346');
    expect(normalizeScannedCode('0049000006346', 'upc_a')).toBe('0049000006346');
    expect(normalizeScannedCode('049000006346', 'ean_13')).toBe('0049000006346');
  });

  it('expands UPC-E through UPC-A to the 13-digit form', () => {
    expect(normalizeScannedCode('01234565', 'upc_e')).toBe('0012345000065');
    expect(normalizeScannedCode('01234566', 'upc_e')).toBeNull();
  });

  it('drops misreads: bad check digit, wrong length for the format, non-digits', () => {
    expect(normalizeScannedCode('5000159484694', 'ean_13')).toBeNull();
    expect(normalizeScannedCode('5000159484695', 'ean_8')).toBeNull();
    expect(normalizeScannedCode('96385074', 'ean_13')).toBeNull();
    expect(normalizeScannedCode('12345678901231', 'ean_13')).toBeNull();
    expect(normalizeScannedCode('abc', 'ean_13')).toBeNull();
  });
});

describe('sameBarcode', () => {
  it('matches exact codes and the 12-digit UPC-A form of a padded code', () => {
    expect(sameBarcode('5000159484695', '5000159484695')).toBe(true);
    expect(sameBarcode('049000006346', '0049000006346')).toBe(true);
    expect(sameBarcode('0049000006346', '0049000006346')).toBe(true);
  });

  it('never equates EAN-8 with a longer code and ignores null', () => {
    expect(sameBarcode('96385074', '0000096385074')).toBe(false);
    expect(sameBarcode(null, '5000159484695')).toBe(false);
    expect(sameBarcode('5000159484695', '5000159484694')).toBe(false);
  });
});
