'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { personaInputSchema, type DraftPersona } from '@threadsignal/drafts';
import { Button } from '@threadsignal/ui';
import { draftRequest, draftMessage, mutationIdSchema } from '@/lib/phase4/client';
import { PermissionNotice } from '../phase1/primitives';
const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
export function PersonaForm({
  persona,
  brandId,
  organizationId,
  canManage,
}: {
  persona: DraftPersona;
  brandId: string;
  organizationId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(personaInputSchema), defaultValues: persona });
  const custom = useWatch({ control, name: 'tone' }) === 'Custom';
  return (
    <form
      className="panel max-w-4xl p-6 sm:p-8"
      onSubmit={handleSubmit(async (value) => {
        setError(null);
        setNotice(null);
        try {
          await draftRequest(`/api/brands/${brandId}/persona`, mutationIdSchema, organizationId, {
            method: 'PATCH',
            body: JSON.stringify(value),
          });
          setNotice(
            'Persona saved. Existing drafts must be checked against this updated context before approval.',
          );
          router.refresh();
        } catch (issue) {
          setError(draftMessage(issue));
        }
      })}
    >
      {!canManage && (
        <PermissionNotice>
          Only workspace owners and admins can change the brand’s persona.
        </PermissionNotice>
      )}
      <h2 className="text-lg font-semibold">Your actual role. Your own voice.</h2>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">
        A persona controls writing preferences, not identity fabrication. Use your real affiliation
        and statements you can truthfully make.
      </p>
      <fieldset disabled={!canManage || isSubmitting} className="mt-7 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Display name
            <input {...register('name')} className="field-input mt-2" maxLength={100} />
          </label>
          <label className="text-xs font-semibold">
            Real role
            <select {...register('real_role')} className="field-input mt-2">
              {[
                'founder',
                'employee',
                'developer advocate',
                'support',
                'contractor',
                'agency',
                'consultant',
                'other',
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Tone
            <select {...register('tone')} className="field-input mt-2">
              {[
                'Helpful and concise',
                'Technical',
                'Founder voice',
                'Product specialist',
                'Customer-support style',
                'Custom',
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Technical depth
            <select {...register('technical_depth')} className="field-input mt-2">
              <option value="general">General audience</option>
              <option value="balanced">Balanced</option>
              <option value="technical">Technical</option>
            </select>
          </label>
          <label className="text-xs font-semibold">
            Default reply length
            <select {...register('reply_length')} className="field-input mt-2">
              {['concise', 'standard', 'detailed'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {custom && (
          <label className="block text-xs font-semibold">
            Custom tone
            <textarea
              {...register('custom_tone')}
              rows={3}
              maxLength={500}
              className="field-input mt-2"
            />
          </label>
        )}
        <label className="block text-xs font-semibold">
          Default affiliation disclosure
          <textarea
            {...register('default_disclosure')}
            rows={3}
            maxLength={500}
            className="field-input mt-2"
          />
          <span className="mt-2 block text-[10px] font-normal leading-5 text-muted-foreground">
            For example: “I work with the team behind your product.” This must describe your actual
            relationship.
          </span>
        </label>
        <label className="block text-xs font-semibold">
          Allowed first-person statements
          <textarea
            defaultValue={persona.allowed_first_person_statements.join('\n')}
            onChange={(event) =>
              setValue('allowed_first_person_statements', lines(event.target.value), {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            rows={4}
            maxLength={15000}
            className="field-input mt-2"
          />
          <span className="mt-2 block text-[10px] font-normal text-muted-foreground">
            One truthful statement per line. These are not permission to invent customer
            experiences.
          </span>
        </label>
        <label className="block text-xs font-semibold">
          Prohibited statements
          <textarea
            defaultValue={persona.prohibited_statements.join('\n')}
            onChange={(event) =>
              setValue('prohibited_statements', lines(event.target.value), {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            rows={4}
            maxLength={15000}
            className="field-input mt-2"
          />
        </label>
      </fieldset>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="mt-4 text-xs leading-6 text-red-800">
          Check the persona fields. Disclosure needs at least 10 characters; statements allow up to
          30 lines of 500 characters.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-xs leading-6 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-xs leading-6 text-emerald-800">
          {notice}
        </p>
      )}
      {canManage && (
        <Button type="submit" className="mt-6" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save persona'}
        </Button>
      )}
    </form>
  );
}
