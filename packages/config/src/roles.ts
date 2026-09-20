import { z } from 'zod';

export const organizationRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export type OrganizationPermission =
  | 'read'
  | 'manage_settings'
  | 'manage_members'
  | 'manage_billing'
  | 'request_data'
  | 'manage_ownership';

const PERMISSIONS: Readonly<Record<OrganizationRole, readonly OrganizationPermission[]>> = {
  owner: [
    'read',
    'manage_settings',
    'manage_members',
    'manage_billing',
    'request_data',
    'manage_ownership',
  ],
  admin: ['read', 'manage_settings', 'manage_members'],
  member: ['read'],
  viewer: ['read'],
};

/** UX helper only; every database mutation independently enforces membership and role. */
export function hasOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return PERMISSIONS[role].includes(permission);
}

export function canManageMember(actor: OrganizationRole, target: OrganizationRole): boolean {
  return actor === 'owner' || (actor === 'admin' && target !== 'owner');
}
