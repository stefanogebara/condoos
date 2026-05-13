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

function safeUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
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
      const text = await res.text();
      return {
        configured: true,
        provider,
        query,
        citations: fallbackCitations(query),
        note: `Search provider returned HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = await res.json();
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
