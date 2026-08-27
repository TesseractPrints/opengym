import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshot, isBackupAuthorized } from '../snapshot.js';

test('snapshot is deterministic, complete, and excludes in-flight temp files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-snapshot-'));
  fs.writeFileSync(path.join(dir, 'secret'), 'session-secret', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), '{"users":[]}');
  fs.writeFileSync(path.join(dir, 'db.json.tmp'), 'partial');
  fs.mkdirSync(path.join(dir, 'coach'));
  fs.writeFileSync(path.join(dir, 'coach', 'u1.json'), '{"pending":null}');

  const snapshot = createSnapshot(dir, new Date('2026-08-27T12:00:00.000Z'));
  assert.equal(snapshot.format, 'opengym-backup-v1');
  assert.equal(snapshot.createdAt, '2026-08-27T12:00:00.000Z');
  assert.deepEqual(snapshot.files.map(f => f.path), ['coach/u1.json', 'db.json', 'secret']);
  for (const file of snapshot.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(Buffer.from(file.data, 'base64').length, file.size);
  }
  assert.equal(Buffer.from(snapshot.files.find(f => f.path === 'secret').data, 'base64').toString(), 'session-secret');
});

test('snapshot refuses symlinks instead of following data outside the volume', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-snapshot-'));
  fs.symlinkSync('/etc/passwd', path.join(dir, 'escape'));
  assert.throws(() => createSnapshot(dir), /symlink/);
});

test('backup authorization is exact and timing-safe compatible', () => {
  const token = 'a'.repeat(64);
  assert.equal(isBackupAuthorized('Bearer ' + token, token), true);
  assert.equal(isBackupAuthorized('Bearer ' + 'b'.repeat(64), token), false);
  assert.equal(isBackupAuthorized(token, token), false);
  assert.equal(isBackupAuthorized(undefined, token), false);
  assert.equal(isBackupAuthorized('Bearer ' + token, ''), false);
});
