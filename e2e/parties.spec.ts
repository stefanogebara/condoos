// Party guest-list (#10): amenity reservations now accept expected_guests +
// guest_list + notes so the porteiro can admit by name without phoning.
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Amenity = {
  id: number;
  name: string;
  capacity: number;
  booking_window_days: number;
};

type Slot = {
  starts_at: string;
  ends_at: string;
  available: boolean;
  available_spots: number;
};

async function residentToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'resident@condoos.dev', password: 'resident123' },
  });
  await expectOk(r, 'resident login');
  return (await r.json()).data.token;
}

async function expectOk(response: Awaited<ReturnType<APIRequestContext['get']>>, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

test('Parties API: amenity reservation accepts guest list + count', async ({ request }) => {
  const token = await residentToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Find the Party Room (or any party-ish amenity).
  const amenities = await request.get(`${apiURL}/amenities`, { headers });
  await expectOk(amenities, 'amenities');
  const list = (await amenities.json()).data as Amenity[];
  const party = list.find((a) => /Party Room|Salão|Salao|Festa/i.test(a.name)) || list[0];
  expect(party, 'no amenity available to test').toBeTruthy();

  // Reservations must match the admin-configured slot duration. Use the new
  // slots endpoint instead of hardcoding a multi-hour party window.
  let selected: Slot | undefined;
  const maxDays = Math.min(Math.max(1, party.booking_window_days || 14), 14);
  for (let offset = 1; offset <= maxDays; offset += 1) {
    const date = isoDate(offset);
    const slots = await request.get(`${apiURL}/amenities/${party.id}/slots?date=${date}`, { headers });
    await expectOk(slots, 'slots');
    const rows = (await slots.json()).data.slots as Slot[];
    selected = rows.find((s) => s.available && s.available_spots >= 2);
    if (selected) break;
  }
  test.skip(!selected, `no available slot with guest capacity for ${party.name}`);

  const expectedGuests = Math.min(3, Math.max(1, selected!.available_spots - 1));
  const guestNames = ['Ana Souza', 'Bruno Lima', 'Carla Ferreira'].slice(0, expectedGuests).join('\n');
  let reservationId: number | undefined;
  const created = await request.post(`${apiURL}/amenities/reservations`, {
    headers,
    data: {
      amenity_id: party.id,
      starts_at: selected!.starts_at,
      ends_at: selected!.ends_at,
      expected_guests: expectedGuests,
      guest_list: guestNames,
      notes: 'E2E party guest-list validation.',
    },
  });
  await expectOk(created, 'create reservation');
  const body = (await created.json()).data;
  reservationId = body.id;
  expect(body.expected_guests).toBe(expectedGuests);

  try {
    // Verify the list endpoint surfaces the new fields.
    const reservations = await request.get(`${apiURL}/amenities/reservations`, { headers });
    await expectOk(reservations, 'reservations');
    const rows = (await reservations.json()).data as Array<{ id: number; expected_guests: number | null; guest_list: string | null }>;
    const found = rows.find((r) => r.id === body.id);
    expect(found, 'created reservation missing from list').toBeTruthy();
    expect(found!.expected_guests).toBe(expectedGuests);
    expect(found!.guest_list).toContain('Ana Souza');
  } finally {
    if (reservationId) {
      await request.delete(`${apiURL}/amenities/reservations/${reservationId}`, { headers });
    }
  }
});
