/**
 * Small, dependency-free path helpers (POSIX and Windows) so the extension
 * does not need `node:path` and can run in the web extension host.
 */

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(p);
}

function splitDrive(p: string): [string, string] {
  const m = /^([a-zA-Z]:)([\\/].*)?$/.exec(p);
  if (m) return [m[1], m[2] ?? ''];
  return ['', p];
}

/** Collapse `.`/`..` segments and duplicate separators; keeps `/` separators. */
export function normalizePath(p: string): string {
  const [drive, rest] = splitDrive(p);
  const unix = rest.replace(/\\/g, '/');
  const abs = unix.startsWith('/');
  const out: string[] = [];
  for (const seg of unix.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
      continue;
    }
    out.push(seg);
  }
  const body = out.join('/');
  if (drive) return drive + (abs ? '/' : '') + body;
  return (abs ? '/' : '') + body || (abs ? '/' : '.');
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

export function dirname(p: string): string {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = n.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  const [drive] = splitDrive(n);
  if (drive && i === 2) return drive + '/';
  return n.slice(0, i);
}

export function basename(p: string): string {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return n.slice(n.lastIndexOf('/') + 1);
}

/** Resolve `p` against `base` (absolute paths win). */
export function resolvePath(base: string, p: string): string {
  return isAbsolutePath(p) ? normalizePath(p) : joinPath(base, p);
}

/** Expand a leading `~/` with the given home directory. */
export function expandHome(p: string, home: string | undefined): string {
  if ((p === '~' || p.startsWith('~/') || p.startsWith('~\\')) && home) return joinPath(home, p.slice(1));
  return p;
}
