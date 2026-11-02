/**
 * Retail barcode maths for the scanner (FR-F5, Phase 10b): GS1 check digits, UPC-E expansion and
 * the normalisation to the code Open Food Facts stores, so a scan can be matched against
 * `food.offCode` and sent to `GET off/product/:code` without a second lookup form.
 */

/** The formats the scanner asks for, in the Barcode Detection API's spelling. */
export type ScanFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e';
export const SCAN_FORMATS: readonly ScanFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

const DIGITS = /^\d+$/;

/**
 * GS1 mod-10 check digit for `body` (the code without its last digit): weights 3,1,3,1… from the
 * rightmost body digit. Works for EAN-8, UPC-A, EAN-13 and GTIN-14 alike.
 */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** True for an 8, 12, 13 or 14 digit code whose last digit is the correct GS1 check digit. */
export function isValidGtin(code: string): boolean {
  if (!DIGITS.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/**
 * UPC-E → UPC-A (12 digits, check digit included). Accepts the 6 data digits, number system + 6,
 * or number system + 6 + check digit (what detectors return). Returns null when the number system
 * is not 0/1, the digits are not digits, or a supplied check digit does not match.
 */
export function expandUpcE(code: string): string | null {
  if (!DIGITS.test(code) || code.length < 6 || code.length > 8) return null;
  const system = code.length === 6 ? '0' : code.charAt(0);
  if (system !== '0' && system !== '1') return null;
  const data = code.length === 6 ? code : code.slice(1, 7);
  const check = code.length === 8 ? code.charAt(7) : null;
  const d = (i: number) => data.charAt(i);
  const last = d(5);
  let body: string;
  if (last === '0' || last === '1' || last === '2') {
    body = `${system}${d(0)}${d(1)}${last}0000${d(2)}${d(3)}${d(4)}`;
  } else if (last === '3') {
    body = `${system}${d(0)}${d(1)}${d(2)}00000${d(3)}${d(4)}`;
  } else if (last === '4') {
    body = `${system}${d(0)}${d(1)}${d(2)}${d(3)}00000${d(4)}`;
  } else {
    body = `${system}${d(0)}${d(1)}${d(2)}${d(3)}${d(4)}0000${last}`;
  }
  const expanded = body + String(gs1CheckDigit(body));
  if (check !== null && check !== expanded.charAt(11)) return null;
  return expanded;
}

/**
 * The code Open Food Facts keeps for a scanned retail barcode: EAN-13 and EAN-8 as printed,
 * UPC-A left-padded to 13 digits (OFF's canonical form, verified against their API), UPC-E
 * expanded to UPC-A first. Null when the check digit fails or the format is not a retail code,
 * so a misread frame is dropped instead of looked up.
 */
export function normalizeScannedCode(raw: string, format: ScanFormat): string | null {
  const code = raw.trim();
  if (format === 'upc_e') {
    const expanded = expandUpcE(code);
    return expanded === null ? null : `0${expanded}`;
  }
  if (!isValidGtin(code)) return null;
  if (format === 'ean_8') return code.length === 8 ? code : null;
  // Detectors differ on UPC-A: some report the 12 digits as `upc_a`, others the zero-padded 13 as
  // `ean_13`; both end up in OFF's 13-digit form.
  if (code.length === 12) return `0${code}`;
  return code.length === 13 ? code : null;
}

/**
 * Compares a library food's stored code with a scanned one: OFF pads codes shorter than 13 digits
 * (other than EAN-8) with leading zeros, so a food saved before this rule or imported from a CSV
 * may hold the 12-digit UPC-A form.
 */
export function sameBarcode(stored: string | null, scanned: string): boolean {
  if (stored === null) return false;
  const a = stored.trim();
  if (a === scanned) return true;
  if (a.length === 8 || scanned.length === 8) return false;
  return a.replace(/^0+/, '') === scanned.replace(/^0+/, '');
}
