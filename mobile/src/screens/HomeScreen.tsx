import { ChevronRight, Download, Folder, RefreshCw, Settings, Unlink, Wifi, WifiOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { ApiError, ping, toApiError } from '../api/client';
import { countEntries, getMeta } from '../db';
import { rootStats, type RootStat } from '../db/queries';
import { formatDateTime, formatSize } from '../format';
import { relocate, unpair } from '../pairing';
import { platform } from '../platform';
import { getAutoSync, setAutoSync } from '../settings';
import { autoSyncPlan, syncFromPc, type SyncProgress } from '../sync';
import type { PairingInfo, PingResponse } from '../types';
import { Button, colors } from '../ui';

interface Props {
  pairing: PairingInfo;
  onBrowse: (startPath?: string) => void;
  onUnpaired: () => void;
  onRelocated: (pairing: PairingInfo) => void;
}

function progressLabel(p: SyncProgress): string {
  switch (p.phase) {
    case 'rescanning':
      return 'Rescanning folders on the PC...';
    case 'downloading':
      return p.total
        ? `Downloading ${p.received.toLocaleString()} / ${p.total.toLocaleString()}`
        : `Downloading ${p.received.toLocaleString()}`;
    case 'cleaning':
      return 'Removing deleted files...';
  }
}

export default function HomeScreen({ pairing, onBrowse, onUnpaired, onRelocated }: Props) {
  const [checking, setChecking] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [remote, setRemote] = useState<PingResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [stats, setStats] = useState<RootStat[]>([]);
  const [autoSyncOn, setAutoSyncOn] = useState(true);

  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    setLocalCount(await countEntries());
    setLastSynced(await getMeta('last_synced_at'));
    setStats(await rootStats());
    setAutoSyncOn(await getAutoSync());
  }, []);

  /** Pings the PC (finding it again if its address changed). Returns the answer, or null if offline. */
  const check = useCallback(async (): Promise<PingResponse | null> => {
    setChecking(true);
    setError(null);
    let result: PingResponse | null = null;
    try {
      result = await ping(pairing);
      setRemote(result);
    } catch (e) {
      const err = toApiError(e);

      // Unreachable: the PC may have a new address. Try to find it by id.
      if (err.isConnectivity) {
        setNote('Looking for your PC on the network...');
        const moved = await relocate(pairing).catch(() => null);
        setNote(null);
        if (moved && (moved.host !== pairing.host || moved.port !== pairing.port)) {
          onRelocated(moved); // the new pairing prop re-runs this check
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

  // On opening: check the PC, then sync automatically if the phone's copy is out of date.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await check();
      if (cancelled || !result || syncingRef.current) return;
      const plan = await autoSyncPlan(result);
      if (!cancelled && plan.run) await runSync(plan.rescan, true);
    })();
    return () => {
      cancelled = true;
    };
  }, [check]);

  async function runSync(rescan: boolean, auto = false) {
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    setSyncMessage(null);
    setProgress(null);
    try {
      const r = await syncFromPc(pairing, { rescan, onProgress: setProgress });
      const removed = r.removed > 0 ? `, removed ${r.removed.toLocaleString()} deleted` : '';
      setSyncMessage(
        `${auto ? 'Auto-synced' : 'Synced'} ${r.total.toLocaleString()} entries in ${(r.ms / 1000).toFixed(1)}s${removed}`,
      );
    } catch (e) {
      setSyncError(e instanceof ApiError ? e.message : `Sync failed: ${String(e)}`);
    }
    setProgress(null);
    setSyncing(false);
    syncingRef.current = false;
    await check();
  }

  async function toggleAutoSync(value: boolean) {
    setAutoSyncOn(value);
    await setAutoSync(value);
  }

  function confirmUnpair() {
    Alert.alert('Unpair this PC?', 'The saved token, the local file index and your pinned folders will be deleted from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: async () => {
          await unpair();
          onUnpaired();
        },
      },
    ]);
  }

  const online = remote !== null;
  const busy = checking || syncing;
  const pct =
    progress?.total && progress.phase !== 'rescanning'
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{pairing.name}</Text>
      <Text style={styles.subtitle}>
        {pairing.host}:{pairing.port}
      </Text>

      <View style={styles.card}>
        <Row label="Status">
          {checking ? (
            <ActivityIndicator color={colors.primary} />
          ) : online ? (
            <View style={styles.inline}>
              <Wifi size={16} color={colors.ok} />
              <Text style={{ color: colors.ok, fontWeight: '600' }}>Online</Text>
            </View>
          ) : (
            <View style={styles.inline}>
              <WifiOff size={16} color={colors.danger} />
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Offline</Text>
            </View>
          )}
        </Row>
        {note ? <Text style={styles.help}>{note}</Text> : null}
        {remote ? (
          <>
            <Row label="Entries on PC">
              <Text style={styles.value}>{remote.file_count.toLocaleString()}</Text>
            </Row>
            <Row label="PC last scanned">
              <Text style={styles.value}>{remote.indexed_at ? formatDateTime(remote.indexed_at) : 'not yet'}</Text>
            </Row>
          </>
        ) : null}
        <Row label="Entries on phone">
          <Text style={styles.value}>{localCount === null ? '...' : localCount.toLocaleString()}</Text>
        </Row>
        <Row label="Last synced">
          <Text style={styles.value}>{lastSynced ? formatDateTime(Number(lastSynced)) : 'never'}</Text>
        </Row>
      </View>

      <Button title="Browse files" icon={Folder} onPress={() => onBrowse()} disabled={!localCount} />

      {stats.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Folders on this PC</Text>
          {stats.map((s) => (
            <Pressable key={s.root} style={styles.statRow} onPress={() => onBrowse(s.root)}>
              <Folder size={20} color={colors.primary} />
              <View style={styles.statText}>
                <Text style={styles.value}>{s.root}</Text>
                <Text style={styles.help}>
                  {s.files.toLocaleString()} files · {formatSize(s.bytes)}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error.message}</Text>
          {error.isConnectivity ? (
            <>
              <Text style={styles.help}>{platform.connectionHelp}</Text>
              <Button
                title="Open settings"
                variant="secondary"
                icon={Settings}
                onPress={() => platform.openNetworkSettings()}
              />
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sync</Text>

        <View style={styles.switchRow}>
          <View style={styles.statText}>
            <Text style={styles.value}>Sync when opening the app</Text>
            <Text style={styles.help}>Only when the PC has newer data. A rescan is requested if your last sync is over 6 hours old.</Text>
          </View>
          <Switch
            value={autoSyncOn}
            onValueChange={toggleAutoSync}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>

        {syncing && progress ? (
          <>
            <Text style={styles.value}>{progressLabel(progress)}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%` as `${number}%` }]} />
            </View>
          </>
        ) : null}
        {syncing && !progress ? <ActivityIndicator color={colors.primary} /> : null}

        {syncMessage ? <Text style={styles.ok}>{syncMessage}</Text> : null}
        {syncError ? <Text style={styles.error}>{syncError}</Text> : null}

        <Button
          title="Sync now"
          variant="secondary"
          icon={Download}
          onPress={() => runSync(false)}
          disabled={busy || !online}
        />
        <Button
          title="Rescan PC & sync"
          variant="secondary"
          icon={RefreshCw}
          onPress={() => runSync(true)}
          disabled={busy || !online}
        />
      </View>

      <View style={styles.actions}>
        <Button
          title="Re-check connection"
          variant="secondary"
          icon={Wifi}
          onPress={() => {
            void check();
          }}
          disabled={busy}
        />
        <Button title="Unpair" variant="danger" icon={Unlink} onPress={confirmUnpair} disabled={syncing} />
      </View>
    </ScrollView>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 8 },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: -8 },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  statText: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { color: colors.muted, fontSize: 15 },
  value: { color: colors.text, fontSize: 15, fontWeight: '500' },
  ok: { color: colors.ok, fontSize: 15 },
  error: { color: colors.danger, fontSize: 15 },
  help: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.primary },
  actions: { gap: 12 },
});