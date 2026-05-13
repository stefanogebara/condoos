import type { AdminAgentOutput } from '../ai/admin-agent';

export type AgentEvidenceSource = {
  type: 'past_ticket' | 'vendor_history' | 'web_citation' | 'photo' | 'pattern' | 'after_hours';
  title: string;
  detail: string;
  url?: string | null;
  source?: string | null;
};

type ToolTrace = Array<{ name: string; input: any; output: any }>;

function text(value: unknown, max: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function lang(locale?: string): 'pt' | 'en' | 'es' | 'fr' {
  const raw = String(locale || '').toLowerCase();
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('fr')) return 'fr';
  if (raw.startsWith('en')) return 'en';
  return 'pt';
}

function pick(locale: string | undefined, pt: string, en: string, es: string, fr: string): string {
  const l = lang(locale);
  return l === 'en' ? en : l === 'es' ? es : l === 'fr' ? fr : pt;
}

function formatDate(value: string | null | undefined, locale?: string): string {
  return value ? String(value).slice(0, 10) : pick(locale, 'sem data', 'no date', 'sin fecha', 'sans date');
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

export function buildAgentEvidenceSources(plan: AdminAgentOutput, toolTrace: ToolTrace = [], locale?: string): AgentEvidenceSource[] {
  const sources: AgentEvidenceSource[] = [];

  for (const item of plan.building_memory?.similar_resolved_tickets || []) {
    sources.push({
      type: 'past_ticket',
      title: text(item.title, 140) || `Chamado #${item.id}`,
      detail: [
        `${pick(locale, 'Resolvido em', 'Resolved on', 'Resuelto el', 'Résolu le')} ${formatDate(item.resolved_at, locale)}`,
        item.dispatched_vendors ? `${pick(locale, 'fornecedor', 'vendor', 'proveedor', 'prestataire')}: ${text(item.dispatched_vendors, 120)}` : '',
        item.resolution_note ? text(item.resolution_note, 240) : '',
      ].filter(Boolean).join(' · '),
    });
  }

  const openSimilar = Number(plan.building_memory?.open_similar_count || 0);
  if (openSimilar >= 3) {
    sources.push({
      type: 'pattern',
      title: pick(locale, 'Padrão operacional detectado', 'Operational pattern detected', 'Patrón operativo detectado', 'Tendance opérationnelle détectée'),
      detail: pick(
        locale,
        `${openSimilar} chamados abertos da mesma categoria nos últimos 30 dias.`,
        `${openSimilar} open tickets in the same category in the last 30 days.`,
        `${openSimilar} tickets abiertos de la misma categoría en los últimos 30 días.`,
        `${openSimilar} tickets ouverts dans la même catégorie sur les 30 derniers jours.`,
      ),
    });
  }

  if (plan.building_memory?.is_outside_business_hours) {
    sources.push({
      type: 'after_hours',
      title: pick(locale, 'Horário local fora do expediente', 'Local time outside business hours', 'Hora local fuera de horario', 'Heure locale hors horaires'),
      detail: `${pick(locale, 'Hora local estimada', 'Estimated local time', 'Hora local estimada', 'Heure locale estimée')}: ${String(plan.building_memory.local_hour).padStart(2, '0')}h.`,
    });
  }

  for (const fit of plan.existing_network_fit || []) {
    const cost = fit.cost_history;
    if (!cost || Number(cost.expense_count || 0) <= 0) continue;
    const confidence = cost.confidence === 'high'
      ? pick(locale, 'histórico forte', 'strong history', 'historial sólido', 'historique solide')
      : pick(locale, 'valor de referência', 'reference value', 'valor de referencia', 'valeur de référence');
    const amount = cost.last_amount_brl != null
      ? `${pick(locale, 'último gasto', 'last spend', 'último gasto', 'dernière dépense')} R$ ${Math.round(cost.last_amount_brl).toLocaleString('pt-BR')}`
      : '';
    sources.push({
      type: 'vendor_history',
      title: text(fit.company_name, 140),
      detail: [
        confidence,
        pick(locale, `${cost.expense_count} despesa(s) registradas`, `${cost.expense_count} recorded expense(s)`, `${cost.expense_count} gasto(s) registrados`, `${cost.expense_count} dépense(s) enregistrées`),
        amount,
      ].filter(Boolean).join(' · '),
    });
  }

  for (const photo of plan.attachment_analysis || []) {
    sources.push({
      type: 'photo',
      title: `${pick(locale, 'Foto analisada', 'Analyzed photo', 'Foto analizada', 'Photo analysée')} #${photo.id}`,
      detail: [
        text(photo.description, 240),
        photo.signals?.length ? `${pick(locale, 'sinais', 'signals', 'señales', 'signaux')}: ${photo.signals.slice(0, 6).join(', ')}` : '',
      ].filter(Boolean).join(' · '),
    });
  }

  for (const call of toolTrace) {
    if (call.name !== 'research_external_vendors') continue;
    const configured = call.output?.configured === true;
    for (const citation of call.output?.citations || []) {
      const url = safeUrl(citation?.url);
      if (!url) continue;
      sources.push({
        type: 'web_citation',
        title: text(citation?.title || url, 160),
        detail: configured
          ? text(citation?.snippet || 'External search result cited by the agent.', 320)
          : text(citation?.snippet || pick(locale, 'URL de busca manual; nenhum dado de fornecedor verificado ao vivo.', 'Manual search URL only; no live vendor facts verified.', 'URL de búsqueda manual; no se verificaron datos del proveedor en vivo.', 'URL de recherche manuelle ; aucune donnée prestataire vérifiée en direct.'), 320),
        url,
        source: text(citation?.source || call.output?.provider || 'web', 80),
      });
    }
  }

  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.type}|${source.title}|${source.url || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}
