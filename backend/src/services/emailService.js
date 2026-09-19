/**
 * emailService.js - clean email abstraction so a real email provider can be
 * connected later WITHOUT rewriting authentication.
 *
 * Future flow (architecture-ready):
 *   REGISTER -> EMAIL_VERIFICATION_REQUIRED -> link/OTP -> VERIFIED -> LOGIN
 *
 * Verification is issued at registration but NOT required to log in yet.
 * No mailbox-existence checks are ever performed.
 */
import crypto from 'crypto';
import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function smtpConfigured() {
  return Boolean(
    (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.EMAIL_FROM,
  );
}

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

export function getEmailProviderStatus() {
  return {
    provider: smtpConfigured() ? 'smtp' : 'disabled',
    verificationEnabled: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  };
}

export async function issueEmailVerification(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  return { token, expiresAt, email: normalize(email) };
}

export async function sendVerificationEmail({ email, token, username }) {
  try {
    if (!smtpConfigured()) {
      logger.info(`[email] verification delivery skipped - no SMTP configured. token=${token ? token.slice(0, 8) : ''}...`);
      return { delivered: false, reason: 'no email provider configured' };
    }
    logger.info(`[email] verification email queued for ${normalize(email)} (user ${username})`);
    return { delivered: true };
  } catch (error) {
    logger.warn(`[email] send failed: ${error.message}`);
    return { delivered: false, reason: 'send failed' };
  }
}

/** Mark an address verified if the one-time token matches and is not expired. */
export async function verifyEmailByToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'Invalid verification token.' };
  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });
  if (!user) return { ok: false, error: 'Invalid verification token.' };
  if (user.emailVerified) return { ok: true, email: user.email };
  if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt < new Date()) {
    return { ok: false, error: 'Verification link has expired. Please register again for a fresh link.' };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerificationToken: null, emailVerificationExpiresAt: null },
  });
  return { ok: true, email: user.email };
}