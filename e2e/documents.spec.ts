import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');

type Session = { token: string; user: any };

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Session;
}

async function setSession(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('admin publishes a resident-visible document and resident can open it', async ({ page, request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
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
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
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
