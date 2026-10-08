import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Folder as FolderIcon,
  Pin,
  PinOff,
  Search,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { copyText } from '../clipboard';
import DetailsSheet from '../components/DetailsSheet';
import FilterSheet from '../components/FilterSheet';
import { getMeta } from '../db';
import {
  SEARCH_LIMIT,
  hasFileFilters,
  isPinned,
  listFolder,
  listPinned,
  listRecent,
  searchFiles,
  setPinned,
  tokenize,
  type FileRow,
} from '../db/queries';
import { iconFor } from '../fileTypes';
import { DEFAULT_FILTERS, activeCount, describe, toSpec, type FilterState } from '../filters';
import { formatDate, formatSize } from '../format';
import { useDebounced, useToast } from '../hooks';
import { fullPcPath } from '../pcPaths';
import type { PairingInfo } from '../types';
import { colors } from '../ui';

interface Props {
  pairing: PairingInfo;
  initialPath?: string;
  onBack: () => void;
}

type Tab = 'browse' | 'recent' | 'pinned';
type Mode = Tab | 'search';

const TABS: { key: Tab; label: string; Icon: LucideIcon }[] = [
  { key: 'browse', label: 'Browse', Icon: FolderIcon },
  { key: 'recent', label: 'Recent', Icon: Clock },
  { key: 'pinned', label: 'Pinned', Icon: Pin },
];

const ROW_HEIGHT = 60;

function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function subtitleFor(row: FileRow, mode: Mode): { text: string; head: boolean } {
  switch (mode) {
    case 'search':
      return { text: row.parent, head: true };
    case 'recent':
      return { text: `${formatDate(row.mtime)} · ${row.parent}`, head: false };
    case 'pinned':
      return { text: row.path, head: true };
    default:
      return { text: row.isDir ? 'Folder' : `${formatSize(row.size)} · ${formatDate(row.mtime)}`, head: false };
  }
}

