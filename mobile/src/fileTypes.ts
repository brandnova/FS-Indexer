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
import type { Palette } from './theme/tokens';

interface FileKind {
  id: string;
  label: string;
  Icon: LucideIcon;
  color: string;
  exts: string[];
}

// The registry: add an entry to support another kind of file.
const KINDS: FileKind[] = [
  { id: 'images', label: 'Images', Icon: ImageIcon, color: '#0EA5E9', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'raw', 'ico', 'avif'] },
  { id: 'audio', label: 'Audio', Icon: Music, color: '#A855F7', exts: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff'] },
  { id: 'video', label: 'Video', Icon: Video, color: '#EF4444', exts: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'm4v', 'flv', 'mpg', 'mpeg'] },
  { id: 'documents', label: 'Documents', Icon: FileText, color: '#2F66E0', exts: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'epub', 'pages', 'tex'] },
  { id: 'spreadsheets', label: 'Spreadsheets', Icon: FileSpreadsheet, color: '#16A34A', exts: ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'] },
  { id: 'slides', label: 'Slides', Icon: Presentation, color: '#F97316', exts: ['ppt', 'pptx', 'odp'] },
  { id: 'archives', label: 'Archives', Icon: FileArchive, color: '#A16207', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso'] },
  {
    id: 'code',
    label: 'Code',
    Icon: FileCode,
    color: '#0D9488',
    exts: ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'swift', 'sh', 'bash', 'ps1', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'lua'],
  },
  { id: 'installers', label: 'Installers', Icon: Package, color: '#7C3AED', exts: ['apk', 'aab', 'exe', 'msi', 'deb', 'rpm', 'appimage', 'pkg', 'dmg'] },
];

const byExt = new Map<string, FileKind>();
for (const kind of KINDS) {
  for (const ext of kind.exts) byExt.set(ext, kind);
}

/** The kinds the filter sheet offers. */
export const FILE_KINDS = KINDS.map(({ id, label }) => ({ id, label }));

/** All extensions belonging to the given kind ids. */
export function extsForKinds(ids: string[]): string[] {
  return KINDS.filter((k) => ids.includes(k.id)).flatMap((k) => k.exts);
}

/** Icon and colour for an entry. `ext` is lowercase without a dot, as the agent sends it. */
export function iconFor(ext: string, isDir: boolean, colors: Palette): { Icon: LucideIcon; color: string } {
  if (isDir) return { Icon: Folder, color: colors.folder };
  const kind = byExt.get(ext);
  return kind ? { Icon: kind.Icon, color: kind.color } : { Icon: FileIcon, color: colors.muted };
}