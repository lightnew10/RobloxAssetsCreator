import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// Windows antivirus/indexers and other processes can temporarily hold the target
// file open. Retry only transient filesystem errors; NEVER delete the destination
// to force a rename, as doing so could lose the last complete job snapshot.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function writeAtomicJson(file, value, {
  fsApi = { mkdir, rename, unlink, writeFile },
  maxAttempts = 12,
  firstDelayMs = 40,
  maxDelayMs = 750,
  pause = delay,
  onRetry = null,
} = {}) {
  const serialized = JSON.stringify(value, null, 2);
  if (typeof serialized !== 'string') throw new TypeError('Cannot serialize undefined JSON value.');
  await fsApi.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    // A unique file avoids writers overwriting each other's temporary snapshots.
    await fsApi.writeFile(temp, serialized, 'utf8');
    const attempts = Math.max(1, Math.floor(maxAttempts));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await fsApi.rename(temp, file);
        return;
      } catch (cause) {
        if (!RETRYABLE_RENAME_CODES.has(cause?.code)) throw cause;
        if (attempt >= attempts) {
          const failure = new Error(
            'Sauvegarde du job bloquée par Windows ou un autre processus après ' +
            attempts + ' tentatives (' + cause.code + '). Ancien fichier conservé.'
          );
          failure.code = 'JOB_SAVE_BLOCKED';
          failure.cause = cause;
          failure.details = { file, attempts, originalCode: cause.code, originalMessage: cause.message };
          throw failure;
        }
        const waitMs = Math.min(maxDelayMs, firstDelayMs * 2 ** (attempt - 1));
        if (typeof onRetry === 'function') onRetry({ attempt, code: cause.code, file, waitMs });
        await pause(waitMs);
      }
    }
  } finally {
    // After a successful rename the temporary file no longer exists. When any
    // failure occurs, removing only OUR temp does not affect the last good job.
    try { await fsApi.unlink(temp); }
    catch (cause) {
      if (cause?.code !== 'ENOENT') {
        // A temporary-file cleanup failure must not erase the original error.
        // The unique filename is safe for later manual cleanup after shutdown.
        console.warn('[RAC][JOB_TEMP_CLEANUP_FAILED]', { temp, code: cause.code, message: cause.message });
      }
    }
  }
}
