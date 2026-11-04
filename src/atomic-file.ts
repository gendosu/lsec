import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Callers serialize the full operation; rename alone cannot protect read/modify/write. */
export function writeFileAtomic(filePath: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  let fd: number | undefined;
  let owned = false;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    owned = true;
    fs.writeFileSync(fd, data);
    fs.fchmodSync(fd, 0o600);
    const writtenFd = fd;
    fd = undefined;
    fs.closeSync(writtenFd);
    fs.renameSync(tempPath, filePath);
    owned = false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* Preserve the original failure. */ }
    }
    if (owned) {
      try { fs.unlinkSync(tempPath); } catch { /* Leave evidence if cleanup also fails. */ }
    }
  }
}
