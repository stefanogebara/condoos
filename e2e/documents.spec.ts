import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { credentialsFor } from './support/credentials';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');
const apiOrigin = apiURL.replace(/\/api\/?$/, '');

type Session = { token: string; user: any };

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Session;
}

async function loginRole(request: APIRequestContext, role: 'admin' | 'resident'): Promise<Session> {
  const creds = credentialsFor(role);
  return loginApi(request, creds.email, creds.password);
}

async function setSession(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('admin publishes a resident-visible document and resident can open it', async ({ page, request }) => {
  const admin = await loginRole(request, 'admin');
  const resident = await loginRole(request, 'resident');
  const title = `Resident handbook ${Date.now()}`;
  let docId: number | undefined;

  try {
    await setSession(page, admin);
    await page.goto('/board/documents');
    await expect(page.getByRole('heading', { level: 1, name: /Documents|Documentos/i })).toBeVisible();
    await page.getByRole('button', { name: /New document|Nuevo documento|Novo documento/i }).click();
    await expect(page.getByTestId('document-editor')).toBeVisible();
    await page.getByTestId('document-title').fill(title);
    await page.getByTestId('document-category').selectOption('rules');
    await page.getByTestId('document-date').fill('2026-05-13');
    await page.getByTestId('document-url').fill('https://example.com/condoos-resident-handbook.pdf');
    await page.getByTestId('document-description').fill('Resident-visible building document for E2E coverage.');
    await page.getByRole('button', { name: /Save|Guardar|Salvar/i }).click();
    await expect(page.getByText(/Document published|Documento publicado/i)).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();

    const listed = await request.get(`${apiURL}/documents?include_inactive=1`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(listed.ok(), `document list failed: ${listed.status()} ${await listed.text()}`).toBeTruthy();
    const docs = (await listed.json()).data as Array<{ id: number; title: string }>;
    docId = docs.find((doc) => doc.title === title)?.id;
    expect(docId, 'created document id').toBeTruthy();

    await setSession(page, resident);
    await page.goto('/app/documents');
    await expect(page.getByRole('heading', { level: 1, name: /Documents|Documentos/i })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByRole('link', { name: /open document|abrir documento/i }).first()).toHaveAttribute(
      'href',
      'https://example.com/condoos-resident-handbook.pdf',
    );
  } finally {
    if (docId) {
      await request.delete(`${apiURL}/documents/${docId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
    }
  }
});

test('board-only documents stay hidden from residents', async ({ page, request }) => {
  const admin = await loginRole(request, 'admin');
  const resident = await loginRole(request, 'resident');
  const title = `Board contract ${Date.now()}`;
  let docId: number | undefined;

  try {
    const created = await request.post(`${apiURL}/documents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        title,
        category: 'contracts',
        description: 'Board-only E2E document',
        file_url: 'https://example.com/board-only-contract.pdf',
        document_date: '2026-05-13',
        visibility: 'board_only',
        active: true,
      },
    });
    expect(created.ok(), `document create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
    docId = (await created.json()).data.id;

    await setSession(page, admin);
    await page.goto('/board/documents');
    await expect(page.getByText(title)).toBeVisible();

    await setSession(page, resident);
    await page.goto('/app/documents');
    await expect(page.getByText(title)).toHaveCount(0);
  } finally {
    if (docId) {
      await request.delete(`${apiURL}/documents/${docId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
    }
  }
});

test('uploaded document shows a size chip on both board and resident views (Phase 3)', async ({ page, request }) => {
  const admin = await loginRole(request, 'admin');
  const resident = await loginRole(request, 'resident');
  const title = `Phase3 size chip ${Date.now()}`;
  const bytes = Buffer.from('A'.repeat(4096));
  let docId: number | undefined;
  let fileId: number | undefined;

  try {
    const presign = await request.post(`${apiURL}/uploads/presign`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        filename: 'phase3.txt',
        content_type: 'text/plain',
        size_bytes: bytes.length,
        purpose: 'document',
        visibility: 'residents',
      },
    });
    expect(presign.ok()).toBeTruthy();
    const presigned = (await presign.json()).data;
    fileId = presigned.file.id;
    const uploadUrl = String(presigned.upload_url).startsWith('http')
      ? presigned.upload_url
      : `${apiOrigin}${presigned.upload_url}`;
    await request.put(uploadUrl, {
      headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'text/plain' },
      data: bytes,
    });
    await request.post(`${apiURL}/uploads/complete`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { file_id: fileId },
    });

    const created = await request.post(`${apiURL}/documents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        title,
        category: 'rules',
        file_id: fileId,
        visibility: 'residents',
        active: true,
      },
    });
    expect(created.ok()).toBeTruthy();
    docId = (await created.json()).data.id;

    // Board view — uploaded row shows the size chip with the testid
    // we added in Phase 3. 4096 bytes → "4.0 KB".
    await setSession(page, admin);
    await page.goto('/board/documents');
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByTestId(`board-document-${docId}-size`)).toContainText(/KB|kB/i);

    // Resident view — same chip + same content.
    await setSession(page, resident);
    await page.goto('/app/documents');
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByTestId(`resident-document-${docId}-size`)).toContainText(/KB|kB/i);
  } finally {
    if (docId) await request.delete(`${apiURL}/documents/${docId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    if (fileId) await request.delete(`${apiURL}/uploads/files/${fileId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
  }
});

test('admin uploads a document file and resident can download the stored copy', async ({ page, request }) => {
  const admin = await loginRole(request, 'admin');
  const resident = await loginRole(request, 'resident');
  const title = `Uploaded bylaws ${Date.now()}`;
  const bytes = Buffer.from('CondoOS uploaded bylaws fixture\n');
  let docId: number | undefined;
  let fileId: number | undefined;

  try {
    const presign = await request.post(`${apiURL}/uploads/presign`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        filename: 'bylaws-fixture.txt',
        content_type: 'text/plain',
        size_bytes: bytes.length,
        purpose: 'document',
        visibility: 'residents',
      },
    });
    expect(presign.ok(), `presign failed: ${presign.status()} ${await presign.text()}`).toBeTruthy();
    const presigned = (await presign.json()).data;
    fileId = presigned.file.id;

    const uploadUrl = String(presigned.upload_url).startsWith('http')
      ? presigned.upload_url
      : `${apiOrigin}${presigned.upload_url}`;
    const uploaded = await request.put(uploadUrl, {
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'text/plain',
      },
      data: bytes,
    });
    expect(uploaded.ok(), `upload failed: ${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();

    const completed = await request.post(`${apiURL}/uploads/complete`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { file_id: fileId },
    });
    expect(completed.ok(), `complete failed: ${completed.status()} ${await completed.text()}`).toBeTruthy();

    const created = await request.post(`${apiURL}/documents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        title,
        category: 'rules',
        description: 'Uploaded document E2E fixture',
        file_id: fileId,
        document_date: '2026-05-14',
        visibility: 'residents',
        active: true,
      },
    });
    expect(created.ok(), `document create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
    docId = (await created.json()).data.id;

    await setSession(page, resident);
    await page.goto('/app/documents');
    await expect(page.getByText(title)).toBeVisible();

    const downloaded = await request.get(`${apiURL}/uploads/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${resident.token}` },
    });
    expect(downloaded.ok(), `download failed: ${downloaded.status()} ${await downloaded.text()}`).toBeTruthy();
    expect(await downloaded.text()).toBe(bytes.toString());
  } finally {
    if (docId) {
      await request.delete(`${apiURL}/documents/${docId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
    }
    if (fileId) {
      await request.delete(`${apiURL}/uploads/files/${fileId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
    }
  }
});
