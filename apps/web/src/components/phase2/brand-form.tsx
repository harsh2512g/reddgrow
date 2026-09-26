'use client';

import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { ArrowRight, FlaskConical, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { brandInputSchema, demoBrand, type BrandInput } from '@threadsignal/knowledge';
import { FormField, PermissionNotice, ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import { createdSchema, knowledgeRequest, mutationSchema, requestMessage } from './api';
import { KnowledgeChecklist } from './primitives';
import type { Brand } from './types';
import { BrandExtraction } from './brand-extraction';

type Fields = z.input<typeof brandInputSchema>;
type TextName =
  | 'name'
  | 'website_url'
  | 'description'
  | 'value_proposition'
  | 'target_audience'
  | 'category'
  | 'pricing_url'
  | 'docs_url'
  | 'support_url'
  | 'custom_tone'
  | 'disclosure_text';
type ListName =
  'use_cases' | 'avoid_claims' | 'allowed_links' | 'countries' | 'keywords' | 'exclusions';
const emptyBrand: BrandInput = {
  name: '',
  website_url: '',
  description: '',
  value_proposition: '',
  target_audience: '',
  use_cases: [],
  category: '',
  pricing_url: '',
  docs_url: '',
  support_url: '',
  tone: 'Helpful and concise',
  custom_tone: '',
  reply_length: 'standard',
  real_role: 'founder',
  disclosure_text: '',
  avoid_claims: [],
  allowed_links: [],
  countries: [],
  competitors: [],
  keywords: [],
  exclusions: [],
};
const tones = [
  'Helpful and concise',
  'Technical',
  'Founder voice',
  'Product specialist',
  'Customer-support style',
  'Custom',
] as const;
const roles = [
  'founder',
  'employee',
  'developer advocate',
  'support',
  'contractor',
  'agency',
  'consultant',
  'other',
] as const;

export function BrandForm({
  brand,
  canManage,
  organizationId,
}: {
  brand?: Brand;
  canManage: boolean;
  organizationId: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [extractionChecksum, setExtractionChecksum] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Fields, unknown, BrandInput>({
    resolver: zodResolver(brandInputSchema),
    defaultValues: brand?.profile ?? emptyBrand,
  });
  const { fields: competitors, append, remove } = useFieldArray({ control, name: 'competitors' });
  const values = useWatch({ control });
  const validation = brandInputSchema.safeParse(values);
  const invalidFields = new Set(
    validation.success ? [] : validation.error.issues.map((issue) => issue.path[0]),
  );
  const validFields = (...names: string[]) => names.every((name) => !invalidFields.has(name));
  const checklist = [
    {
      label: 'Name and approved website',
      complete: Boolean(
        validFields('name', 'website_url') &&
        values.name &&
        values.name.length >= 2 &&
        values.website_url &&
        /^https:\/\//.test(values.website_url),
      ),
    },
    {
      label: 'Product and audience',
      complete: Boolean(
        validFields('description', 'value_proposition', 'target_audience', 'category') &&
        values.description &&
        values.description.length >= 10 &&
        values.value_proposition &&
        values.value_proposition.length >= 10 &&
        values.target_audience &&
        values.category,
      ),
    },
    {
      label: 'Use cases and countries',
      complete:
        validFields('use_cases', 'countries') &&
        Boolean(values.use_cases?.length && values.countries?.length),
    },
    {
      label: 'Transparent voice',
      complete: Boolean(
        validFields('tone', 'custom_tone', 'real_role', 'reply_length', 'disclosure_text') &&
        values.disclosure_text &&
        values.disclosure_text.length >= 10 &&
        values.real_role &&
        (values.tone !== 'Custom' || values.custom_tone?.trim()),
      ),
    },
    {
      label: 'Approved product links',
      complete: validFields('allowed_links') && Boolean(values.allowed_links?.length),
    },
  ];

  function textField(
    name: TextName,
    label: string,
    options: { long?: boolean; hint?: string; type?: string } = {},
  ) {
    const id = `brand-${name}`;
    const shared = {
      id,
      className: 'field-input',
      'aria-invalid': Boolean(errors[name]),
      'aria-describedby': errors[name] ? `${id}-error` : options.hint ? `${id}-hint` : undefined,
      ...register(name),
    };
    return (
      <FormField
        key={name}
        id={id}
        label={label}
        error={errors[name]?.message}
        {...(options.hint ? { hint: options.hint } : {})}
      >
        {options.long ? (
          <textarea {...shared} rows={3} />
        ) : (
          <input {...shared} type={options.type ?? 'text'} autoComplete="off" />
        )}
      </FormField>
    );
  }

  function listField(name: ListName, label: string, hint = 'One item per line.') {
    const id = `brand-${name}`;
    const error = errors[name];
    const message =
      error?.message ??
      (Array.isArray(error) ? error.find((item) => item?.message)?.message : undefined);
    return (
      <FormField key={name} id={id} label={label} hint={hint} error={message}>
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <textarea
              id={id}
              className="field-input"
              rows={3}
              name={field.name}
              ref={field.ref}
              onBlur={() => {
                field.onChange((field.value ?? []).map((item) => item.trim()).filter(Boolean));
                field.onBlur();
              }}
              value={(field.value ?? []).join('\n')}
              onChange={(event) => field.onChange(event.target.value.split('\n'))}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : `${id}-hint`}
            />
          )}
        />
      </FormField>
    );
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div>
        {!canManage && (
          <PermissionNotice>
            Only an organization owner or admin can change brand details. You can review this
            profile.
          </PermissionNotice>
        )}
        {brand && canManage && (
          <BrandExtraction
            brandId={brand.id}
            organizationId={organizationId}
            disabled={isSubmitting}
            onApply={(suggestions, checksum) => {
              for (const suggestion of suggestions) {
                const field = suggestion.field;
                if (field === 'use_cases' || field === 'keywords' || field === 'avoid_claims') {
                  if (Array.isArray(suggestion.value))
                    setValue(field, suggestion.value, { shouldDirty: true, shouldValidate: true });
                } else if (typeof suggestion.value === 'string')
                  setValue(field, suggestion.value, { shouldDirty: true, shouldValidate: true });
              }
              setExtractionChecksum(checksum);
            }}
          />
        )}
        <form
          noValidate
          className="space-y-6"
          onSubmit={handleSubmit(
            async (profile) => {
              if (!canManage) return;
              setResult(null);
              try {
                if (brand) {
                  await knowledgeRequest(`/api/brands/${brand.id}`, mutationSchema, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      profile,
                      ...(extractionChecksum
                        ? { extraction: { checksum: extractionChecksum } }
                        : {}),
                    }),
                  });
                  setResult({ status: 'success', message: 'Your brand profile has been saved.' });
                  setExtractionChecksum(null);
                  router.refresh();
                } else {
                  const created = await knowledgeRequest('/api/brands', createdSchema, {
                    method: 'POST',
                    headers: { 'X-ThreadSignal-Organization': organizationId },
                    body: JSON.stringify(profile),
                  });
                  setResult({
                    status: 'success',
                    message: 'Brand created. Add your first knowledge source next.',
                  });
                  router.push(`/app/knowledge?brandId=${encodeURIComponent(created.id)}`);
                  router.refresh();
                }
              } catch (error) {
                setResult({ status: 'error', message: requestMessage(error) });
              }
            },
            () =>
              setResult({
                status: 'error',
                message: 'Check the highlighted fields before saving your brand.',
              }),
          )}
        >
          {!brand && canManage && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <FlaskConical size={17} className="text-primary" /> Explore with a synthetic
                    product
                  </p>
                  <p className="mt-2 max-w-lg text-xs leading-6 text-muted-foreground">
                    ClarityScale AI is our fictional demo. It includes an approved fixture website
                    for development ingestion.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => {
                    reset(structuredClone(demoBrand));
                    setResult({
                      status: 'success',
                      message: 'Synthetic demo details loaded. Review them, then create the brand.',
                    });
                  }}
                >
                  Use synthetic demo
                </Button>
              </div>
            </div>
          )}
          <fieldset disabled={!canManage || isSubmitting} className="space-y-6">
            <section className="panel space-y-6 p-6 sm:p-7">
              <SectionTitle
                number="01"
                title="The product, in your own words"
                detail="Clear, specific details become the foundation of your knowledge base."
              />
              <div className="grid gap-6 sm:grid-cols-2">
                {textField('name', 'Brand name')}
                {textField('website_url', 'Approved website', {
                  type: 'url',
                  hint: 'An HTTPS website you are authorized to use.',
                })}
              </div>
              {textField('description', 'Short product description', { long: true })}
              {textField('value_proposition', 'Main value proposition', { long: true })}
              <div className="grid gap-6 sm:grid-cols-2">
                {textField('target_audience', 'Target audience', { long: true })}
                {textField('category', 'Product category')}
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                {listField('use_cases', 'Primary use cases')}
                {listField('countries', 'Countries served')}
              </div>
            </section>
            <section className="panel space-y-6 p-6 sm:p-7">
              <SectionTitle
                number="02"
                title="A voice with an honest point of view"
                detail="Tone describes how you communicate. Your role and affiliation must reflect reality."
              />
              <div className="grid gap-6 sm:grid-cols-2">
                <FormField id="brand-tone" label="Preferred tone" error={errors.tone?.message}>
                  <select id="brand-tone" className="field-input" {...register('tone')}>
                    {tones.map((tone) => (
                      <option key={tone}>{tone}</option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  id="brand-role"
                  label="Your real relationship to the product"
                  error={errors.real_role?.message}
                >
                  <select
                    id="brand-role"
                    className="field-input capitalize"
                    {...register('real_role')}
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              {values.tone === 'Custom' &&
                textField('custom_tone', 'Describe your custom tone', { long: true })}
              <FormField
                id="brand-length"
                label="Preferred reply length"
                error={errors.reply_length?.message}
              >
                <select
                  id="brand-length"
                  className="field-input sm:max-w-xs"
                  {...register('reply_length')}
                >
                  <option value="concise">Concise</option>
                  <option value="standard">Standard</option>
                  <option value="detailed">Detailed</option>
                </select>
              </FormField>
              {textField('disclosure_text', 'Affiliation disclosure', {
                long: true,
                hint: 'For example: “I am one of the founders of ProductName.”',
              })}
              {listField(
                'avoid_claims',
                'Words or claims to avoid',
                'One limitation, unsupported claim, or phrase per line.',
              )}
            </section>
            <section className="panel space-y-6 p-6 sm:p-7">
              <SectionTitle
                number="03"
                title="Keep the evidence close"
                detail="Add approved product links and the places where your team documents the facts."
              />
              <div className="grid gap-6 sm:grid-cols-2">
                {textField('pricing_url', 'Pricing URL (optional)', { type: 'url' })}
                {textField('docs_url', 'Documentation URL (optional)', { type: 'url' })}
              </div>
              {textField('support_url', 'Support URL (optional)', { type: 'url' })}
              {listField(
                'allowed_links',
                'Approved product links',
                'One HTTPS URL per line, on the same domain as your approved website.',
              )}
            </section>
            <section className="panel space-y-6 p-6 sm:p-7">
              <SectionTitle
                number="04"
                title="The wider product landscape"
                detail="Document competitors and vocabulary. These details describe your product; they do not start monitoring."
              />
              {competitors.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No competitors added. Add them when relevant to your product.
                </p>
              )}
              {competitors.map((competitor, index) => (
                <div
                  key={competitor.id}
                  className="space-y-4 rounded-xl border border-border bg-muted/30 p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">Competitor {index + 1}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove competitor ${index + 1}`}
                      onClick={() => remove(index)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      id={`competitor-${index}-name`}
                      label="Competitor name"
                      error={errors.competitors?.[index]?.name?.message}
                    >
                      <input
                        id={`competitor-${index}-name`}
                        className="field-input"
                        {...register(`competitors.${index}.name`)}
                      />
                    </FormField>
                    <FormField
                      id={`competitor-${index}-domain`}
                      label="Competitor website"
                      error={errors.competitors?.[index]?.domain?.message}
                    >
                      <input
                        id={`competitor-${index}-domain`}
                        type="url"
                        className="field-input"
                        {...register(`competitors.${index}.domain`)}
                      />
                    </FormField>
                  </div>
                  <FormField
                    id={`competitor-${index}-aliases`}
                    label="Aliases and common misspellings"
                    hint="One name per line."
                    error={errors.competitors?.[index]?.aliases?.message}
                  >
                    <Controller
                      control={control}
                      name={`competitors.${index}.aliases`}
                      render={({ field }) => (
                        <textarea
                          id={`competitor-${index}-aliases`}
                          rows={2}
                          className="field-input"
                          {...field}
                          value={(field.value ?? []).join('\n')}
                          onChange={(event) => field.onChange(event.target.value.split('\n'))}
                          onBlur={() => {
                            field.onChange(
                              (field.value ?? []).map((item) => item.trim()).filter(Boolean),
                            );
                            field.onBlur();
                          }}
                        />
                      )}
                    />
                  </FormField>
                  <FormField
                    id={`competitor-${index}-notes`}
                    label="Competitor notes (optional)"
                    error={errors.competitors?.[index]?.notes?.message}
                    hint="Record comparison context without inventing claims about another product."
                  >
                    <textarea
                      id={`competitor-${index}-notes`}
                      rows={3}
                      maxLength={2000}
                      className="field-input"
                      {...register(`competitors.${index}.notes`)}
                    />
                  </FormField>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={competitors.length >= 20}
                onClick={() => append({ name: '', domain: '', aliases: [], notes: '' })}
              >
                <Plus size={15} /> Add competitor
              </Button>
              <div className="grid gap-6 sm:grid-cols-2">
                {listField('keywords', 'Product vocabulary')}
                {listField('exclusions', 'Excluded topics')}
              </div>
            </section>
          </fieldset>
          <ResultNotice result={result} />
          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5">
              <p className="max-w-sm text-xs leading-6 text-muted-foreground">
                Your organization’s plan limits apply. Customer details stay inside this workspace.
              </p>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving brand…' : brand ? 'Save brand profile' : 'Create brand'}
                {brand ? <Save size={16} /> : <ArrowRight size={16} />}
              </Button>
            </div>
          )}
        </form>
      </div>
      <div className="space-y-5 xl:sticky xl:top-28">
        <KnowledgeChecklist items={checklist} />
        <div className="rounded-2xl border border-border bg-white/50 p-5">
          <p className="font-editorial text-xl italic text-primary">Specific beats spectacular.</p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Use real capabilities, honest limitations, and sources you can stand behind. You can
            refine this profile as your product evolves.
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-2 flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-violet-50 font-mono text-[10px] text-primary">
        {number}
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
