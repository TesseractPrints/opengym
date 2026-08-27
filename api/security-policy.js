const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function mutationOriginAllowed(method, origin, expectedOrigin) {
  if (SAFE_METHODS.has(String(method || '').toUpperCase())) return true;
  return typeof origin === 'string' && origin === expectedOrigin;
}

export function registrationAccess({ inviteOnly, userCount, validInvite }) {
  if (!inviteOnly) return { allowed: true, bootstrapAdmin: false };
  if (userCount === 0) return { allowed: true, bootstrapAdmin: true };
  return { allowed: !!validInvite, bootstrapAdmin: false };
}

export function bootstrapStillAvailable(bootstrapAdmin, userCount) {
  return !!bootstrapAdmin && userCount === 0;
}
