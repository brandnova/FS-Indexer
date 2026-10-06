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

// What we need to talk to an agent.
export interface Candidate {
  host: string;
  port: number;
  token: string;
}

// A verified, saved pairing.
export interface PairingInfo extends Candidate {
  v: 1;
  id: string;
  name: string;
}

export interface PingResponse {
  device_id: string;
  name: string;
  version: string;
  api_version?: number; // absent on agents from before this field existed (they speak v1)
  indexed_at: number;
  file_count: number;
  scanning: boolean;
}