import db from '../db';
import type { AuthUser } from './auth';
import { recordTicketEvent } from './tickets';

export type TicketQuoteStatus = 'received' | 'shortlisted' | 'selected' | 'rejected';

export interface TicketQuoteInput {
  condoId: number;
  ticketId: number;
  actorUserId: number;
  serviceContactId?: number | null;
  vendorName?: string | null;
  quoteAmountCents?: number | null;
  currency?: string | null;
  availability?: string | null;
  warranty?: string | null;
  notes?: string | null;
  attachmentUrl?: string | null;
  attachmentFileId?: number | null;
  status?: TicketQuoteStatus;
}

export interface TicketQuoteRow {
  id: number;
  ticket_id: number;
  condominium_id: number;
  service_contact_id: number | null;
  vendor_name: string;
  vendor_category: string | null;
  vendor_contact: string | null;
  quote_amount_cents: number | null;
  currency: string;
  availability: string | null;
  warranty: string | null;
  notes: string | null;
  attachment_url: string | null;
  attachment_file_id: number | null;
  attachment_filename: string | null;
  status: TicketQuoteStatus;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

type CreateTicketQuoteResult =
  | ({ ok: true } & TicketQuoteRow)
  | { ok: false; error: 'ticket_not_found' | 'vendor_not_in_condo' | 'vendor_required' };

function cleanText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cleanCurrency(value: string | null | undefined): string {
  const currency = cleanText(value, 12)?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return currency || 'BRL';
}

function ticketInCondo(ticketId: number, condoId: number): boolean {
  return !!db.prepare(`SELECT 1 FROM tickets WHERE id = ? AND condominium_id = ?`).get(ticketId, condoId);
}

export function createTicketQuote(input: TicketQuoteInput): CreateTicketQuoteResult {
  if (!ticketInCondo(input.ticketId, input.condoId)) return { ok: false, error: 'ticket_not_found' };

  let vendorName = cleanText(input.vendorName, 200);
  let serviceContactId = input.serviceContactId || null;
  if (serviceContactId) {
    const vendor = db.prepare(
      `SELECT id, company_name
       FROM service_contacts
       WHERE id = ? AND condominium_id = ? AND active = 1`
    ).get(serviceContactId, input.condoId) as { id: number; company_name: string } | undefined;
    if (!vendor) return { ok: false, error: 'vendor_not_in_condo' };
    vendorName = vendor.company_name;
    serviceContactId = vendor.id;
  }
  if (!vendorName) return { ok: false, error: 'vendor_required' };

  const result = db.prepare(
    `INSERT INTO ticket_vendor_quotes (
       ticket_id, condominium_id, service_contact_id, vendor_name,
       quote_amount_cents, currency, availability, warranty, notes,
       attachment_url, attachment_file_id, status, created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.ticketId,
    input.condoId,
    serviceContactId,
    vendorName,
    input.quoteAmountCents ?? null,
    cleanCurrency(input.currency),
    cleanText(input.availability, 500),
    cleanText(input.warranty, 500),
    cleanText(input.notes, 2_000),
    cleanText(input.attachmentUrl, 1_000),
    input.attachmentFileId || null,
    input.status || 'received',
    input.actorUserId,
  );
  const quoteId = Number(result.lastInsertRowid);

  recordTicketEvent({
    ticketId: input.ticketId,
    condoId: input.condoId,
    actorUserId: input.actorUserId,
    eventType: 'vendor.quote_added',
    title: 'Cotação adicionada',
    body: vendorName,
    metadata: {
      quote_id: quoteId,
      service_contact_id: serviceContactId,
      quote_amount_cents: input.quoteAmountCents ?? null,
      status: input.status || 'received',
    },
    visibility: 'admin',
  });

  return { ok: true, ...listTicketQuotes({ condoId: input.condoId, ticketId: input.ticketId, role: 'board_admin' }).find((q) => q.id === quoteId)! };
}

export function listTicketQuotes(input: {
  condoId: number;
  ticketId: number;
  role: AuthUser['role'];
}): TicketQuoteRow[] {
  if (input.role !== 'board_admin') return [];
  return db.prepare(
    `SELECT q.id, q.ticket_id, q.condominium_id, q.service_contact_id,
            COALESCE(sc.company_name, q.vendor_name) AS vendor_name,
            sc.category AS vendor_category,
            sc.contact_name AS vendor_contact,
            q.quote_amount_cents, q.currency, q.availability, q.warranty,
            q.notes, q.attachment_url, q.attachment_file_id,
            f.original_filename AS attachment_filename,
            q.status, q.created_by_user_id, q.created_at, q.updated_at
     FROM ticket_vendor_quotes q
     JOIN tickets t ON t.id = q.ticket_id AND t.condominium_id = q.condominium_id
     LEFT JOIN service_contacts sc ON sc.id = q.service_contact_id
     LEFT JOIN files f ON f.id = q.attachment_file_id
     WHERE q.condominium_id = ? AND q.ticket_id = ?
     ORDER BY
       CASE q.status WHEN 'selected' THEN 0 WHEN 'shortlisted' THEN 1 WHEN 'received' THEN 2 ELSE 3 END,
       q.quote_amount_cents IS NULL ASC,
       q.quote_amount_cents ASC,
       q.created_at ASC`
  ).all(input.condoId, input.ticketId) as TicketQuoteRow[];
}
