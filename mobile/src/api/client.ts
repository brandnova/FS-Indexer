// expo/fetch (not the global fetch) because it supports streaming response
// bodies, which the sync needs. We use it everywhere for consistency.
import { fetch } from 'expo/fetch';
import type { Candidate, PingResponse } from '../types';

export type ApiErrorKind = 'unauthorized' | 'forbidden' | 'network' | 'timeout' | 'server';

const MESSAGES: Record<ApiErrorKind, string> = {
  unauthorized: 'The PC rejected the token. Check it and try again.',
  forbidden: 'The PC refused the connection. It only accepts devices on its local network.',
  network: 'Could not reach the PC.',
  timeout: 'The PC did not respond in time.',
  server: 'Unexpected response. Is this the FS agent?',
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;

  constructor(kind: ApiErrorKind, message?: string) {
    super(message ?? MESSAGES[kind]);
    // Keeps `instanceof ApiError` working under Babel's class transform.
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.kind = kind;
  }

  /** True for connectivity problems (as opposed to a bad token). */
  get isConnectivity(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

export function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('network');
}

export function baseUrl(c: Pick<Candidate, 'host' | 'port'>): string {
  return `http://${c.host}:${c.port}/api/v1`;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  timeoutMs?: number;
  /** Extra non-2xx statuses that should be returned instead of thrown (e.g. 409). */
  allow?: number[];
}

/**
 * Authenticated request. The timeout only covers waiting for the response
 * headers, so a long streamed body isn't cut off.
 */
export async function apiRequest(c: Candidate, path: string, opts: RequestOptions = {}) {
  const { method = 'GET', timeoutMs = 5000, allow = [] } = opts;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(`${baseUrl(c)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${c.token}` },
      signal: controller.signal,
    });
    if (res.status === 401) throw new ApiError('unauthorized');
    if (res.status === 403) throw new ApiError('forbidden');
    if (!res.ok && !allow.includes(res.status)) {
      throw new ApiError('server', `The PC returned an error (${res.status}).`);
    }
    return res;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(timedOut ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

export async function ping(c: Candidate): Promise<PingResponse> {
  const res = await apiRequest(c, '/ping');
  try {
    return (await res.json()) as PingResponse;
  } catch {
    throw new ApiError('server');
  }
}