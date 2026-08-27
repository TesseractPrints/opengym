import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('default deployment never downloads or mounts third-party exercise media', () => {
  const compose = read('docker-compose.yml');
  const mobilePackage = read('frontend/package.json');
  const vite = read('frontend/vite.config.js');
  const serviceWorker = read('frontend/public/sw.js');

  assert.doesNotMatch(compose, /exercises-dataset|media:\s*$|\/media\/(img|gif)|\/usr\/share\/nginx\/html\/(img|gif)/m);
  assert.doesNotMatch(mobilePackage, /cdn\.jsdelivr\.net|VITE_(IMG|GIF)_BASE/);
  assert.doesNotMatch(vite, /['"]\/(img|gif)['"]/);
  assert.doesNotMatch(serviceWorker, /\/(img|gif)\//);
  assert.match(compose, /VITE_EXERCISE_MEDIA(?::|=)\s*disabled/);
});

test('web image is explicitly unprivileged and blocks public backup routing', () => {
  const dockerfile = read('web/Dockerfile');
  const nginx = read('web/nginx.conf');

  assert.match(dockerfile, /nginxinc\/nginx-unprivileged/);
  assert.match(dockerfile, /VITE_EXERCISE_MEDIA=disabled/);
  assert.match(dockerfile, /ENTRYPOINT \["nginx"\]/);
  assert.match(nginx, /listen 8080/);
  assert.match(nginx, /location \^~ \/api\/internal\//);
  assert.match(nginx, /proxy_pass http:\/\/opengym-api:3000/);
});

test('default API image is a non-root core build without agent runtimes', () => {
  const dockerfile = read('api/Dockerfile');
  const coreStage = dockerfile.split('FROM node:22-alpine AS core')[1] || '';

  assert.ok(coreStage, 'missing final core stage');
  assert.match(coreStage, /ENV NODE_ENV=production COACH_DISABLED=1/);
  assert.match(coreStage, /USER node/);
  assert.doesNotMatch(coreStage, /bubblewrap|codex|claude|COPY coach\//i);
});
