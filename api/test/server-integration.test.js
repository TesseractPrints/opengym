import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('server did not become ready: ' + output)), 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('gym-api on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`server exited before readiness (${code}): ${output}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not exit after SIGTERM')), 10000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('server enforces deployment authority and exits cleanly', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-server-test-'));
  const tokenFile = path.join(data, 'backup-token');
  const dbFile = path.join(data, 'db.json');
  fs.writeFileSync(dbFile, JSON.stringify({ users: [], creds: [], subs: [], invites: [] }), { mode: 0o644 });
  fs.chmodSync(dbFile, 0o644);
  assert.equal(fs.statSync(dbFile).mode & 0o777, 0o644);
  const port = await freePort();
  const origin = 'https://gym.test';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: data,
      RP_ID: 'gym.test',
      ORIGIN: origin,
      INVITE_ONLY: '1',
      COACH_DISABLED: '1',
      BACKUP_TOKEN_FILE: tokenFile
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(data, { recursive: true, force: true });
  });

  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  assert.equal(fs.statSync(dbFile).mode & 0o777, 0o600);
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);

  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const config = await fetch(base + '/api/config');
  assert.deepEqual(await config.json(), { invite_only: false });

  const rejected = await fetch(base + '/api/register/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Owner' })
  });
  assert.equal(rejected.status, 403);
  assert.deepEqual(await rejected.json(), { error: 'origin not allowed' });

  const admitted = await fetch(base + '/api/register/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Owner' })
  });
  assert.equal(admitted.status, 200);
  assert.ok((await admitted.json()).cid);

  const unauthorized = await fetch(base + '/api/internal/backup');
  assert.equal(unauthorized.status, 401);

  const backup = await fetch(base + '/api/internal/backup', {
    headers: { authorization: 'Bearer ' + token }
  });
  assert.equal(backup.status, 200);
  const envelope = await backup.json();
  assert.equal(envelope.format, 'opengym-backup-v1');
  assert.ok(envelope.files.some(file => file.path === 'secret'));
  assert.ok(envelope.files.some(file => file.path === 'vapid.json'));
  assert.equal(envelope.files.find(file => file.path === 'db.json').mode, 0o600);
  assert.ok(!envelope.files.some(file => file.path === 'backup-token'));

  const exited = waitForExit(child);
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
});

test('server refuses an external backup-token symlink before readiness', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-server-test-'));
  const credentials = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-credentials-test-'));
  const target = path.join(credentials, 'target');
  const tokenFile = path.join(credentials, 'backup-token');
  fs.writeFileSync(target, 'x'.repeat(64), { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  fs.symlinkSync(target, tokenFile);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(await freePort()),
      DATA_DIR: data,
      RP_ID: 'gym.test',
      ORIGIN: 'https://gym.test',
      INVITE_ONLY: '1',
      COACH_DISABLED: '1',
      BACKUP_TOKEN_FILE: tokenFile
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(credentials, { recursive: true, force: true });
  });

  await assert.rejects(waitForReady(child), /server exited before readiness/);
  assert.notEqual(child.exitCode, 0);
});
