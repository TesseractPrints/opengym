import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function readSnapshotFile(absolute, expected, relative) {
  let fd;
  try {
    try {
      fd = fs.openSync(
        absolute,
        fs.constants.O_RDONLY |
          fs.constants.O_NONBLOCK |
          fs.constants.O_NOFOLLOW
      );
    } catch (error) {
      if (error.code === 'ELOOP') {
        throw new Error(`snapshot refuses symlink: ${relative}`, { cause: error });
      }
      throw error;
    }

    const actual = fs.fstatSync(fd);
    if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
      throw new Error(`file changed during snapshot: ${relative}`);
    }
    return { content: fs.readFileSync(fd), stat: actual };
  } finally {
    if (fd !== undefined) {
      const snapshotFd = fd;
      fd = undefined;
      fs.closeSync(snapshotFd);
    }
  }
}

function snapshotFiles(root, directory, files, excluded) {
  for (const name of fs.readdirSync(directory).sort()) {
    if (name.endsWith('.tmp')) continue;
    const absolute = path.join(directory, name);
    if (excluded.has(path.resolve(absolute))) continue;
    const stat = fs.lstatSync(absolute);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (stat.isSymbolicLink()) throw new Error(`snapshot refuses symlink: ${relative}`);
    if (stat.isDirectory()) {
      snapshotFiles(root, absolute, files, excluded);
      continue;
    }
    if (!stat.isFile()) throw new Error(`snapshot refuses non-file: ${relative}`);
    const { content, stat: openedStat } = readSnapshotFile(absolute, stat, relative);
    files.push({
      path: relative,
      mode: openedStat.mode & 0o777,
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      data: content.toString('base64')
    });
  }
}

export function createSnapshot(root, now = new Date(), { exclude = [] } = {}) {
  const files = [];
  const excluded = new Set(exclude.filter(Boolean).map(file => path.resolve(file)));
  snapshotFiles(root, root, files, excluded);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { format: 'opengym-backup-v1', createdAt: now.toISOString(), files };
}

export function isBackupAuthorized(header, token) {
  if (typeof header !== 'string' || typeof token !== 'string' || token.length < 32) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from('Bearer ' + token);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
