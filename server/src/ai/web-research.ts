export interface WebResearchInput {
  query: string;
  location?: string | null;
  category?: string | null;
  maxResults?: number | null;
}

export interface WebResearchCitation {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebResearchResult {
  configured: boolean;
  provider: string;
  query: string;
  citations: WebResearchCitation[];
  note?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function clip(value: unknown, max: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// SEC-3 — Block internal hosts in citation URLs.
//
// Citation URLs returned by the search provider flow back into the
// model context as "vendor URLs the model cited". A malicious or
// misconfigured search provider could return URLs pointing at:
//   - 169.254.169.254  (cloud metadata endpoint — IMDS)
//   - 127.x.x.x         (loopback — any server-local listener)
//   - localhost
//   - RFC1918 ranges    (10/172.16-31/192.168 — internal network)
//   - file://, gopher:// etc (already blocked by the protocol check)
//
// Today none of those URLs are auto-fetched by CondoOS, so the
// immediate risk is "model sees a URL like
// http://169.254.169.254/latest/meta-data/ and helpfully suggests the
// admin browse it". The bigger risk is a future feature that adds
// "fetch citation content" — that would make this trivially
// exploitable. Block at the URL-acceptance layer so it's safe by
// construction.
function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  // IPv6 loopback / link-local / private. Lightweight string checks —
  // full parsing isn't needed because we only need to reject; the
  // legitimate-vendor URL space is unaffected.
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd00:')) return true;
  // IPv4 — match dotted-quad and check each octet against the well-
  // known private/link-local/loopback ranges. Anything that isn't a
  // dotted-quad falls through to "allowed" (it's a normal hostname).
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b, c] = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3])];
  if (a === 127) return true;                          // 127.0.0.0/8 — loopback
  if (a === 10) return true;                           // 10.0.0.0/8 — RFC1918
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12 — RFC1918
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16 — link-local + IMDS
  if (a === 0) return true;                            // 0.0.0.0/8 — "this network"
  if (a >= 224) return true;                           // 224+ — multicast / reserved
  void c; // include for readability above
  return false;
}

function safeUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isBlockedHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Exported for tests — keeps the SSRF rules independently testable.
export { isBlockedHostname };

// SEC-3 — Response size cap. A misbehaving or malicious search provider
// could return hundreds of MB of JSON; without a cap we'd happily
// buffer it into memory and OOM the process. 1MB is well over what a
// 5-result citation response needs (~50KB typical) and bounds the
// damage. Larger responses are treated as a failed call.
const MAX_RESPONSE_BYTES = 1_000_000;

async function readBodyCapped(res: Response, cap: number): Promise<string> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > cap) throw new Error('response_too_large');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > cap) throw new Error('response_too_large');
  return new TextDecoder('utf-8').decode(buf);
}

function buildQuery(input: WebResearchInput): string {
  const parts = [
    clip(input.query, 300),
    clip(input.category, 80),
    clip(input.location, 140),
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function fallbackCitations(query: string): WebResearchCitation[] {
  const encoded = encodeURIComponent(query);
  return [
    {
      title: `Google search: ${query}`,
      url: `https://www.google.com/search?q=${encoded}`,
      snippet: 'Live web search is not configured on the server. Use this query as a manual research starting point.',
      source: 'search_url',
    },
    {
      title: `Bing search: ${query}`,
      url: `https://www.bing.com/search?q=${encoded}`,
      snippet: 'Fallback search URL only; no vendor facts were verified by CondoOS.',
      source: 'search_url',
    },
    {
      title: `Google Maps search: ${query}`,
      url: `https://www.google.com/maps/search/${encoded}`,
      snippet: 'Use maps to validate service area, reviews, and local phone/contact details manually.',
      source: 'search_url',
    },
  ];
}

function normalizeResults(data: any, maxResults: number, provider: string): WebResearchCitation[] {
  const arrays = [
    data?.results,
    data?.organic,
    data?.items,
    data?.webPages?.value,
  ].filter(Array.isArray);
  const rows = arrays[0] || [];
  const citations: WebResearchCitation[] = [];
  for (const row of rows) {
    const url = safeUrl(row?.url || row?.link);
    if (!url) continue;
    const title = clip(row?.title || row?.name || url, 160);
    const snippet = clip(row?.content || row?.snippet || row?.description || row?.text, 500);
    citations.push({ title, url, snippet, source: provider });
    if (citations.length >= maxResults) break;
  }
  return citations;
}

async function callSearchProvider(query: string, maxResults: number): Promise<WebResearchResult> {
  const endpoint = process.env.WEB_SEARCH_ENDPOINT;
  const apiKey = process.env.WEB_SEARCH_API_KEY;
  const provider = (process.env.WEB_SEARCH_PROVIDER || (endpoint?.includes('tavily') ? 'tavily' : 'generic')).toLowerCase();
  if (!endpoint || !apiKey) {
    return {
      configured: false,
      provider: 'not_configured',
      query,
      citations: fallbackCitations(query),
      note: 'Set WEB_SEARCH_ENDPOINT and WEB_SEARCH_API_KEY to enable live cited vendor research.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.WEB_SEARCH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const body = provider === 'tavily'
      ? { api_key: apiKey, query, max_results: maxResults, search_depth: 'basic', include_answer: false }
      : { query, max_results: maxResults };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider === 'tavily' ? {} : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // SEC-M6 — Do NOT echo the provider's raw error body into the
      // model context. Some search providers include the API key in
      // error messages; the `note` field reaches the model. Log the
      // detail server-side instead.
      const text = await readBodyCapped(res, MAX_RESPONSE_BYTES).catch(() => '(unreadable)');
      console.warn(`[web-research] provider HTTP ${res.status}: ${text.slice(0, 200)}`);
      return {
        configured: true,
        provider,
        query,
        citations: fallbackCitations(query),
        note: `Search provider returned HTTP ${res.status}.`,
      };
    }
    const bodyText = await readBodyCapped(res, MAX_RESPONSE_BYTES);
    const data = JSON.parse(bodyText);
    const citations = normalizeResults(data, maxResults, provider);
    return {
      configured: true,
      provider,
      query,
      citations: citations.length ? citations : fallbackCitations(query),
      note: citations.length ? undefined : 'Search provider returned no usable http(s) citations.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function researchExternalVendors(input: WebResearchInput): Promise<WebResearchResult> {
  const query = buildQuery(input);
  const maxResults = Math.min(8, Math.max(1, Number(input.maxResults || 5)));
  if (!query) {
    return {
      configured: false,
      provider: 'not_configured',
      query: '',
      citations: [],
      note: 'query_required',
    };
  }
  try {
    return await callSearchProvider(query, maxResults);
  } catch (error) {
    return {
      configured: !!(process.env.WEB_SEARCH_ENDPOINT && process.env.WEB_SEARCH_API_KEY),
      provider: process.env.WEB_SEARCH_PROVIDER || 'generic',
      query,
      citations: fallbackCitations(query),
      note: `Search failed: ${(error as Error)?.message || error}`,
    };
  }
}
