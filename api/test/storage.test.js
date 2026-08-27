import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  atomicWrite,
  hardenDataTree,
  readPrivateFile,
  writePrivateFileExclusive,
} from '../storage.js';

test('atomicWrite replaces persistent state with owner-only permissions', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, 'old', { mode: 0o644 });
  fs.chmodSync(file, 0o644);

  atomicWrite(file, 'new');

  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('atomicWrite never follows a predictable stale temp symlink', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'db.json');
  const outside = path.join(dir, 'outside');
  fs.writeFileSync(outside, 'do-not-touch', { mode: 0o600 });
  fs.symlinkSync(outside, `${file}.tmp`);

  atomicWrite(file, '{"safe":true}');

  assert.equal(fs.readFileSync(outside, 'utf8'), 'do-not-touch');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"safe":true}');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('atomicWrite never removes a colliding temp path it did not create', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'db.json');
  const collision = 'fixed-collision';
  const temp = `${file}.${process.pid}-${collision}.tmp`;
  fs.writeFileSync(temp, 'owned-elsewhere', { mode: 0o600 });

  assert.throws(
    () => atomicWrite(file, 'candidate-data', { randomUUID: () => collision }),
    error => error.code === 'EEXIST'
  );
  assert.equal(fs.readFileSync(temp, 'utf8'), 'owned-elsewhere');
  assert.equal(fs.existsSync(file), false);
});

test('atomicWrite removes its temp after a post-open write failure', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const file = path.join(root, 'db.json');
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = (target, ...args) => {
    if (typeof target === 'number') {
      const error = new Error('injected write failure');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalWriteFileSync(target, ...args);
  };

  try {
    assert.throws(
      () => atomicWrite(file, 'new-data', { randomUUID: () => 'write-failure' }),
      error => error.code === 'ENOSPC'
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('atomicWrite never closes its staging descriptor twice', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const file = path.join(root, 'db.json');
  const originalOpenSync = fs.openSync;
  const originalCloseSync = fs.closeSync;
  let stagingFd;
  let stagingCloseCalls = 0;

  fs.openSync = (...args) => {
    const fd = originalOpenSync(...args);
    stagingFd = fd;
    return fd;
  };
  fs.closeSync = fd => {
    if (fd === stagingFd) {
      stagingCloseCalls += 1;
      if (stagingCloseCalls === 1) {
        originalCloseSync(fd);
        const error = new Error('injected close failure');
        error.code = 'EIO';
        throw error;
      }
    }
    return originalCloseSync(fd);
  };

  try {
    assert.throws(
      () => atomicWrite(file, 'new-data', { randomUUID: () => 'close-failure' }),
      error => error.code === 'EIO'
    );
  } finally {
    fs.openSync = originalOpenSync;
    fs.closeSync = originalCloseSync;
  }

  assert.equal(stagingCloseCalls, 1);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('private credential helpers use regular owner-only files without following symlinks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const regular = path.join(root, 'regular-token');
  const unsafe = path.join(root, 'unsafe-token');
  const symlink = path.join(root, 'symlink-token');
  const value = 'x'.repeat(32);
  fs.writeFileSync(regular, value, { mode: 0o600 });
  fs.writeFileSync(unsafe, value, { mode: 0o644 });
  fs.chmodSync(regular, 0o600);
  fs.chmodSync(unsafe, 0o644);
  fs.symlinkSync(regular, symlink);

  assert.equal(readPrivateFile(regular), value);
  assert.throws(() => readPrivateFile(unsafe), /unsafe mode/);
  assert.throws(() => readPrivateFile(symlink), /refuses symlink/);
});

test('writePrivateFileExclusive creates owner-only credentials and preserves collisions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const created = path.join(root, 'created-token');
  const collision = path.join(root, 'existing-token');
  writePrivateFileExclusive(created, 'created-value');
  fs.writeFileSync(collision, 'existing-value', { mode: 0o600 });

  assert.equal(fs.readFileSync(created, 'utf8'), 'created-value');
  assert.equal(fs.statSync(created).mode & 0o777, 0o600);
  assert.throws(
    () => writePrivateFileExclusive(collision, 'replacement'),
    error => error.code === 'EEXIST'
  );
  assert.equal(fs.readFileSync(collision, 'utf8'), 'existing-value');
});

test('hardenDataTree repairs existing persistent file and directory permissions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const nested = path.join(root, 'profiles');
  const db = path.join(root, 'db.json');
  const state = path.join(nested, 'state-user.json');
  fs.mkdirSync(nested, { mode: 0o755 });
  fs.writeFileSync(db, '{}', { mode: 0o644 });
  fs.writeFileSync(state, '{}', { mode: 0o666 });
  fs.chmodSync(root, 0o755);
  fs.chmodSync(nested, 0o755);
  fs.chmodSync(db, 0o644);
  fs.chmodSync(state, 0o666);

  hardenDataTree(root);

  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(nested).mode & 0o777, 0o700);
  assert.equal(fs.statSync(db).mode & 0o777, 0o600);
  assert.equal(fs.statSync(state).mode & 0o777, 0o600);
});

test('hardenDataTree preserves an externally owned mount root while repairing its entries', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = path.join(root, 'db.json');
  fs.writeFileSync(db, '{}', { mode: 0o644 });
  fs.chmodSync(root, 0o777);
  fs.chmodSync(db, 0o644);

  hardenDataTree(root, { preserveRoot: true });

  assert.equal(fs.statSync(root).mode & 0o777, 0o777);
  assert.equal(fs.statSync(db).mode & 0o777, 0o600);
});

