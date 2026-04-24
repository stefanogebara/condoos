import fetch from 'node-fetch';

export interface GoogleTokenInfo {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: string | boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  exp: string | number;
}

export class GoogleAuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type TokenInfoFetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<GoogleTokenInfo> }>;

export async function verifyGoogleCredential(
  credential: string,
  clientId: string | undefined,
  fetcher: TokenInfoFetcher = fetch as unknown as TokenInfoFetcher,
): Promise<GoogleTokenInfo> {
  if (!clientId) throw new GoogleAuthError('google_auth_disabled', 501);

  const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
  const gRes = await fetcher(verifyUrl);
  if (!gRes.ok) throw new GoogleAuthError('google_verify_failed');

  const info = await gRes.json();
  if (info.aud !== clientId) throw new GoogleAuthError('google_aud_mismatch');
  if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') {
    throw new GoogleAuthError('google_iss_mismatch');
  }

  const exp = typeof info.exp === 'string' ? parseInt(info.exp, 10) : info.exp;
  if (!exp || exp * 1000 < Date.now()) throw new GoogleAuthError('google_token_expired');

  const emailVerified = info.email_verified === true || info.email_verified === 'true';
  if (!emailVerified) throw new GoogleAuthError('google_email_unverified');

  const email = (info.email || '').toLowerCase().trim();
  if (!email) throw new GoogleAuthError('google_no_email');

  return { ...info, email };
}
