import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { coachRoutes } = await import('../coach/routes.js');

function disabledRoutes() {
  const replies = [];
  const routes = coachRoutes({
    json: (_res, status, body) => replies.push({ status, body }),
    readBody: async () => ({ enabled: true }),
    readSession: () => ({ id: 'admin' }),
    requireAdmin: () => ({ id: 'admin', admin: true })
  }, { disabledByEnv: true });
  return { routes, replies };
}

test('environment kill switch hides public Coach disclosure', async () => {
  const { routes, replies } = disabledRoutes();
  await routes['GET /api/coach/disclosure']({}, {});
  assert.deepEqual(replies, [{ status: 503, body: { error: 'the Coach is disabled on this instance' } }]);
});

test('environment kill switch blocks privileged Coach mutation routes', async () => {
  const { routes, replies } = disabledRoutes();
  await routes['POST /api/admin/coach/config']({}, {});
  assert.deepEqual(replies, [{ status: 503, body: { error: 'the Coach is disabled on this instance' } }]);
});
