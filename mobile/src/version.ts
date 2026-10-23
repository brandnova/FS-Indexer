interface Parsed {
  nums: [number, number, number];
  pre: string;
}

function parse(v: string): Parsed | null {
  let s = v.trim().replace(/^v/, '').split('+')[0];
  let pre = '';
  const dash = s.indexOf('-');
  if (dash >= 0) {
    pre = s.slice(dash + 1);
    s = s.slice(0, dash);
  }
  const parts = s.split('.').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { nums: [parts[0], parts[1], parts[2]], pre };
}

function compareIdentifier(x: string, y: string): number {
  const mx = /^(.*?)(\d+)$/.exec(x);
  const my = /^(.*?)(\d+)$/.exec(y);
  if (mx && my && mx[1] === my[1]) return Math.sign(Number(mx[2]) - Number(my[2]));
  return x < y ? -1 : x > y ? 1 : 0;
}

/** True if version a is newer than b. A release is newer than its own release candidates ("rc10" beats "rc9"). */
export function isNewer(a: string, b: string): boolean {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i];
  if (pa.pre === pb.pre) return false;
  if (pa.pre === '') return true;
  if (pb.pre === '') return false;
  const xs = pa.pre.split('.');
  const ys = pb.pre.split('.');
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const c = compareIdentifier(xs[i], ys[i]);
    if (c !== 0) return c > 0;
  }
  return xs.length > ys.length;
}