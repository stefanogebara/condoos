// Ticket categories and vendor categories don't line up 1:1 — the resident
// reporter picks from a short list (maintenance / electrical / plumbing /
// hvac / security / etc.) while the admin's vendor directory uses
// finer-grained codes (general_maintenance, climatization, security_access,
// gas_leak, water_damage…). Same map already exists client-side in
// BoardTickets.tsx for the picker; this server-side copy is used to
// auto-rewire blocked tickets when a new vendor lands.
//
// IMPORTANT: keep in sync with client-app/src/pages/board/BoardTickets.tsx.
// If you add a row here, add it there too.

export const CATEGORY_ALIASES: Record<string, string[]> = {
  maintenance:    ['maintenance', 'general_maintenance'],
  hvac:           ['hvac', 'climatization'],
  plumbing:       ['plumbing'],
  electrical:     ['electrical'],
  elevator:       ['elevator'],
  security:       ['security', 'security_access'],
  amenity:        ['amenity', 'amenities'],
  cleaning:       ['cleaning'],
  fire_safety:    ['fire_safety', 'safety'],
  gas:            ['gas', 'gas_leak'],
  water:          ['water', 'water_damage'],
};

export function categoryMatches(ticketCat: string, vendorCat: string): boolean {
  if (!ticketCat || !vendorCat) return false;
  if (ticketCat === vendorCat) return true;
  const aliases = CATEGORY_ALIASES[ticketCat];
  return !!aliases && aliases.includes(vendorCat);
}

// Reverse lookup — given a vendor category, return every ticket category
// that should consider this vendor a match. Used by the auto-rewire to
// find blocked tickets that a newly-added vendor can now serve.
export function ticketCategoriesForVendor(vendorCat: string): string[] {
  if (!vendorCat) return [];
  const matches = new Set<string>([vendorCat]);
  for (const [ticketCat, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(vendorCat)) matches.add(ticketCat);
  }
  return Array.from(matches);
}
