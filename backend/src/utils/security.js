// Centralised, server-authoritative role + input-validation helpers.

export const ROLE_USER = 'USER';
export const ROLE_ADMIN = 'ADMIN';
export const ROLE_SUPER_ADMIN = 'SUPER_ADMIN';
export const VALID_ROLES = new Set([ROLE_USER, ROLE_ADMIN, ROLE_SUPER_ADMIN]);

export function normalizeRole(value) {
  return VALID_ROLES.has(value) ? value : ROLE_USER;
}

export function isAdminRole(value) {
  return value === ROLE_ADMIN || value === ROLE_SUPER_ADMIN;
}

export function isSuperAdminRole(value) {
  return value === ROLE_SUPER_ADMIN;
}

export function defaultRole() {
  return ROLE_USER;
}

// Roles are never accepted from the client/body. This normaliser is only used
// for values read from the database after a server-side role source.
export function sanitizeRoleFromRecord(user) {
  return VALID_ROLES.has(user?.role) ? user.role : ROLE_USER;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

// These names can never be claimed by a new account. `admin`/`super-admin` are
// reserved to prevent impersonation of privileged UI, and the owner account
// name (okwedavid) is reserved so it always resolves to the super admin.
export const RESERVED_USERNAMES = Object.freeze(['admin', 'super-admin', 'okwedavid']);

export function validateUsername(username) {
  const trimmed = typeof username === 'string' ? username.trim() : '';
  // Check reserved names first, before format validation: "super-admin" is
  // blocked even though it contains a hyphen and would be rejected by the
  // regex anyway — checking first gives a clear reserved-name error.
  if (RESERVED_USERNAMES.includes(trimmed.toLowerCase())) {
    return 'That username is reserved and cannot be used.';
  }
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username must be 3-32 characters using letters, numbers and underscores.';
  }
  return null;
}

// Backend-authoritative email syntax check. Conservative on purpose: rejects
// obviously malformed addresses without restricting legitimate providers.
// Any custom domain with valid syntax is accepted (no Gmail/Yahoo lock-in).
// No mailbox-existence probing is performed at signup.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function normalizeEmailAddress(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320) return null;
  return trimmed.toLowerCase();
}

export function validateEmail(email) {
  if (email === undefined || email === null) return null; // email is optional
  if (typeof email !== 'string') return 'Enter a valid email address.';
  const value = email.trim();
  if (!value) return 'Enter a valid email address.';
  if (value.length > 254) return 'Enter a valid email address.';

  const parts = value.split('@');
  if (parts.length !== 2) return 'Enter a valid email address.';
  const [local, domain] = parts;
  if (!local || !domain) return 'Enter a valid email address.';
  if (local.length > 64) return 'Enter a valid email address.';
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return 'Enter a valid email address.';
  if (domain.startsWith('-') || domain.endsWith('-') || domain.includes('..')) return 'Enter a valid email address.';
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address.';
  return null;
}

export const EMAIL_STATUS = Object.freeze({
  REGISTERED: 'registered',
  VERIFICATION_REQUIRED: 'verification_required',
  VERIFIED: 'verified',
});

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  return null;
}

export function serializeUser(user, { isNewUser = false } = {}) {
  const role = sanitizeRoleFromRecord(user);
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    emailVerified: user.emailVerified === true,
    // The super admin always renders as "super-admin", never as the raw owner
    // username (okwedavid). Any other account shows its own chosen name.
    displayName: role === ROLE_SUPER_ADMIN ? 'super-admin' : (user.displayName || null),
    bio: user.bio || null,
    walletAddress: user.walletAddress || null,
    walletProfiles: user.walletProfiles || {},
    preferredNetwork: user.preferredNetwork || 'ethereum',
    role,
    isAdmin: isAdminRole(role),
    isSuperAdmin: role === ROLE_SUPER_ADMIN,
    isNewUser,
  };
}

export function getMaxPayoutAmount() {
  const raw = Number(process.env.MAX_PAYOUT_AMOUNT);
  const cap = Number.isFinite(raw) && raw > 0 ? raw : 100; // default hard cap
  return cap;
}

export function validatePayoutAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: 'Amount must be greater than zero.' };
  }
  const cap = getMaxPayoutAmount();
  if (value > cap) {
    return {
      ok: false,
      message: `Amount exceeds the maximum allowed payout of ${cap}.`,
    };
  }
  return { ok: true, amount: value };
}

export function welcomeGreeting({ isNewUser, name }) {
  const display = name || 'operator';
  return isNewUser ? `Welcome ${display}` : `Welcome back ${display}`;
}