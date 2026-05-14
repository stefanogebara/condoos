// Compress a task description into a one-line WhatsApp-style message —
// strips formal headers, keeps the verb + symptom, ends with an open
// question. The model is told to produce these in the prompt; the
// fallback path needs the same shape for consistency.
//
// Heuristic: take the first ~120 chars of the task, drop trailing
// punctuation, append "Pode atender hoje?" / "Can you come today?".
// Not perfect — the admin can edit before send — but better than
// "Olá, sou do [condo]. Precisamos avaliar: [paste-bomb]."
// Filter action_plan items that duplicate platform-executable work.
// The UI already provides one-click buttons for:
//   - "Enviar mensagem" to a saved vendor (per-card on agent workbench)
//   - "Comunicado aos moradores" (resident_update card → publish)
//   - "Criar proposta" (proposal_draft card → push to /board/proposals)
//   - "Dispatch" / "acionar fornecedor" via the ticket dispatch button
// Listing those as action_plan items is noise. We keep only items that
// describe genuine offline work the platform can't auto-execute:
// site visits, gathering competing quotes from new vendors, calling the
// concierge team, posting physical notices, etc.
//
// Detection is a keyword denylist on the combined step+details string.
// Imperfect but cheap; the prompt already tells the model to avoid these
// (the denylist is a backstop when the model echoes anyway).
const PLATFORM_DUPLICATE_KEYWORDS = [
  // Outreach to a vendor — there's a button for that. Bounded .{0,30}
  // tolerates an adjective slipping in ("enviar mensagem TÉCNICA para X")
  // without becoming a runaway match.
  /enviar\s+(mensagem|whatsapp|comunica[çc][ãa]o).{0,30}\s+(para|ao)\s+/i,
  /\bacionar\b\s+(o\s+)?fornecedor/i,
  /contac?tar\s+(o\s+)?fornecedor/i,
  /send\s+(whatsapp|message|email).{0,30}\s+to\s+(the\s+)?(vendor|technician|contractor)/i,
  // Publishing the resident comms — resident_update covers it.
  // Broader than the literal "postar comunicado": catches "comunicar
  // condôminos", "avisar moradores", "informar residentes" too — every
  // form the model has produced in the wild for this same action.
  /\b(postar|publicar|enviar|emitir)\s+(o\s+)?(comunicado|aviso|notifica[çc][ãa]o)/i,
  /\b(comunicar|avisar|informar|notificar)\s+(os\s+)?(condôminos|cond[oô]minos|moradores|residentes)\b/i,
  /post\s+(the\s+)?(announcement|notice)\s+to\s+residents/i,
  /\b(notify|inform|update)\s+(the\s+)?residents?\b/i,
  // Proposal creation — proposal_draft button covers it.
  /criar\s+(uma\s+)?proposta\s+para\s+vota[çc][ãa]o/i,
  /open\s+(a\s+)?proposal\s+for\s+(resident\s+)?vote/i,
];

function isOfflineAction(item: { step: string; details: string }): boolean {
  const combined = `${item.step} ${item.details}`.toLowerCase();
  return !PLATFORM_DUPLICATE_KEYWORDS.some((re) => re.test(combined));
}

function shortOutreach(task: string, lang: 'pt' | 'en' = 'pt'): string {
  const trimmed = String(task || '').replace(/\s+/g, ' ').trim();
  const summary = trimmed.length > 120 ? trimmed.slice(0, 117) + '…' : trimmed;
  const cleaned = summary.replace(/[.!?]+$/, '');
  return lang === 'en'
    ? `Hi — ${cleaned}. Can you come today?`
    : `Oi, tudo bem? ${cleaned}. Pode atender hoje?`;
}

export type AdminAgentMode = 'general' | 'repair' | 'install' | 'vendor_options' | 'policy';
export type AdminAgentTaskType = 'repair' | 'install' | 'vendor_research' | 'policy' | 'general';

export interface AdminAgentServiceContact {
  category?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  service_scope?: string | null;
  notes?: string | null;
  emergency_available?: number | boolean | null;
  preferred?: number | boolean | null;
  last_used_at?: string | null;
}

export interface AdminAgentInput {
  task: string;
  mode?: string;
  location?: string;
  budget?: string;
  urgency?: string;
  locale?: string;
  condo?: { name?: string | null; address?: string | null } | null;
  service_contacts?: AdminAgentServiceContact[];
}

export interface AdminAgentOption {
  title: string;
  fit: string;
  pros: string[];
  cons: string[];
  estimated_cost_range: string;
  timeline: string;
  questions_for_vendor: string[];
  evaluation_criteria: string[];
}

export interface AdminAgentAction {
  step: string;
  owner: string;
  due: string;
  details: string;
}

export interface AdminAgentResidentUpdate {
  title: string;
  body: string;
}

export interface AdminAgentProposalDraft {
  title: string;
  description: string;
  category: 'maintenance' | 'infrastructure' | 'safety' | 'amenity' | 'community' | 'policy' | 'financial';
  estimated_cost: number | null;
}

export interface AdminAgentNetworkFit {
  company_name: string;
  category: string;
  reason: string;
  contact_method: string;
  // Cost history is decorated by the runner after sanitize from the
  // expenses ledger. Null when the admin has never logged a spend with
  // this vendor. last_amount_brl is the headline number the UI surfaces;
  // avg/min/max give the agent a range to anchor estimated_cost_range on.
  cost_history?: {
    expense_count: number;
    last_amount_brl: number | null;
    last_spent_at: string | null;
    avg_brl: number | null;
    min_brl: number | null;
    max_brl: number | null;
    // Confidence threshold: 3+ past expenses = 'high' (cite as histórico),
    // 1-2 = 'low' (cite as valor de referência), 0 = no cost_history.
    // Without this gate the agent treats a single past invoice as a
    // reliable estimate, which it isn't.
    confidence: 'high' | 'low';
  } | null;
}

