'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { ArrowRight, FileUp, Globe2, NotebookPen, SearchCheck } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import {
  MAX_UPLOAD_BYTES,
  MAX_TEXT_LENGTH,
  sourceInputSchema,
  publicWebsite,
} from '@threadsignal/knowledge';
import { FormField, ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import { createdSchema, knowledgeRequest, requestMessage } from './api';
import type { Brand } from './types';

const pagesSchema = z.object({
  pages: z
    .array(
      z.object({
        url: publicWebsite,
        title: z.string().max(500),
        description: z.string().max(2000).optional(),
      }),
    )
    .max(100),
});
type FixturePage = z.infer<typeof pagesSchema>['pages'][number];
type SourceType = 'website' | 'webpage' | 'file' | 'manual';
const sourceOptions = [
  { value: 'website', label: 'Website', detail: 'Select approved pages', icon: Globe2 },
  { value: 'webpage', label: 'Single page', detail: 'Focus on one source', icon: SearchCheck },
  { value: 'file', label: 'Upload', detail: 'PDF, Markdown, or text', icon: FileUp },
  { value: 'manual', label: 'Write a note', detail: 'Add product knowledge', icon: NotebookPen },
] as const;

export function SourceForm({ brand }: { brand: Brand }) {
  const router = useRouter();
  const [type, setType] = useState<SourceType>('website');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [pages, setPages] = useState<FixturePage[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function discover() {
    setDiscovering(true);
    setResult(null);
    try {
      const data = await knowledgeRequest(`/api/brands/${brand.id}/knowledge/pages`, pagesSchema);
      setPages(data.pages);
      setSelected([]);
      if (!data.pages.length)
        setResult({
          status: 'error',
          message:
            'No approved fixture pages are available for this website. Upload a document or add a note instead.',
        });
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <section className="panel overflow-hidden" id="add-source">
      <div className="border-b border-border p-6">
        <h2 className="text-lg font-semibold tracking-tight">Add something worth knowing.</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          Approved pages, private documents, and your team’s own product notes.
        </p>
      </div>
      <form
        className="space-y-6 p-6"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setErrors({});
          setResult(null);
          if (type === 'file') {
            if (name.trim().length < 2 || name.trim().length > 150) {
              setErrors({ name: 'Use a source name between 2 and 150 characters.' });
              return;
            }
            if (!file) {
              setErrors({ file: 'Choose a PDF, Markdown, or text file.' });
              return;
            }
            if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
              setErrors({ file: 'Choose a nonempty file of 10 MB or less.' });
              return;
            }
            if (!/\.(pdf|md|markdown|txt)$/i.test(file.name)) {
              setErrors({ file: 'Supported formats are PDF, Markdown, and plain text.' });
              return;
            }
          } else {
            const parsed = sourceInputSchema.safeParse({ name, type, pages: selected, text });
            if (!parsed.success) {
              setErrors(
                Object.fromEntries(
                  parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
                ),
              );
              return;
            }
          }
          setPending(true);
          try {
            let created: { id: string };
            if (type === 'file' && file) {
              const data = new FormData();
              data.set('name', name.trim());
              data.set('file', file);
              created = await knowledgeRequest(
                `/api/brands/${brand.id}/knowledge/upload`,
                createdSchema,
                { method: 'POST', body: data },
              );
            } else {
              const input = sourceInputSchema.parse({ name, type, pages: selected, text });
              created = await knowledgeRequest(`/api/brands/${brand.id}/knowledge`, createdSchema, {
                method: 'POST',
                body: JSON.stringify(input),
              });
            }
            setResult({
              status: 'success',
              message: 'Your source is queued. Opening its processing details…',
            });
            router.push(`/app/knowledge/${encodeURIComponent(created.id)}`);
            router.refresh();
          } catch (error) {
            setResult({ status: 'error', message: requestMessage(error) });
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={pending || discovering} className="space-y-6">
          <fieldset>
            <legend className="mb-3 text-sm font-semibold">Source type</legend>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {sourceOptions.map(({ value, label, detail, icon: Icon }) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${type === value ? 'border-primary bg-violet-50' : 'border-border hover:border-violet-300'}`}
                >
                  <span className="flex items-center justify-between">
                    <Icon size={19} className="text-primary" />
                    <input
                      type="radio"
                      name="source-type"
                      value={value}
                      checked={type === value}
                      className="size-4 accent-primary"
                      onChange={() => {
                        setType(value);
                        setSelected([]);
                        setErrors({});
                        setResult(null);
                      }}
                    />
                  </span>
                  <span className="mt-3 block text-sm font-semibold">{label}</span>
                  <span className="mt-1.5 block text-[11px] leading-5 text-muted-foreground">
                    {detail}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormField
            label="Source name"
            id="source-name"
            error={errors.name}
            hint="A title your team can recognize later."
          >
            <input
              id="source-name"
              className="field-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={150}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'source-name-error' : 'source-name-hint'}
            />
          </FormField>
          {(type === 'website' || type === 'webpage') && (
            <div className="rounded-xl border border-border bg-muted/25 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">Review before importing</p>
                  <p className="mt-2 max-w-lg text-xs leading-6 text-muted-foreground">
                    Website ingestion uses approved local fixtures. No external website is fetched.
                    The ClarityScale AI demo includes product, pricing, and documentation pages.
                  </p>
                  <p className="mt-2 break-all font-mono text-[11px] text-primary">
                    {brand.website_url}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void discover()}
                  disabled={discovering}
                >
                  {discovering
                    ? 'Finding pages…'
                    : pages
                      ? 'Refresh available pages'
                      : 'Find approved pages'}
                </Button>
              </div>
              {pages && pages.length > 0 && (
                <fieldset className="mt-5 space-y-2">
                  <legend className="mb-3 text-xs font-semibold">
                    {type === 'webpage' ? 'Choose one page' : 'Choose the pages you approve'} ·{' '}
                    {selected.length} selected
                  </legend>
                  {pages.map((page) => (
                    <label
                      key={page.url}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selected.includes(page.url) ? 'border-violet-200 bg-white' : 'border-transparent hover:bg-white'}`}
                    >
                      <input
                        type={type === 'webpage' ? 'radio' : 'checkbox'}
                        name="approved-pages"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={selected.includes(page.url)}
                        onChange={(event) =>
                          setSelected(
                            type === 'webpage'
                              ? [page.url]
                              : event.target.checked
                                ? [...selected, page.url]
                                : selected.filter((url) => url !== page.url),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{page.title}</span>
                        <span className="mt-1 block break-all text-[11px] leading-5 text-muted-foreground">
                          {page.url}
                        </span>
                        {page.description && (
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            {page.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {errors.pages && (
                <p role="alert" className="mt-3 text-xs text-red-700">
                  {errors.pages}
                </p>
              )}
            </div>
          )}
          {type === 'file' && (
            <FormField
              label="Private knowledge file"
              id="source-file"
              error={errors.file}
              hint="PDF, .md, .markdown, or .txt · Maximum 10 MB. Scanned or encrypted PDFs need a readable text version."
            >
              <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/35 p-6">
                <FileUp size={25} className="mb-4 text-primary" />
                <input
                  id="source-file"
                  type="file"
                  accept=".pdf,.md,.markdown,.txt,application/pdf,text/plain,text/markdown"
                  className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2 file:text-xs file:font-semibold file:text-primary"
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    setFile(next);
                    if (!name && next) setName(next.name.replace(/\.[^.]+$/, '').slice(0, 150));
                  }}
                  aria-invalid={Boolean(errors.file)}
                  aria-describedby={errors.file ? 'source-file-error' : 'source-file-hint'}
                />
                {file && (
                  <p className="mt-3 break-all text-xs text-muted-foreground">
                    {file.name} · {(file.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            </FormField>
          )}
          {type === 'manual' && (
            <FormField
              label="Product knowledge"
              id="source-text"
              error={errors.text}
              hint="Document facts, limitations, FAQs, or internal guidance. Avoid passwords, API keys, and personal data."
            >
              <textarea
                id="source-text"
                rows={10}
                className="field-input"
                maxLength={MAX_TEXT_LENGTH}
                value={text}
                onChange={(event) => setText(event.target.value)}
                aria-invalid={Boolean(errors.text)}
                aria-describedby={errors.text ? 'source-text-error' : 'source-text-hint'}
              />
              <p className="text-right font-mono text-[10px] text-muted-foreground">
                {text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()} characters
              </p>
            </FormField>
          )}
        </fieldset>
        <ResultNotice result={result} />
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
          <p className="max-w-md text-[11px] leading-6 text-muted-foreground">
            Files stay private. Only your approved content is included in this brand’s search.
          </p>
          <Button type="submit" disabled={pending || discovering}>
            {pending ? 'Adding source…' : 'Add knowledge source'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </section>
  );
}
