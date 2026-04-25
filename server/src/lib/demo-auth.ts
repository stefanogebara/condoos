const seededDemoEmails = new Set([
  'admin@condoos.dev',
  'resident@condoos.dev',
  'jordan@condoos.dev',
  'taylor@condoos.dev',
  'riley@condoos.dev',
  'sam@condoos.dev',
]);

const demoPasswords = new Set(['admin123', 'resident123']);

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

export function demoAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return truthy(env.DEMO_AUTH_ENABLED);
}

export function isBlockedDemoCredential(
  email: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !demoAuthEnabled(env)
    && seededDemoEmails.has(email.toLowerCase())
    && demoPasswords.has(password);
}

