// accountLinking.js — resolve an external provider identity to one
// AgentFinance user.
//
// THE ACCOUNT-SAFETY RULES THIS ENFORCES
//
// 1. ONE PROVIDER ACCOUNT, ONE AGENTFINANCE USER, FOREVER.
//    (provider, providerUserId) is globally unique. If it is already attached to
//    a different user, linking is REFUSED with an explanation. The old code
//    looked the user up by `oauthId` and, failing that, fell through to email —
//    which could silently attach one person's provider account to another
//    person's account.
//
// 2. EMAIL IS NOT AN IDENTITY.
//    Linking by email is permitted ONLY when the provider asserts the address is
//    verified. An unverified provider email is attacker-controllable (Facebook
//    and X both permit user-supplied or unverified addresses), so treating it as
//    proof of ownership would be an account-takeover path. The previous code
//    linked on any email the provider returned.
//
// 3. NO SILENT MERGES.
//    Every path that would change which user a login resolves to is refused, not
//    performed quietly.

import prisma from '../prismaClient.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { defaultRole } from '../utils/security.js';

export class AccountLinkError extends Error {
  constructor(message, { status = 409, code = 'account_link_refused' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Look up an existing AuthIdentity for this provider account. */
export async function findIdentity(provider, providerUserId) {
  return prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider, providerUserId } },
  });
}

/**
 * Resolve a provider profile to a user, creating or linking as needed.
 *
 * Returns { user, created, linked } so the caller can report honestly which
 * happened instead of implying a new account every time.
 */
export async function resolveUserForProviderProfile(profile) {
  const provider = String(profile?.providerId || '').toLowerCase();
  const providerUserId = String(profile?.providerSubject || '').trim();

  if (!provider) {
    throw new AccountLinkError('This provider did not return an identity to link an account.', {
      status: 502,
      code: 'provider_identity_missing',
    });
  }
  if (!providerUserId) {
    throw new AccountLinkError('This provider did not return an identity to link an account.', {
      status: 502,
      code: 'provider_identity_missing',
    });
  }

  // 1) The provider account is already linked: sign that user in.
  const existing = await findIdentity(provider, providerUserId);
  if (existing) {
    await prisma.authIdentity.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date(), email: profile.email || existing.email },
    });
    const user = await prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user) {
      throw new AccountLinkError('This provider account is linked to an account that no longer exists.', {
        status: 409,
        code: 'linked_user_missing',
      });
    }
    return { user, created: false, linked: true };
  }

  // 2) Not linked yet. Linking to an existing local account is allowed only on a
  //    provider-asserted verified email.
  if (profile.email && profile.emailVerified) {
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      await attachIdentity({ userId: byEmail.id, provider, providerUserId, profile });
      return { user: byEmail, created: false, linked: true };
    }
  }

  // 3) A genuinely new AgentFinance user.
  const username = await deriveUniqueUsername(
    profile.name || (profile.email ? profile.email.split('@')[0] : null) || providerUserId,
  );
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const displayName = displayNameFor(profile.name);

  const user = await prisma.user.create({
    data: {
      username,
      email: profile.email || null,
      // Retained so an older deployed build can still resolve this login during a
      // rolling deploy. New multi-provider links live in AuthIdentity.
      oauthId: `${provider}:${providerUserId}`,
      passwordHash,
      role: defaultRole(),
      // A provider login asserts the email address, so it starts verified. Only
      // reached for profile.emailVerified === true (see step 2/3 ordering).
      ...(profile.email && profile.emailVerified ? { emailVerified: true } : {}),
      ...(displayName ? { displayName } : {}),
      identities: {
        create: {
          provider,
          providerUserId,
          email: profile.email || null,
          emailVerified: profile.emailVerified === true,
          lastLoginAt: new Date(),
        },
      },
    },
  });

  return { user, created: true, linked: false };
}

async function attachIdentity({ userId, provider, providerUserId, profile }) {
  try {
    await prisma.authIdentity.create({
      data: {
        userId,
        provider,
        providerUserId,
        email: profile.email || null,
        emailVerified: profile.emailVerified === true,
        lastLoginAt: new Date(),
      },
    });
  } catch (error) {
    // The unique index is the authority. A concurrent request won the race and
    // attached this provider account to a different user; refuse rather than
    // continue as if we had linked it.
    if (isUniqueViolation(error)) {
      throw new AccountLinkError(
        'This provider account is already linked to a different AgentFinance account.',
        { status: 409, code: 'provider_identity_already_linked' },
      );
    }
    throw error;
  }
}

function isUniqueViolation(error) {
  const code = error?.code || error?.meta?.code;
  return code === 'P2002' || code === 'P2010';
}

/** Every provider identity linked to a user, for a settings/audit view. */
export async function listIdentitiesForUser(userId) {
  const rows = await prisma.authIdentity.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    provider: row.provider,
    email: row.email,
    emailVerified: row.emailVerified,
    linkedAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  }));
}

/** Detach a provider identity. The password login is unaffected. */
export async function unlinkIdentity({ userId, provider }) {
  const target = String(provider || '').toLowerCase();
  if (!target) {
    throw new AccountLinkError('A provider is required to unlink.', { status: 400, code: 'provider_required' });
  }
  const identities = await listIdentitiesForUser(userId);
  if (identities.length <= 1) {
    throw new AccountLinkError(
      'This is your only sign-in method and cannot be unlinked. Set a password first.',
      { status: 409, code: 'last_identity' },
    );
  }
  const { count } = await prisma.authIdentity.deleteMany({ where: { userId, provider: target } });
  return { provider: target, unlinked: count > 0 };
}

async function deriveUniqueUsername(base) {
  const cleaned = String(base || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20) || 'user';

  let candidate = cleaned;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await prisma.user.findUnique({ where: { username: candidate } });
    if (!existing) return candidate;
    candidate = `${cleaned.slice(0, 18)}_${crypto.randomBytes(2).toString('hex')}`;
  }
  throw new AccountLinkError('Could not allocate a unique username.', {
    status: 500,
    code: 'username_allocation_failed',
  });
}

function displayNameFor(name) {
  const cleaned = String(name || '').trim();
  if (cleaned.length > 1 && cleaned.length <= 80) return cleaned;
  if (cleaned.length > 80) return cleaned.slice(0, 80);
  return null;
}
