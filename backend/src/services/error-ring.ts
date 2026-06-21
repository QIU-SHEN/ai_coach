interface ErrorEntry {
  time: string;
  message: string;
  path: string;
  method: string;
}

const MAX_ENTRIES = 100;
const ring: ErrorEntry[] = [];

export function pushError(entry: ErrorEntry): void {
  ring.push(entry);
  if (ring.length > MAX_ENTRIES) {
    ring.shift();
  }
}

export function getErrors(): ErrorEntry[] {
  return ring.slice().reverse(); // newest first
}