export interface AdminAgentOutput {
  summary: string;
  task_type: AdminAgentTaskType;
  assumptions: string[];
  recommended_next_step: string;
  existing_network_fit: AdminAgentNetworkFit[];
  options: AdminAgentOption[];
  vendor_search_plan: {
    search_queries: string[];
    shortlisting_criteria: string[];
    outreach_message: string;
  };
  action_plan: AdminAgentAction[];
  resident_update: AdminAgentResidentUpdate;
  proposal_draft: AdminAgentProposalDraft | null;
  risks: string[];
  // Confidence calibration (roadmap item 5). The agent self-estimates how
  // sure it is on every recommendation. Tier gates downstream behavior:
  //   high   (≥0.85)  → eligible for auto-execute (auto-dispatch fires)
  //   medium (0.5-0.85) → recommend only (admin clicks dispatch)
  //   low    (<0.5)   → manual; we hold back the auto-dispatch path
  // The reasoning is what the admin reads to verify the rating — not a
  // free-form essay but a short list of factors (past resolutions found,
  // vendor history depth, network match quality).
  confidence?: {
    score: number;            // 0..1
    tier: 'high' | 'medium' | 'low';
    reasoning: string[];      // 1-4 short factors
  };
  // Building memory — populated by the runner from SQL, attached to the
  // response so the UI can render past resolutions / pattern alerts /
  // after-hours flag without relying on the model's prose. The model
  // also reads this in its prompt context and is expected to cite it.
  building_memory?: {
    similar_resolved_tickets: Array<{
      id: number;
      title: string;
      resolved_at: string | null;
      dispatched_vendors: string | null;
      resolution_note: string;
      estimated_cost_brl: number | null;
    }>;
    open_similar_count: number;
    inferred_category: string | null;
    is_outside_business_hours: boolean;
    local_hour: number;
  } | null;
  // Vision analysis of resident-uploaded attachments (roadmap item 6).
  // Populated when the runner had a ticketId. Each entry is a per-image
  // caption + structured signal tags. UI renders them as small cards
  // next to the recommendation so the admin sees what the agent saw.
  attachment_analysis?: Array<{
    id: number;
    description: string;
    signals: string[];
  }>;
  // ReAct tool-use trace (only present when AGENT_USE_REACT=1). Lets the
  // UI render "checked past tickets... pulled Otis history..." style
  // thinking pane. Each entry is a one-line summary, not raw JSON, so
  // the trace pane doesn't have to parse server-internal shapes.
  agent_trace?: Array<{
    tool: string;
    input_keys: string[];
    output_summary: string;
  }>;
  // Conversational rescue prompts when the agent hit a data wall the
  // current call couldn't cross. These are clickable suggestions the UI
  // pre-fills into the follow-up composer, turning "I can't help" into
  // "let's talk about how to help". Each entry is a single short
  // sentence the admin can adjust before sending.
  //
  // Example triggers:
  //   - No vendor in inferred category → "Quer que eu rascunhe uma
  //     mensagem para procurar dedetizadores?"
  //   - Cost uncited → "Tem um orçamento? Cole aqui e eu registro a
  //     despesa para a próxima."
  //   - Past resolution found → "Quer ver o que foi feito da última
  //     vez nesse elevador?"
  follow_up_suggestions?: string[];
  // Evidence source cards rendered in the workbench. These are derived by
  // the runner from DB/tool outputs after sanitization; the model does not
  // get to invent them.
  evidence_sources?: Array<{
    type: 'past_ticket' | 'vendor_history' | 'web_citation' | 'photo' | 'pattern' | 'after_hours';
    title: string;
    detail: string;
    url?: string | null;
    source?: string | null;
  }>;
  _fallback?: boolean;
}

const MODES: AdminAgentMode[] = ['general', 'repair', 'install', 'vendor_options', 'policy'];
const TASK_TYPES: AdminAgentTaskType[] = ['repair', 'install', 'vendor_research', 'policy', 'general'];
const PROPOSAL_CATEGORIES: AdminAgentProposalDraft['category'][] = [
  'maintenance',
  'infrastructure',
  'safety',
  'amenity',
  'community',
  'policy',
  'financial',
];

export function normalizeAdminAgentMode(value: unknown): AdminAgentMode {
  const raw = String(value || '').trim();
  return (MODES as string[]).includes(raw) ? raw as AdminAgentMode : 'general';
}

