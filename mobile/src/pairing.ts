import * as SecureStore from 'expo-secure-store';
import { ApiError, apiRequest, ping, redeemPairingCode } from './api/client';
import { clearIndex } from './db';
import { findDevice, type DiscoveredDevice } from './discovery';
import { deviceName } from './platform/deviceName';
import type { Candidate, PairingInfo, PairingOffer, PingResponse } from './types';

// The key lives in the OS keystore (Keychain / Keystore), not plain storage.
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

export async function savePairing(info: PairingInfo): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(info));
}

/**
 * Pairs with a PC. With a one-time code, this phone gets a key of its own from the PC (the
 * code is then useless). Offers from older agents carry the shared token instead.
 * Verifies the PC answers with the key, then saves the pairing.
 */
export async function pairWith(offer: PairingOffer): Promise<PairingInfo> {
  let token = offer.token;
  if (!token) {
    if (!offer.code) throw new ApiError('badcode');
    token = await redeemPairingCode(offer, offer.code, deviceName());
  }

  const c: Candidate = { host: offer.host, port: offer.port, token };
  const res = await ping(c);

  const info: PairingInfo = {
    v: 1,
    host: c.host,
    port: c.port,
    token: c.token,
    id: res.device_id,
    name: res.name,
  };

  // A different PC (or leftover demo data) means the old index is meaningless.
  const previous = await loadPairing();
  if (previous && previous.id !== info.id) {
    await clearIndex();
  }

  await savePairing(info);
  return info;
}

export async function unpair(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  await clearIndex();
}

/**
 * Finds a paired PC again after its address changed. Looks it up by device id
 * via mDNS, confirms it answers with our key, and saves the new address.
 * Returns null if it can't be found.
 */
export async function relocate(current: PairingInfo): Promise<PairingInfo | null> {
  if (current.demo) return null; // the demo has no PC to find

  const device = await findDevice(current.id);
  if (!device) return null;

  const host = await pickReachableAddress(device, current.token);
  if (!host) return null;

  const updated: PairingInfo = { ...current, host, port: device.port };
  await savePairing(updated);
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

/** What the QR code was meant to carry (kept for older imports). */
export type QrCandidate = PairingOffer;

/**
 * Parses the JSON shown as a QR code by the agent. Version 2 carries a one-time code;
 * version 1 (older agents) carries the shared token. Returns null if it isn't a pairing code.
 */
export function parseQrPayload(raw: string): PairingOffer | null {
  try {
    const p = JSON.parse(raw);
    if (typeof p?.host !== 'string' || !Number.isInteger(p.port)) return null;
    const id = typeof p.id === 'string' ? p.id : undefined;
    if (p.v === 2 && typeof p.code === 'string') return { host: p.host, port: p.port, code: p.code, id };
    if (p.v === 1 && typeof p.token === 'string') return { host: p.host, port: p.port, token: p.token, id };
  } catch {
    // not JSON
  }
  return null;
}

/** Forgives how people type a code: case, spaces, dashes, and O/I/L for 0/1/1. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
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