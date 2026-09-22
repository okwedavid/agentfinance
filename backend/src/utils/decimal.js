// decimal.js — exact fixed-point arithmetic for BNB accounting.
//
// All reward/pool amounts are stored as decimal STRINGS and manipulated here
// as BigInt scaled by 1e18 (wei-equivalent). Floating point Number math is
// never used for money, so balances can never drift or round-trip into
// artifacts. Multipliers are applied as integer numerator/denominator ratios.

export const WEI = 1000000000000000000n;

export function toUnits(input) {
  if (typeof input === 'bigint') return input;
  const s = String(input ?? '0').trim();
  if (s === '' ) return 0n;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  if (!/^\d+(\.\d*)?$/.test(body)) {
    throw new Error(`Invalid decimal value: ${input}`);
  }
  const [int, frac = ''] = body.split('.');
  const intUnits = BigInt(int || '0') * WEI;
  const fracUnits = BigInt((frac + '0'.repeat(18)).slice(0, 18));
  const units = intUnits + fracUnits;
  return neg ? -units : units;
}

export function fromUnits(units, maxDecimals = 8) {
  const raw = typeof units === 'bigint' ? units : toUnits(units);
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const int = abs / WEI;
  const frac = abs % WEI;
  const fracStr = frac.toString().padStart(18, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${fracStr ? '.' + fracStr : ''}`;
}

export function add(a, b) {
  return toUnits(a) + toUnits(b);
}

export function sub(a, b) {
  return toUnits(a) - toUnits(b);
}

export function gt(a, b) {
  return toUnits(a) > toUnits(b);
}

export function gte(a, b) {
  return toUnits(a) >= toUnits(b);
}

export function lt(a, b) {
  return toUnits(a) < toUnits(b);
}

export function lte(a, b) {
  return toUnits(a) <= toUnits(b);
}

export function isZero(value) {
  return toUnits(value) === 0n;
}

export function clampNonNegative(units) {
  const value = typeof units === 'bigint' ? units : toUnits(units);
  return value < 0n ? 0n : value;
}

export function negate(units) {
  return -toUnits(units);
}

export function max(a, b) {
  const va = toUnits(a);
  const vb = toUnits(b);
  return va >= vb ? va : vb;
}

export function min(a, b) {
  const va = toUnits(a);
  const vb = toUnits(b);
  return va <= vb ? va : vb;
}

// Convert a decimal string/number into an exact { num, den } BigInt ratio so
// that `valueWei = (wei * num) / den` is pure integer arithmetic.
export function toFraction(value) {
  const s = String(value ?? '0').trim();
  if (!/^\d+(\.\d*)?$/.test(s)) {
    throw new Error(`Invalid ratio value: ${value}`);
  }
  const [int, frac = ''] = s.split('.');
  const digits = (int + frac).replace(/^0+/, '') || '0';
  const den = 10n ** BigInt(frac.length);
  return { num: BigInt(digits), den: den || 1n };
}

// Apply a { num, den } ratio to a wei BigInt with floor semantics.
export function applyFraction(units, fraction) {
  const value = typeof units === 'bigint' ? units : toUnits(units);
  if (fraction.den <= 0n) return value;
  return (value * fraction.num) / fraction.den;
}