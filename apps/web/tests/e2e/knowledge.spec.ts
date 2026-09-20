import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';
import { pdfFixture } from '../../../../fixtures/knowledge/pdf';

const origin = 'http://127.0.0.1:3000';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Knowledge journeys require verified project-local services.',
);
test.setTimeout(180_000);
async function waitForSource(page: Page) {
  await expect(page).toHaveURL(/\/app\/knowledge\/[a-f0-9-]{36}$/);
  const sourceId = z.uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45_000 });
  return sourceId;
}

test('brand knowledge ingests approved pages and private files, searches evidence, and cleans up', async ({
  page,
}) => {
  // The isolated runner supplies this only after checking the owned Colima services.
  const databaseUrl = process.env.DATABASE_URL;
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    !databaseUrl ||
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(databaseUrl)
  )
    throw new Error('Verified local test database required.');
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const identity = uniqueIdentity('knowledge');
  const sources: string[] = [];
  let brandId: string | undefined;
  try {
    await signInWithMagicLink(page, identity.email);
    const organizationId = await createWorkspace(page, identity);
    await page.goto('/app/brands/new');
    await page.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await expect(page.getByLabel('Brand name', { exact: true })).toHaveValue('ClarityScale AI');
    await page.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/knowledge\?brandId=/);
    brandId = z.uuid().parse(new URL(page.url()).searchParams.get('brandId'));
    await page.goto('/app/brands');
    await expect(page.getByRole('heading', { name: 'ClarityScale AI', exact: true })).toBeVisible();
    await page.screenshot({
      path: `.threadsignal/verification/phase2-brands-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.goto(`/app/knowledge?brandId=${brandId}`);
    await page.getByLabel('Source name', { exact: true }).fill('Approved website documentation');
    await page.getByRole('button', { name: 'Find approved pages', exact: true }).click();
    const pages = page.locator('input[name="approved-pages"]');
    await expect(pages).toHaveCount(6);
    for (const input of await pages.all()) await input.check();
    await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    const websiteId = await waitForSource(page);
    sources.push(websiteId);
    await page.screenshot({
      path: `.threadsignal/verification/phase2-source-${test.info().project.name}.png`,
      fullPage: true,
    });
    const before =
      await sql`select id,checksum from public.knowledge_chunks where source_id=${websiteId} order by id`;
    expect(before.length).toBeGreaterThanOrEqual(6);
    await page.getByRole('button', { name: 'Re-crawl approved pages', exact: true }).click();
    await expect
      .poll(
        async () => {
          const rows =
            await sql`select generation,status from public.knowledge_sources where id=${websiteId}`;
          return rows[0]?.generation === 2 && rows[0]?.status === 'ready';
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    expect(
      await sql`select id,checksum from public.knowledge_chunks where source_id=${websiteId} order by id`,
    ).toEqual(before);
    await page.goto(`/app/knowledge/search?brandId=${brandId}`);
    await page.getByLabel('Search ClarityScale AI knowledge').fill('batch image API limits');
    await page.getByRole('button', { name: 'Search knowledge', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Evidence for your question', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('https://clarityscale.example/docs', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // Only this synthetic product and test workspace are visible; Auth traces stay disabled.
    await page.screenshot({
      path: `.threadsignal/verification/phase2-search-${test.info().project.name}.png`,
      fullPage: true,
    });

    for (const fixture of [
      {
        name: 'Private PDF guide',
        filename: 'guide.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(
          pdfFixture('Private storage and batch image processing are supported.'),
        ),
      },
      {
        name: 'Markdown limits',
        filename: 'limits.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(
          '# Limits\nBatch uploads contain at most fifty images. Review image dimensions before sending.',
        ),
      },
      {
        name: 'Plain text guide',
        filename: 'guide.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          'Image optimization supports private storage and manual review of every output before publishing.',
        ),
      },
    ]) {
      await page.goto(`/app/knowledge?brandId=${brandId}`);
      await page.locator('input[name="source-type"][value="file"]').check();
      await page.getByLabel('Source name', { exact: true }).fill(fixture.name);
      await page.getByLabel('Private knowledge file').setInputFiles({
        name: fixture.filename,
        mimeType: fixture.mimeType,
        buffer: fixture.buffer,
      });
      await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
      const sourceId = await waitForSource(page);
      sources.push(sourceId);
      const original = await page.request.get(`/api/knowledge/${sourceId}/download`);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(fixture.buffer);
      await page.getByRole('button', { name: 'Exclude from search', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Include in search', exact: true }),
      ).toBeVisible();
      const excluded = await page.request.get(`/api/knowledge/search?brandId=${brandId}&q=private`);
      const rows = z
        .object({ data: z.array(z.object({ source_id: z.uuid() })) })
        .parse(await excluded.json());
      expect(rows.data.every((row) => row.source_id !== sourceId)).toBe(true);
      await page.getByRole('button', { name: 'Include in search', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Exclude from search', exact: true }),
      ).toBeVisible();
    }
    await page.goto(`/app/knowledge?brandId=${brandId}`);
    await page.locator('input[name="source-type"][value="manual"]').check();
    await page.getByLabel('Source name', { exact: true }).fill('Team product note');
    await page
      .getByLabel('Product knowledge', { exact: true })
      .fill(
        'The internal product team recommends reviewing image quality manually before sharing the optimized result.',
      );
    await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    sources.push(await waitForSource(page));
    expect(
      await sql`select id from public.brands where organization_id=${organizationId}`,
    ).toHaveLength(1);
    await page.getByRole('button', { name: 'Delete source', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect
      .poll(
        async () => {
          const rows =
            await sql`select id from public.knowledge_sources where id=${sources.at(-1)!}`;
          return rows.length;
        },
        { timeout: 20_000 },
      )
      .toBe(0);
    const unsafe = await page.request.post(`/api/brands/${brandId}/knowledge/upload`, {
      headers: { origin },
      multipart: {
        name: 'Unsafe PDF',
        file: {
          name: 'fake.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('<script>unsafe</script>'),
        },
      },
    });
    expect(unsafe.status()).toBe(400);
  } finally {
    try {
      if (brandId) {
        // Include a just-created source even if its readiness assertion failed.
        const created =
          await sql`select id from public.knowledge_sources where brand_id=${brandId}`;
        for (const row of created)
          await page.request.delete(`/api/knowledge/${z.uuid().parse(row.id)}`, {
            headers: { origin },
          });
        await expect
          .poll(
            async () => {
              const rows =
                await sql`select id from public.knowledge_sources where brand_id=${brandId!}`;
              return rows.length;
            },
            { timeout: 20_000 },
          )
          .toBe(0);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
});
