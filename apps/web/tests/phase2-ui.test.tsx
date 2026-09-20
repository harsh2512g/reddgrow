import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandSchema, demoBrand, sourceSchema } from '@threadsignal/knowledge';
import { BrandForm } from '../src/components/phase2/brand-form';
import { BrandLibrary } from '../src/components/phase2/brand-library';
import { KnowledgeSearch } from '../src/components/phase2/knowledge-search';
import { ProcessingRefresh } from '../src/components/phase2/knowledge-list';
import { LocalKnowledgeNotice } from '../src/components/phase2/primitives';
import { SourceDetail } from '../src/components/phase2/source-detail';
import { SourceForm } from '../src/components/phase2/source-form';

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

const organizationId = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';
const brand = brandSchema.parse({
  id: brandId,
  organization_id: organizationId,
  name: demoBrand.name,
  website_url: demoBrand.website_url,
  profile: demoBrand,
  status: 'active',
  created_at: '2026-09-15T00:00:00Z',
});
const source = sourceSchema.parse({
  id: sourceId,
  organization_id: organizationId,
  brand_id: brandId,
  name: 'Product documentation',
  type: 'file',
  status: 'ready',
  source_url: null,
  storage_path: 'private/synthetic-file.md',
  filename: 'product.md',
  mime_type: 'text/markdown',
  error_code: null,
  page_count: 1,
  chunk_count: 3,
  generation: 1,
  created_at: '2026-09-15T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
  last_ingested_at: '2026-09-15T00:00:00Z',
  deleted_at: null,
});
const document = {
  id: documentId,
  title: 'Batch processing guide',
  canonical_url: 'https://clarityscale.example/docs',
  page_number: null,
  content:
    'The API supports batch image processing. Every image remains subject to source quality limits.',
  is_included: true,
  checksum: 'synthetic-checksum',
};
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

describe('brand profile workflows', () => {
  it('validates required product context before making a request', async () => {
    const user = userEvent.setup();
    render(<BrandForm canManage organizationId={organizationId} />);
    await user.click(screen.getByRole('button', { name: 'Create brand' }));
    expect(
      await screen.findByText('Check the highlighted fields before saving your brand.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits an explicitly selected synthetic profile with its rendered organization', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: brandId } }));
    render(<BrandForm canManage organizationId={organizationId} />);
    await user.click(screen.getByRole('button', { name: 'Use synthetic demo' }));
    expect(screen.getByLabelText('Brand name')).toHaveValue('ClarityScale AI');
    expect(screen.getByText(/Synthetic demo details loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create brand' }));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(`/app/knowledge?brandId=${brandId}`),
    );
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/brands');
    expect(init?.headers).toEqual(
      expect.objectContaining({ 'X-ThreadSignal-Organization': organizationId }),
    );
    expect(JSON.parse(String(init?.body))).toEqual(demoBrand);
  });

  it('allows optional lists to be cleared without leaving invalid empty strings', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: brandId } }));
    render(<BrandForm canManage organizationId={organizationId} />);
    await user.click(screen.getByRole('button', { name: 'Use synthetic demo' }));
    await user.clear(screen.getByLabelText('Excluded topics'));
    await user.click(screen.getByRole('button', { name: 'Create brand' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).exclusions).toEqual([]);
  });

  it('preserves a form when the server rejects a plan limit or workspace change', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'WORKSPACE_CHANGED',
            message: 'Your workspace changed. Reload before saving.',
          },
        },
        { status: 409 },
      ),
    );
    render(<BrandForm canManage organizationId={organizationId} />);
    await user.click(screen.getByRole('button', { name: 'Use synthetic demo' }));
    await user.click(screen.getByRole('button', { name: 'Create brand' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your workspace changed. Reload before saving.',
    );
    expect(screen.getByLabelText('Brand name')).toHaveValue('ClarityScale AI');
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('renders a readable profile without allowing member or viewer edits', () => {
    render(<BrandForm canManage={false} brand={brand} organizationId={organizationId} />);
    expect(screen.getByLabelText('Brand name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save brand profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Only an organization owner or admin');
  });

  it('shows real empty-state guidance without fabricating brand records', () => {
    render(<BrandLibrary brands={[]} organizationName="Test studio" canManage={false} />);
    expect(screen.getByText('0 active brands')).toBeInTheDocument();
    expect(screen.getByText(/Your organization has not created a brand yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add brand/ })).not.toBeInTheDocument();
  });
});

