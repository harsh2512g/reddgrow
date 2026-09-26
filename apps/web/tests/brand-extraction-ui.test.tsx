import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandExtraction } from '../src/components/phase2/brand-extraction';
const apply = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const checksum = 'a'.repeat(64);
const preview = {
  checksum,
  provider: 'mock',
  limited: false,
  documents: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      source_id: '20000000-0000-4000-8000-000000000001',
      title: 'Product guide',
    },
  ],
  suggestions: [
    {
      field: 'description',
      value: 'A supported product description.',
      citations: [
        {
          document_id: '10000000-0000-4000-8000-000000000001',
          quote: 'A supported product description.',
        },
      ],
    },
  ],
};
beforeEach(() => {
  apply.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
describe('reviewing brand suggestions', () => {
  it('requires explicit field selection and a current-evidence check before editing the form', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: preview }))
      .mockResolvedValueOnce(Response.json({ data: { current: true } }));
    render(
      <BrandExtraction
        brandId="brand"
        organizationId="organization"
        disabled={false}
        onApply={apply}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Suggest product details' }));
    expect(await screen.findByRole('link', { name: 'Product guide' })).toHaveAttribute(
      'href',
      '/app/knowledge/20000000-0000-4000-8000-000000000001',
    );
    expect(apply).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Apply selected suggestions to form' }),
    ).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Replace Product description'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selected suggestions to form' }),
    );
    await waitFor(() => expect(apply).toHaveBeenCalledWith(preview.suggestions, checksum));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ operation: 'validate', checksum }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('then save the brand profile');
  });
  it('keeps form values unchanged when source evidence becomes stale', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: preview }))
      .mockResolvedValueOnce(
        Response.json({ error: { message: 'Your source evidence changed.' } }, { status: 409 }),
      );
    render(
      <BrandExtraction
        brandId="brand"
        organizationId="organization"
        disabled={false}
        onApply={apply}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Suggest product details' }));
    await userEvent.click(await screen.findByLabelText('Replace Product description'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selected suggestions to form' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Your source evidence changed.');
    expect(apply).not.toHaveBeenCalled();
  });
  it('explains empty evidence without inserting placeholder product details', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { ...preview, suggestions: [], documents: [] } }),
    );
    render(
      <BrandExtraction
        brandId="brand"
        organizationId="organization"
        disabled={false}
        onApply={apply}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Suggest product details' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No supported suggestions');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
});
