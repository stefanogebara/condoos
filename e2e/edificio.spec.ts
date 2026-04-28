// Building manager (Edifício) — admin can rename, add, remove units.
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'admin@condoos.dev', password: 'admin123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.token;
}

test('Edifício API: add → rename → delete unit', async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const blist = await request.get(`${apiURL}/buildings`, { headers });
  const buildings = (await blist.json()).data as Array<{ id: number; name: string }>;
  expect(buildings.length).toBeGreaterThan(0);
  const buildingId = buildings[0].id;

  // Add
  const addRes = await request.post(`${apiURL}/buildings/${buildingId}/units`, {
    headers, data: { number: 'E2E-EDIT-9001', floor: 90 },
  });
  expect(addRes.ok(), `add failed: ${addRes.status()} ${await addRes.text()}`).toBeTruthy();
  const created = (await addRes.json()).data as { id: number };

  // Rename
  const patchRes = await request.patch(`${apiURL}/units/${created.id}`, {
    headers, data: { number: 'E2E-EDIT-9001-R' },
  });
  expect(patchRes.ok()).toBeTruthy();
  const renamed = (await patchRes.json()).data;
  expect(renamed.number).toBe('E2E-EDIT-9001-R');

  // Duplicate number → 409
  const dupRes = await request.post(`${apiURL}/buildings/${buildingId}/units`, {
    headers, data: { number: 'E2E-EDIT-9001-R', floor: 90 },
  });
  expect(dupRes.status()).toBe(409);
  expect((await dupRes.json()).error).toBe('duplicate_number');

  // Delete
  const delRes = await request.delete(`${apiURL}/units/${created.id}`, { headers });
  expect(delRes.ok()).toBeTruthy();
});

test('Edifício API: cannot delete a unit with active claims', async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}` };

  const blist = await request.get(`${apiURL}/buildings`, { headers });
  const buildingId = ((await blist.json()).data as Array<{ id: number }>)[0].id;

  const ulist = await request.get(`${apiURL}/buildings/${buildingId}/units`, { headers });
  const units = (await ulist.json()).data as Array<{ id: number; active_claims: number }>;
  const claimed = units.find((u) => u.active_claims > 0);
  expect(claimed, 'demo seed should have at least one claimed unit').toBeTruthy();

  const delRes = await request.delete(`${apiURL}/units/${claimed!.id}`, { headers });
  expect(delRes.status()).toBe(409);
  expect((await delRes.json()).error).toBe('unit_has_active_claims');
});

test('Edifício API: rename empty block, delete a non-empty block fails 409', async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Create a fresh block to play with
  const created = await request.post(`${apiURL}/buildings`, {
    headers,
    data: { name: `E2E Block ${Date.now()}`, floors: 2, units_per_floor: 0 },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).data.id as number;

  // Rename
  const renamed = await request.patch(`${apiURL}/buildings/${id}`, {
    headers, data: { name: `E2E Block Renamed ${Date.now()}` },
  });
  expect(renamed.ok()).toBeTruthy();

  // Add a unit so the block is non-empty
  const addUnit = await request.post(`${apiURL}/buildings/${id}/units`, {
    headers, data: { number: 'TEMP', floor: 1 },
  });
  expect(addUnit.ok()).toBeTruthy();
  const unitId = (await addUnit.json()).data.id as number;

  // Delete the block — should 409
  const failedDel = await request.delete(`${apiURL}/buildings/${id}`, { headers });
  expect(failedDel.status()).toBe(409);
  expect((await failedDel.json()).error).toBe('building_has_units');

  // Clean up: remove the unit, then the block
  await request.delete(`${apiURL}/units/${unitId}`, { headers });
  const finalDel = await request.delete(`${apiURL}/buildings/${id}`, { headers });
  expect(finalDel.ok()).toBeTruthy();
});
