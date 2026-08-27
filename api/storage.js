import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function assertPublishedFile(file, expected, operation) {
  let actual;
  try {
    actual = fs.lstatSync(file);
  } catch (error) {
    throw new Error(`${operation}: ${path.basename(file)}`, { cause: error });
  }
  if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`${operation}: ${path.basename(file)}`);
  }
}

export function atomicWrite(file, content, { randomUUID = crypto.randomUUID } = {}) {
  const tmp = `${file}.${process.pid}-${randomUUID()}.tmp`;
  let fd;
  let ownsTemp = false;
  let operationError;
  try {
    fd = fs.openSync(
      tmp,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600
    );
    ownsTemp = true;
    fs.writeFileSync(fd, content);
    fs.fchmodSync(fd, 0o600);
    fs.fsyncSync(fd);
    const stagingStat = fs.fstatSync(fd);
    const stagingFd = fd;
    fd = undefined;
    fs.closeSync(stagingFd);
    fs.renameSync(tmp, file);
    ownsTemp = false;
    assertPublishedFile(file, stagingStat, 'file changed during publication');
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let cleanupError;
    if (fd !== undefined) {
      const stagingFd = fd;
      fd = undefined;
      try {
        fs.closeSync(stagingFd);
      } catch (error) {
        if (error.code !== 'EBADF') cleanupError = error;
      }
    }
    if (ownsTemp) {
      try {
        fs.unlinkSync(tmp);
      } catch (error) {
        if (error.code !== 'ENOENT' && cleanupError === undefined) cleanupError = error;
      }
    }
    if (cleanupError !== undefined) {
      if (operationError !== undefined) operationError.cleanupError = cleanupError;
      else throw cleanupError;
    }
  }
}

export function readPrivateFile(file) {
  let fd;
  try {
    try {
      fd = fs.openSync(
        file,
        fs.constants.O_RDONLY |
          fs.constants.O_NONBLOCK |
          fs.constants.O_NOFOLLOW
      );
    } catch (error) {
      if (error.code === 'ELOOP') {
        throw new Error(`private file refuses symlink: ${path.basename(file)}`, {
          cause: error,
        });
      }
      throw error;
    }

    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`private file is not regular: ${path.basename(file)}`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`private file has unsafe mode: ${path.basename(file)}`);
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    if (fd !== undefined) {
      const privateFd = fd;
      fd = undefined;
      fs.closeSync(privateFd);
    }
  }
}

export function writePrivateFileExclusive(file, content) {
  let fd;
  let ownsFile = false;
  let operationError;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600
    );
    ownsFile = true;
    fs.writeFileSync(fd, content);
    fs.fchmodSync(fd, 0o600);
    fs.fsyncSync(fd);
    const createdStat = fs.fstatSync(fd);
    const privateFd = fd;
    fd = undefined;
    fs.closeSync(privateFd);
    ownsFile = false;
    assertPublishedFile(file, createdStat, 'file changed during private file creation');
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let cleanupError;
    if (fd !== undefined) {
      const privateFd = fd;
      fd = undefined;
      try {
        fs.closeSync(privateFd);
      } catch (error) {
        if (error.code !== 'EBADF') cleanupError = error;
      }
    }
    if (ownsFile) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT' && cleanupError === undefined) {
          cleanupError = error;
        }
      }
    }
    if (cleanupError !== undefined) {
      if (operationError !== undefined) operationError.cleanupError = cleanupError;
      else throw cleanupError;
    }
  }
}

function withVerifiedDataEntry(entry, expected, directory, operation) {
  let fd;
  try {
    try {
      fd = fs.openSync(
        entry,
        fs.constants.O_RDONLY |
          fs.constants.O_NONBLOCK |
          fs.constants.O_NOFOLLOW |
          (directory ? fs.constants.O_DIRECTORY : 0)
      );
    } catch (error) {
      if (error.code === 'ELOOP' || error.code === 'ENOTDIR') {
        throw new Error(`data tree changed during hardening: ${path.basename(entry)}`, {
          cause: error,
        });
      }
      throw error;
    }

    const actual = fs.fstatSync(fd);
    const expectedType = directory ? expected.isDirectory() : expected.isFile();
    const actualType = directory ? actual.isDirectory() : actual.isFile();
    if (!expectedType || !actualType || actual.dev !== expected.dev || actual.ino !== expected.ino) {
      throw new Error(`data tree changed during hardening: ${path.basename(entry)}`);
    }
    return operation(fd);
  } finally {
    if (fd !== undefined) {
      const entryFd = fd;
      fd = undefined;
      fs.closeSync(entryFd);
    }
  }
}

function hardenDataTreeWithExclusions(root, excluded, preserveRoot) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('data root must be a directory, not a symlink');
  }
  withVerifiedDataEntry(root, stat, true, fd => {
    if (!preserveRoot) fs.fchmodSync(fd, 0o700);
  });

  for (const name of fs.readdirSync(root)) {
    const entry = path.join(root, name);
    const entryStat = fs.lstatSync(entry);
    if (entryStat.isSymbolicLink()) throw new Error(`data tree refuses symlink: ${name}`);
    if (excluded.has(path.resolve(entry))) {
      if (!entryStat.isFile()) throw new Error(`data tree refuses non-file: ${name}`);
      continue;
    }
    if (entryStat.isDirectory()) {
      hardenDataTreeWithExclusions(entry, excluded, false);
    } else if (entryStat.isFile()) {
      withVerifiedDataEntry(entry, entryStat, false, fd => fs.fchmodSync(fd, 0o600));
    } else {
      throw new Error(`data tree refuses non-file: ${name}`);
    }
  }
}

export function hardenDataTree(root, { exclude = [], preserveRoot = false } = {}) {
  const excluded = new Set(exclude.filter(Boolean).map(entry => path.resolve(entry)));
  hardenDataTreeWithExclusions(root, excluded, preserveRoot);
}
