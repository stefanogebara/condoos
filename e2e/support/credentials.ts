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
