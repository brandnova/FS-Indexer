import {
  ChevronRight,
  Copy,
  EllipsisVertical,
  FolderOpen,
  House,
  Pin,
  PinOff,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useActions } from '../actions';
import { FileListRow, ROW_HEIGHT, subtitleFor } from '../components/FileRow';
import {
  SEARCH_LIMIT,
  hasFileFilters,
  isPinned,
  listFolder,
  searchFiles,
  tokenize,
  type FileRow,
} from '../db/queries';
import { DEFAULT_FILTERS, activeCount, describe } from '../filters';
import { fonts, radius } from '../theme/tokens';
import { useDebounced } from '../hooks';
import { useSession } from '../session';
import { ActionRow, EmptyState, IconButton, Sheet, Text, useTheme, useThemedStyles, type Palette } from '../ui';

export interface FilesHandle {
  /** Handles the Android back button inside this screen. Returns true if it did something. */
  handleBack: () => boolean;
}

interface Props {
  path: string; // '' = the list of folders
  onPathChange: (path: string) => void;
  focusKey: number; // changes when something wants the search box focused
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

const FilesScreen = forwardRef<FilesHandle, Props>(function FilesScreen({ path, onPathChange, focusKey }, ref) {
  const session = useSession();
  const { showDetails, togglePin, copyFolderPath, filters, setFilters, spec, openFilters } = useActions();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [rows, setRows] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinnedHere, setPinnedHere] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 200);
  const [results, setResults] = useState<FileRow[] | null>(null);

  const inputRef = useRef<TextInput>(null);
  const crumbsRef = useRef<ScrollView>(null);

  const searchActive = query.trim().length > 0;
  const activeFilters = activeCount(filters);
  const segments = path ? path.split('/') : [];
  const folderName = segments[segments.length - 1] ?? '';
  const inFolder = path !== '';

  useImperativeHandle(
    ref,
    () => ({
      handleBack: () => {
        if (query) {
          setQuery('');
          return true;
        }
        if (path) {
          onPathChange(parentOf(path));
          return true;
        }
        return false;
      },
    }),
    [query, path, onPathChange],
  );

