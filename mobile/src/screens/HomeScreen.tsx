import { Check, ChevronRight, Folder, RefreshCw, Search, Sparkles, WifiOff, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useActions } from '../actions';
import { FileListRow, subtitleFor } from '../components/FileRow';
import { listRecent, type FileRow } from '../db/queries';
import { formatRelative, formatSize } from '../format';
import { unpair } from '../pairing';
import { platform } from '../platform';
import { useSession } from '../session';
import type { SyncProgress } from '../sync';
import { Button, Card, FadeIn, ProgressBar, StatusChip, Text, radius, useTheme, useThemedStyles, type Palette } from '../ui';

interface Props {
  onSearch: () => void;
  onOpenFolder: (path: string) => void;
  onSeeAllRecent: () => void;
  onExitDemo: () => void;
}

const SCREEN_PAD = 20;
const GAP = 12;

function progressText(p: SyncProgress | null): string {
  if (!p) return 'Getting ready...';
  switch (p.phase) {
    case 'rescanning':
      return 'Looking for changes on your PC...';
    case 'downloading':
      return p.total ? `Copying your file list... ${Math.min(100, Math.round((p.received / p.total) * 100))}%` : 'Copying your file list...';
    case 'cleaning':
      return 'Finishing up...';
  }
}

export default function HomeScreen({ onSearch, onOpenFolder, onSeeAllRecent, onExitDemo }: Props) {
  const s = useSession();
  const { showDetails } = useActions();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();

  const [recent, setRecent] = useState<FileRow[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const demo = s.pairing.demo === true;

  useEffect(() => {
    let cancelled = false;
    listRecent({}, 5).then((rows) => {
      if (!cancelled) setRecent(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [s.dataVersion]);

  async function exitDemo() {
    await unpair(); // wipes the sample files and the demo pairing
    onExitDemo();
  }

  const online = s.remote !== null;
  const offline = !online && !s.checking;
  const tileWidth = Math.floor((width - SCREEN_PAD * 2 - GAP) / 2);
  const downloadPct =
    s.progress?.phase === 'downloading' && s.progress.total
      ? Math.min(100, Math.round((s.progress.received / s.progress.total) * 100))
      : null;

  // What the update card says, depending on the situation.
  let Icon: LucideIcon = RefreshCw;
  let badgeBg = colors.primarySoft;
  let badgeFg = colors.primary;
  let title = '';
  let caption = '';
  let captionTone: 'muted' | 'danger' = 'muted';

  if (s.syncing) {
    title = 'Updating...';
    caption = progressText(s.progress) + (s.eta ? ` · ${s.eta}` : '');
  } else if (s.syncError) {
    badgeBg = colors.dangerSoft;
    badgeFg = colors.danger;
    title = "The update didn't finish";
    caption = s.syncError;
    captionTone = 'danger';
  } else if (offline) {
    Icon = WifiOff;
    badgeBg = colors.dangerSoft;
    badgeFg = colors.danger;
    title = "Can't reach your PC";
    caption = s.error?.message ?? 'Make sure your PC is on and the agent is running.';
    captionTone = 'danger';
  } else if (s.lastSynced === null) {
    title = 'Get started';
    caption = "Copy your PC's file list to this phone so you can search it anywhere.";
  } else if (s.pcHasNewer) {
    title = 'Your PC has newer files';
    caption = `Last updated ${formatRelative(s.lastSynced)}`;
  } else {
    Icon = Check;
    badgeBg = colors.successSoft;
    badgeFg = colors.success;
    title = 'Up to date';
    caption = `Updated ${formatRelative(s.lastSynced)}`;
  }
  if (!s.syncing && !s.syncError && s.syncMessage) caption = s.syncMessage;

  const needsUpdate = s.lastSynced === null || s.pcHasNewer;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <FadeIn>
        <View style={styles.header}>
          <Text variant="display" numberOfLines={1}>
            {s.pairing.name}
          </Text>
          <StatusChip
            kind={demo ? 'idle' : s.checking ? 'idle' : online ? 'ok' : 'bad'}
            label={demo ? 'Demo mode' : s.checking ? 'Checking...' : online ? 'Connected' : 'Not connected'}
          />
          {s.note ? (
            <Text variant="caption" tone="muted">
              {s.note}
            </Text>
          ) : null}
        </View>
      </FadeIn>

      {demo ? (
        <FadeIn delay={40}>
          <Card style={styles.updateCard}>
            <View style={styles.updateHeader}>
              <View style={[styles.badge, { backgroundColor: colors.folderSoft }]}>
                <Sparkles size={22} color={colors.folder} />
              </View>
              <View style={styles.flex}>
                <Text variant="heading">You're exploring a demo</Text>
                <Text variant="caption" tone="muted">
                  These are sample files. Connect your own PC to see yours.
                </Text>
              </View>
            </View>
            <Button title="Connect my PC" variant="tonal" size="sm" onPress={() => void exitDemo()} />
          </Card>
        </FadeIn>
      ) : null}

      <FadeIn delay={60}>
        <Card style={styles.updateCard}>
          <View style={styles.updateHeader}>
            <View style={[styles.badge, { backgroundColor: badgeBg }]}>
              <Icon size={22} color={badgeFg} />
            </View>
            {/* Read out automatically when the update status changes. */}
            <View style={styles.flex} accessibilityLiveRegion="polite">
              <Text variant="heading">{title}</Text>
              <Text variant="caption" tone={captionTone}>
                {caption}
              </Text>
            </View>
          </View>

          {s.syncing && downloadPct !== null ? <ProgressBar value={downloadPct} /> : null}

          {s.syncing ? (
            <Button title="Cancel" variant="secondary" size="sm" onPress={s.cancelSync} />
          ) : offline ? (
            <View style={styles.buttonRow}>
              <View style={styles.flex}>
                <Button title="Try again" size="sm" loading={s.checking} onPress={() => void s.check()} />
              </View>
              <View style={styles.flex}>
                <Button title={helpOpen ? 'Hide help' : 'Help'} variant="tonal" size="sm" onPress={() => setHelpOpen((v) => !v)} />
              </View>
            </View>
          ) : (
            <Button
              title={s.lastSynced === null ? 'Update now' : 'Update'}
              variant={needsUpdate ? 'primary' : 'tonal'}
              icon={RefreshCw}
              disabled={!online}
              onPress={() => void s.runSync({ rescan: true })}
            />
          )}
        </Card>
      </FadeIn>

      {offline && helpOpen ? (
        <Card style={styles.helpCard}>
          <Text variant="body">{platform.connectionHelp}</Text>
          <Button
            title="Open network settings"
            variant="secondary"
            size="sm"
            onPress={() => void platform.openNetworkSettings()}
          />
        </Card>
      ) : null}

      <FadeIn delay={120}>
        <Pressable style={styles.searchPill} onPress={onSearch} accessibilityRole="button" accessibilityLabel="Search your files">
          <Search size={20} color={colors.muted} />
          <Text tone="muted">Search your files</Text>
        </Pressable>
      </FadeIn>

      {s.stats.length > 0 ? (
        <FadeIn delay={180}>
          <View style={styles.section}>
            <Text variant="heading">Your folders</Text>
            <View style={styles.tiles}>
              {s.stats.map((stat) => (
                <Pressable
                  key={stat.root}
                  style={[styles.tile, { width: tileWidth }]}
                  onPress={() => onOpenFolder(stat.root)}
                  accessibilityRole="button"
                  accessibilityLabel={`${stat.root}, ${stat.files.toLocaleString()} files, ${formatSize(stat.bytes)}`}
                >
                  <View style={styles.tileIcon}>
                    <Folder size={24} color={colors.folder} />
                  </View>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {stat.root}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {stat.files.toLocaleString()} files · {formatSize(stat.bytes)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </FadeIn>
      ) : null}

      {recent.length > 0 ? (
        <FadeIn delay={240}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text variant="heading">Recent files</Text>
              <Pressable
                onPress={onSeeAllRecent}
                hitSlop={12}
                style={styles.seeAll}
                accessibilityRole="button"
                accessibilityLabel="See all recent files"
              >
                <Text variant="label" tone="primary">
                  See all
                </Text>
                <ChevronRight size={16} color={colors.primary} />
              </Pressable>
            </View>
            <Card style={styles.listCard}>
              {recent.map((row) => (
                <FileListRow key={row.path} item={row} {...subtitleFor(row, 'recent')} onPress={showDetails} />
              ))}
            </Card>
          </View>
        </FadeIn>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: SCREEN_PAD, paddingBottom: 32, gap: 16 },
    flex: { flex: 1 },
    header: { gap: 8, paddingTop: 4 },
    updateCard: { gap: 14 },
    updateHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    buttonRow: { flexDirection: 'row', gap: 10 },
    helpCard: { gap: 12 },
    searchPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 52,
      paddingHorizontal: 16,
      borderRadius: radius.lg,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    section: { gap: 10 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    seeAll: { flexDirection: 'row', alignItems: 'center' },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
    tile: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      gap: 2,
    },
    tileIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: c.folderSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    listCard: { padding: 0, overflow: 'hidden' },
  });