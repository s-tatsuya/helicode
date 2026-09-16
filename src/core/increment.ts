/**
 * Number / date increment (helix-core/src/increment).
 */

const INT_RE = /^(?<sign>[+-]?)(?:(?<hex>0x[0-9a-fA-F_]+)|(?<oct>0o[0-7_]+)|(?<bin>0b[01_]+)|(?<dec>[0-9][0-9_]*))$/;

export function incrementInteger(selected: string, amount: number): string | undefined {
  const m = INT_RE.exec(selected);
  if (!m || !m.groups) return undefined;
  const g = m.groups;
  const negative = g.sign === '-';
  let radix: number;
  let digits: string;
  let prefix = '';
  if (g.hex) {
    radix = 16;
    digits = g.hex.slice(2);
    prefix = '0x';
  } else if (g.oct) {
    radix = 8;
    digits = g.oct.slice(2);
    prefix = '0o';
  } else if (g.bin) {
    radix = 2;
    digits = g.bin.slice(2);
    prefix = '0b';
  } else {
    radix = 10;
    digits = g.dec;
  }
  const clean = digits.replace(/_/g, '');
  if (clean.length === 0) return undefined;
  let value: bigint;
  try {
    value = BigInt(prefix ? prefix + clean : clean);
  } catch {
    return undefined;
  }
  if (negative) value = -value;
  value += BigInt(amount);

  if (radix === 10) {
    const out = value.toString();
    // Preserve leading zeros width (Helix keeps the original width when padded).
    const width = clean.length;
    const neg = value < 0n;
    const abs = neg ? out.slice(1) : out;
    const padded = clean.startsWith('0') && clean.length > 1 ? abs.padStart(width, '0') : abs;
    return reinsertUnderscores((neg ? '-' : g.sign === '+' ? '+' : '') + padded, digits, selected);
  }

  // Non-decimal: treated as unsigned; negative results wrap at 64 bits. Width is kept (and grows if needed).
  const mod = 1n << 64n;
  const v = ((value % mod) + mod) % mod;
  let s = v.toString(radix);
  const upper = /[A-F]/.test(clean) && !/[a-f]/.test(clean);
  if (upper) s = s.toUpperCase();
  s = s.padStart(clean.length, '0');
  return reinsertUnderscores(prefix + s, digits, selected);
}

function reinsertUnderscores(result: string, originalDigits: string, original: string): string {
  if (!originalDigits.includes('_')) return result;
  // Keep the underscore positions counted from the right when lengths match.
  const positions: number[] = [];
  for (let i = originalDigits.length - 1, k = 0; i >= 0; i--) {
    if (originalDigits[i] === '_') positions.push(k);
    else k++;
  }
  const prefixMatch = /^[+-]?(0x|0o|0b)?/.exec(result);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const digits = result.slice(prefix.length);
  let out = '';
  for (let i = digits.length - 1, k = 0; i >= 0; i--, k++) {
    if (positions.includes(k) && k > 0) out = '_' + out;
    out = digits[i] + out;
  }
  void original;
  return prefix + out;
}

const DATE_FORMATS: { re: RegExp; fmt: (d: Date) => string }[] = [
  {
    re: /^(\d{4})-(\d{2})-(\d{2})$/,
    fmt: (d) => `${d.getUTCFullYear().toString().padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`,
  },
  {
    re: /^(\d{4})\/(\d{2})\/(\d{2})$/,
    fmt: (d) => `${d.getUTCFullYear().toString().padStart(4, '0')}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}`,
  },
];

function p2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function incrementDate(selected: string, amount: number): string | undefined {
  for (const f of DATE_FORMATS) {
    const m = f.re.exec(selected);
    if (!m) continue;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (isNaN(d.getTime())) return undefined;
    d.setUTCDate(d.getUTCDate() + amount);
    return f.fmt(d);
  }
  const time = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(selected);
  if (time) {
    const hasSec = time[3] !== undefined;
    let total = Number(time[1]) * 3600 + Number(time[2]) * 60 + (hasSec ? Number(time[3]) : 0);
    total += amount * (hasSec ? 1 : 60);
    total = ((total % 86400) + 86400) % 86400;
    const h = Math.floor(total / 3600);
    const mi = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return hasSec ? `${p2(h)}:${p2(mi)}:${p2(s)}` : `${p2(h)}:${p2(mi)}`;
  }
  return undefined;
}

export function increment(selected: string, amount: number): string | undefined {
  return incrementInteger(selected, amount) ?? incrementDate(selected, amount);
}
