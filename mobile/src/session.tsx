import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, ping, toApiError } from './api/client';
import { countEntries, getMeta } from './db';
import { rootStats, type RootStat } from './db/queries';
import { demoPing, simulateDemoUpdate } from './demo';
import { formatEta } from './format';
import { relocate } from './pairing';
import { getAutoSync, setAutoSync } from './settings';
import { SyncCancelled, autoSyncPlan, syncFromPc, type SyncProgress } from './sync';
import type { PairingInfo, PingResponse } from './types';

export interface Session {
  pairing: PairingInfo;

  // connection
  remote: PingResponse | null;
  error: ApiError | null;
  checking: boolean;
  note: string | null;
  check: () => Promise<PingResponse | null>;

  // updating
  syncing: boolean;
  progress: SyncProgress | null;
  eta: string | null;
  syncMessage: string | null;
  syncError: string | null;
  runSync: (opts: { rescan: boolean; auto?: boolean }) => Promise<void>;
  cancelSync: () => void;

  // what's on the phone
  localCount: number | null;
  lastSynced: number | null;
  pcHasNewer: boolean;
  stats: RootStat[];
  autoSyncOn: boolean;
  setAutoSyncOn: (on: boolean) => void;

  // bumped whenever stored data changes, so lists reload
  dataVersion: number;
  bump: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}

export function SessionProvider({
  pairing,
  onRelocated,
  children,
}: {
  pairing: PairingInfo;
  onRelocated: (pairing: PairingInfo) => void;
  children: ReactNode;
}) {
  const [remote, setRemote] = useState<PingResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checking, setChecking] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const [localCount, setLocalCount] = useState<number | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [syncedStamp, setSyncedStamp] = useState<string | null>(null);
  const [stats, setStats] = useState<RootStat[]>([]);
  const [autoSyncOn, setAutoSyncState] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);

  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const rateRef = useRef<{ t: number; n: number } | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  const loadLocal = useCallback(async () => {
    setLocalCount(await countEntries());
    const last = await getMeta('last_synced_at');
    setLastSynced(last ? Number(last) : null);
    setSyncedStamp(await getMeta('synced_pc_indexed_at'));
    setStats(await rootStats());
    setAutoSyncState(await getAutoSync());
  }, []);

  /** Pings the PC (finding it again if its address changed). Returns the answer, or null if offline. */
  const check = useCallback(async (): Promise<PingResponse | null> => {
    setChecking(true);
    setError(null);
    let result: PingResponse | null = null;
    try {
      result = pairing.demo ? await demoPing() : await ping(pairing);
      setRemote(result);
    } catch (e) {
      const err = toApiError(e);

      // Unreachable: the PC may have a new address. Try to find it by id.
      if (err.isConnectivity) {
        setNote('Looking for your PC on the network...');
        const moved = await relocate(pairing).catch(() => null);
        setNote(null);
        if (moved && (moved.host !== pairing.host || moved.port !== pairing.port)) {
          onRelocated(moved); // the new pairing re-runs this check
          return null;
        }
      }

      setRemote(null);
      setError(err);
    }
    await loadLocal();
    setChecking(false);
    return result;
  }, [pairing, loadLocal, onRelocated]);

  // A rough "time left", measured from how fast entries are arriving.
  const updateEta = useCallback((p: SyncProgress) => {
    if (p.phase !== 'downloading' || !p.total) {
      setEta(null);
      return;
    }
    const now = Date.now();
    if (!rateRef.current) {
      rateRef.current = { t: now, n: p.received };
      return;
    }
    const done = p.received - rateRef.current.n;
    const seconds = (now - rateRef.current.t) / 1000;
    if (done < 3000 || seconds < 3) return; // not enough data for a steady estimate yet
    setEta(formatEta(((p.total - p.received) / done) * seconds));
  }, []);

  const runSync = useCallback(
    async ({ rescan }: { rescan: boolean; auto?: boolean }) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      rateRef.current = null;

      setSyncing(true);
      setSyncError(null);
      setSyncMessage(null);
      setProgress(null);
      setEta(null);

      const onProgress = (p: SyncProgress) => {
        setProgress(p);
        updateEta(p);
      };

      try {
        if (pairing.demo) {
          await simulateDemoUpdate(onProgress, controller.signal);
        } else {
          await syncFromPc(pairing, { rescan, signal: controller.signal, onProgress });
        }
      } catch (e) {
        if (e instanceof SyncCancelled) {
          setSyncMessage('Update cancelled. Your file list may be incomplete until you update again.');
        } else {
          setSyncError(e instanceof ApiError ? e.message : `The update failed: ${String(e)}`);
        }
      }

      setProgress(null);
      setEta(null);
      setSyncing(false);
      syncingRef.current = false;
      abortRef.current = null;
      await check();
      bump();
    },
    [pairing, check, bump, updateEta],
  );

  const cancelSync = useCallback(() => abortRef.current?.abort(), []);

  const setAutoSyncOn = useCallback((on: boolean) => {
    setAutoSyncState(on);
    void setAutoSync(on);
  }, []);

  // On opening the app: check the PC, then update by itself if the phone's copy is out of date.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await check();
      if (cancelled || !result || syncingRef.current || pairing.demo) return;
      const plan = await autoSyncPlan(result);
      if (!cancelled && plan.run) await runSync({ rescan: plan.rescan, auto: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [check]);

  const pcHasNewer =
    remote !== null && remote.indexed_at > 0 && syncedStamp !== null && syncedStamp !== String(remote.indexed_at);

  const value = useMemo<Session>(
    () => ({
      pairing,
      remote,
      error,
      checking,
      note,
      check,
      syncing,
      progress,
      eta,
      syncMessage,
      syncError,
      runSync,
      cancelSync,
      localCount,
      lastSynced,
      pcHasNewer,
      stats,
      autoSyncOn,
      setAutoSyncOn,
      dataVersion,
      bump,
    }),
    [
      pairing, remote, error, checking, note, check, syncing, progress, eta, syncMessage, syncError,
      runSync, cancelSync, localCount, lastSynced, pcHasNewer, stats, autoSyncOn, setAutoSyncOn, dataVersion, bump,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}