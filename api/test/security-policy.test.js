import test from 'node:test';
import assert from 'node:assert/strict';
import { mutationOriginAllowed, registrationAccess, bootstrapStillAvailable } from '../security-policy.js';

test('safe methods do not require an Origin header', () => {
  assert.equal(mutationOriginAllowed('GET', undefined, 'https://gym.tprints.ru'), true);
  assert.equal(mutationOriginAllowed('HEAD', undefined, 'https://gym.tprints.ru'), true);
});

test('mutations require the exact configured origin', () => {
  const expected = 'https://gym.tprints.ru';
  assert.equal(mutationOriginAllowed('POST', expected, expected), true);
  assert.equal(mutationOriginAllowed('PUT', expected, expected), true);
  assert.equal(mutationOriginAllowed('POST', undefined, expected), false);
  assert.equal(mutationOriginAllowed('POST', 'https://evil.tprints.ru', expected), false);
  assert.equal(mutationOriginAllowed('POST', 'https://gym.tprints.ru.evil.example', expected), false);
});

test('an invite-only empty instance admits exactly the bootstrap admin flow', () => {
  assert.deepEqual(registrationAccess({ inviteOnly: true, userCount: 0, validInvite: false }), {
    allowed: true,
    bootstrapAdmin: true
  });
  assert.equal(bootstrapStillAvailable(true, 0), true);
  assert.equal(bootstrapStillAvailable(true, 1), false, 'only the first completed registration wins');
});

test('after bootstrap, invite-only registration requires a live invite', () => {
  assert.deepEqual(registrationAccess({ inviteOnly: true, userCount: 1, validInvite: false }), {
    allowed: false,
    bootstrapAdmin: false
  });
  assert.deepEqual(registrationAccess({ inviteOnly: true, userCount: 1, validInvite: true }), {
    allowed: true,
    bootstrapAdmin: false
  });
});

test('open instances preserve their existing registration behaviour', () => {
  assert.deepEqual(registrationAccess({ inviteOnly: false, userCount: 0, validInvite: false }), {
    allowed: true,
    bootstrapAdmin: false
  });
});
