// One line of the index (see docs/API.md). Field names match the agent.
export interface Entry {
  path: string;
  parent: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  is_dir: boolean;
}

// What we need to talk to an agent: where it is, and this phone's own key.
export interface Candidate {
  host: string;
  port: number;
  token: string;
}

// What a pairing QR code (or the manual form) gives us: where the PC is, plus either a
// one-time pairing code (agents with per-phone keys) or the shared token (older agents).
export interface PairingOffer {
  host: string;
  port: number;
  code?: string;
  token?: string;
  id?: string;
}

// A verified, saved pairing.
export interface PairingInfo extends Candidate {
  v: 1;
  id: string;
  name: string;
  demo?: boolean; // true while exploring the built-in sample files (no PC involved)
}

export interface PingResponse {
  device_id: string;
  name: string;
  version: string;
  api_version?: number; // absent on agents from before this field existed (they speak v1)
  indexed_at: number;
  file_count: number;
  scanning: boolean;
  file_access?: boolean; // whether the PC lets phones open files (absent on older agents)
  uploads?: boolean; // whether the PC accepts files from this phone (absent on older agents)
  upload_max_mb?: number; // the largest file the PC accepts
  upload_folder?: string; // the drop folder's name (not its path)
  latest_version?: string; // the newest release, when the PC's update check is on and it is newer than the PC's version
}