  // Focus the search box when asked (e.g. from the Home screen's search).
  useEffect(() => {
    if (focusKey === 0) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [focusKey]);

  // The folder listing
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listFolder(path, spec)
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error('listing the folder failed', e);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, spec, session.dataVersion]);

  // Is this folder pinned?
  useEffect(() => {
    if (!path) {
      setPinnedHere(false);
      return undefined;
    }
    let cancelled = false;
    isPinned(path).then((p) => {
      if (!cancelled) setPinnedHere(p);
    });
    return () => {
      cancelled = true;
    };
  }, [path, session.dataVersion]);

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
      .catch((e) => console.error('search failed', e));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, spec, filters.scope, session.dataVersion]);

  const onPressRow = useCallback(
    (row: FileRow) => {
      if (searchActive) {
        // Folder: open it. File: jump to the folder that contains it.
        setQuery('');
        onPathChange(row.isDir ? row.path : row.parent);
        return;
      }
      if (row.isDir) onPathChange(row.path);
      else showDetails(row);
    },
    [searchActive, onPathChange, showDetails],
  );

  // Long-press: a folder toggles its pin, a file shows its details.
  const onLongPressRow = useCallback(
    (row: FileRow) => {
      if (row.isDir) void togglePin(row.path, row.name);
      else showDetails(row);
    },
    [togglePin, showDetails],
  );

  const closeMenuThen = (action: () => void, delayMs = 0) => {
    setMenuOpen(false);
    setTimeout(action, delayMs); // let the sheet finish closing before another one opens
  };

  const data = searchActive ? (results ?? []) : rows;
  const searching = searchActive && results === null;
  const mode = searchActive ? 'search' : 'browse';
  const filtersOn = hasFileFilters(spec);

  let empty: ReactEmpty | null = null;
  if (!loading && !searching && data.length === 0) {
    if (searchActive) {
      empty = { icon: SearchX, title: `No results for "${query.trim()}"`, message: 'Try fewer or different words.' };
    } else if (filtersOn) {
      empty = {
        icon: SlidersHorizontal,
        title: 'Nothing matches your filters',
        action: { title: 'Clear filters', onPress: () => setFilters(DEFAULT_FILTERS) },
      };
    } else if (!inFolder) {
      empty = {
        icon: FolderOpen,
        title: 'No files yet',
        message: "Update your file list and your PC's folders will show up here.",
        action: { title: 'Update now', onPress: () => void session.runSync({ rescan: true }) },
      };
    } else {
      empty = { icon: FolderOpen, title: 'This folder is empty' };
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <View style={styles.searchBox}>
          <Search size={18} color={colors.muted} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search your files"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? <IconButton icon={X} label="Clear search" size={18} onPress={() => setQuery('')} /> : null}
          <IconButton
            icon={SlidersHorizontal}
            label="Sort and filter"
            size={20}
            badge={activeFilters > 0}
            color={activeFilters > 0 ? colors.primary : colors.muted}
            onPress={openFilters}
          />
        </View>
        {inFolder && !searchActive ? (
          <IconButton icon={EllipsisVertical} label="Folder options" color={colors.text} onPress={() => setMenuOpen(true)} />
        ) : null}
      </View>

      {activeFilters > 0 ? (
        <View style={styles.filterBar}>
          <Text variant="caption" tone="primary" numberOfLines={1} style={styles.flex}>
            {describe(filters)}
          </Text>
          <Pressable onPress={() => setFilters(DEFAULT_FILTERS)} hitSlop={10}>
            <Text variant="label" tone="primary">
              Clear
            </Text>
          </Pressable>
        </View>
      ) : null}

      {searchActive ? (
        <Text variant="caption" tone="muted" style={styles.caption}>
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
          <Pressable onPress={() => onPathChange('')} hitSlop={8} style={styles.crumbItem}>
            <House size={16} color={path === '' ? colors.text : colors.muted} />
            <Text variant="label" tone={path === '' ? 'text' : 'muted'}>
              {session.pairing.name}
            </Text>
          </Pressable>
          {segments.map((label, i) => (
            <View key={segments.slice(0, i + 1).join('/')} style={styles.crumbItem}>
              <ChevronRight size={14} color={colors.muted} />
              <Pressable onPress={() => onPathChange(segments.slice(0, i + 1).join('/'))} hitSlop={8}>
                <Text variant="label" tone={i === segments.length - 1 ? 'text' : 'muted'}>
                  {label}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {loading || searching ? <ActivityIndicator style={styles.spinner} color={colors.primary} /> : null}

      {empty ? <EmptyState {...empty} /> : null}

      <FlatList
        style={styles.list}
        data={data}
        keyExtractor={(item) => item.path}
        renderItem={({ item }) => (
          <FileListRow item={item} {...subtitleFor(item, mode)} onPress={onPressRow} onLongPress={onLongPressRow} />
        )}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={20}
        windowSize={10}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={folderName}>
        <ActionRow
          icon={pinnedHere ? PinOff : Pin}
          title={pinnedHere ? 'Unpin this folder' : 'Pin this folder'}
          subtitle="Pinned folders are one tap away in the Pinned tab"
          onPress={() => closeMenuThen(() => void togglePin(path, folderName))}
        />
        <ActionRow
          icon={Copy}
          title="Copy folder path"
          subtitle="Its location on your PC"
          onPress={() => closeMenuThen(() => void copyFolderPath(path))}
        />
        <ActionRow
          icon={SlidersHorizontal}
          title="Sort and filter"
          onPress={() => closeMenuThen(openFilters, 300)}
        />
      </Sheet>
    </View>
  );
});

type ReactEmpty = Parameters<typeof EmptyState>[0];

export default FilesScreen;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 8 },
    searchBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 52,
      paddingLeft: 14,
      paddingRight: 4,
      borderRadius: radius.lg,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    input: { flex: 1, paddingVertical: 8, fontSize: 15, fontFamily: fonts.regular, color: c.text },
    filterBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginHorizontal: 16,
      marginTop: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.md,
      backgroundColor: c.primarySoft,
    },
    caption: { paddingHorizontal: 20, paddingVertical: 12 },
    // The breadcrumb strip must never be squeezed by the (tall) list below it.
    crumbsBar: { flexGrow: 0, flexShrink: 0 },
    crumbs: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', gap: 4 },
    crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    spinner: { marginVertical: 12 },
    // The list takes the remaining space and scrolls inside it.
    list: { flex: 1 },
  });