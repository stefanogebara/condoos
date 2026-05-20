import db from '../db';

export type CondoCountry = 'BR' | 'EC';
export type CondoCurrency = 'BRL' | 'USD';
export type CondoLocale = 'pt-BR' | 'es-ES' | 'en-US' | 'fr-FR';
export type CondoGovernanceMode = 'brazil_condominium' | 'ecuador_condominium' | 'neutral';

export interface CondoSettings {
  id: number;
  name: string;
  address: string;
  invite_code: string | null;
  country: CondoCountry;
  currency: CondoCurrency;
  timezone: string;
  locale: CondoLocale;
  governance_mode: CondoGovernanceMode;
}

export interface CondoSettingsInput {
  country?: string;
  currency?: string;
  timezone?: string;
  locale?: string;
  governance_mode?: string;
}

const COUNTRY_DEFAULTS: Record<CondoCountry, Pick<CondoSettings, 'currency' | 'timezone' | 'locale' | 'governance_mode'>> = {
  BR: {
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    governance_mode: 'brazil_condominium',
  },
  EC: {
    currency: 'USD',
    timezone: 'America/Guayaquil',
    locale: 'es-ES',
    governance_mode: 'ecuador_condominium',
  },
};

const CURRENCIES = new Set<CondoCurrency>(['BRL', 'USD']);
const LOCALES = new Set<CondoLocale>(['pt-BR', 'es-ES', 'en-US', 'fr-FR']);
const GOVERNANCE_MODES = new Set<CondoGovernanceMode>(['brazil_condominium', 'ecuador_condominium', 'neutral']);

function normalizeCountry(value: unknown): CondoCountry {
  const raw = String(value || '').trim().toUpperCase();
  return raw === 'EC' ? 'EC' : 'BR';
}

function normalizeCurrency(value: unknown, fallback: CondoCurrency): CondoCurrency {
  const raw = String(value || '').trim().toUpperCase();
  return CURRENCIES.has(raw as CondoCurrency) ? raw as CondoCurrency : fallback;
}

function normalizeLocale(value: unknown, fallback: CondoLocale): CondoLocale {
  const raw = String(value || '').trim();
  return LOCALES.has(raw as CondoLocale) ? raw as CondoLocale : fallback;
}

function normalizeGovernance(value: unknown, fallback: CondoGovernanceMode): CondoGovernanceMode {
  const raw = String(value || '').trim();
  return GOVERNANCE_MODES.has(raw as CondoGovernanceMode) ? raw as CondoGovernanceMode : fallback;
}

export function defaultsForCountry(countryInput: unknown) {
  return COUNTRY_DEFAULTS[normalizeCountry(countryInput)];
}

export function normalizeCondoSettingsInput(input: CondoSettingsInput = {}) {
  const country = normalizeCountry(input.country);
  const defaults = COUNTRY_DEFAULTS[country];
  const timezone = String(input.timezone || defaults.timezone).trim().slice(0, 80) || defaults.timezone;
  return {
    country,
    currency: normalizeCurrency(input.currency, defaults.currency),
    timezone,
    locale: normalizeLocale(input.locale, defaults.locale),
    governance_mode: normalizeGovernance(input.governance_mode, defaults.governance_mode),
  };
}

function hydrateSettings(row: any): CondoSettings {
  const country = normalizeCountry(row?.country);
  const defaults = COUNTRY_DEFAULTS[country];
  return {
    id: Number(row.id),
    name: row.name,
    address: row.address,
    invite_code: row.invite_code || null,
    country,
    currency: normalizeCurrency(row.currency, defaults.currency),
    timezone: String(row.timezone || defaults.timezone),
    locale: normalizeLocale(row.locale, defaults.locale),
    governance_mode: normalizeGovernance(row.governance_mode, defaults.governance_mode),
  };
}

export function getCondoSettings(condoId: number): CondoSettings | null {
  const row = db.prepare(
    `SELECT id, name, address, invite_code, country, currency, timezone, locale, governance_mode
     FROM condominiums
     WHERE id = ?`
  ).get(condoId);
  return row ? hydrateSettings(row) : null;
}

export function updateCondoSettings(condoId: number, input: CondoSettingsInput): CondoSettings | null {
  const normalized = normalizeCondoSettingsInput(input);
  db.prepare(
    `UPDATE condominiums
     SET country = ?,
         currency = ?,
         timezone = ?,
         locale = ?,
         governance_mode = ?
     WHERE id = ?`
  ).run(
    normalized.country,
    normalized.currency,
    normalized.timezone,
    normalized.locale,
    normalized.governance_mode,
    condoId,
  );
  return getCondoSettings(condoId);
}

export function defaultCurrencyForCondo(condoId: number): CondoCurrency {
  return getCondoSettings(condoId)?.currency || 'BRL';
}
