// Party guest-list (#10): amenity reservations now accept expected_guests +
// guest_list + notes so the porteiro can admit by name without phoning.
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

async function residentToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'resident@condoos.dev', password: 'resident123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.token;
}

test('Parties API: amenity reservation accepts guest list + count', async ({ request }) => {
  const token = await residentToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Find the Party Room (or any party-ish amenity).
  const amenities = await request.get(`${apiURL}/amenities`, { headers });
  const list = (await amenities.json()).data as Array<{ id: number; name: string; open_hour: number; close_hour: number; slot_minutes: number }>;
  const party = list.find((a) => /Party Room|Salão|Salao|Festa/i.test(a.name)) || list[0];
  expect(party, 'no amenity available to test').toBeTruthy();

  // Find the first available slot on a future Saturday using the slots endpoint.
  // This avoids desktop/mobile conflicts when both tests run against the same DB.
  const saturday = new Date();
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
  const dateStr = saturday.toISOString().slice(0, 10);
  const slotsRes = await request.get(`${apiURL}/amenities/${party.id}/slots?date=${dateStr}`, { headers });
  const slots = (await slotsRes.json()).data?.slots as Array<{ starts_at: string; ends_at: string; available: boolean }> | undefined;
  const freeSlot = slots?.find((s) => s.available);
  expect(freeSlot, 'no free slot available on the target Saturday').toBeTruthy();
  const future = new Date(freeSlot!.starts_at);
  const ends = new Date(freeSlot!.ends_at);

  const guestNames = ['Ana Souza', 'Bruno Lima', 'Carla Ferreira'].join('\n');
  // Keep guest count small so desktop + mobile can both book the same slot without
  // exceeding the Party Room capacity of 40.
  const guestCount = 5;
  const created = await request.post(`${apiURL}/amenities/reservations`, {
    headers,
    data: {
      amenity_id: party.id,
      starts_at: future.toISOString(),
      ends_at: ends.toISOString(),
      expected_guests: guestCount,
      guest_list: guestNames,
      notes: 'Aniversário de 40 anos. Buffet chega 18h.',
    },
  });
  expect(created.ok(), `failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const body = (await created.json()).data;
  expect(body.expected_guests).toBe(guestCount);

  // Verify the list endpoint surfaces the new fields.
  const reservations = await request.get(`${apiURL}/amenities/reservations`, { headers });
  const rows = (await reservations.json()).data as Array<{ id: number; expected_guests: number | null; guest_list: string | null }>;
  const found = rows.find((r) => r.id === body.id);
  expect(found, 'created reservation missing from list').toBeTruthy();
  expect(found!.expected_guests).toBe(guestCount);
  expect(found!.guest_list).toContain('Ana Souza');
  expect(found!.guest_list).toContain('Bruno Lima');
});
