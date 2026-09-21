/**
 * Host abstraction: Helicode runs in the Node extension host (desktop, remote)
 * and in the web worker extension host (vscode.dev, github.dev). Node APIs
 * (`process`, `child_process`) only exist in the former.
 */

declare const process: { versions?: { node?: string }; platform?: string; env?: Record<string, string | undefined> } | undefined;

/** True in the web extension host (no Node APIs). */
export const isWeb: boolean = typeof process === 'undefined' || !process?.versions?.node;

/** `darwin` | `win32` | `linux` | ... or `web`. */
export const platform: string = isWeb ? 'web' : (process?.platform ?? 'unknown');

export function env(name: string): string | undefined {
  if (isWeb) return undefined;
  return process?.env?.[name];
}

/** Verbose logging to the debug console (HELICODE_TRACE=1). */
export const trace: boolean = !!env('HELICODE_TRACE');

export function homeDir(): string | undefined {
  return env('HOME') ?? env('USERPROFILE');
}
