import { z } from 'zod';

export const SERVICE_CATEGORIES = [
  'electrical',
  'plumbing',
  'elevator',
  'gym_equipment',
  'pool',
  'cleaning',
  'security',
  'landscaping',
  'internet_cctv',
  'pest_control',
  'general_maintenance',
  'legal_admin',
  'other',
] as const;

export const serviceContactSchema = z.object({
  category: z.enum(SERVICE_CATEGORIES).default('general_maintenance'),
  company_name: z.string().min(1).max(140),
  contact_name: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  whatsapp: z.string().max(40).optional().nullable(),
  email: z.string().email().max(160).optional().nullable().or(z.literal('')),
  website: z.string().url().max(2048).optional().nullable().or(z.literal('')),
  address: z.string().max(240).optional().nullable(),
  service_scope: z.string().max(500).optional().nullable(),
  notes: z.string().max(1200).optional().nullable(),
  contract_url: z.string().url().max(2048).optional().nullable().or(z.literal('')),
  emergency_available: z.boolean().default(false),
  preferred: z.boolean().default(false),
  active: z.boolean().default(true),
  last_used_at: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().nullable(),
}).superRefine((contact, ctx) => {
  const hasReachableContact = [
    contact.phone,
    contact.whatsapp,
    contact.email,
    contact.website,
    contact.address,
    contact.notes,
  ].some((value) => String(value || '').trim().length > 0);
  if (!hasReachableContact) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'service_contact_needs_reachable_detail',
      path: ['phone'],
    });
  }
});

export type ServiceContactInput = z.infer<typeof serviceContactSchema>;

export function normalizeServiceContact(body: ServiceContactInput) {
  const date = body.last_used_at
    ? /^\d{4}-\d{2}-\d{2}$/.test(body.last_used_at)
      ? `${body.last_used_at}T00:00:00.000Z`
      : new Date(body.last_used_at).toISOString()
    : null;

  return {
    ...body,
    company_name: body.company_name.trim(),
    contact_name: body.contact_name?.trim() || null,
    phone: body.phone?.trim() || null,
    whatsapp: body.whatsapp?.trim() || null,
    email: body.email?.trim() || null,
    website: body.website?.trim() || null,
    address: body.address?.trim() || null,
    service_scope: body.service_scope?.trim() || null,
    notes: body.notes?.trim() || null,
    contract_url: body.contract_url?.trim() || null,
    last_used_at: date,
  };
}
