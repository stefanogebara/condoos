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
  const list = (await amenities.json()).data as Array<{ id: number; name: string; open_hour: number; close_hour: number }>;
  const party = list.find((a) => /Party Room|Salão|Salao|Festa/i.test(a.name)) || list[0];
  expect(party, 'no amenity available to test').toBeTruthy();

  // Future Saturday 19:00–23:00 in local time, clamped to amenity open hours.
  const future = new Date();
  future.setDate(future.getDate() + ((6 - future.getDay() + 7) % 7 || 7));
  const startH = Math.max(party.open_hour, 19);
  const endH = Math.min(party.close_hour, startH + 4);
  future.setHours(startH, 0, 0, 0);
  const ends = new Date(future);
  ends.setHours(endH, 0, 0, 0);

  const guestNames = ['Ana Souza', 'Bruno Lima', 'Carla Ferreira'].join('\n');
  const created = await request.post(`${apiURL}/amenities/reservations`, {
    headers,
    data: {
      amenity_id: party.id,
      starts_at: future.toISOString(),
      ends_at: ends.toISOString(),
      expected_guests: 30,
      guest_list: guestNames,
      notes: 'Aniversário de 40 anos. Buffet chega 18h.',
    },
  });
  expect(created.ok(), `failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const body = (await created.json()).data;
  expect(body.expected_guests).toBe(30);

  // Verify the list endpoint surfaces the new fields.
  const reservations = await request.get(`${apiURL}/amenities/reservations`, { headers });
  const rows = (await reservations.json()).data as Array<{ id: number; expected_guests: number | null; guest_list: string | null }>;
  const found = rows.find((r) => r.id === body.id);
  expect(found, 'created reservation missing from list').toBeTruthy();
  expect(found!.expected_guests).toBe(30);
  expect(found!.guest_list).toContain('Ana Souza');
  expect(found!.guest_list).toContain('Bruno Lima');
});