function text(value: unknown, max = 500): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function multiline(value: unknown, max = 1_200): string {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function list(value: unknown, fallback: string[] = [], maxItems = 6, maxChars = 220): string[] {
  const raw = Array.isArray(value) ? value : [];
  const out = raw
    .map((item) => text(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
  return out.length ? out : fallback.slice(0, maxItems);
}

function obj(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function likelyPortuguese(input: AdminAgentInput): boolean {
  const haystack = `${input.locale || ''} ${input.task || ''}`.toLowerCase();
  return haystack.includes('pt') || /[çãõáéíóúàêô]/i.test(haystack) || /\b(consert|instalar|síndico|condomínio|condominio|orçamento|orcamento|fornecedor|dedetiza|dedetizador|barata|academia|esteira|elevador|portaria|morador|condômino|condomino)\b/i.test(haystack);
}

type AgentLanguage = 'pt' | 'en' | 'es' | 'fr';

function agentLanguage(input: AdminAgentInput): AgentLanguage {
  const locale = String(input.locale || '').toLowerCase();
  if (locale.startsWith('es')) return 'es';
  if (locale.startsWith('fr')) return 'fr';
  if (locale.startsWith('en')) return 'en';
  return likelyPortuguese(input) ? 'pt' : 'en';
}

function byAgentLanguage<T>(input: AdminAgentInput, copy: Record<AgentLanguage, T>): T {
  return copy[agentLanguage(input)];
}

const AGENT_CATEGORY_LABELS: Record<string, Record<AgentLanguage, string>> = {
  cleaning: { pt: 'limpeza', en: 'cleaning', es: 'limpieza', fr: 'nettoyage' },
  electrical: { pt: 'elétrica', en: 'electrical work', es: 'electricidad', fr: 'électricité' },
  elevator: { pt: 'elevadores', en: 'elevators', es: 'ascensores', fr: 'ascenseurs' },
  fire_safety: { pt: 'segurança contra incêndio', en: 'fire safety', es: 'seguridad contra incendios', fr: 'sécurité incendie' },
  gas: { pt: 'gás', en: 'gas service', es: 'gas', fr: 'gaz' },
  gas_leak: { pt: 'vazamento de gás', en: 'gas leak repair', es: 'fuga de gas', fr: 'fuite de gaz' },
  general_maintenance: { pt: 'manutenção geral', en: 'general maintenance', es: 'mantenimiento general', fr: 'maintenance générale' },
  gym_equipment: { pt: 'equipamentos de academia', en: 'gym equipment', es: 'equipos de gimnasio', fr: 'équipements de salle de sport' },
  hvac: { pt: 'climatização', en: 'HVAC', es: 'climatización', fr: 'climatisation' },
  internet_cctv: { pt: 'internet e CFTV', en: 'internet and CCTV', es: 'internet y CCTV', fr: 'internet et vidéosurveillance' },
  landscaping: { pt: 'jardinagem', en: 'landscaping', es: 'jardinería', fr: 'espaces verts' },
  maintenance: { pt: 'manutenção', en: 'maintenance', es: 'mantenimiento', fr: 'maintenance' },
  other: { pt: 'serviços gerais', en: 'general services', es: 'servicios generales', fr: 'services généraux' },
  pest_control: { pt: 'dedetização', en: 'pest control', es: 'control de plagas', fr: 'désinsectisation' },
  plumbing: { pt: 'hidráulica', en: 'plumbing', es: 'plomería', fr: 'plomberie' },
  pool: { pt: 'piscina', en: 'pool service', es: 'piscina', fr: 'piscine' },
  security: { pt: 'segurança', en: 'security', es: 'seguridad', fr: 'sécurité' },
  security_access: { pt: 'controle de acesso', en: 'access control', es: 'control de acceso', fr: 'contrôle d’accès' },
  water: { pt: 'água', en: 'water service', es: 'agua', fr: 'eau' },
  water_damage: { pt: 'infiltração ou alagamento', en: 'water damage', es: 'daños por agua', fr: 'dégât des eaux' },
};

function agentCategoryLabel(category: string, input: AdminAgentInput): string {
  const labels = AGENT_CATEGORY_LABELS[category];
  if (labels) return byAgentLanguage(input, labels);
  return category.replace(/_/g, ' ');
}

function taskType(input: AdminAgentInput): AdminAgentTaskType {
  const mode = normalizeAdminAgentMode(input.mode);
  if (mode === 'repair') return 'repair';
  if (mode === 'install') return 'install';
  if (mode === 'vendor_options') return 'vendor_research';
  if (mode === 'policy') return 'policy';
  const task = input.task.toLowerCase();
  if (/\b(policy|rule|bylaw|regra|convenç|regimento|norma)\b/i.test(task)) return 'policy';
  if (/\b(competitor|vendor|supplier|quote|bid|compare|option|fornecedor|concorrente|orçamento|cotação|comparar)\b/i.test(task)) return 'vendor_research';
  if (/\b(install|upgrade|replace|setup|charger|solar|camera|instalar|implant|trocar|substituir)\b/i.test(task)) return 'install';
  if (/\b(fix|repair|broken|leak|noise|maintenance|consert|repar|quebrad|vazament|ruído|manutenção)\b/i.test(task)) return 'repair';
  return 'general';
}

function topic(input: AdminAgentInput) {
  const value = text(input.task, 120);
  return value || 'the requested condominium operation';
}

function categoryForTask(input: AdminAgentInput): AdminAgentProposalDraft['category'] {
  const t = input.task.toLowerCase();
  if (/\b(camera|security|gate|access|fire|alarm|seguran|port[aã]o|inc[eê]ndio)\b/i.test(t)) return 'safety';
  if (/\b(ev|charger|solar|elevator|internet|network|install|upgrade|carregador|elevador|energia)\b/i.test(t)) return 'infrastructure';
  if (/\b(gym|pool|party|bbq|academy|academia|piscina|sal[aã]o|churrasc)\b/i.test(t)) return 'amenity';
  if (/\b(rule|policy|bylaw|regra|convenç|regimento|norma)\b/i.test(t)) return 'policy';
  if (/\b(budget|fee|dues|cost|orçamento|taxa|condom[ií]nio)\b/i.test(t)) return 'financial';
  return 'maintenance';
}

function contactKeywords(task: string): string[] {
  const t = task.toLowerCase();
  const categories: string[] = [];
  if (/\b(electric|ev|charger|power|energia|el[eé]tric|carregador)\b/i.test(t)) categories.push('electrical');
  if (/\b(gym|treadmill|fitness|academia|esteira|equipamento)\b/i.test(t)) categories.push('gym_equipment');
  if (/\b(elevator|lift|elevador)\b/i.test(t)) categories.push('elevator');
  if (/\b(pool|piscina)\b/i.test(t)) categories.push('pool');
  if (/\b(plumbing|leak|water|hidrául|vazament|bomba)\b/i.test(t)) categories.push('plumbing');
  if (/\b(security|camera|gate|access|cctv|seguran|port[aã]o|cftv)\b/i.test(t)) categories.push('security', 'internet_cctv');
  if (/\b(clean|trash|limpeza|lixo)\b/i.test(t)) categories.push('cleaning');
  if (!categories.length) categories.push('general_maintenance', 'other');
  return categories;
}

function matchingContacts(input: AdminAgentInput): AdminAgentNetworkFit[] {
  const contacts = input.service_contacts || [];
  const categories = new Set(contactKeywords(input.task));
  return contacts
    .filter((contact) => {
      const category = text(contact.category, 80);
      const company = text(contact.company_name, 140);
      const scope = `${contact.service_scope || ''} ${contact.notes || ''}`.toLowerCase();
      return company && (categories.has(category) || contactKeywords(scope).some((c) => categories.has(c)));
    })
    .sort((a, b) => Number(boolish(b.preferred)) - Number(boolish(a.preferred)) || Number(boolish(b.emergency_available)) - Number(boolish(a.emergency_available)))
    .slice(0, 3)
    .map((contact) => {
      const contactMethod = text(contact.whatsapp || contact.phone || contact.email || contact.website || 'Saved contact', 180);
      return {
        company_name: text(contact.company_name, 140),
        category: text(contact.category, 80) || 'service',
        reason: boolish(contact.preferred) ? 'Already marked as preferred for this building.' : 'Already saved in this building service network.',
        contact_method: contactMethod,
      };
    });
}

export function fallbackAdminAgent(input: AdminAgentInput): AdminAgentOutput {
  const pt = likelyPortuguese(input);
  const condo = text(input.condo?.name, 120) || (pt ? 'condomínio' : 'building');
  const location = text(input.location || input.condo?.address, 160);
  const task = topic(input);
  const type = taskType(input);
  const networkFit = matchingContacts(input);
  const queryLocation = location ? ` ${location}` : '';

  if (pt) {
    return {
      summary: `Plano operacional para: ${task}. Use a rede cadastrada primeiro, depois compare pelo menos três alternativas externas antes de contratar.`,
      task_type: type,
      assumptions: [
        'A IA não navegou na internet nem validou disponibilidade em tempo real.',
        'Valores e prazos precisam ser confirmados por orçamento formal.',
        networkFit.length ? 'Há fornecedores cadastrados que podem servir como primeira chamada.' : 'Não há fornecedor cadastrado claramente ligado a este pedido.',
      ],
      recommended_next_step: networkFit.length
        ? `Acionar ${networkFit[0].company_name} para diagnóstico inicial e, em paralelo, pedir duas cotações comparáveis.`
        : 'Pedir diagnóstico ou proposta técnica com três fornecedores comparáveis antes de levar o tema a voto.',
      existing_network_fit: networkFit,
      options: [
        {
          title: 'Diagnóstico técnico primeiro',
          fit: 'Melhor quando a causa ainda não está comprovada.',
          pros: ['Evita trocar equipamento sem necessidade', 'Gera escopo claro para cotação'],
          cons: ['Adiciona uma etapa antes da contratação', 'Pode exigir taxa de visita'],
          estimated_cost_range: input.budget ? `Dentro do orçamento informado: ${text(input.budget, 120)}` : 'Baixo a médio; confirmar taxa de visita.',
          timeline: input.urgency ? `Prioridade informada: ${text(input.urgency, 80)}` : '24h a 7 dias para vistoria.',
          questions_for_vendor: ['Qual é a causa raiz?', 'O reparo tem garantia?', 'Quais peças e prazos dependem de terceiros?'],
          evaluation_criteria: ['Laudo por escrito', 'Garantia', 'Prazo de atendimento', 'Histórico com condomínios'],
        },
        {
          title: 'Cotação competitiva de reparo ou instalação',
          fit: 'Melhor quando o escopo já é claro e o conselho precisa comparar preço, prazo e garantia.',
          pros: ['Compara fornecedores em base igual', 'Reduz risco de sobrepreço'],
          cons: ['Exige tempo para equalizar propostas', 'Propostas incompletas podem confundir a decisão'],
          estimated_cost_range: 'Confirmar com três orçamentos comparáveis.',
          timeline: '3 a 10 dias para receber e equalizar propostas.',
          questions_for_vendor: ['O que está incluso e excluído?', 'Qual garantia de mão de obra e peças?', 'Há ART, seguro ou certificação necessária?'],
          evaluation_criteria: ['Escopo fechado', 'CNPJ e referências', 'Garantia', 'Condição de pagamento'],
        },
        {
          title: 'Alternativa temporária controlada',
          fit: 'Útil se há impacto imediato aos moradores e a solução definitiva demora.',
          pros: ['Reduz reclamações rapidamente', 'Compra tempo para decidir melhor'],
          cons: ['Pode virar gasto duplicado', 'Não substitui solução definitiva'],
          estimated_cost_range: 'Baixo a médio; limitar por prazo e teto de gasto.',
          timeline: 'Imediato a 72h.',
          questions_for_vendor: ['Qual solução paliativa é segura?', 'Quando a solução definitiva fica pronta?'],
          evaluation_criteria: ['Segurança', 'Custo máximo', 'Prazo curto', 'Reversibilidade'],
        },
      ],
      vendor_search_plan: {
        search_queries: [
          `${task} condomínio${queryLocation}`,
          `fornecedor manutenção ${task}${queryLocation}`,
          `empresa instalação ${task}${queryLocation}`,
          `comparar orçamento ${task} condomínio`,
        ],
        shortlisting_criteria: [
          'Atende condomínios e emite nota fiscal.',
          'Apresenta escopo, garantia, prazo e exclusões por escrito.',
          'Tem referências verificáveis em prédios similares.',
          'Explica dependências técnicas, normas e riscos antes da contratação.',
        ],
        // WhatsApp-native one-liner — no headers, no template framing.
        // The vendor reads this on their phone, not in an inbox.
        outreach_message: shortOutreach(task, input.locale === 'en-US' ? 'en' : 'pt'),
      },
      action_plan: [
        { step: 'Conferir rede cadastrada', owner: 'Síndico', due: 'Hoje', details: 'Verificar fornecedores preferidos, contratos, garantias e último uso.' },
        { step: 'Pedir diagnóstico e fotos/laudo', owner: 'Operação', due: '24-72h', details: 'Documentar causa, urgência, peças, riscos e solução recomendada.' },
        { step: 'Equalizar opções', owner: 'Conselho', due: '3-10 dias', details: 'Comparar preço, prazo, garantia, escopo, certificações e referências.' },
        { step: 'Comunicar moradores', owner: 'Síndico', due: 'Antes da execução', details: 'Avisar impacto, janela de serviço e canal para dúvidas.' },
      ],
      resident_update: {
        title: 'Atualização operacional em análise',
        body: `A administração está avaliando ${task}. O próximo passo é confirmar diagnóstico, alternativas, custos e prazo antes de qualquer contratação.\n\nAssim que houver proposta fechada ou impacto para áreas comuns, os moradores serão informados com antecedência.`,
      },
      proposal_draft: {
        title: text(`Avaliar ${task}`, 90),
        description: `A administração deve avaliar ${task} com diagnóstico técnico e cotações comparáveis. A decisão deve considerar custo total, prazo, garantia, impacto aos moradores e referências do fornecedor.\n\nPróximo passo: solicitar vistoria/proposta escrita e levar a opção recomendada ao conselho ou votação, conforme o valor e a regra interna.`,
        category: categoryForTask(input),
        estimated_cost: null,
      },
      risks: ['Contratar sem escopo fechado aumenta risco de aditivo.', 'Preço baixo sem garantia pode custar mais no ciclo de vida.', 'Serviço em área comum pode exigir aviso prévio e controle de acesso.'],
      _fallback: true,
    };
  }

  return {
    summary: `Operational plan for: ${task}. Use saved vendors first, then compare at least three outside options before approving spend.`,
    task_type: type,
    assumptions: [
      'AI did not browse the web or validate real-time availability.',
      'Costs and timelines must be confirmed by a formal quote.',
      networkFit.length ? 'Saved service contacts may be relevant as the first call.' : 'No saved vendor clearly matches this request.',
    ],
    recommended_next_step: networkFit.length
      ? `Call ${networkFit[0].company_name} for initial diagnosis while requesting two comparable outside quotes.`
      : 'Request a written diagnosis or technical proposal from three comparable vendors before taking the item to vote.',
    existing_network_fit: networkFit,
    options: [
      {
        title: 'Technical diagnosis first',
        fit: 'Best when the root cause is not proven yet.',
        pros: ['Avoids unnecessary replacement', 'Creates a clear scope for bidding'],
        cons: ['Adds a step before contracting', 'May require a visit fee'],
        estimated_cost_range: input.budget ? `Within stated budget: ${text(input.budget, 120)}` : 'Low to medium; confirm visit fee.',
        timeline: input.urgency ? `Stated urgency: ${text(input.urgency, 80)}` : '24h to 7 days for inspection.',
        questions_for_vendor: ['What is the root cause?', 'Is the repair under warranty?', 'Which parts or permits can delay the work?'],
        evaluation_criteria: ['Written report', 'Warranty', 'Response time', 'Condo references'],
      },
      {
        title: 'Competitive repair or installation bid',
        fit: 'Best when the scope is clear and the board needs price, timeline, and warranty comparison.',
        pros: ['Compares vendors on the same basis', 'Reduces overpricing risk'],
        cons: ['Takes time to normalize proposals', 'Incomplete proposals can confuse the decision'],
        estimated_cost_range: 'Confirm with three comparable quotes.',
        timeline: '3 to 10 days to receive and normalize proposals.',
        questions_for_vendor: ['What is included and excluded?', 'What labor and parts warranty applies?', 'Are permits, insurance, or technical certificates required?'],
        evaluation_criteria: ['Closed scope', 'Business credentials and references', 'Warranty', 'Payment terms'],
      },
      {
        title: 'Controlled temporary workaround',
        fit: 'Useful when residents are affected immediately and the permanent fix will take longer.',
        pros: ['Reduces complaints quickly', 'Buys time for a better decision'],
        cons: ['Can become duplicate spend', 'Does not replace the permanent fix'],
        estimated_cost_range: 'Low to medium; cap by time and budget.',
        timeline: 'Immediate to 72h.',
        questions_for_vendor: ['What temporary fix is safe?', 'When can the permanent solution be ready?'],
        evaluation_criteria: ['Safety', 'Maximum cost', 'Short timeline', 'Reversibility'],
      },
    ],
    vendor_search_plan: {
      search_queries: [
        `${task} condominium${queryLocation}`,
        `condo maintenance vendor ${task}${queryLocation}`,
        `installation company ${task}${queryLocation}`,
        `compare quote ${task} condominium`,
      ],
      shortlisting_criteria: [
        'Serves condominiums and issues formal invoices.',
        'Provides written scope, warranty, timeline, and exclusions.',
        'Has verifiable references in similar buildings.',
        'Explains technical dependencies, compliance needs, and risks before contracting.',
      ],
      outreach_message: shortOutreach(task, 'en'),
    },
    action_plan: [
      { step: 'Check saved vendor network', owner: 'Board admin', due: 'Today', details: 'Review preferred vendors, contracts, warranties, and last-use notes.' },
      { step: 'Request diagnosis and photos/report', owner: 'Operations', due: '24-72h', details: 'Document root cause, urgency, parts, risks, and recommended solution.' },
      { step: 'Normalize options', owner: 'Board', due: '3-10 days', details: 'Compare price, timeline, warranty, scope, credentials, and references.' },
      { step: 'Update residents', owner: 'Board admin', due: 'Before execution', details: 'Explain impact, service window, and support channel.' },
    ],
    resident_update: {
      title: 'Operational item under review',
      body: `Management is evaluating ${task}. The next step is to confirm diagnosis, options, cost, and timeline before any vendor is contracted.\n\nResidents will receive advance notice once there is a recommended proposal or any common-area impact.`,
    },
    proposal_draft: {
      title: text(`Evaluate ${task}`, 90),
      description: `Management should evaluate ${task} with a technical diagnosis and comparable quotes. The decision should consider total cost, timeline, warranty, resident impact, and vendor references.\n\nNext step: request a written inspection/proposal and bring the recommended option to the board or vote according to the building's spending rules.`,
      category: categoryForTask(input),
      estimated_cost: null,
    },
    risks: ['Contracting without a closed scope increases change-order risk.', 'The cheapest bid can cost more over the lifecycle if warranty is weak.', 'Common-area work may require advance notice and access control.'],
    _fallback: true,
  };
}

function sanitizeTaskType(value: unknown, fallback: AdminAgentTaskType): AdminAgentTaskType {
  const raw = text(value, 40);
  return (TASK_TYPES as string[]).includes(raw) ? raw as AdminAgentTaskType : fallback;
}

function sanitizeProposalCategory(value: unknown, fallback: AdminAgentProposalDraft['category']): AdminAgentProposalDraft['category'] {
  const raw = text(value, 40);
  return (PROPOSAL_CATEGORIES as string[]).includes(raw) ? raw as AdminAgentProposalDraft['category'] : fallback;
}

function sanitizeNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

// Mojibake fix — when the model echoes back Portuguese characters, we've
// been getting `Ã¡` (two chars) instead of `á` (one char). That's the
// classic signature of UTF-8 bytes being interpreted as Latin-1 codepoints
// somewhere in the request/response chain. The pattern is unmistakable:
// any `Ã` followed by a char in the 0x80-0xBF range is almost certainly a
// 2-byte UTF-8 sequence that got decoded as Latin-1 twice.
//
// Re-encoding fix: walk the string char-by-char, take the low byte of each
// codepoint, then decode the byte buffer as UTF-8. Buffer.from(s, 'latin1')
// does exactly this in one call. We only apply the fix when the suspicious
// pattern is present so clean strings (English, properly-encoded Portuguese
// without mojibake) pass through untouched.
const MOJIBAKE_PATTERN = /[ÂÃ][-¿]/;

// Lone replacement chars from upstream encoding failures (U+FFFD or
// the byte sequence 0xC2 0xAD / 0xEF 0xBF 0xBD as displayed in some
// renderers). These are already lost — the original byte can't be
// recovered. Best we can do is strip them so the UI doesn't show
// "dispon\\u00ad\\xadvel". Stripping vs leaving them in: residents
// would never see them as legible text anyway.
// U+FFFD only — that codepoint signals an upstream encoding failure
// that's already lost the original byte, so no round-trip recovery is
// possible. We strip it so the UI doesn't render the literal black
// diamond. Importantly we do NOT strip U+00AD (soft hyphen) because
// that codepoint is a LEGITIMATE part of mojibake byte sequences
// (Ã­ = bytes 0xC3 0xAD = UTF-8 for 'í'); stripping it breaks the
// fixer's round-trip recovery on Portuguese accents.
function stripReplacementChars(s: string): string {
  return s.replace(/�/g, '');
}

function fixMojibake(value: string): string {
  if (!value) return value;
  // Pre-strip U+FFFD before the pattern test so isolated lost-byte
  // strings get cleaned. The classic mojibake fixer below handles the
  // round-trip recoverable case.
  let working = value.includes('�') ? stripReplacementChars(value) : value;
  if (!MOJIBAKE_PATTERN.test(working)) return working;
  try {
    const fixed = Buffer.from(working, 'latin1').toString('utf8');
    if (MOJIBAKE_PATTERN.test(fixed) || fixed.includes('�')) return working;
    return fixed;
  } catch {
    return working;
  }
}

function fixMojibakeDeep<T>(value: T): T {
  if (typeof value === 'string') return fixMojibake(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => fixMojibakeDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fixMojibakeDeep(v);
    return out as unknown as T;
  }
  return value;
}

// Confidence sanitiser. The model may emit confidence as {score, tier,
// reasoning} or just a number — we accept both shapes and clamp. When
// missing, we synthesise a conservative estimate based on signals we
// know about: a fallback plan is always low; an empty service_contacts
// list means we couldn't really cite anything, so low; otherwise default
// to medium and let the model improve via the prompt. Tier is derived
// from score so the two never disagree.
function sanitizeConfidence(
  raw: unknown,
  isFallback: boolean,
  input: AdminAgentInput,
): { score: number; tier: 'high' | 'medium' | 'low'; reasoning: string[] } {
  const reasoningCap = 4;
  let score: number | null = null;
  let reasoning: string[] = [];

  if (typeof raw === 'number') {
    score = raw;
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const s = typeof o.score === 'number' ? o.score : typeof o.value === 'number' ? o.value : null;
    if (s != null) score = s;
    const r = Array.isArray(o.reasoning) ? o.reasoning : Array.isArray(o.reasons) ? o.reasons : [];
    reasoning = r.map((x) => String(x || '').slice(0, 220)).filter(Boolean).slice(0, reasoningCap);
  }

  if (score == null || !Number.isFinite(score)) {
    // No usable model confidence — synthesise from signals.
    if (isFallback) {
      score = 0.3;
      if (reasoning.length === 0) reasoning = ['Plano gerado por fallback determinístico, sem modelo.'];
    } else if (!input.service_contacts || input.service_contacts.length === 0) {
      score = 0.4;
      if (reasoning.length === 0) reasoning = ['Sem fornecedores cadastrados para citar.'];
    } else {
      score = 0.6;
      if (reasoning.length === 0) reasoning = ['Sem confiança explícita do modelo — valor padrão de partida.'];
    }
  }

  // Clamp to [0,1] and round to two decimals so the UI doesn't show
  // spurious precision ("0.823 alta confiança").
  score = Math.max(0, Math.min(1, Number(score)));
  score = Math.round(score * 100) / 100;
  // Fallback always degrades to at most medium — we never trust a
  // deterministic plan more than a real one even if the heuristic
  // pegged it higher.
  if (isFallback && score > 0.65) score = 0.65;

  const tier: 'high' | 'medium' | 'low' =
    score >= 0.85 ? 'high' : score >= 0.5 ? 'medium' : 'low';

  if (reasoning.length === 0) {
    reasoning = ['Confiança calculada a partir de contexto disponível.'];
  }
  return { score, tier, reasoning };
}

// Lightweight category match — duplicated from admin-agent-runner so the
// sanitizer doesn't import the runner (would create a cycle: runner imports
// sanitizer, sanitizer would import runner). Same alias map, kept narrow.
// Used to drop network_fit entries the model included for vendors that
// don't match the task's category.
// Category inference for sanitiser — looser than the runner's because we
// can afford false positives here (worst case: we filter too few vendors,
// matches the legacy behaviour). Drop \b word-boundaries since they
// don't play well with accented input and we want lenient matching.
function sanitizerInferCategory(task: string, _taskType: string): string | null {
  const t = String(task || '').toLowerCase();
  const checks: Array<[RegExp, string]> = [
    [/(vazamento de g[áa]s|gas leak)/i, 'gas_leak'],
    [/(inunda[çc][ãa]o|inundada?|alagamento|water damage)/i, 'water_damage'],
    [/(inc[êe]ndio|fuma[çc]a|alarme de inc|fire safety|fire alarm)/i, 'fire_safety'],
    [/(elevador|elevator|lift)/i, 'elevator'],
    [/(el[ée]trica?|electrical|tomada|disjuntor|curto-?circuito|fia[çc][ãa]o)/i, 'electrical'],
    [/(hidr[áa]ulica?|encanamento|encanador|vazamento|cano|esgoto|plumbing|leak|pipe|pia|banheiro|chuveiro)/i, 'plumbing'],
    [/(ar condicionado|ventila[çc][ãa]o|climatiza[çc][ãa]o|hvac|a\/c)/i, 'hvac'],
    [/(seguran[çc]a|port[ãa]o|portaria|intercom|c[âa]mera|cctv|security|access|gate)/i, 'security'],
    [/(\bg[áa]s\b)/i, 'gas'],
    [/(dedetiza|dedetizador|barata|formiga|rato|pest|cockroach)/i, 'pest_control'],
    [/(paisagismo|jardim|jardinagem|landscaping|garden)/i, 'landscaping'],
    [/(piscina|pool)/i, 'pool'],
    [/(academia|gym|treadmill|esteira)/i, 'gym_equipment'],
    [/(limpeza|cleaning|janitor)/i, 'cleaning'],
    [/(manuten[çc][ãa]o|conserto|maintenance|repair)/i, 'maintenance'],
  ];
  for (const [re, cat] of checks) if (re.test(t)) return cat;
  return null;
}

// Two-direction alias table for category compat. Pipe-separated synonyms
// flatten the runner-side CATEGORY_ALIASES into a fast lookup.
const CATEGORY_COMPAT: Record<string, Set<string>> = {
  maintenance:        new Set(['maintenance', 'general_maintenance']),
  general_maintenance: new Set(['maintenance', 'general_maintenance']),
  hvac:               new Set(['hvac', 'climatization']),
  security:           new Set(['security', 'security_access']),
  amenity:            new Set(['amenity', 'amenities']),
  fire_safety:        new Set(['fire_safety', 'safety']),
  gas:                new Set(['gas', 'gas_leak']),
  gas_leak:           new Set(['gas', 'gas_leak']),
  water:              new Set(['water', 'water_damage']),
  water_damage:       new Set(['water', 'water_damage']),
};

function categoryCompatible(taskCategory: string, vendorCategory: string): boolean {
  if (!taskCategory || !vendorCategory) return false;
  if (taskCategory === vendorCategory) return true;
  const compat = CATEGORY_COMPAT[taskCategory];
  return !!compat && compat.has(vendorCategory);
}

// Cost discipline check — if the model emits a numeric range (e.g.
// "R$ 2.000 - R$ 10.000") but no saved vendor was named to back it,
// the price is invented. The prompt forbids it; this catches the
// violation. Returns true when the cost looks invented.
//
// Signal: a numeric range WITHOUT a corresponding named vendor in
// existing_network_fit means the agent has nowhere to ground the
// estimate. Honest answers either name a vendor whose cost_history
// supports the range, or say "confirm by quote" / "A confirmar".
// Scope detection — opinionated keyword match against tasks that are
// clearly off-domain for a condo-operations copilot. We refuse cleanly
// so the admin doesn't get a generic marketing/legal/investment plan
// from a tool that should only operate the building. Borderline cases
// (anything about the building, anything ending in a vendor call) pass.
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  // Marketing / promotion / branding
  /\b(marketing|promo[çc][ãa]o|publicidade|propaganda|m[íi]dia social|redes sociais|branding|posicionamento de marca|estrat[ée]gia (digital|de m[íi]dia))\b/i,
  /\b(brand|advertising|social media|seo|growth hacking)\b/i,
  // Investment / portfolio / financial advice (not condo finance)
  /\b(investir|investimento|carteira de investimento|a[çc][õo]es de bolsa|cripto|bitcoin|portf[óo]lio (financeiro|de investimento))\b/i,
  /\b(invest|stock market|crypto|portfolio (allocation|advice))\b/i,
  // Personal advice / lifestyle / relationship
  /\b(conselho pessoal|terapia|psicologia|relacionamento|namorada?|casamento|filhos|adolesc[êe]ncia)\b/i,
  /\b(life advice|personal advice|therapy|relationship|dating|parenting)\b/i,
  // Political / opinion
  /\b(presidente|eleicao|elei[çc][ãa]o|partido pol[íi]tico|governo federal|impeachment)\b/i,
  /\b(election|president|political party|government)\b/i,
];
function looksOutOfScope(task: string): boolean {
  const t = String(task || '');
  return OUT_OF_SCOPE_PATTERNS.some((re) => re.test(t));
}

function looksLikeInventedCost(costRange: string, networkFitCount: number): boolean {
  if (!costRange) return false;
  // Cheap detector: any decimal-grouped number that suggests currency.
  // Allows "Confirm by quote" / "A confirmar" / "TBD" — those are honest.
  const hasNumber = /\d{2,}/.test(costRange);
  if (!hasNumber) return false;
  // No named vendor backing the number → it's a guess. Even when the
  // agent has cost_history for the same category, it MUST cite a vendor
  // to ground the number; an uncited range is theatre.
  return networkFitCount === 0;
}

export function sanitizeAdminAgentOutput(raw: unknown, input: AdminAgentInput): AdminAgentOutput {
  const fallback = fallbackAdminAgent(input);
  const data = obj(raw);
  const knownCompanies = new Set((input.service_contacts || []).map((c) => text(c.company_name, 140).toLowerCase()).filter(Boolean));
  // Build a name → category lookup so we can drop vendors that don't
  // match the inferred task category. Same hash that the model SHOULD
  // have used to filter.
  const companyToCategory = new Map<string, string>();
  for (const c of input.service_contacts || []) {
    const name = text(c.company_name, 140).toLowerCase();
    if (name) companyToCategory.set(name, text(c.category, 80).toLowerCase());
  }
  // Infer the task's category to filter network_fit. Falls back to the
  // task_type the model claimed if the keyword match misses; finally null
  // (which disables the filter — we'd rather show some vendors than none
  // when we genuinely can't tell).
  const taskCategory = sanitizerInferCategory(input.task || '', String(data.task_type || ''));

  const rawFits = Array.isArray(data.existing_network_fit) ? data.existing_network_fit : [];
  // Track whether the model actually produced fits we then filtered out,
  // vs the model produced nothing at all. The first case is intentional
  // ("the model named vendors that don't match the category"); the
  // second is the legacy fallback case.
  const modelProducedFits = rawFits.length > 0;
  const existing_network_fit = rawFits
    .map((item) => obj(item))
    .filter((item) => {
      const company = text(item.company_name, 140).toLowerCase();
      if (!company || !knownCompanies.has(company)) return false;
      // Category gate: if we inferred a category from the task, the
      // vendor's saved category must match (or be alias-compatible).
      // Tasks where we couldn't infer get the legacy behavior — show
      // every named-match the model returned.
      if (!taskCategory) return true;
      const vendorCat = companyToCategory.get(company) || '';
      return categoryCompatible(taskCategory, vendorCat);
    })
    .slice(0, 4)
    .map((item) => ({
      company_name: text(item.company_name, 140),
      category: text(item.category, 80) || 'service',
      reason: text(item.reason, 260) || 'Saved in this building service network.',
      contact_method: text(item.contact_method, 180) || 'Saved contact',
    }));

  const options = (Array.isArray(data.options) ? data.options : [])
    .map((item) => obj(item))
    .map((item, idx) => ({
      title: text(item.title, 120) || fallback.options[idx]?.title || 'Option',
      fit: text(item.fit, 320) || fallback.options[idx]?.fit || 'Operational fit to review.',
      pros: list(item.pros, fallback.options[idx]?.pros || [], 5, 160),
      cons: list(item.cons, fallback.options[idx]?.cons || [], 5, 160),
      estimated_cost_range: text(item.estimated_cost_range, 160) || fallback.options[idx]?.estimated_cost_range || 'Confirm by quote.',
      timeline: text(item.timeline, 120) || fallback.options[idx]?.timeline || 'Confirm with vendor.',
      questions_for_vendor: list(item.questions_for_vendor, fallback.options[idx]?.questions_for_vendor || [], 6, 180),
      evaluation_criteria: list(item.evaluation_criteria, fallback.options[idx]?.evaluation_criteria || [], 6, 160),
    }))
    .filter((item) => item.title)
    .slice(0, 4);

  const vendorPlan = obj(data.vendor_search_plan);
  const actionPlan = (Array.isArray(data.action_plan) ? data.action_plan : [])
    .map((item) => obj(item))
    .map((item, idx) => ({
      step: text(item.step, 140) || fallback.action_plan[idx]?.step || 'Review next step',
      owner: text(item.owner, 100) || fallback.action_plan[idx]?.owner || 'Board',
      due: text(item.due, 80) || fallback.action_plan[idx]?.due || 'TBD',
      details: text(item.details, 320) || fallback.action_plan[idx]?.details || 'Confirm details before acting.',
    }))
    .filter((item) => item.step)
    .filter(isOfflineAction)
    .slice(0, 8);

  const residentUpdate = obj(data.resident_update);
  const proposalDraft = obj(data.proposal_draft);
  const fallbackCategory = fallback.proposal_draft?.category || categoryForTask(input);
  const hasProposalDraft = !!(text(proposalDraft.title, 90) || text(proposalDraft.description, 2_000));

  const output: AdminAgentOutput = {
    summary: text(data.summary, 700) || fallback.summary,
    task_type: sanitizeTaskType(data.task_type, fallback.task_type),
    assumptions: list(data.assumptions, fallback.assumptions, 6, 220),
    recommended_next_step: text(data.recommended_next_step, 500) || fallback.recommended_next_step,
    // Only fall back to the deterministic vendor list when the model
    // produced NO network_fit at all AND we couldn't infer a category
    // from the task. If the model returned fits and we filtered them
    // all out, OR we inferred a category and no saved vendor matches,
    // the empty list is intentional — surfacing the fallback would
    // re-introduce vendors the admin shouldn't see for this task.
    existing_network_fit: existing_network_fit.length || modelProducedFits || taskCategory
      ? existing_network_fit
      : fallback.existing_network_fit,
    options: options.length ? options : fallback.options,
    vendor_search_plan: {
      search_queries: list(vendorPlan.search_queries, fallback.vendor_search_plan.search_queries, 8, 180),
      shortlisting_criteria: list(vendorPlan.shortlisting_criteria, fallback.vendor_search_plan.shortlisting_criteria, 8, 180),
      outreach_message: multiline(vendorPlan.outreach_message, 1_200) || fallback.vendor_search_plan.outreach_message,
    },
    // Empty-allowed: an action_plan with nothing offline-worth-listing is
    // honest. Don't paper over with the boilerplate fallback (which is
    // generic "Conferir rede / Pedir laudo / Equalizar opções") if the
    // filter stripped real items.
    action_plan: actionPlan,
    resident_update: {
      title: text(residentUpdate.title, 120) || fallback.resident_update.title,
      body: multiline(residentUpdate.body, 1_200) || fallback.resident_update.body,
    },
    proposal_draft: hasProposalDraft
      ? {
        title: text(proposalDraft.title, 90) || fallback.proposal_draft!.title,
        description: multiline(proposalDraft.description, 2_500) || fallback.proposal_draft!.description,
        category: sanitizeProposalCategory(proposalDraft.category, fallbackCategory),
        estimated_cost: sanitizeNumberOrNull(proposalDraft.estimated_cost),
      }
      : fallback.proposal_draft,
    risks: list(data.risks, fallback.risks, 8, 220),
    confidence: sanitizeConfidence(data.confidence, !!data._fallback, input),
    _fallback: data._fallback === true ? true : undefined,
  };

  // Scope check: when the task is clearly off-domain, force a refusal
  // even when the model produced a plan. Soft prompt rules are not
  // enough — Claude / GPT will happily over-help on adjacent topics
  // like marketing strategy, legal interpretation, personal advice.
  // Detection is keyword-based against the task text (admin-agent.ts is
  // the only place that scopes condo operations, so we can be opinionated).
  if (looksOutOfScope(input.task || '')) {
    output.summary = 'Não está no escopo desse copiloto (opera apenas operações do condomínio: reparos, instalações, fornecedores, comunicação aos moradores e propostas para decisões do conselho). Reformule como uma decisão operacional ou consulte outro recurso.';
    output.task_type = 'general';
    output.recommended_next_step = 'Reformule a pergunta como uma decisão operacional do condomínio.';
    output.existing_network_fit = [];
    output.options = [];
    output.action_plan = [];
    output.proposal_draft = null;
    output.risks = ['Pergunta fora do escopo — recusa explícita.'];
    output.confidence = {
      score: 0.95,
      tier: 'high',
      reasoning: ['Pergunta fora do escopo operacional do condomínio.'],
    };
  }

  // Cost discipline: if the model emitted a numeric range with no real
  // history backing it, downgrade confidence and tag the reasoning so
  // the admin sees why. Doesn't rewrite the number — just rates the
  // claim honestly. Catches the "vistoria predial — R$ 2.000-10.000"
  // hallucination class.
  const firstCost = output.options?.[0]?.estimated_cost_range || '';
  if (looksLikeInventedCost(firstCost, output.existing_network_fit.length) && output.confidence) {
    output.confidence.score = Math.min(output.confidence.score, 0.45);
    output.confidence.tier = output.confidence.score >= 0.85 ? 'high'
      : output.confidence.score >= 0.5 ? 'medium' : 'low';
    if (!output.confidence.reasoning.some((r) => /sem histórico|no history/i.test(r))) {
      output.confidence.reasoning.unshift('Custo não tem histórico real — número é estimativa do modelo.');
    }
  }

  // Follow-up suggestions — turn data walls into conversation pivots.
  // Each suggestion is a short sentence the UI pre-fills into the
  // follow-up composer. We trigger different prompts based on which
  // walls we just hit, so the admin has an obvious next move when the
  // current call fell short. Skip when the response is a scope refusal
  // (no point suggesting follow-ups on a refused task).
  const suggestions: string[] = [];
  const isRefusal = /\bescopo desse copiloto\b|reformule a pergunta como uma decisão operacional/i.test(output.summary);
  if (!isRefusal) {
    // Wall 1: no vendor in the inferred category. Offer to draft an
    // outreach for new vendors the admin would call themselves.
    if (output.existing_network_fit.length === 0 && taskCategory) {
      const categoryLabel = agentCategoryLabel(taskCategory, input);
      suggestions.push(byAgentLanguage(input, {
        pt: `Quer que eu rascunhe uma mensagem de WhatsApp para procurar fornecedores para ${categoryLabel}?`,
        en: `Want me to draft a WhatsApp message to find vendors for ${categoryLabel}?`,
        es: `¿Quieres que redacte un mensaje de WhatsApp para buscar proveedores de ${categoryLabel}?`,
        fr: `Voulez-vous que je rédige un message WhatsApp pour trouver des prestataires en ${categoryLabel} ?`,
      }));
      suggestions.push(byAgentLanguage(input, {
        pt: `Posso te ajudar a definir critérios de seleção para um novo fornecedor de ${categoryLabel}?`,
        en: `Want help defining selection criteria for a new ${categoryLabel} vendor?`,
        es: `¿Quieres ayuda para definir criterios de selección para un nuevo proveedor de ${categoryLabel}?`,
        fr: `Voulez-vous de l’aide pour définir les critères de sélection d’un nouveau prestataire en ${categoryLabel} ?`,
      }));
    }
    // Wall 2: cost is uncited (we just downgraded confidence). Ask for
    // a real quote so the next call has data.
    if (output.confidence?.reasoning.some((r) => /sem histórico real|estimativa do modelo/i.test(r))) {
      suggestions.push(byAgentLanguage(input, {
        pt: 'Tem um orçamento real? Cole aqui e eu te ajudo a comparar com o histórico do prédio.',
        en: 'Do you have a real quote? Paste it here and I will compare it against the building history.',
        es: '¿Tienes un presupuesto real? Pégalo aquí y lo comparo con el historial del edificio.',
        fr: 'Avez-vous un devis réel ? Collez-le ici et je le comparerai à l’historique de l’immeuble.',
      }));
    }
    // Wall 3: agent had high-confidence past resolution but the admin
    // might want to verify before re-running the same play.
    const memory = (output as any).building_memory as { similar_resolved_tickets?: Array<{ id: number; title: string }> } | null | undefined;
    if (memory?.similar_resolved_tickets?.length) {
      const t = memory.similar_resolved_tickets[0];
      suggestions.push(byAgentLanguage(input, {
        pt: `Quer ver o detalhe do chamado #${t.id} ("${t.title.slice(0, 40)}")?`,
        en: `Want to see the details for ticket #${t.id} ("${t.title.slice(0, 40)}")?`,
        es: `¿Quieres ver el detalle del llamado #${t.id} ("${t.title.slice(0, 40)}")?`,
        fr: `Voulez-vous voir le détail du ticket #${t.id} (« ${t.title.slice(0, 40)} ») ?`,
      }));
    }
    // Wall 4: agent recommended a vendor but cost is unknown — surface
    // a question the admin would naturally ask next.
    if (output.existing_network_fit.length > 0 && output.options.some((o) => /confirm by quote|a confirmar|TBD/i.test(o.estimated_cost_range))) {
      suggestions.push(byAgentLanguage(input, {
        pt: 'Qual a faixa de preço aceitável antes de eu acionar o fornecedor?',
        en: 'What price range is acceptable before I contact the vendor?',
        es: '¿Qué rango de precio es aceptable antes de contactar al proveedor?',
        fr: 'Quelle fourchette de prix est acceptable avant de contacter le prestataire ?',
      }));
    }
  }
  if (suggestions.length > 0) {
    // Cap at 3 — anything more becomes noise. Dedupe by trimmed content.
    output.follow_up_suggestions = Array.from(new Set(suggestions.map((s) => s.trim()))).slice(0, 3);
  }

  // Pass every string through the mojibake fixer as the very last step,
  // after schema sanitization. Has to be last so we fix the strings the
  // schema produced — not just the raw model output — and so we never
  // rewind a defaulted-fallback string back into mojibake.
  return fixMojibakeDeep(output);
}