test('hardenDataTree leaves an excluded credential for its fail-closed validator', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const data = path.join(root, 'db.json');
  const credential = path.join(root, 'backup-token');
  fs.writeFileSync(data, '{}', { mode: 0o644 });
  fs.writeFileSync(credential, 'credential', { mode: 0o644 });
  fs.chmodSync(data, 0o644);
  fs.chmodSync(credential, 0o644);

  hardenDataTree(root, { exclude: [credential] });

  assert.equal(fs.statSync(data).mode & 0o777, 0o600);
  assert.equal(fs.statSync(credential).mode & 0o777, 0o644);
});

test('hardenDataTree rejects a symlink even when its credential path is excluded', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const target = path.join(root, 'secret');
  const credential = path.join(root, 'backup-token');
  fs.writeFileSync(target, 'x'.repeat(32), { mode: 0o600 });
  fs.symlinkSync(target, credential);

  assert.throws(
    () => hardenDataTree(root, { exclude: [credential] }),
    /refuses symlink/
  );
});

test('hardenDataTree rejects a non-file even when its credential path is excluded', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const credential = path.join(root, 'backup-token');
  fs.mkdirSync(credential, { mode: 0o700 });

  assert.throws(
    () => hardenDataTree(root, { exclude: [credential] }),
    /refuses non-file/
  );
});

test('atomicWrite never chmods a path after publishing the staging inode', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const file = path.join(root, 'db.json');
  const outside = path.join(root, 'outside');
  fs.writeFileSync(outside, 'outside', { mode: 0o644 });
  fs.chmodSync(outside, 0o644);
  const originalRenameSync = fs.renameSync;
  let publishedMode;
  fs.renameSync = (source, destination) => {
    originalRenameSync(source, destination);
    publishedMode = fs.statSync(destination).mode & 0o777;
    fs.unlinkSync(destination);
    fs.symlinkSync(outside, destination);
  };

  try {
    assert.throws(
      () => atomicWrite(file, 'new-data'),
      /changed during publication/
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(publishedMode, 0o600);
  assert.equal(fs.statSync(outside).mode & 0o777, 0o644);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
});

test('writePrivateFileExclusive never chmods a replaced credential path', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const file = path.join(root, 'backup-token');
  const outside = path.join(root, 'outside');
  fs.writeFileSync(outside, 'outside', { mode: 0o644 });
  fs.chmodSync(outside, 0o644);
  const originalOpenSync = fs.openSync;
  const originalCloseSync = fs.closeSync;
  let privateFd;
  fs.openSync = (...args) => {
    const fd = originalOpenSync(...args);
    if (args[0] === file) privateFd = fd;
    return fd;
  };
  fs.closeSync = fd => {
    const result = originalCloseSync(fd);
    if (fd === privateFd) {
      fs.unlinkSync(file);
      fs.symlinkSync(outside, file);
      privateFd = undefined;
    }
    return result;
  };

  try {
    assert.throws(
      () => writePrivateFileExclusive(file, 'created-value'),
      /changed during private file creation/
    );
  } finally {
    fs.openSync = originalOpenSync;
    fs.closeSync = originalCloseSync;
  }

  assert.equal(fs.statSync(outside).mode & 0o777, 0o644);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
});