export default function BrowseScreen({ pairing, initialPath = '', onBack }: Props) {
  const [tab, setTab] = useState<Tab>('browse');
  const [current, setCurrent] = useState(initialPath); // '' = list of roots
  const [rows, setRows] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [pinnedHere, setPinnedHere] = useState(false);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const spec = useMemo(() => toSpec(filters), [filters]);
  const activeFilters = activeCount(filters);

  const [details, setDetails] = useState<{ row: FileRow; pcPath: string | null } | null>(null);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 200);
  const [results, setResults] = useState<FileRow[] | null>(null);

  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const crumbsRef = useRef<ScrollView>(null);

  const searchActive = query.trim().length > 0;
  const mode: Mode = searchActive ? 'search' : tab;

  // Load the list for the current tab
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load =
      tab === 'browse' ? listFolder(current, spec) : tab === 'recent' ? listRecent(spec) : listPinned();
    load
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error('loading the list failed', e);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, current, spec, reloadKey]);

  // Is the folder we're looking at pinned?
  useEffect(() => {
    if (!current) {
      setPinnedHere(false);
      return undefined;
    }
    let cancelled = false;
    isPinned(current).then((p) => {
      if (!cancelled) setPinnedHere(p);
    });
    return () => {
      cancelled = true;
    };
  }, [current, reloadKey]);

  // Search (runs on the debounced value; stale results are ignored)
  useEffect(() => {
    if (tokenize(debouncedQuery).length === 0) {
      setResults(null);
      return;
    }
    let cancelled = false;
    searchFiles(debouncedQuery, { scope: filters.scope, filters: spec })
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch((e) => console.error('searchFiles failed', e));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, spec, filters.scope]);

  useEffect(() => {
    getMeta('last_synced_at').then(setLastSynced);
  }, []);

  // Back button: clear search, then leave Recent/Pinned, then go up a folder, then leave. (No-op on iOS.)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (query) {
        setQuery('');
      } else if (tab !== 'browse') {
        setTab('browse');
      } else if (current) {
        setCurrent(parentOf(current));
      } else {
        onBack();
      }
      return true;
    });
    return () => sub.remove();
  }, [query, tab, current, onBack]);

  const copy = useCallback(
    async (label: string, text: string) => {
      const ok = await copyText(text);
      showToast(ok ? `${label} copied` : "Copy isn't available in this build");
    },
    [showToast],
  );

  // Copies the full PC path of the folder we're in (or the app path if the PC's location isn't known).
  const copyFolderPath = useCallback(async () => {
    const pc = await fullPcPath(current);
    await copy(pc ? 'PC path' : 'App path', pc ?? current);
  }, [current, copy]);

  const togglePin = useCallback(
    async (path: string, name: string) => {
      const pinned = await isPinned(path);
      await setPinned(path, !pinned);
      showToast(pinned ? `Unpinned ${name}` : `Pinned ${name}`);
      setReloadKey((k) => k + 1);
    },
    [showToast],
  );

  const showDetails = useCallback((row: FileRow) => {
    setDetails({ row, pcPath: null });
    void fullPcPath(row.path).then((pcPath) =>
      setDetails((d) => (d && d.row.path === row.path ? { row, pcPath } : d)),
    );
  }, []);

  // The sheet is a separate window, so close it first: the toast shows in this screen.
  const onCopyFromSheet = useCallback(
    (label: string, text: string) => {
      setDetails(null);
      void copy(label, text);
    },
    [copy],
  );

  const onPressRow = useCallback(
    (row: FileRow) => {
      if (searchActive) {
        // Folder: open it. File: jump to the folder that contains it.
        setQuery('');
        setTab('browse');
        setCurrent(row.isDir ? row.path : row.parent);
        return;
      }
      if (row.isDir) {
        setTab('browse');
        setCurrent(row.path);
      } else {
        showDetails(row);
      }
    },
    [searchActive, showDetails],
  );

  // Long-press: a folder toggles its pin, a file shows its details.
  const onLongPressRow = useCallback(
    (row: FileRow) => {
      if (row.isDir) void togglePin(row.path, row.name);
      else showDetails(row);
    },
    [togglePin, showDetails],
  );

  const onUnpin = useCallback((row: FileRow) => void togglePin(row.path, row.name), [togglePin]);

  const segments = current ? current.split('/') : [];
  const crumbs = segments.map((label, i) => ({ label, path: segments.slice(0, i + 1).join('/') }));

  const data = searchActive ? (results ?? []) : rows;
  const searching = searchActive && results === null;

  let emptyText: string | null = null;
  if (!loading && !searching && data.length === 0) {
    if (searchActive) emptyText = `No files match "${query.trim()}"`;
    else if (tab === 'pinned') emptyText = 'Nothing pinned yet. Open a folder and tap the pin icon, or long-press a folder.';
    else if (hasFileFilters(spec)) emptyText = 'Nothing matches your filters.';
    else if (tab === 'recent') emptyText = 'No files yet. Go back and tap "Sync now".';
    else if (current === '') emptyText = 'Nothing synced yet. Go back and tap "Sync now".';
    else emptyText = 'This folder is empty.';
  }

  const inFolder = !searchActive && tab === 'browse' && current !== '';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.primary} />
          <Text style={styles.backText}>Home</Text>
        </Pressable>
        <View style={styles.headerRight}>
          {lastSynced ? <Text style={styles.synced}>Synced {formatDate(Number(lastSynced))}</Text> : null}
          {inFolder ? (
            <>
              <Pressable onPress={() => void copyFolderPath()} hitSlop={12}>
                <Copy size={20} color={colors.muted} />
              </Pressable>
              <Pressable onPress={() => void togglePin(current, segments[segments.length - 1])} hitSlop={12}>
                <Pin size={20} color={pinnedHere ? colors.primary : colors.muted} />
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={() => setSheetOpen(true)} hitSlop={12}>
            <SlidersHorizontal size={20} color={activeFilters > 0 ? colors.primary : colors.muted} />
            {activeFilters > 0 ? <View style={styles.dot} /> : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={18} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={`Search files on ${pairing.name}`}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={12}>
              <X size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {activeFilters > 0 ? (
        <View style={styles.filterBar}>
          <Text style={styles.filterText} numberOfLines={1}>
            {describe(filters)}
          </Text>
          <Pressable onPress={() => setFilters(DEFAULT_FILTERS)} hitSlop={10}>
            <Text style={styles.clearLink}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      {searchActive ? (
        <Text style={styles.caption}>
          {searching
            ? 'Searching...'
            : `${data.length}${data.length >= SEARCH_LIMIT ? '+' : ''} result${data.length === 1 ? '' : 's'}`}
        </Text>
      ) : (
        <>
          <View style={styles.tabs}>
            {TABS.map(({ key, label, Icon }) => {
              const active = tab === key;
              return (
                <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, active && styles.tabActive]}>
                  <Icon size={16} color={active ? '#fff' : colors.muted} />
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'browse' ? (
            <ScrollView
              ref={crumbsRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.crumbsBar}
              contentContainerStyle={styles.crumbs}
              onContentSizeChange={() => crumbsRef.current?.scrollToEnd({ animated: true })}
            >
              <Pressable onPress={() => setCurrent('')} hitSlop={8}>
                <Text style={[styles.crumb, current === '' && styles.crumbActive]}>{pairing.name}</Text>
              </Pressable>
              {crumbs.map((c, i) => (
                <View key={c.path} style={styles.crumbWrap}>
                  <ChevronRight size={14} color={colors.muted} style={styles.crumbSep} />
                  <Pressable onPress={() => setCurrent(c.path)} hitSlop={8}>
                    <Text style={[styles.crumb, i === crumbs.length - 1 && styles.crumbActive]}>{c.label}</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </>
      )}

      {loading || searching ? <ActivityIndicator style={styles.spinner} color={colors.primary} /> : null}

      {emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null}

      <FlatList
        style={styles.list}
        data={data}
        keyExtractor={(item) => item.path}
        renderItem={({ item }) => (
          <Row
            item={item}
            mode={mode}
            onPress={onPressRow}
            onLongPress={onLongPressRow}
            onUnpin={mode === 'pinned' ? onUnpin : undefined}
          />
        )}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={20}
        windowSize={10}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <FilterSheet visible={sheetOpen} value={filters} onChange={setFilters} onClose={() => setSheetOpen(false)} />
      <DetailsSheet
        row={details?.row ?? null}
        pcPath={details?.pcPath ?? null}
        onCopy={onCopyFromSheet}
        onClose={() => setDetails(null)}
      />
    </View>
  );
}

const Row = memo(function Row({
  item,
  mode,
  onPress,
  onLongPress,
  onUnpin,
}: {
  item: FileRow;
  mode: Mode;
  onPress: (row: FileRow) => void;
  onLongPress: (row: FileRow) => void;
  onUnpin?: (row: FileRow) => void;
}) {
  const { Icon, color } = iconFor(item.ext, item.isDir);
  const sub = subtitleFor(item, mode);

  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Icon size={24} color={color} />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1} ellipsizeMode={sub.head ? 'head' : 'tail'}>
          {sub.text}
        </Text>
      </View>
      {onUnpin ? (
        <Pressable onPress={() => onUnpin(item)} hitSlop={12}>
          <PinOff size={18} color={colors.muted} />
        </Pressable>
      ) : item.isDir ? (
        <ChevronRight size={18} color={colors.muted} />
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  synced: { color: colors.muted, fontSize: 13 },
  dot: { position: 'absolute', top: -2, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  searchRow: { paddingHorizontal: 16 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 16, color: colors.text },
  filterBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 10 },
  filterText: { flex: 1, color: colors.primary, fontSize: 13 },
  clearLink: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  caption: { color: colors.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 12 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  tabLabelActive: { color: '#fff' },
  // The breadcrumb strip must never be squeezed by the (tall) list below it.
  crumbsBar: { flexGrow: 0, flexShrink: 0 },
  crumbs: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  crumbWrap: { flexDirection: 'row', alignItems: 'center' },
  crumb: { color: colors.muted, fontSize: 14 },
  crumbActive: { color: colors.text, fontWeight: '700' },
  crumbSep: { marginHorizontal: 4 },
  spinner: { marginVertical: 12 },
  empty: { color: colors.muted, textAlign: 'center', padding: 24, fontSize: 15 },
  // The list takes the remaining space and scrolls inside it.
  list: { flex: 1 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.border },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  toast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  toastText: { color: '#fff', fontSize: 14 },
});