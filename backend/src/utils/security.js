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

export function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return 'Username must be 3-32 characters using letters, numbers and underscores.';
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email) {
  if (email === undefined || email === null) return null; // email is optional
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return 'Enter a valid email address.';
  }
  return null;
}

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
    displayName: user.displayName || null,
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