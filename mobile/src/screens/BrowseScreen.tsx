import { ChevronLeft, ChevronRight, File as FileIcon, Folder as FolderIcon, Search, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SEARCH_LIMIT, listFolder, searchFiles, tokenize, type FileRow } from '../db/queries';
import { getMeta } from '../db';
import { formatDate, formatDateTime, formatSize } from '../format';
import { useDebounced } from '../hooks';
import type { PairingInfo } from '../types';
import { colors } from '../ui';

interface Props {
  pairing: PairingInfo;
  onBack: () => void;
}

const ROW_HEIGHT = 60;

function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export default function BrowseScreen({ pairing, onBack }: Props) {
  const [current, setCurrent] = useState(''); // '' = list of roots
  const [rows, setRows] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 200);
  const [results, setResults] = useState<FileRow[] | null>(null);

  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const crumbsRef = useRef<ScrollView>(null);

  const searchActive = query.trim().length > 0;

  // Folder listing
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listFolder(current)
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error('listFolder failed', e);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  // Search (runs on the debounced value; stale results are ignored)
  useEffect(() => {
    if (tokenize(debouncedQuery).length === 0) {
      setResults(null);
      return;
    }
    let cancelled = false;
    searchFiles(debouncedQuery)
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch((e) => console.error('searchFiles failed', e));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    getMeta('last_synced_at').then(setLastSynced);
  }, []);

  // Back button: clear search, then go up a folder, then leave. (No-op on iOS.)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (query) {
        setQuery('');
      } else if (current) {
        setCurrent(parentOf(current));
      } else {
        onBack();
      }
      return true;
    });
    return () => sub.remove();
  }, [query, current, onBack]);

  const onPressRow = useCallback(
    (row: FileRow) => {
      if (searchActive) {
        // Folder: open it. File: jump to the folder that contains it.
        setQuery('');
        setCurrent(row.isDir ? row.path : row.parent);
        return;
      }
      if (row.isDir) {
        setCurrent(row.path);
      } else {
        Alert.alert(
          row.name,
          `${row.path}\n\n${formatSize(row.size)}\nModified ${formatDateTime(row.mtime)}`,
        );
      }
    },
    [searchActive],
  );

  const segments = current ? current.split('/') : [];
  const crumbs = segments.map((label, i) => ({ label, path: segments.slice(0, i + 1).join('/') }));

  const data = searchActive ? (results ?? []) : rows;
  const searching = searchActive && results === null;

  let emptyText: string | null = null;
  if (!loading && !searching && data.length === 0) {
    if (searchActive) emptyText = `No files match "${query.trim()}"`;
    else if (current === '') emptyText = 'Nothing synced yet. Go back and tap "Sync now".';
    else emptyText = 'This folder is empty.';
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.primary} />
          <Text style={styles.backText}>Home</Text>
        </Pressable>
        {lastSynced ? <Text style={styles.synced}>Synced {formatDate(Number(lastSynced))}</Text> : null}
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

      {searchActive ? (
        <Text style={styles.caption}>
          {searching
            ? 'Searching...'
            : `${data.length}${data.length >= SEARCH_LIMIT ? '+' : ''} result${data.length === 1 ? '' : 's'}`}
        </Text>
      ) : (
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
      )}

      {loading || searching ? <ActivityIndicator style={styles.spinner} color={colors.primary} /> : null}

      {emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null}

      <FlatList
        data={data}
        keyExtractor={(item) => item.path}
        renderItem={({ item }) => <Row item={item} showParent={searchActive} onPress={onPressRow} />}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={20}
        windowSize={10}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

const Row = memo(function Row({
  item,
  showParent,
  onPress,
}: {
  item: FileRow;
  showParent: boolean;
  onPress: (row: FileRow) => void;
}) {
  return (
    <Pressable onPress={() => onPress(item)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {item.isDir ? (
        <FolderIcon size={24} color={colors.primary} />
      ) : (
        <FileIcon size={24} color={colors.muted} />
      )}
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {showParent ? (
          <Text style={styles.meta} numberOfLines={1} ellipsizeMode="head">
            {item.parent}
          </Text>
        ) : (
          <Text style={styles.meta} numberOfLines={1}>
            {item.isDir ? 'Folder' : `${formatSize(item.size)} · ${formatDate(item.mtime)}`}
          </Text>
        )}
      </View>
      {item.isDir ? <ChevronRight size={18} color={colors.muted} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  synced: { color: colors.muted, fontSize: 13, paddingRight: 4 },
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
  caption: { color: colors.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 12 },
  crumbsBar: { flexGrow: 0 },
  crumbs: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  crumbWrap: { flexDirection: 'row', alignItems: 'center' },
  crumb: { color: colors.muted, fontSize: 14 },
  crumbActive: { color: colors.text, fontWeight: '700' },
  crumbSep: { marginHorizontal: 4 },
  spinner: { marginVertical: 12 },
  empty: { color: colors.muted, textAlign: 'center', padding: 24, fontSize: 15 },
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
});