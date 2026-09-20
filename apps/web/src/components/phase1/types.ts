export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type ActionResult = { status: 'success' | 'error'; message: string; invitationUrl?: string };
export type FormAction = (data: FormData) => Promise<ActionResult>;

export type OrganizationValues = {
  name: string;
  slug: string;
  billingEmail: string;
  timezone: string;
  currency: string;
};

export type OrganizationOption = { id: string; name: string; role: Role };
export type Member = { id: string; email: string; role: Role; isCurrentUser?: boolean };
export type Invitation = { id: string; email: string; role: Role; expiresAt: string };
export type PlanCard = {
  id: string;
  name: string;
  price: string;
  description: string;
  limits: string[];
};
