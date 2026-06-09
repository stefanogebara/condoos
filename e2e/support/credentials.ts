export type E2ERole = 'admin' | 'resident' | 'concierge' | 'porteiro';

type Credentials = {
  email: string;
  password: string;
};

const defaults: Record<E2ERole, Credentials> = {
  admin: { email: 'admin@condoos.dev', password: 'admin123' },
  resident: { email: 'resident@condoos.dev', password: 'resident123' },
  concierge: { email: 'porteiro@condoos.dev', password: 'porteiro123' },
  porteiro: { email: 'porteiro@condoos.dev', password: 'porteiro123' },
};

const prefixes: Record<E2ERole, string> = {
  admin: 'E2E_ADMIN',
  resident: 'E2E_RESIDENT',
  concierge: 'E2E_CONCIERGE',
  porteiro: 'E2E_CONCIERGE',
};

export function credentialsFor(role: E2ERole): Credentials {
  const prefix = prefixes[role];
  return {
    email: process.env[`${prefix}_EMAIL`] || defaults[role].email,
    password: process.env[`${prefix}_PASSWORD`] || defaults[role].password,
  };
}

export function hasExplicitCredentialsFor(role: E2ERole): boolean {
  const prefix = prefixes[role];
  return Boolean(process.env[`${prefix}_EMAIL`] && process.env[`${prefix}_PASSWORD`]);
}

export function isProdE2ETarget(): boolean {
  const target = process.env.E2E_BASE_URL || process.env.E2E_API_URL || '';
  return /^https?:\/\//i.test(target) && !/localhost|127\.0\.0\.1/i.test(target);
}

export function prodCredentialSkipReason(roles: E2ERole[]): string | null {
  if (!isProdE2ETarget()) return null;
  const missing = Array.from(new Set(
    roles
      .filter((role) => !hasExplicitCredentialsFor(role))
      .map((role) => prefixes[role]),
  ));
  if (missing.length === 0) return null;
  const required = missing.map((prefix) => `${prefix}_EMAIL/${prefix}_PASSWORD`).join(', ');
  return `production E2E target requires explicit private pilot credentials: ${required}`;
}
