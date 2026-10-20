import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { copyText } from './clipboard';
import DetailsSheet from './components/DetailsSheet';
import DownloadsBar from './components/DownloadsBar';
import DownloadsSheet from './components/DownloadsSheet';
import FilterSheet from './components/FilterSheet';
import UploadSheet from './components/UploadSheet';
import { isPinned, setPinned, type FileRow, type FilterSpec } from './db/queries';
import { enqueueDownload } from './downloadQueue';
import { DEFAULT_FILTERS, toSpec, type FilterState } from './filters';
import { useToast } from './hooks';
import { fullPcPath } from './pcPaths';
import { Toast } from './ui';

interface Actions {
  showDetails: (row: FileRow) => void;
  togglePin: (path: string, name: string) => Promise<void>;
  copyFolderPath: (path: string) => Promise<void>;
  notify: (message: string) => void;
  filters: FilterState;
  spec: FilterSpec;
  setFilters: (filters: FilterState) => void;
  openFilters: () => void;
  openUpload: () => void;
  download: (row: FileRow) => void; // adds a file to the download queue
  openDownloads: () => void;
}

const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('useActions must be used inside ActionsProvider');
  return actions;
}

export function ActionsProvider({ bump, children }: { bump: () => void; children: ReactNode }) {
  const [toast, notify] = useToast();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [details, setDetails] = useState<{ row: FileRow; pcPath: string | null } | null>(null);
  const spec = useMemo(() => toSpec(filters), [filters]);

  const copy = useCallback(
    async (label: string, text: string) => {
      const ok = await copyText(text);
      notify(ok ? `${label} copied` : "Copy isn't available in this build");
    },
    [notify],
  );

  const copyFolderPath = useCallback(
    async (path: string) => {
      const pc = await fullPcPath(path);
      await copy(pc ? 'PC path' : 'App path', pc ?? path);
    },
    [copy],
  );

  const togglePin = useCallback(
    async (path: string, name: string) => {
      const pinned = await isPinned(path);
      await setPinned(path, !pinned);
      notify(pinned ? `Unpinned ${name}` : `Pinned ${name}`);
      bump();
    },
    [notify, bump],
  );

  const showDetails = useCallback((row: FileRow) => {
    setDetails({ row, pcPath: null });
    void fullPcPath(row.path).then((pcPath) =>
      setDetails((d) => (d && d.row.path === row.path ? { row, pcPath } : d)),
    );
  }, []);

  // The sheet is a separate window, so close it first: the toast shows in the main one.
  const onCopyFromSheet = useCallback(
    (label: string, text: string) => {
      setDetails(null);
      void copy(label, text);
    },
    [copy],
  );

  const download = useCallback(
    (row: FileRow) => {
      const result = enqueueDownload(row);
      notify(result === 'added' ? `Added to downloads: ${row.name}` : `Already in your downloads: ${row.name}`);
    },
    [notify],
  );

  const onDownloadFromSheet = useCallback(
    (row: FileRow) => {
      setDetails(null);
      download(row);
    },
    [download],
  );

  const onShowDownloadsFromSheet = useCallback(() => {
    setDetails(null);
    setDownloadsOpen(true);
  }, []);

  const value = useMemo<Actions>(
    () => ({
      showDetails,
      togglePin,
      copyFolderPath,
      notify,
      filters,
      spec,
      setFilters,
      openFilters: () => setFiltersOpen(true),
      openUpload: () => setUploadOpen(true),
      download,
      openDownloads: () => setDownloadsOpen(true),
    }),
    [showDetails, togglePin, copyFolderPath, notify, filters, spec, download],
  );

  return (
    <ActionsContext.Provider value={value}>
      {children}
      <DownloadsBar onPress={() => setDownloadsOpen(true)} />
      <Toast message={toast} />
      <FilterSheet visible={filtersOpen} value={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
      <UploadSheet visible={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DownloadsSheet visible={downloadsOpen} onClose={() => setDownloadsOpen(false)} />
      <DetailsSheet
        row={details?.row ?? null}
        pcPath={details?.pcPath ?? null}
        onCopy={onCopyFromSheet}
        onDownload={onDownloadFromSheet}
        onShowDownloads={onShowDownloadsFromSheet}
        onClose={() => setDetails(null)}
      />
    </ActionsContext.Provider>
  );
}