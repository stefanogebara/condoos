// Reusable orchestrator for the admin operations agent.
//
// The original route at POST /api/ai/admin-agent does the full context-
// gathering + model call inline. The Incident Loop feature (verified tickets
// → AI agent dispatch) needs to fire the same logic from a different
// endpoint, so the heavy lifting moves here. The route handler stays as the
// auth + rate-limit + audit shell.

import db from '../db';
import { chat, parseJsonLoose } from './openrouter';
import { ADMIN_AGENT_SYS } from './prompts';
import {
  fallbackAdminAgent,
  normalizeAdminAgentMode,
  sanitizeAdminAgentOutput,
  type AdminAgentInput,
  type AdminAgentMode,
} from './admin-agent';

function clip(value: unknown, max: number): string {
  return String(value || '').slice(0, max);
}

export interface RunAdminAgentArgs {
  condoId: number;
  task: string;
  mode?: string | AdminAgentMode;
  locale?: string;
  location?: string;
  budget?: string;
  urgency?: string;
}

export interface RunAdminAgentResult {
  plan: any;
  fallback: boolean;
}

export async function runAdminAgent(args: RunAdminAgentArgs): Promise<RunAdminAgentResult> {
  const mode = normalizeAdminAgentMode(args.mode);

  const condo = db.prepare(`SELECT id, name, address FROM condominiums WHERE id = ?`).get(args.condoId) as any;
  const footprint = db.prepare(
    `SELECT COUNT(DISTINCT b.id) AS buildings, COUNT(u.id) AS units
     FROM buildings b
     LEFT JOIN units u ON u.building_id = b.id
     WHERE b.condominium_id = ?`
  ).get(args.condoId) as any;

  const serviceContacts = db.prepare(
    `SELECT category, company_name, contact_name, phone, whatsapp, email, website,
            service_scope, notes, emergency_available, preferred, last_used_at
     FROM service_contacts
     WHERE condominium_id = ? AND active = 1
     ORDER BY preferred DESC, emergency_available DESC, company_name ASC
     LIMIT 40`
  ).all(args.condoId) as any[];

  const amenities = db.prepare(
    `SELECT name, description, capacity, admin_notes
     FROM amenities
     WHERE condominium_id = ? AND active = 1
     ORDER BY name ASC
     LIMIT 12`
  ).all(args.condoId) as any[];

  const recentProposals = db.prepare(
    `SELECT id, title, category, status, estimated_cost, created_at
     FROM proposals
     WHERE condominium_id = ?
     ORDER BY created_at DESC
     LIMIT 8`
  ).all(args.condoId) as any[];

  const openSuggestions = db.prepare(
    `SELECT id, body, category, created_at
     FROM suggestions
     WHERE condominium_id = ? AND status = 'open'
     ORDER BY created_at DESC
     LIMIT 8`
  ).all(args.condoId) as any[];

  const adminInput: AdminAgentInput = {
    task: args.task,
    mode,
    location: args.location || '',
    budget: args.budget || '',
    urgency: args.urgency || '',
    locale: args.locale || '',
    condo: condo ? { name: condo.name, address: condo.address } : null,
    service_contacts: serviceContacts,
  };

  const context = {
    generated_at: new Date().toISOString(),
    request: {
      task: args.task,
      mode,
      location: adminInput.location || condo?.address || null,
      budget: adminInput.budget || null,
      urgency: adminInput.urgency || null,
      locale: adminInput.locale || null,
    },
    condominium: condo ? {
      name: condo.name,
      address: condo.address,
      buildings: Number(footprint?.buildings || 0),
      units: Number(footprint?.units || 0),
    } : null,
    saved_service_contacts: serviceContacts.map((c) => ({
      category: clip(c.category, 80),
      company_name: clip(c.company_name, 140),
      contact_name: clip(c.contact_name, 120),
      phone: clip(c.phone, 60),
      whatsapp: clip(c.whatsapp, 60),
      email: clip(c.email, 160),
      website: clip(c.website, 240),
      service_scope: clip(c.service_scope, 500),
      notes: clip(c.notes, 700),
      emergency_available: !!c.emergency_available,
      preferred: !!c.preferred,
      last_used_at: c.last_used_at,
    })),
    amenities: amenities.map((a) => ({
      name: clip(a.name, 120),
      description: clip(a.description, 500),
      capacity: a.capacity,
      admin_notes: clip(a.admin_notes, 700),
    })),
    recent_proposals: recentProposals.map((p) => ({
      id: p.id,
      title: clip(p.title, 220),
      category: p.category,
      status: p.status,
      estimated_cost: p.estimated_cost,
      created_at: p.created_at,
    })),
    open_suggestions: openSuggestions.map((s) => ({
      id: s.id,
      body: clip(s.body, 700),
      category: s.category,
      created_at: s.created_at,
    })),
    tool_limitations: 'This route does not perform live web browsing, vendor calls, purchases, bookings, or installation work. It produces a decision-ready plan, search queries, outreach copy, and a proposal draft.',
  };

  let usedFallback = false;
  let raw: any;
  try {
    const text = await chat(
      [
        { role: 'system', content: ADMIN_AGENT_SYS },
        { role: 'user', content: JSON.stringify(context) },
      ],
      { jsonMode: true, maxTokens: 2_000 }
    );
    raw = parseJsonLoose<any>(text);
    if (!raw) {
      raw = fallbackAdminAgent(adminInput);
      usedFallback = true;
    }
  } catch {
    raw = fallbackAdminAgent(adminInput);
    usedFallback = true;
  }

  const plan = sanitizeAdminAgentOutput(raw, adminInput);
  return { plan, fallback: usedFallback };
}
