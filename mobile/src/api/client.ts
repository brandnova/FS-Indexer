// expo/fetch (not the global fetch) because it supports streaming response
// bodies, which the sync needs. We use it everywhere for consistency.
import { fetch } from 'expo/fetch';
import type { Candidate, PingResponse } from '../types';

// The range of agent API versions this app understands.
export const MIN_API_VERSION = 1;
export const MAX_API_VERSION = 1;

export type ApiErrorKind = 'unauthorized' | 'forbidden' | 'network' | 'timeout' | 'server' | 'incompatible';

const MESSAGES: Record<ApiErrorKind, string> = {
  unauthorized: 'The PC rejected the token. Check it and try again.',
  forbidden: 'The PC refused the connection. It only accepts devices on its local network.',
  network: 'Could not reach the PC.',
  timeout: 'The PC did not respond in time.',
  server: 'Unexpected response. Is this the FS agent?',
  incompatible: 'This app and the agent on your PC are not compatible. Update both to the latest version.',
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
    if (res.status === 429) {
      throw new ApiError('server', 'Too many failed attempts. Wait a minute and try again.');
    }
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

/** Pings the agent and refuses agents whose API version this app can't speak. */
export async function ping(c: Candidate): Promise<PingResponse> {
  const res = await apiRequest(c, '/ping');

  let body: PingResponse;
  try {
    body = (await res.json()) as PingResponse;
  } catch {
    throw new ApiError('server');
  }

  const api = body.api_version ?? 1; // agents before this field existed speak v1
  if (api > MAX_API_VERSION) {
    throw new ApiError('incompatible', 'The agent on your PC is newer than this app supports. Please update the app.');
  }
  if (api < MIN_API_VERSION) {
    throw new ApiError('incompatible', 'The agent on your PC is too old for this app. Please update the agent.');
  }
  return body;
}