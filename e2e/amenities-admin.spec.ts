// Amenities admin: CRUD (create, rename, deactivate), resident access control,
// reservation overbooking protection.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const session = (await r.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

async function loginBrowser(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

const BASE_AMENITY = {
  name:                'E2E Sala de Jogos',
  description:         'Sala de jogos para testes.',
  icon:                '🎮',
  capacity:            10,
  open_hour:           8,
  close_hour:          22,
  slot_minutes:        60,
  booking_window_days: 30,
  active:              true,
};

// ---------------------------------------------------------------------------
// 1. Admin creates an amenity → appears in GET list
// ---------------------------------------------------------------------------

test('Amenities admin: admin creates amenity → visible in list', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const tag  = Date.now();
  const name = `${BASE_AMENITY.name} ${tag}`;

  const createRes = await request.post(`${apiURL}/amenities`, {
    headers: admH,
    data: { ...BASE_AMENITY, name },
  });
  expect(createRes.ok(), `create failed: ${createRes.status()} ${await createRes.text()}`).toBeTruthy();
  const amenityId: number = (await createRes.json()).data.id;
  expect(amenityId).toBeGreaterThan(0);

  // Admin list includes inactive=1 so the new one definitely shows
  const listRes  = await request.get(`${apiURL}/amenities?include_inactive=1`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(listRes.ok()).toBeTruthy();
  const list = (await listRes.json()).data as any[];
  expect(list.some((a: any) => a.id === amenityId)).toBe(true);
});

// ---------------------------------------------------------------------------
// 2. Admin renames amenity via PATCH
// ---------------------------------------------------------------------------

test('Amenities admin: admin can rename an amenity', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/amenities`, {
    headers: admH,
    data: { ...BASE_AMENITY, name: `E2E Rename Before ${Date.now()}` },
  });
  const amenityId: number = (await createRes.json()).data.id;
  const newName = `E2E Rename After ${Date.now()}`;

  const patchRes = await request.patch(`${apiURL}/amenities/${amenityId}`, {
    headers: admH,
    data: { ...BASE_AMENITY, name: newName },
  });
  expect(patchRes.ok(), `patch failed: ${patchRes.status()} ${await patchRes.text()}`).toBeTruthy();
  expect((await patchRes.json()).data.name).toBe(newName);
});

// ---------------------------------------------------------------------------
// 3. Admin deactivates amenity (soft-delete → active=0)
// ---------------------------------------------------------------------------

test('Amenities admin: admin deactivates amenity → active becomes 0', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/amenities`, {
    headers: admH,
    data: { ...BASE_AMENITY, name: `E2E Deactivate ${Date.now()}` },
  });
  const amenityId: number = (await createRes.json()).data.id;

  const delRes = await request.delete(`${apiURL}/amenities/${amenityId}`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(delRes.ok(), `delete failed: ${delRes.status()} ${await delRes.text()}`).toBeTruthy();
  expect((await delRes.json()).data.active).toBe(0);

  // No longer visible to residents (active=0)
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const resList  = await request.get(`${apiURL}/amenities`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  const list = (await resList.json()).data as any[];
  expect(list.some((a: any) => a.id === amenityId)).toBe(false);
});

// ---------------------------------------------------------------------------
// 4. Resident gets 403 on create, patch, and delete
// ---------------------------------------------------------------------------

test('Amenities admin: resident gets 403 on CRUD operations', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  // Create a real amenity to try to attack
  const createRes = await request.post(`${apiURL}/amenities`, {
    headers: admH,
    data: { ...BASE_AMENITY, name: `E2E RBAC Target ${Date.now()}` },
  });
  const amenityId: number = (await createRes.json()).data.id;

  const tryCreate = await request.post(`${apiURL}/amenities`, {
    headers: resH,
    data: { ...BASE_AMENITY, name: 'Resident attempt' },
  });
  expect(tryCreate.status()).toBe(403);

  const tryPatch = await request.patch(`${apiURL}/amenities/${amenityId}`, {
    headers: resH,
    data: { ...BASE_AMENITY, name: 'Resident overwrite' },
  });
  expect(tryPatch.status()).toBe(403);

  const tryDelete = await request.delete(`${apiURL}/amenities/${amenityId}`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  expect(tryDelete.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 5. Overbooking: second reservation for the same slot is rejected
// ---------------------------------------------------------------------------

test('Amenities admin: same-slot double reservation is rejected', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  // Create a fresh amenity with 1 slot per hour and capacity 1 so overbooking is guaranteed
  const amenityRes = await request.post(`${apiURL}/amenities`, {
    headers: admH,
    data: {
      ...BASE_AMENITY,
      name:         `E2E Overbook ${Date.now()}`,
      capacity:     1,
      slot_minutes: 60,
    },
  });
  const amenityId: number = (await amenityRes.json()).data.id;

  // Pick a date 3 days from now and find the first available slot
  const bookDate = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const dateStr  = bookDate.toISOString().slice(0, 10); // YYYY-MM-DD

  const slotsRes = await request.get(`${apiURL}/amenities/${amenityId}/slots?date=${dateStr}`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  expect(slotsRes.ok(), `slots failed: ${slotsRes.status()} ${await slotsRes.text()}`).toBeTruthy();
  // slots endpoint returns { data: { amenity_id, date, slots: [...] } }
  const slotsData = (await slotsRes.json()).data;
  const slots     = slotsData.slots as any[];
  const freeSlot  = slots.find((s: any) => s.available);
  if (!freeSlot) {
    test.skip(true, 'no free slots available 3 days out — environment may have reservations');
    return;
  }

  const bookPayload = {
    amenity_id:      amenityId,
    starts_at:       freeSlot.starts_at,
    ends_at:         freeSlot.ends_at,
    expected_guests: 0,
  };

  // First booking — should succeed
  const first = await request.post(`${apiURL}/amenities/reservations`, {
    headers: resH,
    data:    bookPayload,
  });
  expect(first.ok(), `first booking failed: ${first.status()} ${await first.text()}`).toBeTruthy();
  const firstReservationId: number = (await first.json()).data.id;

  // Second booking for the exact same slot — should be rejected
  const second = await request.post(`${apiURL}/amenities/reservations`, {
    headers: admH,
    data:    bookPayload,
  });
  expect(second.status()).toBeGreaterThanOrEqual(400);
  expect((await second.json()).success).toBe(false);

  const slotsAfterBooking = await request.get(`${apiURL}/amenities/${amenityId}/slots?date=${dateStr}`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  const updatedSlot = ((await slotsAfterBooking.json()).data.slots as any[])
    .find((s: any) => s.starts_at === freeSlot.starts_at);
  expect(updatedSlot.available).toBe(false);
  expect(updatedSlot.available_spots).toBe(0);

  await request.delete(`${apiURL}/amenities/reservations/${firstReservationId}`, { headers: resH });
  await request.delete(`${apiURL}/amenities/${amenityId}`, { headers: admH });
});

// ---------------------------------------------------------------------------
// 6. Admin can see and cancel upcoming reservations from /board/amenities
// ---------------------------------------------------------------------------

test('Amenities admin: board amenities page shows current reservations', async ({ page, request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };
  const name = `E2E Admin Visible ${Date.now()}`;
  let amenityId: number | undefined;
  let reservationId: number | undefined;

  try {
    const amenityRes = await request.post(`${apiURL}/amenities`, {
      headers: admH,
      data: {
        ...BASE_AMENITY,
        name,
        capacity: 2,
        slot_minutes: 60,
      },
    });
    expect(amenityRes.ok(), `amenity create failed: ${amenityRes.status()} ${await amenityRes.text()}`).toBeTruthy();
    amenityId = (await amenityRes.json()).data.id;

    const dateStr = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const slotsRes = await request.get(`${apiURL}/amenities/${amenityId}/slots?date=${dateStr}`, {
      headers: { Authorization: `Bearer ${resident.token}` },
    });
    const freeSlot = ((await slotsRes.json()).data.slots as any[]).find((s) => s.available);
    expect(freeSlot).toBeTruthy();

    const createdReservation = await request.post(`${apiURL}/amenities/reservations`, {
      headers: resH,
      data: {
        amenity_id: amenityId,
        starts_at: freeSlot.starts_at,
        ends_at: freeSlot.ends_at,
        expected_guests: 0,
      },
    });
    expect(createdReservation.ok(), `reservation create failed: ${createdReservation.status()} ${await createdReservation.text()}`).toBeTruthy();
    reservationId = (await createdReservation.json()).data.id;

    await loginBrowser(page, admin);
    await page.goto('/board/amenities');
    const reservationsPanel = page.getByTestId('admin-amenity-reservations');
    const reservationRow = page.getByTestId(`admin-amenity-reservation-${reservationId}`);
    await expect(reservationsPanel).toBeVisible();
    await expect(reservationRow).toBeVisible();
    await expect(reservationRow.getByText(name)).toBeVisible();
    await expect(reservationRow.getByText(/Maya|resident/i)).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await reservationRow.getByRole('button', { name: /Cancelar|Cancel/i }).click();
    await expect(page.getByText(/Reserva cancelada|Reservation cancelled/i)).toBeVisible();
    const rows = (await (await request.get(`${apiURL}/amenities/reservations`, { headers: resH })).json()).data as Array<{ id: number; status: string }>;
    expect(rows.find((r) => r.id === reservationId)?.status).toBe('cancelled');
  } finally {
    if (reservationId) {
      await request.delete(`${apiURL}/amenities/reservations/${reservationId}`, { headers: resH });
    }
    if (amenityId) {
      await request.delete(`${apiURL}/amenities/${amenityId}`, { headers: admH });
    }
  }
});
