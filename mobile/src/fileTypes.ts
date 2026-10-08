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
  Icon: LucideIcon;
  color: string;
  exts: string[];
}

// The registry: add a line to support another kind of file.
const KINDS: FileKind[] = [
  { Icon: ImageIcon, color: '#0ea5e9', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'raw', 'ico', 'avif'] },
  { Icon: Music, color: '#a855f7', exts: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff'] },
  { Icon: Video, color: '#ef4444', exts: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'm4v', 'flv', 'mpg', 'mpeg'] },
  { Icon: FileText, color: '#2563eb', exts: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'epub', 'pages', 'tex'] },
  { Icon: FileSpreadsheet, color: '#16a34a', exts: ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'] },
  { Icon: Presentation, color: '#f97316', exts: ['ppt', 'pptx', 'odp'] },
  { Icon: FileArchive, color: '#a16207', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso'] },
  {
    Icon: FileCode,
    color: '#0d9488',
    exts: ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'swift', 'sh', 'bash', 'ps1', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'lua'],
  },
  { Icon: Package, color: '#7c3aed', exts: ['apk', 'aab', 'exe', 'msi', 'deb', 'rpm', 'appimage', 'pkg', 'dmg'] },
];

const byExt = new Map<string, FileKind>();
for (const kind of KINDS) {
  for (const ext of kind.exts) byExt.set(ext, kind);
}

const FOLDER = { Icon: Folder, color: colors.primary };
const FALLBACK = { Icon: FileIcon, color: colors.muted };

/** Icon and colour for an entry. `ext` is lowercase without a dot, as the agent sends it. */
export function iconFor(ext: string, isDir: boolean): { Icon: LucideIcon; color: string } {
  if (isDir) return FOLDER;
  const kind = byExt.get(ext);
  return kind ? { Icon: kind.Icon, color: kind.color } : FALLBACK;
}