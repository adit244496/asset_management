export const SUPERADMIN = 'superadmin';
export const ADMIN = 'admin';
export const VERIFIER = 'verifier';
export const VIEWER = 'viewer';
export const ASSIGNEE = 'assignee';

export const ALL_ROLES = [SUPERADMIN, ADMIN, VERIFIER, VIEWER, ASSIGNEE];

export const ROLE_LABELS = {
  [SUPERADMIN]: 'superadmin',
  [ADMIN]: 'admin',
  [VERIFIER]: 'verifier',
  [VIEWER]: 'viewer',
  [ASSIGNEE]: 'assignee',
};

export const ROLE_HINTS = {
  [SUPERADMIN]: 'Everything, including restore, permanent delete and clearing all data',
  [ADMIN]: 'Add, edit, import and scrap; manage master data and users',
  [VERIFIER]: 'Sees everything, edits records and verifies new entries — nothing else',
  [VIEWER]: 'Read-only — can see the register but change nothing',
  [ASSIGNEE]: 'Not an account — a name assets can be issued to. Cannot sign in',
};

export const isSuperadmin = (role) => role === SUPERADMIN;

export const isAdmin = (role) => role === SUPERADMIN || role === ADMIN;

export const canWrite = (role) => isAdmin(role);

export const VERIFY_ROLES = [SUPERADMIN, ADMIN, VERIFIER];
export const canVerify = (role) => VERIFY_ROLES.includes(role);

export const canDiscard = (role) => isAdmin(role);

export const canEdit = (role) => canWrite(role) || role === VERIFIER;

export function roleChangeError(current, requested) {
  if (!requested || requested === current) return null;
  if (current === ASSIGNEE) {
    return 'An assignee’s profile cannot be changed. Create a new account for this person instead.';
  }
  return null;
}

export function superadminGuardError(actorRole, targetRole, requestedRole) {
  if (actorRole === SUPERADMIN) return null;
  if (targetRole === SUPERADMIN) {
    return 'Only a superadmin can change a superadmin’s account.';
  }
  if (requestedRole === SUPERADMIN) {
    return 'Only a superadmin can grant the superadmin profile.';
  }
  return null;
}

export const grantableRoles = (actorRole) => (
  actorRole === SUPERADMIN ? ALL_ROLES : ALL_ROLES.filter((r) => r !== SUPERADMIN)
);

export const canManageAccount = (actorRole, targetRole) => (
  superadminGuardError(actorRole, targetRole) === null
);
