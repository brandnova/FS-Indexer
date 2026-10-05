import * as SecureStore from 'expo-secure-store';
import { apiRequest, ping } from './api/client';
import { clearIndex } from './db';
import { findDevice, type DiscoveredDevice } from './discovery';
import type { Candidate, PairingInfo, PingResponse } from './types';

// The token lives in the OS keystore (Keychain / Keystore), not plain storage.
const KEY = 'pairing';

export async function loadPairing(): Promise<PairingInfo | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PairingInfo;
  } catch {
    return null;
  }
}

/** Verifies the PC answers with this token, then saves the pairing. */
export async function pairWith(c: Candidate): Promise<PairingInfo> {
  const res = await ping(c);

  const info: PairingInfo = {
    v: 1,
    host: c.host,
    port: c.port,
    token: c.token,
    id: res.device_id,
    name: res.name,
  };

  // A different PC means the old index is meaningless.
  const previous = await loadPairing();
  if (previous && previous.id !== info.id) {
    await clearIndex();
  }

  await SecureStore.setItemAsync(KEY, JSON.stringify(info));
  return info;
}

export async function unpair(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  await clearIndex();
}

/**
 * Finds a paired PC again after its address changed. Looks it up by device id
 * via mDNS, confirms it answers with our token, and saves the new address.
 * Returns null if it can't be found.
 */
export async function relocate(current: PairingInfo): Promise<PairingInfo | null> {
  const device = await findDevice(current.id);
  if (!device) return null;

  const host = await pickReachableAddress(device, current.token);
  if (!host) return null;

  const updated: PairingInfo = { ...current, host, port: device.port };
  await SecureStore.setItemAsync(KEY, JSON.stringify(updated));
  return updated;
}

/** Tries every advertised address in parallel; the first one (in order) that answers as this device wins. */
async function pickReachableAddress(device: DiscoveredDevice, token: string): Promise<string | null> {
  const results = await Promise.all(
    device.addresses.map(async (host) => {
      try {
        const res = await apiRequest({ host, port: device.port, token }, '/ping', { timeoutMs: 2500 });
        const body = (await res.json()) as PingResponse;
        return body.device_id === device.id ? host : null;
      } catch {
        return null;
      }
    }),
  );
  return results.find((h) => h !== null) ?? null;
}

export interface QrCandidate extends Candidate {
  id?: string;
}

/** Parses the JSON shown as a QR code by the agent. Returns null if it isn't one. */
export function parseQrPayload(raw: string): QrCandidate | null {
  try {
    const p = JSON.parse(raw);
    if (
      p?.v === 1 &&
      typeof p.host === 'string' &&
      Number.isInteger(p.port) &&
      typeof p.token === 'string'
    ) {
      return { host: p.host, port: p.port, token: p.token, id: typeof p.id === 'string' ? p.id : undefined };
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Parses "192.168.1.23:8080" (port optional, defaults to 8080). */
export function parseAddress(input: string): { host: string; port: number } | null {
  const cleaned = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!cleaned) return null;

  const idx = cleaned.lastIndexOf(':');
  if (idx === -1) return { host: cleaned, port: 8080 };

  const host = cleaned.slice(0, idx);
  const port = Number(cleaned.slice(idx + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}