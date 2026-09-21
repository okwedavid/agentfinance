// emailService.js — email verification abstraction (optional feature).
//
// Login is intentionally NOT gated on email verification; this only enables
// optional email confirmation. Delivery is no-op/skipped (with a log line)
// until SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM and an SMTP package are
// configured — so the feature is safe to ship without any email infrastructure.

import crypto from 'node:crypto';
import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';

export function issueEmailVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function getEmailProviderStatus() {
  const configured = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM,
  );
  return {
    configured,
    provider: process.env.SMTP_HOST ? 'smtp' : null,
    from: process.env.SMTP_FROM || null,
    verificationSupported: configured || process.env.NODE_ENV !== 'production',
  };
}

/**
 * Fire-and-forget verification delivery. Never throws for infrastructure
 * missing; returns a status object instead.
 */
export async function sendVerificationEmail({ email, username = null, token, baseUrl }) {
  if (!email) return { ok: false, reason: 'no-email' };

  const configured = getEmailProviderStatus().configured;
  if (!configured) {
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`[email] Verification link for ${username || email}: ${baseUrl}/auth/verify?token=${token}`);
    } else {
      logger.warn(`[email] SMTP not configured; verification email skipped for ${email}.`);
    }
    return { ok: true, delivered: false, reason: 'smtp-not-configured' };
  }

  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    logger.warn('[email] SMTP configured but nodemailer is not installed; verification email skipped.');
    return { ok: true, delivered: false, reason: 'nodemailer-missing' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: 'Verify your AgentFinance email',
      text: `Hi ${username || 'there'},\n\nVerify your email address to finish setting up your AgentFinance account:\n${baseUrl}/auth/verify?token=${token}\n\nIf you did not create this account, you can safely ignore this email.`,
    });
    return { ok: true, delivered: true };
  } catch (error) {
    logger.warn('[email] Verification email failed to send', error.message);
    return { ok: true, delivered: false, reason: 'send-failed' };
  }
}

export async function verifyEmailByToken(token) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { ok: false, error: 'No verification token provided.' };
  }
  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token.trim() } });
  if (!user) {
    return { ok: false, error: 'Invalid verification token.' };
  }
  if (user.emailVerificationExpiresAt && new Date(user.emailVerificationExpiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'This verification link has expired.' };
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerificationToken: null, emailVerificationExpiresAt: null },
  });
  return { ok: true, user: updated, email: updated.email };
}