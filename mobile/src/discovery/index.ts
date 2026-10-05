export interface DiscoveredDevice {
  id: string;
  name: string;
  addresses: string[]; // IPv4 only
  port: number;
}

const SERVICE_TYPE = 'fs-sync'; // advertised by the agent as _fs-sync._tcp

interface ZeroconfLike {
  on(event: string, listener: (...args: any[]) => void): void;
  scan(type: string, protocol: string, domain: string): void;
  stop(): void;
  removeAllListeners?: (event?: string) => void;
}

/**
 * The native module doesn't exist in Expo Go, so it is loaded lazily and any
 * failure means "discovery unavailable" rather than a crash.
 */
function createZeroconf(): ZeroconfLike | null {
  try {
    const mod = require('react-native-zeroconf');
    const Zeroconf = mod.default ?? mod;
    return new Zeroconf() as ZeroconfLike;
  } catch {
    return null;
  }
}

const isIPv4 = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

/**
 * Starts scanning. Returns null if discovery isn't available on this build.
 * `onDevices` is called with the full current list whenever it changes.
 */
export function startDiscovery(onDevices: (devices: DiscoveredDevice[]) => void): { stop: () => void } | null {
  const zc = createZeroconf();
  if (!zc) return null;

  const byService = new Map<string, DiscoveredDevice>(); // key: mDNS service name
  const publish = () => onDevices(Array.from(byService.values()));

  zc.on('resolved', (service: any) => {
    const txt = (service?.txt ?? {}) as Record<string, string>;
    const addresses: string[] = ((service?.addresses ?? []) as string[]).filter(isIPv4);
    if (!txt.id || addresses.length === 0 || !service?.port) return;

    byService.set(String(service.name), {
      id: txt.id,
      name: txt.name || String(service.name),
      addresses,
      port: Number(service.port),
    });
    publish();
  });

  zc.on('remove', (name: string) => {
    if (byService.delete(name)) publish();
  });

  zc.on('error', (e: unknown) => console.warn('mDNS error', e));

  try {
    zc.scan(SERVICE_TYPE, 'tcp', 'local.');
  } catch {
    return null; // native module missing (Expo Go)
  }

  return {
    stop() {
      try {
        zc.stop();
      } catch {
        // ignore
      }
      try {
        zc.removeAllListeners?.();
      } catch {
        // ignore
      }
    },
  };
}

/** Scans until the device with this id shows up, or the timeout passes. */
export function findDevice(id: string, timeoutMs = 4000): Promise<DiscoveredDevice | null> {
  return new Promise((resolve) => {
    let session: { stop: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const finish = (device: DiscoveredDevice | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      session?.stop();
      resolve(device);
    };

    timer = setTimeout(() => finish(null), timeoutMs);
    session = startDiscovery((devices) => {
      const match = devices.find((d) => d.id === id);
      if (match) finish(match);
    });
    if (!session) finish(null);
  });
}