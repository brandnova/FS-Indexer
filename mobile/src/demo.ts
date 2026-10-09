import { clearIndex, countEntries, getDb, getMeta, setMeta } from './db';
import { savePairing } from './pairing';
import { SyncCancelled, type SyncProgress } from './sync';
import type { Entry, PairingInfo, PingResponse } from './types';

// ---------- the sample files ----------

type DemoFile = [name: string, sizeKb: number, daysAgo: number];
interface DemoFolder {
  folder: string;
  items: DemoNode[];
}
type DemoNode = DemoFile | DemoFolder;

const DEMO_TREE: Record<string, DemoNode[]> = {
  Documents: [
    {
      folder: 'Work',
      items: [
        {
          folder: 'Reports',
          items: [
            ['Quarterly report Q3.pdf', 2400, 12],
            ['Sales summary.xlsx', 380, 5],
            ['Team update.docx', 96, 2],
          ],
        },
        ['Project plan.docx', 140, 20],
        ['Meeting notes.txt', 6, 1],
        ['Budget 2026.xlsx', 220, 9],
        ['Kickoff slides.pptx', 5200, 30],
      ],
    },
    {
      folder: 'Personal',
      items: [
        ['CV 2026.pdf', 180, 40],
        ['Passport scan.jpg', 1900, 200],
        ['Recipes.docx', 64, 75],
        ['Travel checklist.txt', 3, 14],
      ],
    },
    {
      folder: 'Receipts',
      items: [
        ['Electricity March.pdf', 90, 220],
        ['Electricity April.pdf', 92, 190],
        ['Laptop warranty.pdf', 310, 400],
      ],
    },
    ['Notes.md', 2, 0],
    ['Reading list.txt', 1, 3],
  ],
  Pictures: [
    {
      folder: 'Holiday 2025',
      items: [
        ['Beach sunset.jpg', 3400, 90],
        ['Old town.jpg', 2900, 89],
        ['Market stall.jpg', 3100, 88],
        ['Hotel view.jpg', 2700, 88],
        ['Group photo.jpg', 3600, 87],
        ['Boat trip.mp4', 48000, 87],
      ],
    },
    {
      folder: 'Family',
      items: [
        ['Birthday cake.jpg', 2500, 130],
        ['Garden.jpg', 2200, 45],
        ['Graduation.png', 4100, 300],
      ],
    },
    {
      folder: 'Screenshots',
      items: [
        ['Screenshot 2026-09-14.png', 640, 25],
        ['Screenshot 2026-10-02.png', 580, 7],
        ['Screenshot 2026-10-06.png', 710, 3],
      ],
    },
    ['Profile photo.png', 410, 60],
  ],
  Music: [
    {
      folder: 'Road trip',
      items: [
        ['Open road.mp3', 5600, 120],
        ['Sunrise drive.mp3', 6100, 120],
        ['Midnight highway.mp3', 5900, 119],
        ['Coast.flac', 31000, 119],
      ],
    },
    {
      folder: 'Focus',
      items: [
        ['Deep work 1.mp3', 7200, 50],
        ['Deep work 2.mp3', 7000, 50],
        ['Rain sounds.ogg', 4800, 33],
        ['Cover.jpg', 220, 50],
      ],
    },
    ['Voice memo.m4a', 1200, 6],
  ],
  Projects: [
    {
      folder: 'website',
      items: [
        ['index.html', 8, 4],
        ['styles.css', 12, 4],
        ['app.js', 21, 3],
        {
          folder: 'assets',
          items: [
            ['logo.svg', 6, 40],
            ['hero.png', 480, 40],
          ],
        },
      ],
    },
    {
      folder: 'scripts',
      items: [
        ['backup.sh', 2, 100],
        ['clean.py', 3, 21],
      ],
    },
    ['README.md', 4, 8],
    ['archive-2025.zip', 48000, 150],
    ['setup.exe', 5400, 90],
  ],
};

/** A stable pseudo-random number from a name, so sample dates look natural but never change. */
function offsetFor(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 40000;
  return h;
}

function buildEntries(nowSec: number): Entry[] {
  const out: Entry[] = [];

  for (const [label, nodes] of Object.entries(DEMO_TREE)) {
    out.push({ path: label, parent: '', name: label, ext: '', size: 0, mtime: nowSec - 3600, is_dir: true });

    const walk = (items: DemoNode[], parent: string) => {
      for (const item of items) {
        if (Array.isArray(item)) {
          const [name, sizeKb, daysAgo] = item;
          const dot = name.lastIndexOf('.');
          out.push({
            path: `${parent}/${name}`,
            parent,
            name,
            ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
            size: sizeKb * 1024,
            mtime: nowSec - daysAgo * 86400 - offsetFor(name),
            is_dir: false,
          });
        } else {
          const path = `${parent}/${item.folder}`;
          out.push({ path, parent, name: item.folder, ext: '', size: 0, mtime: nowSec - 86400, is_dir: true });
          walk(item.items, path);
        }
      }
    };
    walk(nodes, label);
  }

  return out;
}

// ---------- entering the demo ----------

const INSERT_SQL =
  'INSERT OR REPLACE INTO files (path, parent, name, name_lc, path_lc, ext, size, mtime, is_dir, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/** Loads the sample files onto the phone and returns a demo pairing (no PC involved). */
export async function startDemo(): Promise<PairingInfo> {
  await clearIndex(); // start from a clean slate

  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const entries = buildEntries(now);

  await db.withTransactionAsync(async () => {
    for (const e of entries) {
      await db.runAsync(
        INSERT_SQL,
        e.path,
        e.parent,
        e.name,
        e.name.toLowerCase(),
        e.path.toLowerCase(),
        e.ext,
        e.size,
        e.mtime,
        e.is_dir ? 1 : 0,
        1,
      );
    }
  });

  await setMeta('sync_id', '1');
  await setMeta('last_synced_at', String(now));
  await setMeta('synced_pc_indexed_at', String(now));
  await setMeta(
    'pc_roots',
    JSON.stringify({
      sep: '/',
      roots: Object.keys(DEMO_TREE).map((label) => ({ label, path: `/home/demo/${label}` })),
    }),
  );

  const info: PairingInfo = { v: 1, host: 'demo', port: 0, token: 'demo', id: 'demo', name: 'Demo PC', demo: true };
  await savePairing(info);
  return info;
}

// ---------- pretending to be a PC ----------

/** What a PC would answer to a ping, built from the sample data on the phone. */
export async function demoPing(): Promise<PingResponse> {
  const stamp = Number((await getMeta('synced_pc_indexed_at')) ?? '0') || Math.floor(Date.now() / 1000);
  return {
    device_id: 'demo',
    name: 'Demo PC',
    version: 'demo',
    api_version: 1,
    indexed_at: stamp,
    file_count: await countEntries(),
    scanning: false,
  };
}

/** A fake update, so people can see how updating looks and feels. Honors Cancel. */
export async function simulateDemoUpdate(onProgress: (p: SyncProgress) => void, signal?: AbortSignal): Promise<void> {
  const wait = async (ms: number) => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    if (signal?.aborted) throw new SyncCancelled();
  };

  const total = await countEntries();
  onProgress({ phase: 'rescanning', received: 0, total: null });
  await wait(900);

  for (let step = 1; step <= 10; step++) {
    onProgress({ phase: 'downloading', received: Math.round((total * step) / 10), total });
    await wait(150);
  }

  onProgress({ phase: 'cleaning', received: total, total });
  await wait(300);
  await setMeta('last_synced_at', String(Math.floor(Date.now() / 1000)));
}