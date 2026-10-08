import {
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Music,
  Package,
  Presentation,
  Video,
  type LucideIcon,
} from 'lucide-react-native';
import { colors } from './ui';

interface FileKind {
  id: string;
  label: string;
  Icon: LucideIcon;
  color: string;
  exts: string[];
}

// The registry: add an entry to support another kind of file.
const KINDS: FileKind[] = [
  { id: 'images', label: 'Images', Icon: ImageIcon, color: '#0ea5e9', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'raw', 'ico', 'avif'] },
  { id: 'audio', label: 'Audio', Icon: Music, color: '#a855f7', exts: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff'] },
  { id: 'video', label: 'Video', Icon: Video, color: '#ef4444', exts: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'm4v', 'flv', 'mpg', 'mpeg'] },
  { id: 'documents', label: 'Documents', Icon: FileText, color: '#2563eb', exts: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'epub', 'pages', 'tex'] },
  { id: 'spreadsheets', label: 'Spreadsheets', Icon: FileSpreadsheet, color: '#16a34a', exts: ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'] },
  { id: 'slides', label: 'Slides', Icon: Presentation, color: '#f97316', exts: ['ppt', 'pptx', 'odp'] },
  { id: 'archives', label: 'Archives', Icon: FileArchive, color: '#a16207', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso'] },
  {
    id: 'code',
    label: 'Code',
    Icon: FileCode,
    color: '#0d9488',
    exts: ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'swift', 'sh', 'bash', 'ps1', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'lua'],
  },
  { id: 'installers', label: 'Installers', Icon: Package, color: '#7c3aed', exts: ['apk', 'aab', 'exe', 'msi', 'deb', 'rpm', 'appimage', 'pkg', 'dmg'] },
];

const byExt = new Map<string, FileKind>();
for (const kind of KINDS) {
  for (const ext of kind.exts) byExt.set(ext, kind);
}

const FOLDER = { Icon: Folder, color: colors.primary };
const FALLBACK = { Icon: FileIcon, color: colors.muted };

/** The kinds the filter sheet offers. */
export const FILE_KINDS = KINDS.map(({ id, label }) => ({ id, label }));

/** All extensions belonging to the given kind ids. */
export function extsForKinds(ids: string[]): string[] {
  return KINDS.filter((k) => ids.includes(k.id)).flatMap((k) => k.exts);
}

/** Icon and colour for an entry. `ext` is lowercase without a dot, as the agent sends it. */
export function iconFor(ext: string, isDir: boolean): { Icon: LucideIcon; color: string } {
  if (isDir) return FOLDER;
  const kind = byExt.get(ext);
  return kind ? { Icon: kind.Icon, color: kind.color } : FALLBACK;
}