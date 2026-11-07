import fs from 'node:fs/promises';

// Windows cannot fsync directory handles. File fsync + atomic rename still
// supports process-crash recovery there, but not a power-loss durability claim.
// POSIX metadata flush failures remain fatal; never swallow file write errors.
export async function syncDirectory(directory) {
  if (process.platform === 'win32') return false;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  return true;
}