test('hardenDataTree fails closed when a checked file path is replaced', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  const file = path.join(root, 'db.json');
  const outside = path.join(outsideRoot, 'outside');
  fs.writeFileSync(file, '{}', { mode: 0o644 });
  fs.writeFileSync(outside, 'outside', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  fs.chmodSync(outside, 0o644);
  const originalLstatSync = fs.lstatSync;
  let replaced = false;
  fs.lstatSync = target => {
    const stat = originalLstatSync(target);
    if (target === file && !replaced) {
      replaced = true;
      fs.unlinkSync(file);
      fs.symlinkSync(outside, file);
    }
    return stat;
  };

  try {
    assert.throws(
      () => hardenDataTree(root, { preserveRoot: true }),
      /changed during hardening|refuses symlink/
    );
  } finally {
    fs.lstatSync = originalLstatSync;
  }

  assert.equal(replaced, true);
  assert.equal(fs.statSync(outside).mode & 0o777, 0o644);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
});

test('atomicWrite preserves a write error while cleanup closes once and removes its temp', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const file = path.join(root, 'db.json');
  const originalOpenSync = fs.openSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalCloseSync = fs.closeSync;
  let stagingFd;
  let stagingCloseCalls = 0;

  fs.openSync = (...args) => {
    const fd = originalOpenSync(...args);
    stagingFd = fd;
    return fd;
  };
  fs.writeFileSync = (target, ...args) => {
    if (target === stagingFd) {
      const error = new Error('injected write failure');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalWriteFileSync(target, ...args);
  };
  fs.closeSync = fd => {
    if (fd === stagingFd) {
      stagingCloseCalls += 1;
      originalCloseSync(fd);
      const error = new Error('injected cleanup close failure');
      error.code = 'EIO';
      throw error;
    }
    return originalCloseSync(fd);
  };

  let caught;
  try {
    try {
      atomicWrite(file, 'new-data', { randomUUID: () => 'cleanup-close' });
    } catch (error) {
      caught = error;
    }
  } finally {
    fs.openSync = originalOpenSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.closeSync = originalCloseSync;
  }

  assert.deepEqual({
    error: caught?.code,
    cleanupError: caught?.cleanupError?.code,
    closeCalls: stagingCloseCalls,
    artifacts: fs.readdirSync(root),
  }, {
    error: 'ENOSPC',
    cleanupError: 'EIO',
    closeCalls: 1,
    artifacts: [],
  });
});

test('writePrivateFileExclusive preserves a write error while cleanup removes its file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const file = path.join(root, 'backup-token');
  const originalOpenSync = fs.openSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalCloseSync = fs.closeSync;
  let privateFd;
  let privateCloseCalls = 0;

  fs.openSync = (...args) => {
    const fd = originalOpenSync(...args);
    privateFd = fd;
    return fd;
  };
  fs.writeFileSync = (target, ...args) => {
    if (target === privateFd) {
      const error = new Error('injected credential write failure');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalWriteFileSync(target, ...args);
  };
  fs.closeSync = fd => {
    if (fd === privateFd) {
      privateCloseCalls += 1;
      originalCloseSync(fd);
      const error = new Error('injected cleanup close failure');
      error.code = 'EIO';
      throw error;
    }
    return originalCloseSync(fd);
  };

  let caught;
  try {
    try {
      writePrivateFileExclusive(file, 'new-token');
    } catch (error) {
      caught = error;
    }
  } finally {
    fs.openSync = originalOpenSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.closeSync = originalCloseSync;
  }

  assert.deepEqual({
    error: caught?.code,
    cleanupError: caught?.cleanupError?.code,
    closeCalls: privateCloseCalls,
    artifacts: fs.readdirSync(root),
  }, {
    error: 'ENOSPC',
    cleanupError: 'EIO',
    closeCalls: 1,
    artifacts: [],
  });
});