describe('knowledge ingestion controls', () => {
  it('requires explicit page approval before queueing a fixture crawl', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: { pages: [{ url: 'https://clarityscale.example/docs', title: 'Product guide' }] },
      }),
    );
    fetchMock.mockResolvedValueOnce(Response.json({ data: { id: sourceId } }));
    render(<SourceForm brand={brand} />);
    await user.type(screen.getByLabelText('Source name'), 'Approved product docs');
    await user.click(screen.getByRole('button', { name: 'Find approved pages' }));
    const approval = await screen.findByRole('checkbox', { name: /Product guide/ });
    expect(approval).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Add knowledge source' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select the approved pages');
    expect(fetchMock).toHaveBeenCalledOnce();
    await user.click(approval);
    await user.click(screen.getByRole('button', { name: 'Add knowledge source' }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/app/knowledge/${sourceId}`));
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe(`/api/brands/${brandId}/knowledge`);
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({ type: 'website', pages: ['https://clarityscale.example/docs'] }),
    );
  });

  it('adds a useful manual note through the source contract', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: sourceId } }));
    render(<SourceForm brand={brand} />);
    await user.click(screen.getByRole('radio', { name: /Write a note/ }));
    await user.type(screen.getByLabelText('Source name'), 'Image quality limitations');
    await user.type(
      screen.getByLabelText('Product knowledge'),
      'Image recovery depends on source resolution and cannot reconstruct all missing details.',
    );
    await user.click(screen.getByRole('button', { name: 'Add knowledge source' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual(
      expect.objectContaining({
        type: 'manual',
        text: expect.stringContaining('source resolution'),
      }),
    );
  });

  it('rejects files above 10 MB before uploading', async () => {
    const user = userEvent.setup();
    render(<SourceForm brand={brand} />);
    await user.click(screen.getByRole('radio', { name: /Upload/ }));
    const file = new File(['synthetic content'], 'large.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('Private knowledge file'), file);
    await user.click(screen.getByRole('button', { name: 'Add knowledge source' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('10 MB or less');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose source mutations to read-only roles', () => {
    render(<SourceDetail brand={brand} source={source} documents={[document]} canManage={false} />);
    expect(screen.getByText(document.content)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      `/api/knowledge/${sourceId}/download`,
    );
    expect(screen.queryByRole('button', { name: 'Exclude from search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete source' })).not.toBeInTheDocument();
  });

  it('requires confirmation before deleting a source', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: sourceId } }));
    render(<SourceDetail brand={brand} source={source} documents={[document]} canManage />);
    await user.click(screen.getByRole('button', { name: 'Delete source' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/knowledge/${sourceId}`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(navigation.push).toHaveBeenCalledWith(`/app/knowledge?brandId=${brandId}`);
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it('updates the selected document inclusion without submitting source text', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: documentId } }));
    render(<SourceDetail brand={brand} source={source} documents={[document]} canManage />);
    await user.click(screen.getByRole('button', { name: 'Exclude from search' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/knowledge/documents/${documentId}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ included: false });
  });

  it('offers cleanup retry when deletion leaves a failed private-file cleanup', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: sourceId } }));
    render(
      <SourceDetail
        brand={brand}
        source={{
          ...source,
          status: 'deleting',
          deleted_at: '2026-09-15T01:00:00Z',
          error_code: 'STORAGE_UNAVAILABLE',
        }}
        documents={[]}
        canManage
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Retry cleanup' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm cleanup retry' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/knowledge/${sourceId}`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('bounds automatic processing refreshes and offers a manual refresh afterward', async () => {
    vi.useFakeTimers();
    try {
      render(<ProcessingRefresh active version="fixture-generation-1" />);
      await act(async () => {
        vi.advanceTimersByTime(90_000);
      });
      expect(navigation.refresh).toHaveBeenCalledTimes(20);
      expect(screen.getByRole('status')).toHaveTextContent('Processing is taking longer');
      fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
      expect(navigation.refresh).toHaveBeenCalledTimes(21);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('knowledge search and hosted boundaries', () => {
  it('shows search provenance and labels deterministic relevance as mock', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            source_id: sourceId,
            document_id: documentId,
            title: document.title,
            source_url: document.canonical_url,
            page_number: 2,
            content: document.content,
            score: 0.82,
          },
        ],
      }),
    );
    render(<KnowledgeSearch brand={brand} />);
    await user.type(
      screen.getByLabelText(`Search ${brand.name} knowledge`),
      'batch API & limitations',
    );
    await user.click(screen.getByRole('button', { name: 'Search knowledge' }));
    expect(await screen.findByText('Mock relevance 0.82')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review source' })).toHaveAttribute(
      'href',
      `/app/knowledge/${sourceId}`,
    );
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `/api/knowledge/search?brandId=${brandId}&q=batch%20API%20%26%20limitations`,
    );
  });

  it('explains a successful empty search without inventing an answer', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: [] }));
    render(<KnowledgeSearch brand={brand} />);
    await user.type(screen.getByLabelText(`Search ${brand.name} knowledge`), 'unavailable feature');
    await user.click(screen.getByRole('button', { name: 'Search knowledge' }));
    expect(await screen.findByText('No matching knowledge yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Mock relevance \d/)).not.toBeInTheDocument();
  });

  it.each(['/app/brands', '/app/brands/new', '/app/knowledge', '/app/knowledge/search'] as const)(
    'offers the matching local destination %s without carrying hosted identities',
    (destination) => {
      render(<LocalKnowledgeNotice destination={destination} />);
      expect(
        screen.getByRole('heading', { name: 'Knowledge processing is not enabled here yet.' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Continue to local/ })).toHaveAttribute(
        'href',
        `http://127.0.0.1:3000${destination}`,
      );
      expect(screen.getByText(/Local brands and files stay separate/)).toBeInTheDocument();
      expect(
        screen.getByText('Your hosted sign-in does not sign you in locally.'),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
