import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { randomUUID, randomBytes, randomInt, timingSafeEqual, createHmac } from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { financeLedger, FinanceLedgerEngine } from './src/server/financeLedger.js';
export { siteSettings, DEFAULT_SITE_SETTINGS } from './src/server/siteSettings.js';
import { siteSettings, DEFAULT_SITE_SETTINGS } from './src/server/siteSettings.js';
import { OrderFeeBreakdown } from './src/shared/fees.js';
import {
  SEED_USERS,
  SEED_GIGS,
  SEED_PROJECTS,
  SEED_PROPOSALS,
  SEED_ORDERS,
  SEED_REVIEWS,
  SEED_MESSAGES
} from './src/data/completeSeedDataset.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));

// ==========================================
// PRODUCTION / DEVELOPMENT SECURITY BOUNDARY
// ==========================================
const isCompiledProductionBundle = path.basename(fileURLToPath(import.meta.url)).startsWith('server.js');
const isNpmStart = process.env.npm_lifecycle_event === 'start';
const isExplicitProd = process.env.NODE_ENV === 'production';
const isTestEnv = process.env.NODE_ENV === 'test';

// Enforce production mode for compiled production bundles or npm start, unless in test environment
const IS_PROD = (isExplicitProd || isNpmStart || isCompiledProductionBundle) && !isTestEnv;

if (IS_PROD) {
  process.env.NODE_ENV = 'production';
}

// Internal secrets
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || isCompiledProductionBundle;
const JWT_SECRET: string = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (IS_PRODUCTION) {
    throw new Error('JWT_SECRET environment variable (min 32 characters) is required in production.');
  }
  return 'dev-only-insecure-jwt-secret-do-not-use-in-production';
})();

const REQUIRE_KYC_FOR_PAYOUTS = false;

function escapeHtml(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper to determine whether simulated development deposits are permitted
function areSimulatedDepositsAllowed(): boolean {
  if (IS_PRODUCTION) {
    return false;
  }
  return true;
}

// Feed business rules from the site settings into the ledger engine
financeLedger.configure({
  commissionPercent: DEFAULT_SITE_SETTINGS.commission.commissionPercent,
  buyerFeePercent: DEFAULT_SITE_SETTINGS.commission.buyerProcessingFeePercent,
  smallOrderFee: DEFAULT_SITE_SETTINGS.commission.smallOrderFeeAmount,
  smallOrderThreshold: DEFAULT_SITE_SETTINGS.commission.smallOrderFeeThreshold,
  refundClientFeesOnFullRefund: DEFAULT_SITE_SETTINGS.commission.refundClientFeesOnFullRefund,
  minimumOrderAmount: DEFAULT_SITE_SETTINGS.commission.minimumOrderAmount,
  minimumWithdrawalAmount: DEFAULT_SITE_SETTINGS.wallets.minimumWithdrawalAmount,
  maximumWithdrawalAmount: DEFAULT_SITE_SETTINGS.wallets.maximumWithdrawalPerTransaction
});

// ==========================================
// CRYPTOGRAPHIC AUTHENTICATION ADAPTER (JWT / Session)
// ==========================================

function signToken(payload: { id: string; role: string; email: string; sessionVersion?: number }, expiresInMs = 7 * 24 * 3600 * 1000): string {
  const data = JSON.stringify({ ...payload, exp: Date.now() + expiresInMs });
  const base64Data = Buffer.from(data).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(base64Data).digest('base64url');
  return `${base64Data}.${signature}`;
}

function verifyToken(token: string): { id: string; role: string; email: string; sessionVersion?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [base64Data, signature] = parts;
    const expectedSig = createHmac('sha256', JWT_SECRET).update(base64Data).digest('base64url');
    
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(base64Data, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }

    const dbUser = users.find(u => u.id === payload.id);
    if (dbUser) {
      if (payload.sessionVersion !== undefined) {
        if (!dbUser.sessionVersion || dbUser.sessionVersion < payload.sessionVersion) {
          dbUser.sessionVersion = payload.sessionVersion;
        } else if (dbUser.sessionVersion && payload.sessionVersion !== dbUser.sessionVersion) {
          return null; // Session invalidated by password reset or explicit logout
        }
      }
    }

    return payload;
  } catch {
    return null;
  }
}

// Global Authentication Middleware: verifies cryptographic signed JWT/session and populates req.user
function verifyAuthTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();

    // Remove admin token bypass


    const payload = verifyToken(token);
    if (payload) {
      const dbUser = users.find(u => u.id === payload.id);
      if (dbUser) {
        (req as any).user = {
          id: dbUser.id,
          role: dbUser.role,
          status: dbUser.status,
          email: dbUser.email
        };
        (req as any).authenticatedUserId = dbUser.id;
        (req as any).authenticatedUser = dbUser;
        return next();
      }
    }
  }

  // Without a valid cryptographic session token, the request is strictly unauthenticated
  (req as any).user = null;
  (req as any).authenticatedUserId = null;
  (req as any).authenticatedUser = null;
  next();
}

app.use(verifyAuthTokenMiddleware);

// Resolve authenticated user identity strictly from verified session (NEVER from client-supplied IDs)
function resolveAuthenticatedUserId(req: Request): string | null {
  const authUser = (req as any).user?.id || (req as any).authenticatedUserId;
  if (authUser && typeof authUser === 'string' && authUser.trim()) {
    return authUser.trim();
  }
  return null;
}
// ROBUST USER ACCOUNT SYSTEM & VERIFICATION
// ==========================================

interface VerificationRecord {
  code: string;
  expiresAt: number;
  lastResendAt: number;
  attempts: number;
}

const emailVerificationCodes = new Map<string, VerificationRecord>();
const smsVerificationCodes = new Map<string, VerificationRecord>();
const forgotPasswordCodes = new Map<string, VerificationRecord>();
const withdrawalVerificationCodes = new Map<string, VerificationRecord>();

function generate6DigitCode(): string {
  return randomInt(100000, 1000000).toString();
}

// Verification codes are echoed back in API responses ONLY outside production (dev/test convenience).
// In production a code must never leave the server in a response; otherwise device verification,
// admin 2FA and password reset can all be bypassed by anyone.
const EXPOSE_MOCK_CODES = !IS_PRODUCTION;
function mockCode(key: string, code: string): Record<string, string> {
  return EXPOSE_MOCK_CODES ? { [key]: code } : {};
}

// New-device verification for regular users. Admin accounts ALWAYS require it.
// Defaults to on outside production. In production it defaults to off until a real email provider is wired in
// (set USER_DEVICE_VERIFICATION=true to enable it).
const USER_DEVICE_VERIFICATION = process.env.USER_DEVICE_VERIFICATION
  ? process.env.USER_DEVICE_VERIFICATION === 'true'
  : !IS_PRODUCTION;

// No email provider is integrated yet. In production, admin verification codes are written to the server log
// so the owner can still sign in; replace this with a real mail/SMS sender.
function deliverAdminCode(email: string, code: string) {
  console.warn(`[AUTH ADMIN 2FA] Verification code for ${email}: ${code}`);
}

function isValidEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isValidMobile(v: string): boolean {
  return /^\+?[0-9][0-9\s\-()]{6,18}$/.test(v);
}

// 1. Signup Endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, confirmPassword, mobile, name } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || typeof mobile !== 'string' || !email.trim() || !password || !mobile.trim()) {
      return res.status(400).json({ error: 'Email, password, and mobile number are required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (password.length > 72) {
      return res.status(400).json({ error: 'Password must be at most 72 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!isValidMobile(mobile.trim())) {
      return res.status(400).json({ error: 'Please enter a valid mobile number.' });
    }
    const existing = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    if (users.some(u => u.mobile && u.mobile === mobile.trim())) {
      return res.status(409).json({ error: 'An account with this mobile number already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const newUserId = 'user_' + Date.now() + '_' + randomBytes(3).toString('hex');
    const isFirstUser = users.length === 0;
    const newUser: User = {
      id: newUserId,
      name: (typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : normalizedEmail.split('@')[0]),
      email: normalizedEmail,
      mobile: mobile.trim(),
      role: isFirstUser ? 'super_admin' : 'user',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400&h=400&fit=crop',
      title: isFirstUser ? 'Super Administrator' : 'Freelancer / Member',
      rating: 5.0,
      reviewsCount: 0,
      hourlyRate: 50,
      earned: 0,
      completedJobs: 0,
      bio: 'New member on WorkPerHour.',
      skills: ['General'],
      status: 'active',
      verified: false,
      emailVerified: false,
      mobileVerified: false,
      walletBalance: 0,
      createdAt: new Date().toISOString().substring(0, 10),
      password: hashedPassword,
      sessionVersion: 1,
      knownDevices: req.body?.deviceId ? [String(req.body.deviceId).trim()] : ['dev_default_session']
    };

    users.push(newUser);
    ensureWallet(newUserId);

    const emailCode = generate6DigitCode();
    emailVerificationCodes.set(normalizedEmail, {
      code: emailCode,
      expiresAt: Date.now() + 15 * 60 * 1000,
      lastResendAt: Date.now(),
      attempts: 0
    });

    const smsCode = generate6DigitCode();
    smsVerificationCodes.set(mobile.trim(), {
      code: smsCode,
      expiresAt: Date.now() + 15 * 60 * 1000,
      lastResendAt: Date.now(),
      attempts: 0
    });

    if (!IS_PRODUCTION) {
      console.log(`[AUTH SIGNUP] Email verification code for ${normalizedEmail}: ${emailCode}`);
      console.log(`[AUTH SIGNUP] SMS verification code for ${mobile.trim()}: ${smsCode}`);
    }

    userEmails.unshift({
      id: 'email_' + Date.now(),
      userId: newUserId,
      userEmail: normalizedEmail,
      subject: 'Verify Your WorkPerHour Account',
      snippet: `Your email verification code is ${emailCode}`,
      body: `Welcome to WorkPerHour! Please enter verification code ${emailCode} to verify your account.`,
      date: new Date().toLocaleDateString(),
      read: false
    });

    const token = signToken({ id: newUser.id, role: newUser.role, email: newUser.email, sessionVersion: newUser.sessionVersion });

    res.status(201).json({
      success: true,
      token,
      user: safeUser(newUser),
      ...mockCode('mockEmailCode', emailCode),
      ...mockCode('mockSmsCode', smsCode)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// 2. Email Verification & Resend
app.post('/api/auth/verify-email', (req, res) => {
  const { email, code: rawCode } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || rawCode === undefined || rawCode === null || String(rawCode).trim() === '') return res.status(400).json({ error: 'Email and code are required.' });
  const code = String(rawCode);
  const normalizedEmail = email.trim().toLowerCase();
  const record = emailVerificationCodes.get(normalizedEmail);
  if (!record) return res.status(400).json({ error: 'No verification code found or code expired.' });
  if (Date.now() > record.expiresAt) {
    emailVerificationCodes.delete(normalizedEmail);
    return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
  }
  if (record.attempts >= 5) {
    emailVerificationCodes.delete(normalizedEmail);
    return res.status(429).json({ error: 'Too many failed attempts. Code invalidated.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid verification code.' });
  }

  emailVerificationCodes.delete(normalizedEmail);
  const user = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
  if (user) {
    (user as any).emailVerified = true;
    user.verified = true;
  }
  res.json({ success: true, message: 'Email verified successfully!' });
});

app.post('/api/auth/resend-email-code', (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
  const normalizedEmail = email.trim().toLowerCase();
  const existing = emailVerificationCodes.get(normalizedEmail);
  const now = Date.now();
  if (existing && now - existing.lastResendAt < 30_000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before requesting a new resend.' });
  }

  const newCode = generate6DigitCode();
  emailVerificationCodes.set(normalizedEmail, {
    code: newCode,
    expiresAt: now + 15 * 60 * 1000,
    lastResendAt: now,
    attempts: 0
  });

  const user = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
  userEmails.unshift({
    id: 'email_' + Date.now(),
    userId: user?.id || 'guest',
    userEmail: normalizedEmail,
    subject: 'Your New WorkPerHour Verification Code',
    snippet: `Your new verification code is ${newCode}`,
    body: `Here is your requested verification code: ${newCode}. It is valid for 15 minutes.`,
    date: new Date().toLocaleDateString(),
    read: false
  });

  if (!IS_PRODUCTION) {
    console.log(`[AUTH RESEND] Email verification code for ${normalizedEmail}: ${newCode}`);
  } else if (user && (user.role === 'admin' || user.role === 'super_admin')) {
    deliverAdminCode(normalizedEmail, newCode);
  }
  res.json({ success: true, message: 'New verification code generated and sent.', ...mockCode('mockEmailCode', newCode) });
});

// 3. Mobile / SMS Verification & Resend
app.post('/api/auth/verify-sms', (req, res) => {
  const { mobile, code: rawCode } = req.body || {};
  if (typeof mobile !== 'string' || !mobile.trim() || rawCode === undefined || rawCode === null || String(rawCode).trim() === '') return res.status(400).json({ error: 'Mobile number and code are required.' });
  const code = String(rawCode);
  const cleanMobile = mobile.trim();
  const record = smsVerificationCodes.get(cleanMobile);
  if (!record) return res.status(400).json({ error: 'No SMS verification code found or expired.' });
  if (Date.now() > record.expiresAt) {
    smsVerificationCodes.delete(cleanMobile);
    return res.status(400).json({ error: 'SMS verification code has expired.' });
  }
  if (record.attempts >= 5) {
    smsVerificationCodes.delete(cleanMobile);
    return res.status(429).json({ error: 'Too many failed attempts.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid SMS verification code.' });
  }

  smsVerificationCodes.delete(cleanMobile);
  const user = users.find(u => u.mobile === cleanMobile);
  if (user) {
    (user as any).mobileVerified = true;
    user.verified = true;
  }
  res.json({ success: true, message: 'Mobile verified successfully via SMS! Account is now active and usable.' });
});

app.post('/api/auth/resend-sms-code', (req, res) => {
  const { mobile } = req.body || {};
  if (typeof mobile !== 'string' || !mobile.trim()) return res.status(400).json({ error: 'Mobile number is required.' });
  const cleanMobile = mobile.trim();
  const existing = smsVerificationCodes.get(cleanMobile);
  const now = Date.now();
  if (existing && now - existing.lastResendAt < 30_000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before resending SMS.' });
  }

  const newCode = generate6DigitCode();
  smsVerificationCodes.set(cleanMobile, {
    code: newCode,
    expiresAt: now + 15 * 60 * 1000,
    lastResendAt: now,
    attempts: 0
  });

  if (!IS_PRODUCTION) console.log(`[AUTH RESEND] SMS verification code for ${cleanMobile}: ${newCode}`);
  res.json({ success: true, message: 'New SMS OTP dispatched.', ...mockCode('mockSmsCode', newCode) });
});

function sanitizeAndCreateMessage(
  sender: User,
  order: Order,
  body: any,
  fileCheck: { ok: boolean; fileInfo?: any; error?: string }
): Message {
  // Stored as typed; React escapes on render, so escaping here would double-escape (&lt; shown literally).
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const isSystemOrStaff = isStaffUser(sender);
  
  let type = body.type;
  if (!isSystemOrStaff && (type === 'system' || type === 'deliverable')) {
    type = 'message';
  }
  if (type !== 'message' && type !== 'file') {
    type = 'message';
  }
  if (type !== 'file' && !text) {
    throw new Error('Message text is required.');
  }
  if (text.length > 5000) {
    throw new Error('Message is too long.');
  }

  const metadata: any = {};
  if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
    Object.assign(metadata, body.metadata);
  }

  // 1. Offer cards (proposal / invoice / deposit) are created only by the server from real offer records.
  // A browser must never be able to forge one through a plain message.
  delete metadata.offerId;
  delete metadata.offerKind;

  // 2. Prevent browser-supplied metadata from forging trusted system, platform, payment, or lifecycle events.
  // Normal buyer/seller chat can include benign UI metadata (e.g. clientMessageId, requirementText),
  // but cannot spoof platform-level lifecycle, payment, escrow, delivery, dispute, or administrative events.
  if (!isSystemOrStaff) {
    const FORBIDDEN_METADATA_KEYS = [
      'disputeId', 'revisionId', 'reviewId', 'ticketId', 'payoutId', 'refundId', 'transactionId',
      'deliveryVersion', 'version', 'amount', 'refundAmount', 'feeBreakdown',
      'system', 'isSystem', 'official', 'verified', 'trusted', 'isAdmin', 'isStaff',
      'role', 'senderRole', 'status', 'orderStatus', 'paymentStatus', 'escrowStatus'
    ];
    for (const key of FORBIDDEN_METADATA_KEYS) {
      delete metadata[key];
    }

    if (typeof metadata.action === 'string') {
      const action = metadata.action.trim().toLowerCase();
      const isReservedAction =
        /^(offer_|escrow_|deliverable_|delivery_|revision_|dispute_|review_|order_|payment_|payout_|refund_|wallet_|transaction_|deposit_|system_|admin_|staff_|moderation_|audit_|project_proposal)/i.test(action) ||
        ['auto_accept', 'order_auto_accepted', 'release_escrow', 'escrow_release'].includes(action);

      if (isReservedAction) {
        delete metadata.action;
      }
    }
  } else {
    if (typeof metadata.action === 'string' && /^offer_/i.test(metadata.action)) {
      delete metadata.action;
    }
  }

  if (body.clientMessageId) {
    metadata.clientMessageId = String(body.clientMessageId);
  }
  if (body.metadata?.clientMessageId) {
    metadata.clientMessageId = String(body.metadata.clientMessageId);
  }

  return {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: sender.id,
    senderName: sender.name,
    text: text.slice(0, 5000),
    timestamp: new Date().toISOString(),
    type,
    fileInfo: fileCheck.fileInfo,
    metadata
  };
}

// 4. Secure Login with Single Active Session per Account and Device Verification
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

async function handleLogin(req: Request, res: Response) {
  const clientIp = (req.ip || req.socket.remoteAddress || 'unknown-client').toString();
  const { email, password, userId, code, verificationCode, emailCode } = req.body || {};
  const lookupEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  const lookupId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;

  // Lock out by client IP AND by targeted account, so a single account cannot be brute-forced from many IPs.
  const now = Date.now();
  const cooldownMs = process.env.NODE_ENV === 'test' ? 2000 : 60000;
  const attemptKeys = [clientIp, ...(lookupEmail || lookupId ? ['acct:' + (lookupEmail || lookupId)] : [])];
  for (const key of attemptKeys) {
    const attemptRecord = loginAttempts.get(key);
    if (!attemptRecord) continue;
    if (now < attemptRecord.resetAt && attemptRecord.count >= 5) {
      return res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
    }
    if (now >= attemptRecord.resetAt) {
      loginAttempts.delete(key);
    }
  }

  function recordFailedLogin() {
    for (const key of attemptKeys) {
      const record = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + cooldownMs };
      record.count++;
      loginAttempts.set(key, record);
    }
  }

  if (!lookupEmail && !lookupId) {
    return res.status(401).json({ error: 'Email is required for login.' });
  }

  if (typeof password !== 'string' || !password.trim()) {
    return res.status(401).json({ error: 'Password is required.' });
  }

  const user = users.find(u => 
    (lookupEmail && u.email && u.email.toLowerCase() === lookupEmail) ||
    (lookupId && u.id === lookupId)
  );

  if (!user) {
    recordFailedLogin();
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // A password is ALWAYS required: no hardcoded passwords and no passwordless accounts.
  const passwordMatch = typeof user.password === 'string' && user.password.length > 0 && bcrypt.compareSync(password, user.password);
  if (!passwordMatch) {
    recordFailedLogin();
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: `Account is ${user.status}.` });
  }

  // Device verification & Admin 2FA flow
  const rawDeviceId = req.body?.deviceId || req.headers['x-device-id'];
  const deviceId = rawDeviceId ? String(rawDeviceId).trim() : 'dev_default_session';

  if (!user.knownDevices || !Array.isArray(user.knownDevices)) {
    user.knownDevices = [];
  }

  const isAdminRole = user.role === 'admin' || user.role === 'super_admin';
  const providedCode = (code || verificationCode || emailCode)?.toString().trim();
  // Placeholder device ids and the client-supplied skip flag are a dev/test convenience only. They never
  // bypass verification in production and never bypass it for administrator accounts.
  const isPlaceholderDevice = deviceId === 'dev_default_session' || deviceId === 'unknown';
  const trustedDevice = user.knownDevices.includes(deviceId) && !(isAdminRole && isPlaceholderDevice);
  const devBypass = !IS_PRODUCTION && !isAdminRole && (isPlaceholderDevice || Boolean(req.body?.skipDeviceVerification));
  const requiresVerification = isAdminRole
    ? !trustedDevice
    : (USER_DEVICE_VERIFICATION && !trustedDevice && !devBypass);

  if (requiresVerification) {
    const userEmailKey = (user.email || lookupEmail || user.id).toLowerCase();

    if (!providedCode) {
      const newCode = generate6DigitCode();
      emailVerificationCodes.set(userEmailKey, {
        code: newCode,
        expiresAt: Date.now() + 15 * 60 * 1000,
        lastResendAt: Date.now(),
        attempts: 0
      });

      if (IS_PRODUCTION && isAdminRole) deliverAdminCode(user.email, newCode);

      userEmails.unshift({
        id: 'email_' + Date.now(),
        userId: user.id,
        userEmail: user.email,
        subject: isAdminRole ? 'Admin Login Email Verification Code' : 'New Device Login Verification Code',
        snippet: `Your verification code is ${newCode}`,
        body: isAdminRole
          ? `An administrator login attempt was initiated. Please enter verification code ${newCode} to access the Admin Dashboard.`
          : `A login attempt from a new device (${deviceId}) was detected. Please enter verification code ${newCode} to create a new session.`,
        date: new Date().toLocaleDateString(),
        read: false
      });

      return res.status(200).json({
        requiresVerification: true,
        requireCode: true,
        message: isAdminRole
          ? 'Admin login requires an email verification code. Code sent to your registered admin email.'
          : 'New device detected. Please provide the email verification code sent to your email.',
        ...mockCode('mockEmailCode', newCode),
        deviceId
      });
    }

    // Verify provided code (previously unreachable: any code was accepted on an unknown device)
    const record = emailVerificationCodes.get(userEmailKey);
    if (!record || Date.now() > record.expiresAt) {
      recordFailedLogin();
      return res.status(400).json({ error: 'Invalid or expired email verification code.' });
    }
    if (record.attempts >= 5) {
      emailVerificationCodes.delete(userEmailKey);
      return res.status(429).json({ error: 'Too many failed attempts. Please log in again to receive a new code.' });
    }
    if (record.code !== providedCode) {
      record.attempts++;
      recordFailedLogin();
      return res.status(400).json({ error: 'Invalid or expired email verification code.' });
    }

    emailVerificationCodes.delete(userEmailKey);
    if (!user.knownDevices.includes(deviceId)) {
      user.knownDevices.push(deviceId);
      if (user.knownDevices.length > 10) user.knownDevices.shift();
    }
  }

  // Invalidate any previous active session: Every successful login increments sessionVersion
  user.sessionVersion = (user.sessionVersion || 0) + 1;

  for (const key of attemptKeys) loginAttempts.delete(key);

  const token = signToken({ id: user.id, role: user.role, email: user.email, sessionVersion: user.sessionVersion });
  return res.json({
    success: true,
    token,
    user: safeUser(user)
  });
}

app.post('/api/auth/login', handleLogin);
app.post('/api/auth/login/verify', handleLogin);

app.get('/api/auth/me', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Unauthenticated session token.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  return res.json({ success: true, user: safeUser(u) });
});

app.post('/api/auth/demo-session', (req, res) => {
  // Passwordless demo login is a development convenience only; never available in production.
  if (IS_PRODUCTION && !isTestEnv) return res.status(404).json({ error: 'Not found.' });
  const { userId } = req.body || {};
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'Demo user not found.' });
  if (['admin', 'super_admin', 'support'].includes(user.role)) {
    return res.status(403).json({ error: 'Demo login is not available for privileged accounts.' });
  }
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  const token = signToken({ id: user.id, role: user.role, email: user.email, sessionVersion: user.sessionVersion });
  return res.json({ success: true, token, user: safeUser(user) });
});

// 5. Forgot Password Flow
// Validates a recovery code with a hard attempt limit (6-digit codes are otherwise brute-forceable).
function checkRecoveryCode(query: string, code: unknown): 'ok' | 'invalid' | 'locked' {
  const record = forgotPasswordCodes.get(query);
  if (!record || Date.now() > record.expiresAt) return 'invalid';
  if (record.attempts >= 5) {
    forgotPasswordCodes.delete(query);
    return 'locked';
  }
  if (typeof code !== 'string' && typeof code !== 'number') return 'invalid';
  if (record.code !== String(code).trim()) {
    record.attempts++;
    return 'invalid';
  }
  return 'ok';
}

app.post('/api/auth/forgot-password/request', (req, res) => {
  const { emailOrMobile } = req.body || {};
  if (typeof emailOrMobile !== 'string' || !emailOrMobile.trim()) return res.status(400).json({ error: 'Email or mobile is required.' });
  const query = emailOrMobile.trim().toLowerCase();
  // Identical response whether or not the account exists (no account enumeration).
  const genericResponse = { success: true, message: 'If an account exists, a recovery code has been sent.' };
  const user = users.find(u => (u.email && u.email.toLowerCase() === query) || u.mobile === query);
  if (!user) {
    return res.json(genericResponse);
  }

  const existing = forgotPasswordCodes.get(query);
  if (existing && Date.now() - existing.lastResendAt < 30_000) {
    return res.json(genericResponse);
  }

  const code = generate6DigitCode();
  forgotPasswordCodes.set(query, {
    code,
    expiresAt: Date.now() + 15 * 60 * 1000,
    lastResendAt: Date.now(),
    attempts: 0
  });

  if (!IS_PRODUCTION) {
    console.log(`[AUTH FORGOT] Recovery code for ${query}: ${code}`);
  } else if (user.role === 'admin' || user.role === 'super_admin') {
    deliverAdminCode(user.email, code);
  }

  res.json({ ...genericResponse, ...mockCode('mockRecoveryCode', code) });
});

app.post('/api/auth/forgot-password/verify', (req, res) => {
  const { emailOrMobile, code } = req.body || {};
  if (typeof emailOrMobile !== 'string' || !emailOrMobile.trim() || !code) return res.status(400).json({ error: 'Identifier and code are required.' });
  const query = emailOrMobile.trim().toLowerCase();
  const check = checkRecoveryCode(query, code);
  if (check === 'locked') return res.status(429).json({ error: 'Too many failed attempts. Please request a new recovery code.' });
  if (check !== 'ok') {
    return res.status(400).json({ error: 'Invalid or expired recovery code.' });
  }
  res.json({ success: true, message: 'Code verified successfully.' });
});

app.post('/api/auth/forgot-password/reset', (req, res) => {
  const { emailOrMobile, code, newPassword, confirmPassword, confirmNewPassword } = req.body || {};
  if (typeof emailOrMobile !== 'string' || !emailOrMobile.trim() || !code || typeof newPassword !== 'string' || !newPassword) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  const confirmToUse = confirmPassword || confirmNewPassword;
  if (confirmToUse && newPassword !== confirmToUse) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }
  if (newPassword.length > 72) {
    return res.status(400).json({ error: 'New password must be at most 72 characters long.' });
  }
  const query = emailOrMobile.trim().toLowerCase();
  const check = checkRecoveryCode(query, code);
  if (check === 'locked') return res.status(429).json({ error: 'Too many failed attempts. Please request a new recovery code.' });
  if (check !== 'ok') {
    return res.status(400).json({ error: 'Invalid or expired recovery code.' });
  }

  const user = users.find(u => (u.email && u.email.toLowerCase() === query) || u.mobile === query);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  user.password = bcrypt.hashSync(newPassword, 10);
  user.sessionVersion = (user.sessionVersion || 1) + 1;
  forgotPasswordCodes.delete(query);

  res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
});

// 7. Withdrawal Email Verification Endpoints
app.post('/api/auth/withdrawal/request-code', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  if (!caller || !caller.email) return res.status(400).json({ error: 'User email not found.' });

  const code = generate6DigitCode();
  withdrawalVerificationCodes.set(caller.id, {
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    lastResendAt: Date.now(),
    attempts: 0
  });

  userEmails.unshift({
    id: 'email_' + Date.now(),
    userId: caller.id,
    userEmail: caller.email,
    subject: 'Withdrawal Email Verification Code',
    snippet: `Your withdrawal code is ${code}`,
    body: `You requested a withdrawal from your WorkPerHour wallet. Use verification code ${code} to complete the transaction.`,
    date: new Date().toLocaleDateString(),
    read: false
  });

  res.json({ success: true, message: 'Withdrawal verification code sent to your registered email.', ...mockCode('mockWithdrawalCode', code) });
});

app.post('/api/auth/withdrawal/verify-and-execute', requireAuth, (req, res) => {
  const caller = (req as any).authenticatedUser;
  const { code, amount, method, accountDetails } = req.body || {};

  if (!code) return res.status(400).json({ error: 'Email verification code is required for withdrawal.' });

  const record = withdrawalVerificationCodes.get(caller.id);
  if (!record) {
    return res.status(400).json({ error: 'No active withdrawal verification code found. Please request a new code.' });
  }
  if (Date.now() > record.expiresAt) {
    withdrawalVerificationCodes.delete(caller.id);
    return res.status(400).json({ error: 'Withdrawal verification code has expired.' });
  }
  if (record.attempts >= 5) {
    withdrawalVerificationCodes.delete(caller.id);
    return res.status(429).json({ error: 'Too many incorrect attempts. Verification code invalidated.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid verification code.' });
  }

  withdrawalVerificationCodes.delete(caller.id);

  req.body.userId = caller.id;
  return handlePayoutRequest(req, res);
});

function safeUser(user: any) {
  const { password, knownDevices, sessionVersion, ...safe } = user;
  return safe;
}

function orderParticipantSafeUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    title: user.title,
    rating: user.rating,
    reviewsCount: user.reviewsCount,
    hourlyRate: user.hourlyRate,
    skills: user.skills,
    verified: user.verified,
    status: user.status
  };
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Please provide a valid session token.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  if (u.status !== 'active') {
    return res.status(403).json({ error: 'Forbidden: Account is suspended, restricted, or deactivated.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
}

// ---- Workstream access control -------------------------------------------------------------
const STAFF_ROLES = ['admin', 'super_admin', 'support'];
function isStaffUser(user: any): boolean {
  return !!user && STAFF_ROLES.includes(user.role);
}
/** Only the order's buyer, its seller, or platform staff may read or write its workstream. */
function canAccessOrderWorkstream(user: any, order: { buyerId: string; sellerId: string } | undefined): boolean {
  if (!user || !order) return false;
  return isStaffUser(user) || user.id === order.buyerId || user.id === order.sellerId;
}

function adminActor(req: Request): string {
  const authUserId = resolveAuthenticatedUserId(req);
  const u = authUserId ? users.find(user => user.id === authUserId) : null;
  if (u) return `${u.name} (${u.role || 'admin'})`;
  return 'Administrator';
}

function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authUserId = resolveAuthenticatedUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const u = users.find(user => user.id === authUserId);
    if (!u) {
      return res.status(401).json({ error: 'User not found.' });
    }
    if (!allowedRoles.includes(u.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
    }
    (req as any).authenticatedUserId = u.id;
    (req as any).authenticatedUser = u;
    next();
  };
}

// Admin guard: strictly requires valid administrator session
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Valid admin session missing.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u || (u.role !== 'super_admin' && u.role !== 'admin')) {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
}

app.use('/api/admin', (req, res, next) => {
  if (req.method === 'GET' && (req.path === '/settings' || req.path === '/site-settings')) {
    return next();
  }
  return requireAdmin(req, res, next);
});


// In-memory rate limiter per route and user identity.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(max: number, windowMs: number, prefix: string = '') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }
    const identity = (req as any).authenticatedUserId || req.ip || 'anon';
    const route = prefix || req.route?.path || req.path;
    const key = `${route}:${identity}`;
    const now = Date.now();
    const record = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count++;
    rateBuckets.set(key, record);
    if (record.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// IP-based rate limiter specifically for WebSocket connection attempts to prevent DoS.
const wsConnectionBuckets = new Map<string, { count: number; resetAt: number }>();
function checkWsIpRateLimit(ip: string): boolean {
  const max = 5; // Max 5 connection attempts
  const windowMs = 30_000; // per 30 seconds
  const now = Date.now();
  const record = wsConnectionBuckets.get(ip) || { count: 0, resetAt: now + windowMs };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  
  record.count++;
  wsConnectionBuckets.set(ip, record);
  
  return record.count <= max;
}



const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const ip = request.socket.remoteAddress || 'unknown';
  if (!checkWsIpRateLimit(ip)) {
    console.warn(`[Security] WebSocket connection attempt from ${ip} rejected: rate limit exceeded.`);
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
wss.on('error', (err) => {
  console.error('WSS Server error:', err);
});

// Interfaces
interface User {
  id: string;
  name: string;
  username?: string;
  email: string;
  mobile?: string;
  role: 'user' | 'admin' | 'super_admin' | 'moderator' | 'support' | string;
  avatar: string;
  title: string;
  rating: number;
  reviewsCount: number;
  hourlyRate: number;
  earned: number;
  completedJobs: number;
  bio: string;
  skills: string[];
  status: 'active' | 'suspended' | 'restricted' | 'deactivated';
  verified: boolean;
  emailVerified?: boolean;
  mobileVerified?: boolean;
  walletBalance: number;
  createdAt: string;
  isFlagged?: boolean;
  flagReason?: string;
  password?: string;
  sessionVersion?: number;
  knownDevices?: string[];
  isAvailableNow?: boolean;
}

interface GigExtra {
  id: string;
  title: string;
  price: number;
}

interface Gig {
  id: string;
  freelancerId: string;
  freelancerName: string;
  freelancerUsername?: string;
  freelancerAvatar: string;
  freelancerLevel?: string;
  title: string;
  slug?: string;
  category: string;
  subcategory?: string;
  description: string;
  price: number;
  deliveryDays: number;
  rating: number;
  reviewsCount: number;
  image: string;
  status: 'published' | 'draft' | 'suspended' | 'paused' | 'pending' | 'declined';
  featured: boolean;
  extras?: GigExtra[];
  moderationStatus?: 'approved' | 'flagged' | 'rejected' | 'pending';
  moderationNotes?: string;
}

interface Project {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerAvatar: string;
  title: string;
  slug?: string;
  category: string;
  subcategory?: string;
  description: string;
  budgetMin: number;
  budgetMax: number;
  deadlineDays: number;
  proposalsCount: number;
  createdAt: string;
  status: 'open' | 'published' | 'unpublished' | 'suspended' | 'in_progress' | 'completed';
  featured: boolean;
  moderationStatus?: 'approved' | 'flagged' | 'rejected' | 'pending';
  moderationNotes?: string;
}

interface Proposal {
  id: string;
  projectId: string;
  freelancerId: string;
  freelancerName: string;
  freelancerAvatar: string;
  freelancerTitle: string;
  coverLetter: string;
  bidAmount: number;
  deliveryDays: number;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface Order {
  id: string;
  title: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: 'funded_in_escrow' | 'in_progress' | 'delivered' | 'completed' | 'disputed' | 'revision' | 'cancelled' | 'draft_review' | 'work_in_progress';
  createdAt: string;
  completedAt?: string;
  dueDate: string;
  requirements?: string;
  deliverables?: string;
  deliverableFiles?: Array<{ id?: string; name: string; url: string; size: string; uploadedAt?: string }>;
  revisions?: Array<{ id: string; requestedAt: string; reason: string; status: string }>;
  adminNotes?: string;
  isMuted?: boolean;
  escrowProtectionStartDate?: string;
  escrowProtectionEndDate?: string;
  gigId?: string;
  projectId?: string;
  serviceUrl?: string;
  gigSlug?: string;
  sellerUsername?: string;
  buyerUsername?: string;
  serviceTitle?: string;
  serviceThumbnail?: string;
  isTimerPaused?: boolean;
  feeBreakdown?: OrderFeeBreakdown;
  deliveryHistory?: Array<{
    version: number;
    notes?: string;
    message?: string;
    reference?: string;
    files: Array<{ id?: string; name: string; size: string; url: string; uploadedAt?: string }>;
    deliveredAt: string;
  }>;
  deliveryNotes?: string;
  deliveryReference?: string;
  acceptedVersion?: number;
  reviewWindowDays?: number;
  reviewWindowExpiresAt?: string;
  review?: Review;
}

interface Dispute {
  id: string;
  orderId: string;
  raisedBy: string;
  reason: string;
  evidence: string;
  status: 'open' | 'under_investigation' | 'resolved_refund' | 'resolved_release' | 'resolved_partial';
  createdAt: string;
  resolutionNotes?: string;
  assignedTo?: string;
}

interface Refund {
  id: string;
  orderId: string;
  buyerId: string;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface Payout {
  id: string;
  freelancerId: string;
  amount: number;
  method: 'UPI' | 'Bank Transfer' | 'Stripe' | 'Razorpay' | 'PayPal';
  status: 'pending' | 'approved' | 'processed' | 'failed' | 'cancelled' | 'reversed';
  createdAt: string;
  accountDetails: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  order: number;
  subcategories: { id: string; name: string; slug: string; enabled: boolean }[];
}

interface Review {
  id: string;
  orderId?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewerAvatar?: string;
  targetUserId?: string;
  rating: number;
  comment?: string;
  orderTitle?: string;
  gigId?: string;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
  isCancelledOrder?: boolean;
  reply?: {
    text: string;
    createdAt: string;
    sellerId: string;
    sellerName: string;
    sellerAvatar?: string;
  };
}

interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
  messages: { sender: string; text: string; timestamp: string }[];
}

interface AuditLog {
  id: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  details: string;
  timestamp: string;
}

interface Message {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  type?: 'message' | 'system' | 'file' | 'deliverable';
  fileInfo?: { name: string; size: string; url: string; type?: string; category?: string };
  metadata?: {
    amount?: number;
    action?: string;
    milestoneTitle?: string;
    version?: number;
    notes?: string;
    reference?: string;
    reason?: string;
    rating?: number;
    comment?: string;
    revisionId?: string;
    deliveryVersion?: number;
    requirementText?: string;
    clientMessageId?: string;
    acceptedVersion?: number;
    reviewWindowDays?: number;
    disputeId?: string;
    raisedBy?: string;
    isCancelledOrder?: boolean;
    reply?: any;
    offerId?: string;
    offerKind?: string;
  };
}

interface UserEmail {
  id: string;
  userId: string;
  userEmail: string;
  subject: string;
  snippet?: string;
  body: string;
  type?: 'SUSPEND' | 'RESTRICT' | 'DEACTIVATE' | 'IMPERSONATE' | 'GENERAL';
  sentAt?: string;
  date?: string;
  read: boolean;
}

let userEmails: UserEmail[] = [];

function notifyUserOnAdminAction(user: User, action: 'suspended' | 'restricted' | 'deactivated' | 'impersonated', notes?: string) {
  const timestamp = new Date().toLocaleString();
  const timeShort = new Date().toISOString();

  let emailSubject = '';
  let emailBody = '';
  let chatText = '';

  if (action === 'suspended') {
    emailSubject = `[URGENT] WorkSphere Account Suspended - Action Required`;
    emailBody = `Dear ${user.name},\n\nYour WorkSphere account (${user.email}) has been SUSPENDED by Platform Administration.\n\nReason/Notes: ${notes || 'Violation of Marketplace Policies / Security Investigation'}.\n\nWhile suspended, your active listings, gigs, and bidding capabilities are temporarily paused. If you believe this is an error or wish to file an appeal, please click "Contact Support Desk" or reply directly to support.`;
    chatText = `🚨 ACCOUNT ALERT: Your WorkSphere account has been SUSPENDED by Platform Administration. Please Contact Support Desk immediately to review your account status and submit an appeal.`;
  } else if (action === 'restricted') {
    emailSubject = `[NOTICE] WorkSphere Account Privileges Restricted`;
    emailBody = `Dear ${user.name},\n\nYour WorkSphere account (${user.email}) privileges have been RESTRICTED by Platform Administration.\n\nReason/Notes: ${notes || 'Account compliance review / policy warning'}.\n\nCertain actions (such as creating new gigs or submitting bids) are currently limited. Please contact our Support Desk to resolve these restrictions.`;
    chatText = `⚠️ ACCOUNT NOTICE: Your WorkSphere account privileges have been RESTRICTED by Platform Administration. Please Contact Support Desk for assistance and clarification.`;
  } else if (action === 'deactivated') {
    emailSubject = `[NOTICE] WorkSphere Account Deactivated`;
    emailBody = `Dear ${user.name},\n\nYour WorkSphere account (${user.email}) has been DEACTIVATED by Platform Administration.\n\nReason/Notes: ${notes || 'Account deactivated'}.`;
    chatText = `🚨 ACCOUNT ALERT: Your WorkSphere account has been DEACTIVATED.`;
  } else if (action === 'impersonated') {
    emailSubject = `[SECURITY NOTICE] Administrative Support Session Initialized`;
    emailBody = `Dear ${user.name},\n\nA Super Administrator initialized an Administrative Support Impersonation Session for your account (${user.email}) at ${timestamp} for support investigation and auditing.\n\nIf you have any questions or security concerns, please contact support immediately.`;
    chatText = `🔒 SECURITY NOTICE: An Administrative Support Impersonation Session was started for your account by Super Admin for inspection. Please contact support if you have any questions.`;
  }

  // 1. Store Email Record
  const newEmail: UserEmail = {
    id: 'email_' + Date.now() + Math.random().toString(36).substring(2, 5),
    userId: user.id,
    userEmail: user.email,
    subject: emailSubject,
    body: emailBody,
    type: action === 'suspended' ? 'SUSPEND' : action === 'restricted' ? 'RESTRICT' : action === 'deactivated' ? 'DEACTIVATE' : 'IMPERSONATE',
    sentAt: timestamp,
    read: false
  };
  userEmails.unshift(newEmail);

  // 2. Add System Chat Message into User's Support Thread
  // 2. Add System Chat Message into User's Support Thread
  const supportOrderId = `support_admin_${user.id}`;
  const newChatMsg: Message = {
    id: 'msg_' + Date.now() + Math.random().toString(36).substring(2, 5),
    orderId: supportOrderId,
    senderId: 'user-admin',
    senderName: 'WorkSphere Admin & Support Desk',
    text: chatText,
    timestamp: timeShort
  };
  recordMessage(newChatMsg);

function notifyUser(message: Message, targetUserId: string) {
  const payload = JSON.stringify({ type: 'MESSAGE_RECEIVED', message });
  for (const client of clients) {
    const clientUserId = (client as any).authenticatedUserId;
    const clientUser = users.find(u => u.id === clientUserId);
    const isAuthorized = clientUser && (
      ['admin', 'super_admin', 'support'].includes(clientUser.role) ||
      clientUserId === targetUserId
    );
    
    if (isAuthorized && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// ... somewhere ...
  // 3. Broadcast WS message
  try {
    notifyUser(newChatMsg, user.id);
  } catch (err) {
    console.error('WS notify error:', err);
  }
}

// Development / Testing credentials hashed with bcrypt
// Known demo passwords exist ONLY outside production. In production every seeded account gets an
// unguessable random password; the super admin uses ADMIN_INITIAL_PASSWORD (or a one-time generated
// password printed to the server log on first boot).
const randomPasswordHash = () => bcrypt.hashSync(randomBytes(24).toString('hex'), 10);
let bootstrapAdminPasswordNotice: string | null = null;
if (IS_PRODUCTION && process.env.ADMIN_INITIAL_PASSWORD && process.env.ADMIN_INITIAL_PASSWORD.length < 12) {
  console.warn('[SECURITY] ADMIN_INITIAL_PASSWORD is shorter than 12 characters and was ignored. A random one-time password will be generated instead.');
}
function seedPasswordHashFor(role: string): string {
  if (!IS_PRODUCTION) {
    return bcrypt.hashSync(role === 'super_admin' ? 'adminpassword123' : 'password123', 10);
  }
  if (role === 'super_admin') {
    const configured = process.env.ADMIN_INITIAL_PASSWORD;
    if (configured && configured.length >= 12) return bcrypt.hashSync(configured, 10);
    // One generated password shared by every seeded super admin (previously each admin got a different one
    // and only the last was printed, locking out the others).
    const generated = bootstrapAdminPasswordNotice ?? randomBytes(18).toString('base64url');
    bootstrapAdminPasswordNotice = generated;
    return bcrypt.hashSync(generated, 10);
  }
  return randomPasswordHash();
}

// Initial Data Seeds & Persistent Storage Engine
export let users: User[] = SEED_USERS.map(u => ({
  ...u,
  password: seedPasswordHashFor(u.role),
  sessionVersion: u.sessionVersion || 1,
  knownDevices: u.knownDevices || ['dev_default_session']
}));

export let gigs: Gig[] = [...SEED_GIGS];
export let orders: Order[] = [...SEED_ORDERS];
export let projects: Project[] = [...SEED_PROJECTS];
export let proposals: Proposal[] = [...SEED_PROPOSALS];
export let reviews: Review[] = [...SEED_REVIEWS];
export let messages: Message[] = [...SEED_MESSAGES];

// Initialize default wallets for seeded users
for (const u of users) {
  ensureWallet(u.id);
}

export let disputes: Dispute[] = [];
export let refunds: Refund[] = [];
export let payouts: Payout[] = [];

let categories: Category[] = [
  {
    id: 'cat_ai',
    name: 'AI Services',
    slug: 'ai-services',
    enabled: true,
    order: 1,
    subcategories: [
      { id: 'sub_ai_1', name: 'Generative AI', slug: 'generative-ai', enabled: true },
      { id: 'sub_ai_2', name: 'AI Applications', slug: 'ai-applications', enabled: true },
      { id: 'sub_ai_3', name: 'AI Agents', slug: 'ai-agents', enabled: true },
      { id: 'sub_ai_4', name: 'Prompt Engineering', slug: 'prompt-engineering', enabled: true },
      { id: 'sub_ai_5', name: 'Machine Learning & Data Science', slug: 'machine-learning-data-science', enabled: true },
      { id: 'sub_ai_6', name: 'ChatGPT Integration', slug: 'chatgpt-integration', enabled: true },
      { id: 'sub_ai_7', name: 'Midjourney & AI Art', slug: 'ai-art', enabled: true }
    ]
  },
  {
    id: 'cat_tech',
    name: 'Technology & Programming',
    slug: 'technology-programming',
    enabled: true,
    order: 2,
    subcategories: [
      { id: 'sub_tech_1', name: 'Web Development', slug: 'web-development', enabled: true },
      { id: 'sub_tech_2', name: 'Mobile Apps', slug: 'mobile-apps', enabled: true },
      { id: 'sub_tech_3', name: 'Software Development', slug: 'software-development', enabled: true },
      { id: 'sub_tech_4', name: 'WordPress', slug: 'wordpress', enabled: true },
      { id: 'sub_tech_5', name: 'E-commerce', slug: 'ecommerce', enabled: true },
      { id: 'sub_tech_6', name: 'Databases', slug: 'databases', enabled: true },
      { id: 'sub_tech_7', name: 'Game Development', slug: 'game-development', enabled: true },
      { id: 'sub_tech_8', name: 'QA & Testing', slug: 'qa-testing', enabled: true },
      { id: 'sub_tech_9', name: 'DevOps & Cloud', slug: 'devops-cloud', enabled: true }
    ]
  },
  {
    id: 'cat_writing',
    name: 'Writing & Translation',
    slug: 'writing-translation',
    enabled: true,
    order: 3,
    subcategories: [
      { id: 'sub_writ_1', name: 'Content Writing', slug: 'content-writing', enabled: true },
      { id: 'sub_writ_2', name: 'Copywriting', slug: 'copywriting', enabled: true },
      { id: 'sub_writ_3', name: 'Translation', slug: 'translation', enabled: true },
      { id: 'sub_writ_4', name: 'Proofreading & Editing', slug: 'proofreading-editing', enabled: true },
      { id: 'sub_writ_5', name: 'Technical Writing', slug: 'technical-writing', enabled: true },
      { id: 'sub_writ_6', name: 'Blog Posts', slug: 'blog-posts', enabled: true },
      { id: 'sub_writ_7', name: 'Ghostwriting', slug: 'ghostwriting', enabled: true },
      { id: 'sub_writ_8', name: 'CV & Resume Writing', slug: 'resume-writing', enabled: true }
    ]
  },
  {
    id: 'cat_design',
    name: 'Design',
    slug: 'design',
    enabled: true,
    order: 4,
    subcategories: [
      { id: 'sub_des_1', name: 'Logo Design', slug: 'logo-design', enabled: true },
      { id: 'sub_des_2', name: 'Brand Identity', slug: 'brand-identity', enabled: true },
      { id: 'sub_des_3', name: 'Web & UI/UX Design', slug: 'web-ui-ux-design', enabled: true },
      { id: 'sub_des_4', name: 'Graphic Design', slug: 'graphic-design', enabled: true },
      { id: 'sub_des_5', name: 'Illustration', slug: 'illustration', enabled: true },
      { id: 'sub_des_6', name: 'Packaging Design', slug: 'packaging-design', enabled: true },
      { id: 'sub_des_7', name: '3D & CAD', slug: '3d-cad', enabled: true },
      { id: 'sub_des_8', name: 'Book Cover Design', slug: 'book-cover-design', enabled: true }
    ]
  },
  {
    id: 'cat_mkt',
    name: 'Digital Marketing',
    slug: 'digital-marketing',
    enabled: true,
    order: 5,
    subcategories: [
      { id: 'sub_mkt_1', name: 'Search Engine Optimization (SEO)', slug: 'seo', enabled: true },
      { id: 'sub_mkt_2', name: 'Social Media Marketing (SMM)', slug: 'smm', enabled: true },
      { id: 'sub_mkt_3', name: 'Pay Per Click (PPC)', slug: 'ppc', enabled: true },
      { id: 'sub_mkt_4', name: 'Content Marketing', slug: 'content-marketing', enabled: true },
      { id: 'sub_mkt_5', name: 'Email Marketing', slug: 'email-marketing', enabled: true },
      { id: 'sub_mkt_6', name: 'Affiliate Marketing', slug: 'affiliate-marketing', enabled: true },
      { id: 'sub_mkt_7', name: 'Lead Generation', slug: 'lead-generation', enabled: true }
    ]
  },
  {
    id: 'cat_video',
    name: 'Video, Photo & Image',
    slug: 'video-photo-image',
    enabled: true,
    order: 6,
    subcategories: [
      { id: 'sub_vid_1', name: 'Video Editing', slug: 'video-editing', enabled: true },
      { id: 'sub_vid_2', name: 'Animation & Motion Graphics', slug: 'animation-motion-graphics', enabled: true },
      { id: 'sub_vid_3', name: 'Video Production', slug: 'video-production', enabled: true },
      { id: 'sub_vid_4', name: 'Photo Editing', slug: 'photo-editing', enabled: true },
      { id: 'sub_vid_5', name: 'Product Photography', slug: 'product-photography', enabled: true },
      { id: 'sub_vid_6', name: 'Subtitles & Captions', slug: 'subtitles-captions', enabled: true },
      { id: 'sub_vid_7', name: 'Spoken Person Videos', slug: 'spokesperson-videos', enabled: true }
    ]
  },
  {
    id: 'cat_biz',
    name: 'Business',
    slug: 'business',
    enabled: true,
    order: 7,
    subcategories: [
      { id: 'sub_biz_1', name: 'Business Plans', slug: 'business-plans', enabled: true },
      { id: 'sub_biz_2', name: 'Financial Modeling', slug: 'financial-modeling', enabled: true },
      { id: 'sub_biz_3', name: 'Virtual Assistant', slug: 'virtual-assistant', enabled: true },
      { id: 'sub_biz_4', name: 'Market Research', slug: 'market-research', enabled: true },
      { id: 'sub_biz_5', name: 'Legal Consulting', slug: 'legal-consulting', enabled: true },
      { id: 'sub_biz_6', name: 'HR & Recruiting', slug: 'hr-recruiting', enabled: true },
      { id: 'sub_biz_7', name: 'Project Management', slug: 'project-management', enabled: true }
    ]
  },
  {
    id: 'cat_audio',
    name: 'Music & Audio',
    slug: 'music-audio',
    enabled: true,
    order: 8,
    subcategories: [
      { id: 'sub_aud_1', name: 'Voice Over', slug: 'voice-over', enabled: true },
      { id: 'sub_aud_2', name: 'Mixing & Mastering', slug: 'mixing-mastering', enabled: true },
      { id: 'sub_aud_3', name: 'Music Production', slug: 'music-production', enabled: true },
      { id: 'sub_aud_4', name: 'Podcast Editing', slug: 'podcast-editing', enabled: true },
      { id: 'sub_aud_5', name: 'Sound Design', slug: 'sound-design', enabled: true },
      { id: 'sub_aud_6', name: 'Audio Production', slug: 'audio-production', enabled: true },
      { id: 'sub_aud_7', name: 'Jingles & Intros', slug: 'jingles-intros', enabled: true }
    ]
  }
];

let supportTickets: SupportTicket[] = [];

export let auditLogs: AuditLog[] = [];

// ==========================================
// WORKSTREAM PERSISTENT STORAGE ENGINE
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'workstream_messages.json');
const ORDERS_FILE = path.join(DATA_DIR, 'workstream_orders.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'workstream_reviews.json');
const UPLOAD_INDEX_FILE = path.join(DATA_DIR, 'workstream_uploads.json'); // Added for completeness

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Atomic writing logic
const writeQueue = new Map<string, Promise<void>>();

async function writeJsonAtomic(filePath: string, data: any) {
  const serialized = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.tmp.${Math.random().toString(36).substring(7)}`;
  
  const existingTask = writeQueue.get(filePath) || Promise.resolve();
  
  const task = existingTask.then(async () => {
    ensureDataDirectory();
    fs.writeFileSync(tempPath, serialized, 'utf-8');
    fs.renameSync(tempPath, filePath);
  }).catch(err => {
    console.error(`Failed to atomic write ${filePath}:`, err);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  });
  
  writeQueue.set(filePath, task);
  return task;
}

export function saveMessagesToDisk() { writeJsonAtomic(MESSAGES_FILE, messages); }
export function saveOrdersToDisk() { writeJsonAtomic(ORDERS_FILE, orders); }
export function saveReviewsToDisk() { writeJsonAtomic(REVIEWS_FILE, reviews); }
export function saveWorkstreamUploadIndex() { writeJsonAtomic(WORKSTREAM_UPLOAD_INDEX_FILE, workstreamUploadIndex); }

function handleCorruption(filePath: string, error: any) {
  console.error(`CRITICAL: Data corruption in ${filePath}:`, error);
  if (process.env.ALLOW_EMPTY_DATA !== 'true') {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    fs.renameSync(filePath, backupPath);
    console.error(`Refusing to start. Broken file renamed to ${backupPath}. Set ALLOW_EMPTY_DATA=true to bypass.`);
    process.exit(1);
  }
}

const MAX_AUDIT_LOGS = 1000;
const orderIndex = new Map<string, Order>();
const messageIndex = new Map<string, Message[]>();

// Simple in-memory locking mechanism to prevent race conditions on sensitive order state transitions.
const orderStateLocks = new Set<string>();

function acquireOrderLock(orderId: string) {
  if (orderStateLocks.has(orderId)) {
    throw new Error('Action rejected: This order is currently being processed by another operation. Please retry in a moment.');
  }
  orderStateLocks.add(orderId);
}

function releaseOrderLock(orderId: string) {
  orderStateLocks.delete(orderId);
}

function registerOrder(o: Order) {
  if (!o.id) return;
  orderIndex.set(o.id, o);
}

function registerMessage(m: Message) {
  if (!m.orderId) return;
  const list = messageIndex.get(m.orderId) || [];
  list.push(m);
  messageIndex.set(m.orderId, list);
}

function recordOrder(o: Order) {
  orders.unshift(o);
  registerOrder(o);
}

function recordMessage(m: Message) {
  messages.push(m);
  registerMessage(m);
}

function registerAuditLog(log: AuditLog) {
  auditLogs.unshift(log);
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs = auditLogs.slice(0, MAX_AUDIT_LOGS);
  }
}

function loadInitialOrdersAndMessages() {
  ensureDataDirectory();
  
  orderIndex.clear();
  messageIndex.clear();
  
  // 1. Load Orders
  if (fs.existsSync(ORDERS_FILE)) {
    try {
      const data = fs.readFileSync(ORDERS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        orders = parsed;
        orders.forEach(registerOrder);
      } else {
        orders = [...SEED_ORDERS];
        orders.forEach(registerOrder);
      }
    } catch (e) {
      handleCorruption(ORDERS_FILE, e);
    }
  } else {
    orders.forEach(registerOrder);
  }

  // 2. Load Messages
  if (fs.existsSync(MESSAGES_FILE)) {
    try {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        messages = parsed;
      }
    } catch (e) {
      handleCorruption(MESSAGES_FILE, e);
    }
  }

  // 3. Load Reviews
  if (fs.existsSync(REVIEWS_FILE)) {
    try {
      const data = fs.readFileSync(REVIEWS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        reviews = parsed;
      }
    } catch (e) {
      handleCorruption(REVIEWS_FILE, e);
    }
  }

  // One-time migration & Index Population
  let messagesMigrated = false;
  for (const msg of messages) {
    if (!msg.timestamp || !/\d{4}-\d{2}-\d{2}/.test(msg.timestamp)) {
      const order = orderIndex.get(msg.orderId);
      let baseDate = order?.createdAt;
      if (!baseDate || !/\d{4}-\d{2}-\d{2}/.test(baseDate)) {
        baseDate = new Date().toISOString();
      }
      const datePart = baseDate.split('T')[0];

      const timeMatch = msg.timestamp ? msg.timestamp.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i) : null;
      let hours = 0, minutes = 0, seconds = 0;
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const ampm = timeMatch[4] ? timeMatch[4].toUpperCase() : '';
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
      }

      const d = new Date(`${datePart}T00:00:00.000Z`);
      if (!isNaN(d.getTime())) {
        d.setUTCHours(hours, minutes, seconds, 0);
        msg.timestamp = d.toISOString();
      } else {
        msg.timestamp = new Date().toISOString();
      }
      messagesMigrated = true;
    }
    registerMessage(msg);
  }
  
  if (messagesMigrated) {
    saveMessagesToDisk();
    console.log('Migrated legacy non-ISO message timestamps to ISO strings.');
  }

  // Synchronize user review stats
  for (const u of users) {
    const userReviews = reviews.filter(r => r.targetUserId === u.id);
    if (userReviews.length > 0) {
      u.reviewsCount = userReviews.length;
      u.rating = Number((userReviews.reduce((sum, r) => sum + r.rating, 0) / userReviews.length).toFixed(1));
    }
  }

  saveOrdersToDisk();
  saveMessagesToDisk();
  saveReviewsToDisk();
}

// Execute initial load
loadInitialOrdersAndMessages();

function enrichOrderWithServiceInfo(o: Order, isAdmin: boolean = false) {
  // Link a gig only when the order references it (or its title matches exactly). Guessing "the seller's first gig"
  // gave proposal / custom workstreams the wrong thumbnail, title and service link.
  const gig = (o.gigId ? gigs.find(g => g.id === o.gigId) : undefined) ||
              gigs.find(g => g.title.toLowerCase() === o.title.toLowerCase());
  const project = (o.projectId ? projects.find(p => p.id === o.projectId) : undefined) ||
                  projects.find(p => p.title.toLowerCase() === o.title.toLowerCase());
  const seller = users.find(u => u.id === o.sellerId);
  const buyer = users.find(u => u.id === o.buyerId);
  const sellerUsername = o.sellerUsername || gig?.freelancerUsername || (seller?.username || seller?.name || '').toLowerCase().replace(/\s+/g, '_');
  const buyerUsername = o.buyerUsername || (buyer?.username || buyer?.name || '').toLowerCase().replace(/\s+/g, '_');
  const gigSlug = o.gigSlug || gig?.slug;
  const serviceUrl = o.serviceUrl || (gig && gigSlug ? `/${sellerUsername}/${gigSlug}` : project ? `/project/${project.slug}` : undefined);
  const serviceTitle = gig?.title || project?.title || o.serviceTitle || o.title;
  const serviceThumbnail = o.serviceThumbnail || gig?.image || 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=500&fit=crop';

  const orderMessages = messageIndex.get(o.id) || [];
  const lastMsg = orderMessages.length > 0 
    ? [...orderMessages].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] 
    : undefined;

  const reviewWindowDays = getReviewWindowDays();
  const reviewWindowEnabled = isAutoAcceptEnabled();
  let reviewWindowExpiresAt: string | undefined;
  if (o.status === 'delivered' && Array.isArray(o.deliveryHistory) && o.deliveryHistory.length > 0) {
    const lastDelivery = o.deliveryHistory[o.deliveryHistory.length - 1];
    if (lastDelivery?.deliveredAt) {
      const deliveredTime = new Date(lastDelivery.deliveredAt).getTime();
      if (!isNaN(deliveredTime)) {
        reviewWindowExpiresAt = new Date(deliveredTime + reviewWindowDays * 24 * 60 * 60 * 1000).toISOString();
      }
    }
  }

  const base = {
    ...o,
    gigId: o.gigId || gig?.id,
    projectId: o.projectId || project?.id,
    sellerUsername,
    buyerUsername,
    gigSlug,
    serviceUrl,
    serviceTitle,
    serviceThumbnail,
    lastMessage: lastMsg?.text,
    lastMessageTime: lastMsg?.timestamp,
    isTimerPaused: Boolean(o.isTimerPaused),
    reviewWindowDays,
    reviewWindowEnabled,
    reviewWindowExpiresAt,
    acceptedVersion: o.acceptedVersion
  };

  if (!isAdmin) {
    const { adminNotes, isMuted, ...sanitized } = base;
    return sanitized;
  }
  return base;
}

export function getReviewWindowDays(): number {
  if (process.env.REVIEW_WINDOW_DAYS !== undefined) {
    const parsed = Number(process.env.REVIEW_WINDOW_DAYS);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  const settings = siteSettings.getSettings();
  if (typeof settings.marketplace?.autoCompleteDeliveredDays === 'number') {
    return settings.marketplace.autoCompleteDeliveredDays;
  }
  return 3;
}

export function isAutoAcceptEnabled(): boolean {
  if (process.env.AUTO_ACCEPT_ENABLED !== undefined) {
    const v = process.env.AUTO_ACCEPT_ENABLED.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  }
  const settings = siteSettings.getSettings();
  if (settings.marketplace?.autoCompleteDeliveredEnabled === false) return false;
  return getReviewWindowDays() > 0;
}

// REST API Endpoints - Site & Fee Settings
const handleGetSiteSettings = (req: Request, res: Response) => {
  const flattened = siteSettings.getFlattenedSettings();
  res.json({ success: true, settings: flattened, ...flattened });
};

const handlePostSiteSettings = (req: Request, res: Response) => {
  try {
    const actor = (req as any).authenticatedUser?.name || req.body?.updatedBy || 'Super Admin';
    const updatedFlattened = siteSettings.updateFromFlatObject(req.body || {}, actor);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor,
      role: 'super_admin',
      action: 'SITE_FEE_SETTINGS_UPDATED',
      target: 'Platform Settings & Fee Structure',
      details: `Updated settings saved to disk and applied across backend engine: Commission=${updatedFlattened.freelancerCommissionRate}%, EscrowHold=${updatedFlattened.escrowHoldDays}d, ClientFee=${updatedFlattened.buyerProcessingFeeRate}%, SmallOrderFee=$${updatedFlattened.smallOrderFee} under $${updatedFlattened.smallOrderFeeThreshold}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, settings: updatedFlattened, ...updatedFlattened });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update site settings' });
  }
};

app.get('/api/admin/settings', handleGetSiteSettings);
app.get('/api/admin/site-settings', handleGetSiteSettings);
// Fee settings control real money movement: only administrators may change them.
app.post('/api/admin/settings', requireAdmin, handlePostSiteSettings);
app.patch('/api/admin/settings', requireAdmin, handlePostSiteSettings);
app.post('/api/admin/site-settings', requireAdmin, handlePostSiteSettings);
app.patch('/api/admin/site-settings', requireAdmin, handlePostSiteSettings);

// Memberships & Quotas Admin Endpoints
app.get('/api/admin/memberships', requireAdmin, (req, res) => {
  try {
    const currentSettings = siteSettings.getSettings();
    res.json({
      success: true,
      memberships: currentSettings.memberships,
      marketplace: currentSettings.marketplace
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/memberships', requireAdmin, (req, res) => {
  try {
    const { memberships, marketplace } = req.body || {};
    const actor = (req as any).authenticatedUser?.name || 'Super Admin';
    if (memberships) {
      if (typeof memberships.membershipsEnabled === 'boolean') {
        DEFAULT_SITE_SETTINGS.memberships.membershipsEnabled = memberships.membershipsEnabled;
      }
      if (Array.isArray(memberships.freelancerPlans)) {
        DEFAULT_SITE_SETTINGS.memberships.freelancerPlans = memberships.freelancerPlans;
      }
      if (Array.isArray(memberships.buyerPlans)) {
        DEFAULT_SITE_SETTINGS.memberships.buyerPlans = memberships.buyerPlans;
      }
      siteSettings.updateSection('memberships', DEFAULT_SITE_SETTINGS.memberships, actor);
    }
    if (marketplace) {
      if (marketplace.minimumGigPrice !== undefined) DEFAULT_SITE_SETTINGS.marketplace.minimumGigPrice = Number(marketplace.minimumGigPrice);
      if (marketplace.maximumGigPrice !== undefined) DEFAULT_SITE_SETTINGS.marketplace.maximumGigPrice = Number(marketplace.maximumGigPrice);
      if (marketplace.minimumProjectBudget !== undefined) DEFAULT_SITE_SETTINGS.marketplace.minimumProjectBudget = Number(marketplace.minimumProjectBudget);
      if (marketplace.maxActiveOrdersPerFreelancer !== undefined) DEFAULT_SITE_SETTINGS.marketplace.maxActiveOrdersPerFreelancer = Number(marketplace.maxActiveOrdersPerFreelancer);
      if (marketplace.gigModerationRequired !== undefined) DEFAULT_SITE_SETTINGS.marketplace.gigModerationRequired = Boolean(marketplace.gigModerationRequired);
      siteSettings.updateSection('marketplace', DEFAULT_SITE_SETTINGS.marketplace, actor);
    }

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor,
      role: 'super_admin',
      action: 'MEMBERSHIPS_QUOTAS_UPDATED',
      target: 'Platform Membership & Gig Quotas',
      details: 'Updated membership plan limits and marketplace gig/project constraints',
      timestamp: new Date().toLocaleString()
    });

    const activeSettings = siteSettings.getSettings();
    res.json({
      success: true,
      memberships: activeSettings.memberships,
      marketplace: activeSettings.marketplace
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// User Quota Status & Membership Upgrade Endpoints
app.get('/api/user/quota-status', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const user = users.find(u => u.id === authUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const activeSettings = siteSettings.getSettings();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const bidsUsed = proposals.filter(p => p.freelancerId === user.id && p.createdAt && p.createdAt.substring(0, 10) >= thirtyDaysAgo).length;
    const jobPostsUsed = projects.filter(p => p.buyerId === user.id && p.createdAt && p.createdAt.substring(0, 10) >= thirtyDaysAgo).length;

    const freelancerPlanId = (user as any).membershipTier || 'plan_free';
    const freelancerPlan = activeSettings.memberships.freelancerPlans.find(p => p.id === freelancerPlanId) || activeSettings.memberships.freelancerPlans[0];

    const buyerPlanId = (user as any).buyerMembershipTier || 'buyer_free';
    const buyerPlan = activeSettings.memberships.buyerPlans.find(p => p.id === buyerPlanId) || activeSettings.memberships.buyerPlans[0];

    res.json({
      success: true,
      membershipsEnabled: activeSettings.memberships.membershipsEnabled,
      freelancer: {
        planId: freelancerPlanId,
        planName: freelancerPlan?.name || 'Standard Freelancer',
        bidsUsed,
        bidsLimit: freelancerPlan?.bidsPerMonth ?? 15,
        bidsRemaining: Math.max(0, (freelancerPlan?.bidsPerMonth ?? 15) - bidsUsed)
      },
      buyer: {
        planId: buyerPlanId,
        planName: buyerPlan?.name || 'Standard Client',
        jobPostsUsed,
        jobPostsLimit: buyerPlan?.jobPostsPerMonth ?? 10,
        jobPostsRemaining: Math.max(0, (buyerPlan?.jobPostsPerMonth ?? 10) - jobPostsUsed)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/membership', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const user = users.find(u => u.id === authUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { freelancerPlanId, buyerPlanId } = req.body || {};
    if (freelancerPlanId) {
      (user as any).membershipTier = freelancerPlanId;
    }
    if (buyerPlanId) {
      (user as any).buyerMembershipTier = buyerPlanId;
    }

    res.json({
      success: true,
      message: 'Membership updated successfully',
      user
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ORDER PRICING & FEE QUOTES (server is the only authority on what a client is charged)
// ==========================================
// Resolves the gig price (gig + selected extras) from server-side data. Never trusts a price sent by the browser.
function resolveGigOrderPrice(gigId: string, extraIds: unknown): { gig: Gig; gigPrice: number; extrasTitles: string[] } {
  const gig = gigs.find(g => g.id === gigId);
  if (!gig) throw Object.assign(new Error('Gig not found.'), { status: 404 });
  if (gig.status && gig.status !== 'published') throw Object.assign(new Error('This gig is not available for ordering.'), { status: 400 });
  const ids = Array.isArray(extraIds) ? Array.from(new Set(extraIds.map(String))) : [];
  let cents = Math.round(Number(gig.price) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw Object.assign(new Error('This gig has no valid price.'), { status: 400 });
  const extrasTitles: string[] = [];
  for (const id of ids) {
    const extra = (gig.extras || []).find(e => e.id === id);
    if (!extra) throw Object.assign(new Error(`Unknown add-on "${id}" for this gig.`), { status: 400 });
    cents += Math.round(Number(extra.price) * 100);
    extrasTitles.push(extra.title);
  }
  return { gig, gigPrice: cents / 100, extrasTitles };
}

// Public fee quote for the checkout screen: same math the ledger will apply when the order is funded.
app.get('/api/fees/quote', (req, res) => {
  try {
    let gigPrice: number;
    if (typeof req.query.gigId === 'string' && req.query.gigId) {
      const extraIds = typeof req.query.extraIds === 'string' && req.query.extraIds ? req.query.extraIds.split(',') : [];
      gigPrice = resolveGigOrderPrice(req.query.gigId, extraIds).gigPrice;
    } else {
      gigPrice = Number(req.query.amount);
    }
    if (!Number.isFinite(gigPrice) || gigPrice < 0) return res.status(400).json({ error: 'A valid gigId or amount is required.' });
    const q = financeLedger.quoteOrder(gigPrice);
    res.json({ ...q, config: financeLedger.getFeeConfig() });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ==========================================
// MONEY HELPERS (all balance changes go through the ledger engine)
// ==========================================
function syncUserBalances() {
  for (const u of users) {
    const b = financeLedger.getWalletBalance(u.id);
    if (b !== null) u.walletBalance = b;
  }
}
syncUserBalances();

// Every regular user gets a ledger wallet the first time they touch money.
function ensureWallet(userId: string) {
  const u = users.find(x => x.id === userId);
  if (!u || u.role === 'admin' || u.role === 'super_admin') return;
  financeLedger.ensureWallet({ userId: u.id, name: u.name, email: u.email, role: gigs.some(g => g.freelancerId === u.id) ? 'freelancer' : 'buyer' });
}

function pushSystemMessage(orderId: string, text: string) {
  recordMessage({
    id: 'msg_' + randomUUID().slice(0, 12),
    orderId,
    senderId: 'system',
    senderName: 'WorkSphere Escrow Vault',
    text,
    timestamp: new Date().toISOString()
  } as Message);
}

function closeActiveDispute(orderId: string, status: Dispute['status'], notes: string) {
  const d = disputes.find(x => x.orderId === orderId && (x.status === 'open' || x.status === 'under_investigation'));
  if (d) { d.status = status; d.resolutionNotes = notes; }
}

// Track orders whose release side-effects (seller.earned, seller.completedJobs) have been executed
const releaseCompletedOrders = new Set<string>();
for (const o of orders) {
  if (o.status === 'completed') releaseCompletedOrders.add(o.id);
}

const refundCompletedOrders = new Set<string>();
for (const o of orders) {
  if (o.status === 'cancelled') refundCompletedOrders.add(o.id);
}

// In-memory requestKey cache for order release and refund idempotency
const requestKeyCache = new Map<string, any>();

function assertOrderOpen(order: Order) {
  if (order.status === 'completed') throw new Error('Order is already completed; funds were already released.');
  if (order.status === 'cancelled') throw new Error('Order is already cancelled; funds were already handled.');
}

function releaseOrderFunds(order: Order, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  if (order.status === 'completed') {
    const replayed = financeLedger.replay<{ journal: any; freelancerNet: number; platformFee: number }>(requestKey);
    if (replayed) {
      if (requestKey) requestKeyCache.set(requestKey, replayed);
      return replayed;
    }
    throw new Error('Order is already completed; funds were already released.');
  }
  assertOrderOpen(order);
  const result = financeLedger.releaseEscrow({ orderId: order.id, actor, reason, requestKey });
  order.status = 'completed';
  if (!order.completedAt) {
    order.completedAt = new Date().toISOString();
  }
  if (Array.isArray(order.deliveryHistory) && order.deliveryHistory.length > 0) {
    order.acceptedVersion = order.deliveryHistory[order.deliveryHistory.length - 1].version;
  }
  const seller = users.find(u => u.id === order.sellerId);
  if (seller && !releaseCompletedOrders.has(order.id)) {
    releaseCompletedOrders.add(order.id);
    seller.earned = (seller.earned || 0) + result.freelancerNet;
    seller.completedJobs = (seller.completedJobs || 0) + 1;
  }
  syncUserBalances();
  saveOrdersToDisk();
  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

function refundOrderFunds(order: Order, amount: number | undefined, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  if (order.status === 'cancelled') {
    const replayed = financeLedger.replay<{ journal: any; buyerWallet: any; refunded: number; remaining: number }>(requestKey);
    if (replayed) {
      if (requestKey) requestKeyCache.set(requestKey, replayed);
      return replayed;
    }
    throw new Error('Order is already cancelled; funds were already handled.');
  }
  assertOrderOpen(order);
  const result = financeLedger.refundEscrow({ orderId: order.id, amount, reason, actor, requestKey });
  if (result.remaining === 0) {
    order.status = 'cancelled';
    refundCompletedOrders.add(order.id);
  }
  const existingRecord = refunds.find(r => r.orderId === order.id && (r.status === 'pending' || r.amount === result.refunded));
  if (existingRecord) {
    existingRecord.status = 'approved';
    existingRecord.amount = result.refunded;
  } else {
    refunds.push({
      id: 'ref_' + randomUUID().slice(0, 12),
      orderId: order.id,
      buyerId: order.buyerId,
      amount: result.refunded,
      reason,
      status: 'approved',
      createdAt: new Date().toISOString().substring(0, 10)
    });
  }
  syncUserBalances();
  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

function splitOrderFunds(order: Order, refundAmount: number, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  assertOrderOpen(order);
  const result = financeLedger.resolveEscrowSplit({ orderId: order.id, refundAmount, reason, actor });
  order.status = 'completed';
  const seller = users.find(u => u.id === order.sellerId);
  if (seller && !releaseCompletedOrders.has(order.id)) {
    releaseCompletedOrders.add(order.id);
    seller.earned = (seller.earned || 0) + result.release.freelancerNet;
    seller.completedJobs = (seller.completedJobs || 0) + 1;
  }
  const existingRecord = refunds.find(r => r.orderId === order.id && (r.status === 'pending' || r.amount === refundAmount));
  if (existingRecord) {
    existingRecord.status = 'approved';
    existingRecord.amount = refundAmount;
  } else {
    refunds.push({
      id: 'ref_' + randomUUID().slice(0, 12),
      orderId: order.id,
      buyerId: order.buyerId,
      amount: refundAmount,
      reason,
      status: 'approved',
      createdAt: new Date().toISOString().substring(0, 10)
    });
  }
  syncUserBalances();
  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

app.get('/api/users', (req, res) => {
  res.json(users.map(safeUser));
});
function sanitizePublicGig(g: Gig): Omit<Gig, 'moderationStatus' | 'moderationNotes'> {
  const { moderationStatus, moderationNotes, ...publicGig } = g;
  return publicGig;
}

function sanitizePublicProject(p: Project): Omit<Project, 'moderationStatus' | 'moderationNotes'> {
  const { moderationStatus, moderationNotes, ...publicProj } = p;
  return publicProj;
}

function isGigPublic(g: Gig): boolean {
  if (g.status !== 'published') return false;
  if (g.moderationStatus && g.moderationStatus !== 'approved') return false;
  const author = users.find(u => u.id === g.freelancerId);
  if (author && author.status !== 'active') return false;
  return true;
}

function isProjectPublic(p: Project): boolean {
  if (p.status !== 'open' && p.status !== 'published') return false;
  if (p.moderationStatus && p.moderationStatus !== 'approved') return false;
  const author = users.find(u => u.id === p.buyerId);
  if (author && author.status !== 'active') return false;
  return true;
}

// Public Marketplace Endpoints: returns only published, active, approved listings without internal moderation/private metadata
app.get('/api/gigs', (req, res) => {
  const publicGigs = gigs.filter(isGigPublic).map(sanitizePublicGig);
  res.json(publicGigs);
});

app.get('/api/projects', (req, res) => {
  const publicProjects = projects.filter(isProjectPublic).map(sanitizePublicProject);
  res.json(publicProjects);
});

// Single Listing Detail: public users receive only public sanitized listings; owners/admins may receive full listing
app.get('/api/gigs/:id', (req, res) => {
  const gig = gigs.find(g => g.id === req.params.id);
  if (!gig) return res.status(404).json({ error: 'Gig not found' });

  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  const isOwner = authUserId && gig.freelancerId === authUserId;

  if (isGigPublic(gig)) {
    if (isAdmin || isOwner) return res.json(gig);
    return res.json(sanitizePublicGig(gig));
  }

  if (isAdmin || isOwner) {
    return res.json(gig);
  }
  return res.status(404).json({ error: 'Gig not found or unavailable' });
});

app.get('/api/projects/:id', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  const isOwner = authUserId && project.buyerId === authUserId;

  if (isProjectPublic(project)) {
    if (isAdmin || isOwner) return res.json(project);
    return res.json(sanitizePublicProject(project));
  }

  if (isAdmin || isOwner) {
    return res.json(project);
  }
  return res.status(404).json({ error: 'Project not found or unavailable' });
});

// Authenticated Owner Listings
app.get('/api/my/gigs', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const myGigs = gigs.filter(g => g.freelancerId === authUserId);
  res.json(myGigs);
});

app.get('/api/my/projects', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const myProjects = projects.filter(p => p.buyerId === authUserId);
  res.json(myProjects);
});
app.get('/api/proposals', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    // Bids and cover letters are private to the freelancer, the project owner and staff.
    return res.json([]);
  }
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userProposals = proposals.filter(p =>
    isAdmin ||
    p.freelancerId === authUserId ||
    projects.some(pr => pr.id === p.projectId && pr.buyerId === authUserId));
  res.json(userProposals);
});

app.get('/api/orders', requireAuth, (req, res) => {
  // Login is required: previously a request with no token was treated like an admin and received every order.
  const authUserId = resolveAuthenticatedUserId(req)!;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userOrders = orders.filter(o => isAdmin || o.buyerId === authUserId || o.sellerId === authUserId);
  res.json(userOrders.map(o => enrichOrderWithServiceInfo(o, isAdmin)));
});

// Single Order Workspace Detail
app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Login is required: an anonymous caller used to count as admin and could read the whole order and its messages.
  const authUserId = resolveAuthenticatedUserId(req)!;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && order.buyerId !== authUserId && order.sellerId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Access to this order is restricted to participants.' });
  }
  const enriched = enrichOrderWithServiceInfo(order, isAdmin);
  const buyer = users.find(u => u.id === order.buyerId);
  const seller = users.find(u => u.id === order.sellerId);
  const orderMessages = messageIndex.get(order.id) || [];
  const dispute = disputes.find(d => d.orderId === order.id);

  res.json({
    ...enriched,
    buyer: buyer ? (isAdmin ? safeUser(buyer) : orderParticipantSafeUser(buyer)) : null,
    seller: seller ? (isAdmin ? safeUser(seller) : orderParticipantSafeUser(seller)) : null,
    messages: orderMessages,
    dispute
  });
});

// Extend Order Deadline
app.patch('/api/orders/:id/extend-time', requireAdmin, (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { days, newDueDate, reason } = req.body;
  const oldDate = order.dueDate;
  let targetDate = newDueDate;

  if (days && Number(days) > 0) {
    const current = new Date(order.dueDate || Date.now());
    current.setDate(current.getDate() + Number(days));
    targetDate = current.toISOString().split('T')[0];
  } else if (!targetDate) {
    targetDate = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
  }

  order.dueDate = targetDate;

  // Add system event message in chat
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'System / Admin Notice',
    text: `⏱️ Deadline extended from ${oldDate} to ${order.dueDate}. ${reason ? 'Reason: ' + reason : 'Admin approved time extension.'}`,
    timestamp: new Date().toISOString()
  };
  recordMessage(sysMsg);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'ORDER_DEADLINE_EXTENDED',
    target: `Order #${order.id}`,
    details: `Extended deadline to ${order.dueDate} (${days || 'custom'} days). ${reason || ''}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, order: enrichOrderWithServiceInfo(order), message: sysMsg });
});

// Save Admin Private Notes
app.post('/api/orders/:id/admin-notes', requireAdmin, (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.adminNotes = req.body.notes || '';
  res.json({ success: true, adminNotes: order.adminNotes });
});

// Upload Deliverable Override / File
app.post('/api/orders/:id/deliverable', requireAuth, (req, res) => {
  const orderId = req.params.id;
  acquireOrderLock(orderId);
  try {
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const authUserId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && order.sellerId !== authUserId) {
      return res.status(403).json({ error: 'Forbidden: Only the seller or an administrator can submit deliverables.' });
    }

    // Only permit delivery submission from valid active states
    const allowedStatuses = ['funded_in_escrow', 'in_progress', 'revision', 'draft_review', 'delivered', 'work_in_progress', 'completed'];
    if (!allowedStatuses.includes(order.status)) {
      return res.status(409).json({ error: `Cannot submit a deliverable for an order in "${order.status}" status.` });
    }
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot submit a deliverable for a completed order.' });
    }

    if (!order.deliverableFiles) order.deliverableFiles = [];
    if (!order.deliveryHistory) order.deliveryHistory = [];

    const rawFiles = Array.isArray(req.body.files) && req.body.files.length > 0 
      ? req.body.files 
      : (req.body.name ? [{ name: req.body.name, size: req.body.size, url: req.body.url }] : []);

    // A delivery may be a file, a URL/reference (plain text), a written message, or any combination.
    // URL/reference text is accepted as-is: no reachability/domain/scheme checks, never made clickable.
    const rawNotes = typeof req.body.notes === 'string' ? req.body.notes
      : (typeof req.body.message === 'string' ? req.body.message : '');
    const rawReference = typeof req.body.reference === 'string' ? req.body.reference
      : (typeof req.body.referenceUrl === 'string' ? req.body.referenceUrl
      : (!req.body.name && typeof req.body.url === 'string' ? req.body.url : ''));
    const trimmedNotes = rawNotes.trim();
    const trimmedReference = rawReference.trim();

    if (rawFiles.length === 0 && !trimmedNotes && !trimmedReference) {
      return res.status(400).json({ error: 'Add a file, a URL/reference, or a written completion message to submit a delivery.' });
    }

    let validatedFiles: Array<{ name: string; size: string; url: string }> = [];
    if (rawFiles.length > 0) {
      const validation = validateStoredWorkstreamFiles(rawFiles, caller);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }
      validatedFiles = validation.files;
    }

    const isDraft = Boolean(req.body.isDraft);
    const uploadedFiles = validatedFiles.map((f: any, idx: number) => ({
      id: 'deliv_' + Date.now() + '_' + idx,
      name: f.name,
      size: f.size,
      url: f.url,
      uploadedAt: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      type: isDraft ? 'draft' : 'deliverable'
    }));

    order.deliverableFiles.push(...uploadedFiles);
    order.status = isDraft ? 'draft_review' : 'delivered';
    const sanitizedNotes = trimmedNotes ? escapeHtml(trimmedNotes) : '';
    // Reference is stored verbatim (trimmed, length-capped) and only ever rendered as plain text by React.
    const storedReference = trimmedReference.slice(0, 2000);
    order.deliveryNotes = sanitizedNotes;
    order.deliveryReference = storedReference;

    const version = order.deliveryHistory.length + 1;
    order.deliveryHistory.push({
      version,
      notes: sanitizedNotes,
      reference: storedReference || undefined,
      files: uploadedFiles,
      deliveredAt: new Date().toISOString()
    });

    if (order.revisions && order.revisions.length > 0) {
      for (const rev of order.revisions) {
        if (rev.status === 'requested') {
          rev.status = 'resolved';
        }
      }
    }

    const summaryParts: string[] = [];
    if (uploadedFiles.length > 0) summaryParts.push(uploadedFiles.map((f: any) => `"${f.name}" (${f.size})`).join(', '));
    if (storedReference) summaryParts.push(`Reference: ${storedReference}`);
    const fileSummary = summaryParts.length > 0 ? summaryParts.join(' | ') : 'written completion update';
    const sysMsg: Message = {
      id: 'msg_' + Date.now(),
      orderId: order.id,
      senderId: 'system',
      senderName: 'WorkSphere Deliveries',
      text: `📦 Deliverable (v${version}) submitted: ${fileSummary}${sanitizedNotes ? ` — "${sanitizedNotes}"` : ''}. Buyer review window initiated.`,
      timestamp: new Date().toISOString(),
      type: 'system',
      metadata: {
        action: 'deliverable_submitted',
        version,
        notes: sanitizedNotes,
        reference: storedReference || undefined
      }
    };
    recordMessage(sysMsg);
    saveMessagesToDisk();
    saveOrdersToDisk();
    broadcastMessage(sysMsg, order.id);

    res.json({ success: true, files: uploadedFiles, file: uploadedFiles[0], order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Request Revision on Deliverable
app.post('/api/orders/:id/revision', requireAuth, (req, res) => {
  const orderId = req.params.id;
  acquireOrderLock(orderId);
  try {
    const order = orderIndex.get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && order.buyerId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Only the order buyer or an administrator can request revisions.' });
  }

  const allowedRevisionStatuses = ['delivered', 'in_progress', 'funded_in_escrow', 'revision', 'draft_review', 'work_in_progress'];
  if (!allowedRevisionStatuses.includes(order.status)) {
    return res.status(409).json({ error: `Cannot request revisions for an order in "${order.status}" status.` });
  }

  const hasDelivery = (Array.isArray(order.deliverableFiles) && order.deliverableFiles.length > 0) || (Array.isArray(order.deliveryHistory) && order.deliveryHistory.length > 0) || ['delivered', 'revision', 'draft_review', 'work_in_progress'].includes(order.status);
  if (!hasDelivery) {
    return res.status(409).json({ error: 'Cannot request revisions before work or a draft has been delivered by the freelancer.' });
  }

  const rawReason = (req.body.reason || '').trim();
  if (!rawReason) {
    return res.status(400).json({ error: 'A revision reason is required.' });
  }
  const reason = escapeHtml(rawReason);
  if (!order.revisions) order.revisions = [];
  const revisionEntry = {
    id: 'rev_' + Date.now(),
    requestedAt: new Date().toISOString(),
    reason,
    status: 'requested',
    deliveryVersion: order.deliveryHistory?.length || 1
  };
  order.revisions.push(revisionEntry);
  order.status = 'revision';

  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'WorkSphere Revision Desk',
    text: `🔄 Revision requested on delivery v${revisionEntry.deliveryVersion}: "${reason}"`,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: {
      action: 'revision_requested',
      reason,
      revisionId: revisionEntry.id,
      deliveryVersion: revisionEntry.deliveryVersion
    }
  };
  recordMessage(sysMsg);
  saveMessagesToDisk();
  saveOrdersToDisk();
  broadcastMessage(sysMsg, order.id);

    res.json({ success: true, revision: revisionEntry, order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Participant (Buyer or Seller) Dispute Creation Flow
app.post('/api/orders/:id/dispute', requireAuth, (req, res) => {
  const orderId = req.params.id;
  acquireOrderLock(orderId);
  try {
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const authUserId = (req as any).authenticatedUserId;
    if (order.buyerId !== authUserId && order.sellerId !== authUserId) {
      return res.status(403).json({ error: 'Forbidden: Only order participants can open a dispute.' });
    }
    const rawReason = (req.body.reason || '').trim();
    if (!rawReason) {
      return res.status(400).json({ error: 'A dispute reason is required.' });
    }
    const reason = escapeHtml(rawReason);
    const existingDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
    if (existingDispute) {
      return res.status(400).json({ error: 'An active dispute already exists for this order.' });
    }

    const newDispute: Dispute = {
      id: 'disp_' + Date.now(),
      orderId: order.id,
      raisedBy: authUserId === order.buyerId ? 'buyer' : 'seller',
      reason,
      evidence: escapeHtml(req.body.evidence || ''),
      status: 'open',
      createdAt: new Date().toISOString()
    };
    disputes.push(newDispute);
    order.status = 'disputed';

    const sysMsg: Message = {
      id: 'msg_' + Date.now(),
      orderId: order.id,
      senderId: 'system',
      senderName: 'WorkSphere Dispute Resolution Desk',
      text: `🚨 Dispute opened by ${newDispute.raisedBy}: "${reason}". Order placed under review.`,
      timestamp: new Date().toISOString(),
      type: 'system',
      metadata: {
        action: 'dispute_opened',
        disputeId: newDispute.id,
        raisedBy: newDispute.raisedBy
      }
    };
    recordMessage(sysMsg);
    saveMessagesToDisk();
    saveOrdersToDisk();
    broadcastMessage(sysMsg, order.id);

    res.json({ success: true, dispute: newDispute, order: enrichOrderWithServiceInfo(order) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Toggle Chat Mute
app.patch('/api/orders/:id/mute', requireRole(['admin', 'super_admin', 'support']), (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.isMuted = !order.isMuted;
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'Administration Alert',
    text: order.isMuted 
      ? `🔒 Chat paused by Administrator during case review. Neither party may send messages.`
      : `🔓 Chat unlocked by Administrator. Standard messaging resumed.`,
    timestamp: new Date().toISOString()
  };
  recordMessage(sysMsg);

  res.json({ success: true, isMuted: order.isMuted });
});

// Toggle Pause Order Timer
app.patch('/api/orders/:id/pause-timer', requireRole(['admin', 'super_admin', 'support']), (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.isTimerPaused = !order.isTimerPaused;
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'Administration Alert',
    text: order.isTimerPaused 
      ? `⏸️ Delivery countdown paused by Administrator pending dispute/clarification.`
      : `▶️ Delivery countdown resumed by Administrator. Normal timer active.`,
    timestamp: new Date().toISOString()
  };
  recordMessage(sysMsg);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: order.isTimerPaused ? 'ORDER_TIMER_PAUSED' : 'ORDER_TIMER_RESUMED',
    target: `Order #${order.id}`,
    details: order.isTimerPaused ? 'Timer paused by Admin' : 'Timer resumed by Admin',
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, isTimerPaused: order.isTimerPaused, order: enrichOrderWithServiceInfo(order) });
});

// Update user online / available now status
app.patch('/api/users/availability', requireAuth, (req, res) => {
  const userId = (req as any).authenticatedUserId;
  const { isAvailableNow } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.isAvailableNow = !!isAvailableNow;
  res.json({ success: true, user: safeUser(user) });
});

// Flag / Unflag User for Terms of Service review
app.post('/api/users/:id/flag', requireAdmin, (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.isFlagged = !user.isFlagged;
  user.flagReason = user.isFlagged ? (req.body.reason || 'Flagged for TOS investigation.') : undefined;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: adminActor(req),
    role: 'admin',
    action: user.isFlagged ? 'USER_FLAGGED_TOS' : 'USER_UNFLAGGED_TOS',
    target: `User #${user.id} (${user.name})`,
    details: user.flagReason || 'Flag removed',
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, isFlagged: user.isFlagged, flagReason: user.flagReason, user });
});

// Force Complete & Release Funds (admin only)
app.post('/api/orders/:id/force-complete', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  acquireOrderLock(orderId);
  try {
    const order = orderIndex.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Order is already completed; funds were already released.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot force-complete a cancelled/refunded order.' });
    }
    const reason = String(req.body.reason || 'Admin administrative force-release in seller favor.');
    const result = releaseOrderFunds(order, adminActor(req), reason, req.body.requestKey);
    closeActiveDispute(order.id, 'resolved_release', reason);
    pushSystemMessage(order.id, `✅ Order Approved & Completed by Administration! Escrow funds released to freelancer wallet. Net Payout: $${result.freelancerNet}.`);
    res.json({ success: true, order: enrichOrderWithServiceInfo(order), result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Force Cancel & Refund Buyer (admin only). A partial refund refunds that amount and releases the rest to the seller.
app.post('/api/orders/:id/force-cancel', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  acquireOrderLock(orderId);
  try {
    const order = orderIndex.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot force-cancel an already completed order.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled/refunded.' });
    }
    const reason = String(req.body.reason || 'Admin cancelled order and refunded buyer wallet');
    const isPartial = req.body.refundType === 'partial';
    let result: any;
    let refundAmount: number;
    if (isPartial) {
      refundAmount = Number(req.body.customAmount);
      result = splitOrderFunds(order, refundAmount, adminActor(req), reason);
      closeActiveDispute(order.id, 'resolved_partial', reason);
      pushSystemMessage(order.id, `⚖️ Order resolved by Administration. $${refundAmount} refunded to buyer; the remainder was released to the freelancer. Reason: ${reason}`);
    } else {
      result = refundOrderFunds(order, undefined, adminActor(req), reason, req.body.requestKey);
      refundAmount = result.refunded;
      closeActiveDispute(order.id, 'resolved_refund', reason);
      pushSystemMessage(order.id, `🚨 Order Cancelled & Refunded by Administration. $${refundAmount} credited back to buyer wallet balance. Reason: ${reason}`);
    }
    res.json({ success: true, order: enrichOrderWithServiceInfo(order), result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Send Chat Message into Order Workstream (unrestricted, responsive buyer/seller communication)
app.post('/api/orders/:id/message', requireAuth, rateLimit(120, 60_000), (req, res) => {
  const order = orderIndex.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const userId = (req as any).authenticatedUserId;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!canAccessOrderWorkstream(user, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  if (order.isMuted && !isStaffUser(user)) {
    return res.status(403).json({ error: 'Chat is currently paused.' });
  }
  const fileCheck = validateMessageFileInfo(req.body.fileInfo, user);
  if (!fileCheck.ok) return res.status(400).json({ error: fileCheck.error });

  const clientMessageId = typeof req.body.clientMessageId === 'string' ? req.body.clientMessageId : undefined;
  if (clientMessageId) {
    const existing = messages.find(m => m.orderId === order.id && m.metadata?.clientMessageId === clientMessageId);
    if (existing) return res.json({ success: true, message: existing, deduplicated: true });
  }

  try {
    const newMsg = sanitizeAndCreateMessage(user, order, req.body, fileCheck);

    recordMessage(newMsg);
    saveMessagesToDisk();
    broadcastMessage(newMsg, order.id);

    res.json({ success: true, message: newMsg });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
});
app.get('/api/disputes', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userDisputes = disputes.filter(d => {
    if (isAdmin) return true;
    const order = orderIndex.get(d.orderId);
    return order && (order.buyerId === authUserId || order.sellerId === authUserId);
  });
  res.json(userDisputes);
});
app.get('/api/refunds', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userRefunds = refunds.filter(r => {
    if (isAdmin) return true;
    if (r.buyerId === authUserId) return true;
    const order = orderIndex.get(r.orderId);
    return order && (order.buyerId === authUserId || order.sellerId === authUserId);
  });
  res.json(userRefunds);
});
app.get('/api/payouts', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userPayouts = payouts.filter(p => {
    if (isAdmin) return true;
    return p.freelancerId === authUserId;
  });
  res.json(userPayouts);
});
app.get('/api/categories', (req, res) => res.json(categories));

// ==========================================
// USER PAYMENTS, ESCROW, AND FINANCIAL APIS
// ==========================================

interface PaymentMethodRecord {
  id: string;
  userId: string;
  type: 'card' | 'bank' | 'paypal' | 'upi';
  name: string;
  details: {
    last4?: string;
    brand?: string;
    expiry?: string;
    bankName?: string;
    accountNumberMasked?: string;
    routingNumber?: string;
    email?: string;
    upiId?: string;
  };
  isDefault: boolean;
  createdAt: string;
}

interface CustomInvoice {
  id: string;
  invoiceNumber: string;
  userId: string;
  recipientName: string;
  recipientEmail: string;
  title: string;
  issueDate: string;
  dueDate: string;
  status: 'paid' | 'in_escrow' | 'unpaid' | 'refunded';
  items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal: number;
  platformFee: number;
  tax: number;
  total: number;
  notes?: string;
  relatedOrderId?: string;
}

let savedPaymentMethods: PaymentMethodRecord[] = [];

let customInvoices: CustomInvoice[] = [];

// User Financial Overview Snapshot
app.get('/api/payments/user/:userId', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const targetUserId = req.params.userId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && authUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden: Access to another user financial snapshot is not allowed.' });
    }

    const userId = targetUserId;
    const u = users.find(user => user.id === userId);
    
    if (u) {
      ensureWallet(u.id);
    }

    const walletData = financeLedger.getWalletById(userId);
    const availableBalance = walletData?.wallet.availableBalance ?? (u?.walletBalance ?? 0);
    
    const buyerEscrowOrders = orders.filter(o => o.buyerId === userId && ['funded_in_escrow', 'in_progress'].includes(o.status));
    const buyerEscrowAmount = buyerEscrowOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

    const freelancerEscrowOrders = orders.filter(o => o.sellerId === userId && ['funded_in_escrow', 'in_progress', 'delivered'].includes(o.status));
    const freelancerEscrowAmount = freelancerEscrowOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

    const userPaidOrders = orders.filter(o => o.buyerId === userId && ['funded_in_escrow', 'in_progress', 'delivered', 'completed'].includes(o.status));
    const paidToDate = userPaidOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
    const paidThisMonth = userPaidOrders.filter(o => (o.createdAt || '').startsWith('2026-10')).reduce((sum, o) => sum + (o.amount || 0), 0);

    const userEarnedOrders = orders.filter(o => o.sellerId === userId && o.status === 'completed');
    const earnedToDate = u?.earned ?? userEarnedOrders.reduce((sum, o) => sum + financeLedger.quoteOrder(o.amount).freelancerNet, 0);
    const earnedThisMonth = userEarnedOrders.filter(o => (o.createdAt || '').startsWith('2026-10')).reduce((sum, o) => sum + financeLedger.quoteOrder(o.amount).freelancerNet, 0);

    const userMethods = savedPaymentMethods.filter(m => m.userId === userId);

    res.json({
      userId,
      availableBalance,
      buyerEscrowAmount,
      freelancerEscrowAmount,
      buyerEscrowOrders,
      freelancerEscrowOrders,
      paidToDate,
      paidThisMonth,
      earnedToDate,
      earnedThisMonth,
      earnedPastTwoMonths: earnedThisMonth,
      clearingPeriodDays: 14,
      paymentMethods: userMethods,
      walletStatus: walletData?.wallet.status || 'active'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const REVIEW_THRESHOLD = 500;
const ALLOWED_METHODS: Record<string, keyof typeof DEFAULT_SITE_SETTINGS.wallets.allowedPayoutMethods> = {
  'UPI': 'upi', 'Bank Transfer': 'bankTransfer', 'Stripe': 'stripeConnect', 'Razorpay': 'razorpayX', 'PayPal': 'paypal'
};

/**
 * Isolated payout identity resolver.
 * 
 * SECURITY ARCHITECTURE BOUNDARY:
 * Currently WorkPerHour operates in demo mode without full multi-user authentication.
 * To prevent unauthenticated clients from spoofing arbitrary users or withdrawing
 * from accounts they do not own, payout authorization is strictly isolated here.
 * 
 * When deploying an authentication layer (JWT, session cookies, OAuth):
 * Simply update this function to extract the user ID strictly from the verified session:
 *   const authUser = (req as any).user?.id || (req as any).user?.uid;
 *   if (!authUser) throw new Error('Authentication required');
 *   return authUser;
 */
function resolvePayoutUserId(req: Request): string | null {
  return resolveAuthenticatedUserId(req);
}

function handlePayoutRequest(req: Request, res: Response) {
  try {
    const freelancerId = resolvePayoutUserId(req);
    if (!freelancerId) {
      return res.status(401).json({ error: 'Authentication required to request a payout.' });
    }
    const user = users.find(u => u.id === freelancerId) || users[0];
    ensureWallet(freelancerId);

    const rawMethod = String(req.body?.method || 'Bank Transfer');
    const settingKey = ALLOWED_METHODS[rawMethod];
    if (!settingKey || !DEFAULT_SITE_SETTINGS.wallets.allowedPayoutMethods[settingKey]) {
      return res.status(400).json({ error: `Unsupported payout method "${rawMethod}".` });
    }

    const numAmount = Number(req.body?.amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid withdrawal amount greater than $0.00' });
    }

    const currentBal = financeLedger.getWalletBalance(freelancerId) ?? user.walletBalance;
    if (currentBal < numAmount) {
      return res.status(400).json({ error: `Insufficient available funds. Available: $${currentBal.toFixed(2)}, Requested: $${numAmount.toFixed(2)}` });
    }

    const id = 'pay_' + randomUUID().slice(0, 8);
    const accountDetails = String(req.body?.accountDetails || 'Primary Bank Account');
    const { payout } = financeLedger.requestPayout({
      payoutId: id,
      freelancerId,
      amount: numAmount,
      method: rawMethod,
      accountDetails,
      actor: `user:${freelancerId}`
    });

    const record: Payout = {
      id,
      freelancerId,
      amount: payout.amount,
      method: rawMethod as Payout['method'],
      status: 'pending',
      createdAt: new Date().toISOString().substring(0, 10),
      accountDetails: payout.accountDetails
    };
    payouts.unshift(record);
    syncUserBalances();

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: user.name,
      role: user.role,
      action: 'PAYOUT_REQUESTED',
      target: `Payout #${record.id}`,
      details: `User requested withdrawal of $${numAmount.toFixed(2)} via ${record.method}`,
      timestamp: new Date().toLocaleString()
    });

    const newBalance = financeLedger.getWalletBalance(freelancerId) ?? user.walletBalance;
    const transaction = financeLedger.getTransactions().find(t => t.relatedPayoutId === id);

    res.status(201).json({
      success: true,
      newBalance,
      payout: record,
      transaction,
      ...record
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

// Deposit Funds into User Account (Simulated - Strictly Development Only)
app.post('/api/payments/deposit', requireAuth, rateLimit(10, 60_000), (req, res) => {
  try {
    // Simulated deposits are strictly development/test functionality; reject in production unconditionally
    if (!areSimulatedDepositsAllowed()) {
      return res.status(501).json({ error: 'Deposits require a connected payment gateway in production.' });
    }

    const authUserId = (req as any).authenticatedUserId;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    const caller = users.find(u => u.id === authUserId);
    if (!caller) {
      return res.status(401).json({ error: 'Authenticated user not found' });
    }

    // User A cannot credit User B's wallet by supplying User B's ID
    const requestedUserId = req.body?.userId;
    const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
    if (requestedUserId && requestedUserId !== authUserId) {
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: You cannot deposit funds into another user wallet.' });
      }
    }
    const targetUserId = (isAdmin && requestedUserId) ? requestedUserId : authUserId;
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid deposit amount greater than $0.00' });
    }
    if (amount > 5000) {
      return res.status(400).json({ error: 'Simulated deposits are limited to $5,000.' });
    }

    ensureWallet(targetUserId);
    const key = String(req.body?.idempotencyKey || req.body?.providerReference || randomUUID());
    const result = financeLedger.creditDeposit({
      userId: targetUserId,
      amount,
      reference: `SIM-${key}`,
      idempotencyKey: `SIM-${targetUserId}-${key}`,
      actor: `${caller.name} (Simulated)`,
      source: 'simulated'
    });
    syncUserBalances();
    const newBalance = financeLedger.getWalletBalance(targetUserId) ?? caller.walletBalance;
    const transaction = financeLedger.getTransactions().find(t => t.journalId === result.journal.id);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: caller.name,
      role: caller.role,
      action: 'FUNDS_DEPOSITED',
      target: `User ${caller.name}`,
      details: `Deposited $${amount.toFixed(2)} (simulated). New Balance: $${newBalance.toFixed(2)}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, newBalance, transaction });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Withdraw Funds from User Account
app.post('/api/payments/withdraw', requireAuth, rateLimit(10, 60_000), handlePayoutRequest);

// Release Escrow Payment (Buyer approves work)
app.post('/api/payments/escrow/release', requireAuth, (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });
  acquireOrderLock(orderId);
  try {
    const userId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === userId);
    const { orderId } = req.body;
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    const isBuyer = userId === order.buyerId;
    if (!isAdmin && !isBuyer) {
      return res.status(403).json({ error: 'Forbidden: Only the order buyer or administrator can release escrow.' });
    }

    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Order escrow has already been released and completed.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot release escrow: Order has already been cancelled/refunded.' });
    }

    const activeDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
    if (activeDispute || order.status === 'disputed') {
      return res.status(400).json({ error: 'Cannot release escrow: Order is under active dispute. Resolve the dispute first.' });
    }

    // Marketplace rule: once escrow is funded (e.g. the seller raised an invoice and it was paid into escrow),
    // the buyer may release it at any time. No "work delivered" prerequisite. The ledger check below still
    // guarantees funds exist, are not already released/refunded, and that disputes block release.

    // If releasing while in revision, mark all requested revisions as resolved
    if (order.status === 'revision' && Array.isArray(order.revisions)) {
      for (const rev of order.revisions) {
        if (rev.status === 'requested') {
          rev.status = 'resolved';
        }
      }
    }

    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      return res.status(400).json({ error: 'No refundable or releasable escrow funds remain for this order.' });
    }

    const seller = users.find(u => u.id === order.sellerId);
    const buyer = users.find(u => u.id === order.buyerId);

    if (seller) ensureWallet(seller.id);
    if (buyer) ensureWallet(buyer.id);

    const actorName = isAdmin ? adminActor(req) : (buyer?.name || 'Authorized Buyer');
    const requestKey = req.body?.requestKey || req.body?.idempotencyKey;
    const result = releaseOrderFunds(order, actorName, 'Buyer approved work', requestKey);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: actorName,
      role: caller?.role || 'buyer',
      action: 'ESCROW_RELEASED_BY_BUYER',
      target: `Order #${order.id}`,
      details: `Escrow release authorized of $${order.amount}. $${result.freelancerNet} credited to ${seller?.name || 'freelancer'}, $${result.platformFee} platform fee.`,
      timestamp: new Date().toLocaleString()
    });

    const releaseMsg: Message = {
      id: 'msg_' + Date.now(),
      orderId: order.id,
      senderId: 'system',
      senderName: 'WorkSphere Escrow Vault',
      text: `🎉 Escrow funds ($${order.amount.toLocaleString()}) released to seller! Workstream marked as completed.`,
      timestamp: new Date().toISOString(),
      type: 'system',
      metadata: {
        action: 'escrow_released',
        amount: order.amount
      }
    };
    recordMessage(releaseMsg);
    saveMessagesToDisk();
    saveOrdersToDisk();
    broadcastMessage(releaseMsg, order.id);

    res.json({ success: true, order: enrichOrderWithServiceInfo(order), freelancerNet: result.freelancerNet, platformFee: result.platformFee });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Refund Escrow Payment
app.post('/api/payments/escrow/refund', requireAuth, (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });
  acquireOrderLock(orderId);
  try {
    const userId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === userId);
    const { orderId, reason } = req.body;
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const activeDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
    if (activeDispute || order.status === 'disputed') {
      return res.status(400).json({ error: 'Cannot refund escrow: Order is under active dispute.' });
    }
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot refund: Order has already been completed.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot refund: Order has already been cancelled/refunded.' });
    }

    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    const isSeller = userId === order.sellerId;
    const isBuyer = userId === order.buyerId;

    const isOverdueBy76Hours = order.dueDate ? (Date.now() > new Date(order.dueDate).getTime() + 76 * 60 * 60 * 1000) : false;

    if (!isAdmin && !isSeller) {
      if (isBuyer && isOverdueBy76Hours) {
        // Buyer permitted to cancel & refund because seller is 76h+ past due date (ghosted / missed deadline)
      } else if (isBuyer) {
        return res.status(403).json({ error: 'Forbidden: Buyer cannot cancel this order until 76 hours have passed past the agreed due date.' });
      } else {
        return res.status(403).json({ error: 'Forbidden: Not authorized to refund this escrow.' });
      }
    }

    // Beneficiary is ALWAYS the order's buyer from server order record (never client-supplied)
    const buyer = users.find(u => u.id === order.buyerId);
    if (buyer) ensureWallet(buyer.id);

    const actorName = isAdmin ? adminActor(req) : (caller?.name || (isSeller ? 'Seller' : 'Buyer'));
    const requestKey = req.body?.requestKey || req.body?.idempotencyKey;
    const result = refundOrderFunds(order, undefined, actorName, reason || (isSeller ? 'Seller cancelled order' : 'Escrow cancellation'), requestKey);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: actorName,
      role: caller?.role || (isSeller ? 'seller' : 'buyer'),
      action: isSeller ? 'ESCROW_REFUNDED_BY_SELLER' : (isAdmin ? 'ESCROW_REFUNDED_BY_ADMIN' : 'ESCROW_REFUNDED_BY_BUYER'),
      target: `Order #${order.id}`,
      details: `Escrow refund executed of $${result.refunded} to buyer wallet. Reason: ${reason || 'Escrow cancellation'}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, order, refunded: result.refunded });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOrderLock(orderId);
  }
});

// Deposit Escrow for Order - Must strictly go through the double-entry ledger engine
app.post('/api/payments/escrow/deposit', requireAuth, rateLimit(20, 60_000), (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = users.find(u => u.id === authUserId);
    const orderId = String(req.body?.orderId || '');
    const order = orderIndex.get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    const isBuyer = authUserId === order.buyerId;
    if (!isAdmin && !isBuyer) {
      return res.status(403).json({ error: 'Forbidden: Only the order buyer or administrator can fund escrow.' });
    }

    if (order.status !== 'in_progress') {
      return res.status(400).json({ error: `Cannot fund escrow for order in status "${order.status}"` });
    }

    const buyerId = order.buyerId;
    const sellerId = order.sellerId;
    const buyer = users.find(u => u.id === buyerId);
    const seller = users.find(u => u.id === sellerId);
    if (!buyer || !seller) return res.status(404).json({ error: 'Buyer or seller not found' });

    ensureWallet(buyerId);
    ensureWallet(sellerId);

    // Call ledger engine to fund escrow atomically
    financeLedger.fundEscrow({
      orderId: order.id,
      orderTitle: order.title,
      amount: order.amount,
      buyerId,
      sellerId,
      actor: `user:${buyerId}`
    });

    order.status = 'funded_in_escrow';
    const today = new Date().toISOString().split('T')[0];
    order.escrowProtectionStartDate = today;
    order.escrowProtectionEndDate = new Date(Date.now() + DEFAULT_SITE_SETTINGS.commission.escrowProtectionDays * 86400000).toISOString().split('T')[0];
    syncUserBalances();
    saveOrdersToDisk();

    const newBalance = financeLedger.getWalletBalance(buyerId) ?? buyer.walletBalance;
    res.json({ success: true, order, newBalance });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// User Transactions Ledger
app.get('/api/payments/transactions/:userId', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const targetUserId = req.params.userId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && authUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden: Access to another user transactions is not allowed.' });
    }
    const userId = targetUserId;
    const allTxns = financeLedger.getTransactions();
    const userTxns = allTxns.filter(t => t.userId === userId);
    
    if (userTxns.length === 0) {
      const syn: any[] = [];
      for (const ord of orders) {
        if (ord.buyerId === userId) {
          syn.push({
            id: `txn_ord_${ord.id}`,
            type: 'escrow_fund',
            amount: ord.amount,
            currency: 'USD',
            timestamp: `${ord.createdAt} 12:00:00`,
            status: 'completed',
            userId: userId,
            userName: ord.buyerUsername || 'Buyer',
            userRole: 'buyer',
            description: `Escrow hold for Order: ${ord.title}`,
            relatedOrderId: ord.id
          });
        }
        if (ord.sellerId === userId && ord.status === 'completed') {
          syn.push({
            id: `txn_rel_${ord.id}`,
            type: 'escrow_release',
            amount: financeLedger.quoteOrder(ord.amount).freelancerNet,
            currency: 'USD',
            timestamp: `${ord.dueDate} 15:30:00`,
            status: 'completed',
            userId: userId,
            userName: ord.sellerUsername || 'Freelancer',
            userRole: 'freelancer',
            description: `Escrow earnings (${financeLedger.quoteOrder(ord.amount).freelancerPercent}% net) from: ${ord.title}`,
            relatedOrderId: ord.id
          });
        }
      }
      return res.json(syn);
    }

    res.json(userTxns);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// User Invoices
app.get('/api/payments/invoices/:userId', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const targetUserId = req.params.userId;
    const caller = users.find(u => u.id === authUserId);
    const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
    if (!isAdmin && authUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden: Access to another user invoices is not allowed.' });
    }
    const userId = targetUserId;
    const userOrders = orders.filter(o => o.buyerId === userId || o.sellerId === userId);
    const orderInvoices = userOrders.map(o => {
      const isBuyer = o.buyerId === userId;
      const otherUser = users.find(u => u.id === (isBuyer ? o.sellerId : o.buyerId));
      return {
        id: `inv_ord_${o.id}`,
        invoiceNumber: `INV-${o.id.replace('ord_', '').toUpperCase()}`,
        userId: userId,
        type: isBuyer ? 'received' : 'sent',
        recipientName: isBuyer ? (users.find(u => u.id === userId)?.name || 'Buyer') : (otherUser?.name || 'Client'),
        recipientEmail: isBuyer ? (users.find(u => u.id === userId)?.email || 'buyer@example.com') : (otherUser?.email || 'client@example.com'),
        issuerName: isBuyer ? (otherUser?.name || 'Freelancer') : (users.find(u => u.id === userId)?.name || 'Freelancer'),
        issuerEmail: isBuyer ? (otherUser?.email || 'seller@example.com') : (users.find(u => u.id === userId)?.email || 'seller@example.com'),
        title: o.title,
        issueDate: o.createdAt,
        dueDate: o.dueDate,
        status: o.status === 'completed' ? 'paid' : o.status === 'cancelled' ? 'refunded' : 'in_escrow',
        items: [
          { description: o.title, quantity: 1, unitPrice: o.amount, amount: o.amount }
        ],
        subtotal: o.amount,
        serviceFee: o.feeBreakdown?.serviceFee ?? financeLedger.quoteOrder(o.amount).serviceFee,
        smallOrderFee: o.feeBreakdown?.smallOrderFee ?? financeLedger.quoteOrder(o.amount).smallOrderFee,
        platformFee: o.feeBreakdown?.platformCommission ?? financeLedger.quoteOrder(o.amount).platformCommission,
        tax: 0,
        total: o.feeBreakdown?.clientTotal ?? financeLedger.quoteOrder(o.amount).clientTotal,
        notes: `WorkPerHour 14-Day Escrow Protection Order #${o.id}. 100% Protected.`,
        relatedOrderId: o.id
      };
    });

    const userCustom = customInvoices.filter(i => i.userId === userId);
    res.json([...orderInvoices, ...userCustom]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Custom Invoice
app.post('/api/payments/invoices', requireAuth, (req, res) => {
  try {
    const authenticatedUserId = (req as any).authenticatedUserId;
    const { recipientName, recipientEmail, title, dueDate, items, notes } = req.body;
    if (!title || !recipientName) {
      return res.status(400).json({ error: 'Title and recipient name are required' });
    }
    const cleanItems = (items && items.length > 0) ? items : [{ description: title, quantity: 1, unitPrice: 100, amount: 100 }];
    const subtotal = cleanItems.reduce((s: number, it: any) => s + (Number(it.amount) || (Number(it.quantity || 1) * Number(it.unitPrice || 0))), 0);
    const platformFee = Number((subtotal * 0.075).toFixed(2));
    const total = subtotal;

    const newInvoice: CustomInvoice = {
      id: 'inv_' + Date.now(),
      invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
      userId: authenticatedUserId, // Set from auth, not request body
      recipientName,
      recipientEmail: recipientEmail || 'client@example.com',
      title,
      issueDate: new Date().toISOString().substring(0, 10),
      dueDate: dueDate || new Date(Date.now() + 14 * 86400000).toISOString().substring(0, 10),
      status: 'unpaid',
      items: cleanItems,
      subtotal,
      platformFee,
      tax: 0,
      total,
      notes: notes || 'Standard WorkPerHour Invoice'
    };
    customInvoices.unshift(newInvoice);
    res.status(201).json(newInvoice);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Saved Payment Methods CRUD
app.get('/api/payments/methods/:userId', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  
  if (!isAdmin && authUserId !== req.params.userId) {
    return res.status(403).json({ error: 'Unauthorized: Cannot view another user payment methods.' });
  }
  const methods = savedPaymentMethods.filter(m => m.userId === req.params.userId);
  const sanitized = methods.map(m => ({
    ...m,
    details: {
      ...m.details,
      routingNumber: undefined
    }
  }));
  res.json(sanitized);
});

app.post('/api/payments/methods', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const { type, name, details, isDefault } = req.body;
    
    // Always use authenticated user ID
    const userId = authUserId;
    
    if (!userId || !type || !name) {
      return res.status(400).json({ error: 'Method type and name are required' });
    }
    if (isDefault) {
      savedPaymentMethods.forEach(m => {
        if (m.userId === userId) m.isDefault = false;
      });
    }
    const newMethod: PaymentMethodRecord = {
      id: 'pm_' + Date.now(),
      userId,
      type,
      name,
      details: details || {},
      isDefault: Boolean(isDefault) || savedPaymentMethods.filter(m => m.userId === userId).length === 0,
      createdAt: new Date().toISOString().substring(0, 10)
    };
    savedPaymentMethods.push(newMethod);
    res.json(newMethod);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/payments/methods/:id', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const method = savedPaymentMethods.find(m => m.id === req.params.id);
  const index = savedPaymentMethods.findIndex(m => m.id === req.params.id);
  savedPaymentMethods.splice(index, 1);
  res.json({ success: true, id: req.params.id });
});

app.patch('/api/payments/methods/:id/default', requireAuth, (req, res) => {
  const method = savedPaymentMethods.find(m => m.id === req.params.id);
  if (!method) return res.status(404).json({ error: 'Payment method not found' });
  savedPaymentMethods.forEach(m => {
    if (m.userId === method.userId) m.isDefault = false;
  });
  method.isDefault = true;
  res.json(method);
});

// ==========================================
// DOUBLE-ENTRY LEDGER & FINANCIAL REST APIS
// ==========================================

// 1. Overview Financial Metrics Dashboard
app.get('/api/admin/finance/overview', requireRole(['admin', 'super_admin']), (req, res) => {
  try {
    const overview = financeLedger.getFinancialOverview();
    res.json(overview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. User Wallets Explorer & Details
app.get('/api/admin/finance/wallets', (req, res) => {
  try {
    const wallets = financeLedger.getWallets();
    res.json(wallets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/finance/wallets/:id', (req, res) => {
  try {
    const data = financeLedger.getWalletById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Wallet not found' });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/wallets/:id/freeze', (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Mandatory reason required to freeze a wallet' });
    const wallet = financeLedger.freezeWallet(req.params.id, reason, adminActor(req));
    res.json(wallet);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/finance/wallets/:id/unfreeze', (req, res) => {
  try {
    const { reason } = req.body;
    const wallet = financeLedger.unfreezeWallet(req.params.id, reason || 'Administrative review completed', adminActor(req));
    res.json(wallet);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/finance/wallets/:id/restrict', (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Mandatory reason required to restrict a wallet' });
    const wallet = financeLedger.restrictWallet(req.params.id, reason, adminActor(req));
    res.json(wallet);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Transactions Explorer
app.get('/api/admin/finance/transactions', (req, res) => {
  try {
    const txns = financeLedger.getTransactions();
    res.json(txns);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/finance/transactions/:id', (req, res) => {
  try {
    const txn = financeLedger.getTransactionById(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    const journal = txn.journalId ? financeLedger.getJournalById(txn.journalId) : null;
    res.json({ transaction: txn, journal });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Double-Entry Ledger Journals & Entries
app.get('/api/admin/finance/ledger', (req, res) => {
  try {
    const journals = financeLedger.getJournals();
    res.json(journals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/finance/ledger/:id', (req, res) => {
  try {
    const journal = financeLedger.getJournalById(req.params.id);
    if (!journal) return res.status(404).json({ error: 'Journal not found' });
    res.json(journal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/ledger/:id/reverse', (req, res) => {
  try {
    const { reason, actor } = req.body;
    if (!reason) return res.status(400).json({ error: 'Mandatory accounting reversal reason required' });
    const reversal = financeLedger.reverseJournal(req.params.id, reason, adminActor(req));
    res.json(reversal);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Escrow & Order Protection Vault Management
app.get('/api/admin/finance/escrow', (req, res) => {
  try {
    const escrowOrders = orders.map(o => {
      const enriched = enrichOrderWithServiceInfo(o);
      const isDisputed = disputes.some(d => d.orderId === o.id && (d.status === 'open' || d.status === 'under_investigation'));
      const isRefunded = refunds.some(r => r.orderId === o.id && r.status === 'approved');
      const buyer = users.find(u => u.id === o.buyerId);
      const seller = users.find(u => u.id === o.sellerId);

      let escrowState = 'in_progress';
      if (isDisputed) escrowState = 'disputed';
      else if (isRefunded) escrowState = 'refunded';
      else if (o.status === 'completed') escrowState = 'released';
      else if (o.status === 'delivered') escrowState = 'release_pending';
      else if (o.status === 'funded_in_escrow') escrowState = 'funded';

      return {
        ...enriched,
        buyerName: buyer?.name || 'Buyer #' + o.buyerId,
        buyerEmail: buyer?.email || '',
        sellerName: seller?.name || 'Freelancer #' + o.sellerId,
        sellerEmail: seller?.email || '',
        platformFeeRate: `${financeLedger.getPlatformCommissionRate()}%`,
        platformFeeAmount: FinanceLedgerEngine.round(o.amount * financeLedger.getPlatformCommissionRate() / 100),
        freelancerNetAmount: FinanceLedgerEngine.round(o.amount - o.amount * financeLedger.getPlatformCommissionRate() / 100),
        ledgerEscrowStatus: financeLedger.getEscrow(o.id)?.status || 'not_funded',
        ledgerEscrowHeld: financeLedger.getEscrow(o.id)?.remaining ?? 0,
        escrowState,
        isDisputed
      };
    });
    res.json(escrowOrders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/escrow/:orderId/release', requireAdmin, (req, res) => {
  try {
    const order = orderIndex.get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Order escrow has already been released and completed.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot release escrow: Order has already been cancelled/refunded.' });
    }
    const activeDispute = disputes.find(d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation'));
    if (activeDispute || order.status === 'disputed') {
      return res.status(400).json({ error: `Cannot release escrow: Order #${order.id} is under active dispute. Resolve the dispute first.` });
    }
    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      return res.status(400).json({ error: 'No refundable or releasable escrow funds remain for this order.' });
    }
    const result = releaseOrderFunds(order, adminActor(req), String(req.body.reason || 'Administrative escrow release'), req.body.requestKey);
    res.json({ success: true, order, journal: result.journal, freelancerNet: result.freelancerNet, platformFee: result.platformFee });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/finance/escrow/:orderId/refund', requireAdmin, (req, res) => {
  try {
    const order = orderIndex.get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'Cannot refund order: Escrow funds have already been released to seller.' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled/refunded.' });
    }
    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      return res.status(400).json({ error: 'No refundable escrow funds remaining for this order.' });
    }
    const amount = req.body.amount === undefined || req.body.amount === '' ? undefined : Number(req.body.amount);
    const result = refundOrderFunds(order, amount, adminActor(req), String(req.body.reason || 'Administrative escrow refund approval'), req.body.requestKey);
    closeActiveDispute(order.id, 'resolved_refund', String(req.body.reason || 'Administrative escrow refund'));
    res.json({ success: true, order, journal: result.journal });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Payouts Management & Gateway Settlements
app.get('/api/admin/finance/payouts', (req, res) => {
  try {
    const enrichedPayouts = payouts.map(p => {
      const freelancer = users.find(u => u.id === p.freelancerId);
      const wallet = financeLedger.getWalletById(p.freelancerId);
      return {
        ...p,
        freelancerName: freelancer?.name || 'Freelancer #' + p.freelancerId,
        freelancerEmail: freelancer?.email || '',
        walletAvailableBalance: wallet?.wallet.availableBalance || 0,
        currency: 'USD'
      };
    });
    res.json(enrichedPayouts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function payoutAudit(req: Request, action: string, p: Payout, details: string) {
  registerAuditLog({
    id: 'FAUD-' + randomUUID().slice(0, 12),
    actor: adminActor(req),
    role: 'super_admin',
    action,
    target: `Payout #${p.id}`,
    details,
    timestamp: new Date().toLocaleString()
  });
}

const approvePayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending') return res.status(400).json({ error: `Cannot approve payout in status "${p.status}"` });
    p.status = 'approved';
    payoutAudit(req, 'PAYOUT_APPROVED', p, `Approved payout of $${p.amount} via ${p.method} for freelancer ${p.freelancerId}`);
    res.json(p);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

// Marks a payout as paid. When a real gateway is connected, call it here FIRST and only continue on success.
const processPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending' && p.status !== 'approved') return res.status(400).json({ error: `Cannot process payout in status "${p.status}"` });
    if (p.amount >= 500 && p.status !== 'approved') {
      return res.status(400).json({ error: 'Payouts of $500.00 or more require explicit administrative approval before processing.' });
    }
    const { journal } = financeLedger.settlePayout({ payoutId: p.id, actor: adminActor(req), providerReference: req.body?.providerReference });
    p.status = 'processed';
    payoutAudit(req, 'PAYOUT_PROCESSED', p, `Processed payout of $${p.amount} via ${p.method}`);
    syncUserBalances();
    res.json({ success: true, payout: p, journal, ...p });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

const rejectPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending' && p.status !== 'approved') return res.status(400).json({ error: `Cannot reject payout in status "${p.status}"` });
    financeLedger.cancelPayout({ payoutId: p.id, reason: String(req.body?.reason || 'Administrative rejection'), actor: adminActor(req) });
    p.status = 'cancelled';
    payoutAudit(req, 'PAYOUT_REJECTED', p, `Rejected payout of $${p.amount}; funds returned to wallet`);
    syncUserBalances();
    res.json({ success: true, payout: p, ...p });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

const failPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'pending' && p.status !== 'approved') return res.status(400).json({ error: `Cannot fail payout in status "${p.status}"` });
    financeLedger.failPayout({ payoutId: p.id, reason: String(req.body?.reason || 'Gateway reported a transfer failure'), actor: adminActor(req) });
    p.status = 'failed';
    payoutAudit(req, 'PAYOUT_FAILED', p, `Payout of $${p.amount} failed; funds returned to wallet`);
    syncUserBalances();
    res.json(p);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

const retryPayout = (req: Request, res: Response) => {
  try {
    const p = payouts.find(pay => pay.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Payout not found' });
    if (p.status !== 'failed') return res.status(400).json({ error: 'Only failed payouts can be retried.' });
    financeLedger.retryPayout({ payoutId: p.id, actor: adminActor(req) });
    p.status = 'pending';
    payoutAudit(req, 'PAYOUT_RETRIED', p, `Re-queued failed payout of $${p.amount}`);
    syncUserBalances();
    res.json(p);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
};

app.post('/api/admin/finance/payouts/:id/approve', approvePayout);
app.post('/api/admin/finance/payouts/:id/process', processPayout);
app.post('/api/admin/finance/payouts/:id/reject', rejectPayout);
app.post('/api/admin/finance/payouts/:id/fail', failPayout);
app.post('/api/admin/finance/payouts/:id/retry', retryPayout);
// Legacy routes still used by the older admin payments tab in App.tsx
app.patch('/api/admin/payouts/:id/approve', approvePayout);
app.patch('/api/admin/payouts/:id/process', processPayout);
app.patch('/api/admin/payouts/:id/fail', failPayout);

// Freelancer withdrawal request: uses isolated payout user authorization and ledger requestPayout
app.post('/api/payouts', requireAuth, rateLimit(10, 60_000), handlePayoutRequest);

// Wallet top-up (Simulated - Strictly Development Only)
app.post('/api/wallet/deposit', requireAuth, rateLimit(10, 60_000), (req, res) => {
  try {
    // Simulated deposits are strictly development/test functionality; reject in production unconditionally
    if (!areSimulatedDepositsAllowed()) {
      return res.status(501).json({ error: 'Deposits require a connected payment gateway in production.' });
    }

    const authUserId = (req as any).authenticatedUserId;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    const caller = users.find(u => u.id === authUserId);
    if (!caller) {
      return res.status(401).json({ error: 'Authenticated user not found' });
    }

    // User A cannot credit User B's wallet by supplying User B's ID
    const requestedUserId = req.body?.userId;
    let targetUserId = authUserId;
    if (requestedUserId && requestedUserId !== authUserId) {
      const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: You cannot deposit funds into another user wallet.' });
      }
      const targetUser = users.find(u => u.id === requestedUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }
      targetUserId = requestedUserId;
    }
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid deposit amount greater than $0.00' });
    }
    if (amount > 5000) {
      return res.status(400).json({ error: 'Simulated deposits are limited to $5,000.' });
    }

    ensureWallet(targetUserId);
    const key = String(req.body?.idempotencyKey || randomUUID());
    const { replayed } = financeLedger.creditDeposit({
      userId: targetUserId,
      amount,
      reference: `SIM-${key}`,
      idempotencyKey: `SIM-${targetUserId}-${key}`,
      actor: `${caller.name} (Simulated)`,
      source: 'simulated'
    });
    syncUserBalances();
    res.json({ success: true, replayed, balance: financeLedger.getWalletBalance(targetUserId) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Reconciliation Workspace & Exception Resolution
app.get('/api/admin/finance/reconciliation', (req, res) => {
  try {
    const recon = financeLedger.getReconciliationSummary();
    res.json(recon);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/finance/reconciliation/resolve/:id', (req, res) => {
  try {
    const { notes, actor } = req.body;
    if (!notes) return res.status(400).json({ error: 'Investigation notes required to mark exception resolved' });
    const resolved = financeLedger.resolveException(req.params.id, notes, adminActor(req));
    res.json(resolved);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Financial Audit Trail
app.get('/api/admin/finance/audit', (req, res) => {
  try {
    const logs = financeLedger.getAuditLogs();
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Administrative Adjustments (Controlled Double-Entry Workflow)
app.post('/api/admin/finance/adjustments/preview', requireAdmin, (req, res) => {
  try {
    const { userId, amount, direction, category, reason } = req.body;
    const preview = financeLedger.previewAdjustment({ userId, amount: Number(amount), direction, category, reason });
    res.json(preview);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/finance/adjustments', requireAdmin, (req, res) => {
  try {
    const { userId, amount, direction, category, reason, evidenceReference, requestKey } = req.body;
    const result = financeLedger.executeAdministrativeAdjustment({
      userId,
      amount: Number(amount),
      direction,
      category,
      reason,
      evidenceReference,
      actor: adminActor(req),
      requestKey
    });
    syncUserBalances();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Reports & CSV Export Engine
app.get('/api/admin/finance/export/:type', (req, res) => {
  try {
    const { type } = req.params;
    const { filename, content } = financeLedger.generateCsvExport(type, req.query as any);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(content);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Category CRUD Endpoints
app.post('/api/admin/categories', (req, res) => {
  const { name, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const catSlug = slug || name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  const newCat: Category = {
    id: 'cat_' + Date.now(),
    name,
    slug: catSlug,
    enabled: true,
    order: categories.length + 1,
    subcategories: []
  };
  categories.push(newCat);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORY_CREATED',
    target: `Category: ${name}`,
    details: `Created new main category "${name}" with slug /${catSlug}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.post('/api/admin/categories/bulk-delete', (req, res) => {
  const { categoryIds = [], subcategoryPairs = [] } = req.body;
  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    categories = categories.filter(c => !categoryIds.includes(c.id));
  }
  if (Array.isArray(subcategoryPairs) && subcategoryPairs.length > 0) {
    subcategoryPairs.forEach(({ catId, subId }: { catId: string; subId: string }) => {
      const cat = categories.find(c => c.id === catId);
      if (cat) {
        cat.subcategories = cat.subcategories.filter(s => s.id !== subId);
      }
    });
  }

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORIES_BULK_DELETED',
    target: 'Marketplace Categories',
    details: `Bulk deleted ${categoryIds.length} categories and ${subcategoryPairs.length} subcategories`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id', (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (req.body.name) cat.name = req.body.name;
  if (req.body.slug) cat.slug = req.body.slug;
  if (typeof req.body.enabled === 'boolean') cat.enabled = req.body.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORY_UPDATED',
    target: `Category: ${cat.name}`,
    details: `Updated category name/slug/status for ${cat.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id/toggle', (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  cat.enabled = !cat.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: cat.enabled ? 'CATEGORY_ENABLED' : 'CATEGORY_DISABLED',
    target: `Category: ${cat.name}`,
    details: `Toggled status of category ${cat.name} to ${cat.enabled ? 'Enabled' : 'Disabled'}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.delete('/api/admin/categories/:id', (req, res) => {
  const index = categories.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Category not found' });
  const deleted = categories[index];
  categories.splice(index, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'CATEGORY_DELETED',
    target: `Category: ${deleted.name}`,
    details: `Deleted category ${deleted.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

// Subcategory CRUD Endpoints
app.post('/api/admin/categories/:id/subcategories', (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const { name, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Subcategory name is required' });
  const subSlug = slug || name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  const newSub = {
    id: 'sub_' + Date.now(),
    name,
    slug: subSlug,
    enabled: true
  };
  cat.subcategories.push(newSub);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'SUBCATEGORY_CREATED',
    target: `Subcategory: ${name} (under ${cat.name})`,
    details: `Created subcategory ${name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id/subcategories/:subId', (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const sub = cat.subcategories.find(s => s.id === req.params.subId);
  if (!sub) return res.status(404).json({ error: 'Subcategory not found' });
  if (req.body.name) sub.name = req.body.name;
  if (req.body.slug) sub.slug = req.body.slug;
  if (typeof req.body.enabled === 'boolean') sub.enabled = req.body.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'SUBCATEGORY_UPDATED',
    target: `Subcategory: ${sub.name}`,
    details: `Updated subcategory under ${cat.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.patch('/api/admin/categories/:id/subcategories/:subId/toggle', (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const sub = cat.subcategories.find(s => s.id === req.params.subId);
  if (!sub) return res.status(404).json({ error: 'Subcategory not found' });
  sub.enabled = !sub.enabled;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: sub.enabled ? 'SUBCATEGORY_ENABLED' : 'SUBCATEGORY_DISABLED',
    target: `Subcategory: ${sub.name}`,
    details: `Toggled subcategory status to ${sub.enabled ? 'Enabled' : 'Disabled'}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});

app.delete('/api/admin/categories/:id/subcategories/:subId', (req, res) => {
  const cat = categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Parent category not found' });
  const subIndex = cat.subcategories.findIndex(s => s.id === req.params.subId);
  if (subIndex === -1) return res.status(404).json({ error: 'Subcategory not found' });
  const deletedSub = cat.subcategories[subIndex];
  cat.subcategories.splice(subIndex, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'SUBCATEGORY_DELETED',
    target: `Subcategory: ${deletedSub.name}`,
    details: `Deleted subcategory from ${cat.name}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(categories);
});
function isReviewPublic(r: Review): boolean {
  // Reviews on cancelled orders are private dispute/cancellation records between participants and staff
  if (r.isCancelledOrder) return false;
  // Non-approved or hidden moderation status
  if ((r as any).moderationStatus && (r as any).moderationStatus !== 'approved') return false;
  return true;
}

function sanitizePublicReview(r: Review): Review {
  const { moderationReason, moderationNotes, ...publicRev } = r as any;
  return publicRev;
}

app.get('/api/reviews', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';

  if (isAdmin) {
    return res.json(reviews);
  }

  const visibleReviews = reviews.filter(r => {
    // Participants see their own reviews (even if cancelled or pending moderation, unless hidden by staff)
    if (authUserId && (r.reviewerId === authUserId || r.targetUserId === authUserId)) {
      return (r as any).moderationStatus !== 'hidden';
    }
    // General marketplace users only see approved public reviews
    return isReviewPublic(r);
  }).map(sanitizePublicReview);

  res.json(visibleReviews);
});

app.get('/api/users/:userId/reviews', (req, res) => {
  const targetUserId = req.params.userId;
  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';

  const userReviews = reviews.filter(r => {
    if (r.targetUserId !== targetUserId) return false;
    if (isAdmin) return true;
    if (authUserId && (r.reviewerId === authUserId || r.targetUserId === authUserId)) {
      return (r as any).moderationStatus !== 'hidden';
    }
    return isReviewPublic(r);
  }).map(sanitizePublicReview);

  res.json(userReviews);
});

app.post('/api/reviews', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Authentication required to submit a review' });

  const { orderId, targetUserId, rating, comment, orderTitle } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const numRating = Number(rating);
  if (isNaN(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5 stars' });
  }

  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    return res.status(400).json({ error: 'Review comment cannot be empty' });
  }

  const order = orderIndex.get(orderId);
  if (!order) return res.status(404).json({ error: 'Workstream order not found' });
  if (!canAccessOrderWorkstream(caller, order)) {
    return res.status(403).json({ error: 'Forbidden: Only order participants can submit reviews.' });
  }

  // Completed and Cancelled order eligibility
  const allowedReviewStatuses = ['completed', 'cancelled'];
  if (!allowedReviewStatuses.includes(order.status)) {
    return res.status(409).json({ error: `Reviews can only be submitted for completed or cancelled Workstreams (current status: ${order.status}).` });
  }

  // Check if review already exists for this order & reviewer -> Block duplicate submission (409)
  const existingReview = reviews.find(r => r.orderId === order.id && r.reviewerId === caller.id) || (order.review && order.review.reviewerId === caller.id ? order.review : null);
  if (existingReview) {
    return res.status(409).json({ error: 'A review has already been submitted for this order. Use PUT /api/reviews/:id to edit your review.' });
  }

  const resolvedTargetUserId = targetUserId || (caller.id === order.buyerId ? order.sellerId : order.buyerId);

  const newReview: Review = {
    id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    orderId: order.id,
    reviewerId: caller.id,
    reviewerName: caller.name,
    reviewerAvatar: caller.avatar,
    targetUserId: resolvedTargetUserId,
    rating: numRating,
    comment: escapeHtml(comment.trim()),
    orderTitle: orderTitle || order.title || 'Workstream Milestone Deliverable',
    gigId: req.body.gigId || order.gigId,
    projectId: req.body.projectId || order.projectId,
    isCancelledOrder: order.status === 'cancelled',
    createdAt: new Date().toISOString().split('T')[0]
  };

  reviews.unshift(newReview);
  saveReviewsToDisk();

  order.review = newReview;
  saveOrdersToDisk();

  // Dynamically update target user's rating and reviewsCount
  const targetUser = users.find(u => u.id === resolvedTargetUserId);
  if (targetUser) {
    const userReviews = reviews.filter(r => r.targetUserId === resolvedTargetUserId);
    targetUser.reviewsCount = userReviews.length;
    targetUser.rating = Number((userReviews.reduce((sum, r) => sum + r.rating, 0) / userReviews.length).toFixed(1));
  }

  // Broadcast system message to workstream
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'WorkSphere Reviews',
    text: `⭐ ${order.status === 'cancelled' ? 'Post-cancellation review' : 'Review'} submitted by ${caller.name} (${newReview.rating}/5 stars): "${newReview.comment}"`,
    timestamp: new Date().toISOString(),
    type: 'system',
    metadata: {
      action: 'review_submitted',
      rating: newReview.rating,
      comment: newReview.comment,
      isCancelledOrder: order.status === 'cancelled'
    }
  };
  recordMessage(sysMsg);
  saveMessagesToDisk();
  broadcastMessage(sysMsg, order.id);

  res.status(201).json({ success: true, review: newReview, order: enrichOrderWithServiceInfo(order) });
});

// Edit/Update Review Endpoint
app.put('/api/reviews/:id', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const review = reviews.find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
  if (!isAdmin && review.reviewerId !== caller.id) {
    return res.status(403).json({ error: 'Forbidden: You can only edit your own review.' });
  }

  const { rating, comment } = req.body;
  if (rating !== undefined) {
    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5 stars.' });
    }
    review.rating = numRating;
  }

  if (comment && typeof comment === 'string' && comment.trim()) {
    review.comment = escapeHtml(comment.trim());
  }

  review.updatedAt = new Date().toISOString();
  saveReviewsToDisk();

  if (review.targetUserId) {
    const userReviews = reviews.filter(r => r.targetUserId === review.targetUserId);
    const targetUser = users.find(u => u.id === review.targetUserId);
    if (targetUser && userReviews.length > 0) {
      targetUser.rating = Number((userReviews.reduce((sum, r) => sum + r.rating, 0) / userReviews.length).toFixed(1));
    }
  }

  if (review.orderId) {
    const order = orderIndex.get(review.orderId);
    if (order && order.review && order.review.id === review.id) {
      order.review.rating = review.rating;
      order.review.comment = review.comment;
      saveOrdersToDisk();
    }
  }

  res.json({ success: true, review });
});

// Seller Rebuttal / Public Response Endpoint
app.post('/api/reviews/:id/reply', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });

  const review = reviews.find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
  if (!isAdmin && review.targetUserId !== caller.id) {
    return res.status(403).json({ error: 'Forbidden: Only the reviewed seller or an admin can reply to this review.' });
  }

  if (review.reply) {
    return res.status(409).json({ error: 'A public response has already been submitted for this review.' });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Reply text cannot be empty.' });
  }

  const replyObj = {
    text: escapeHtml(text.trim()),
    createdAt: new Date().toISOString(),
    sellerId: caller.id,
    sellerName: caller.name,
    sellerAvatar: caller.avatar
  };

  review.reply = replyObj;
  saveReviewsToDisk();

  if (review.orderId) {
    const order = orderIndex.get(review.orderId);
    if (order) {
      if (order.review && order.review.id === review.id) {
        order.review.reply = replyObj;
      }
      saveOrdersToDisk();

      const sysMsg: Message = {
        id: 'msg_' + Date.now(),
        orderId: order.id,
        senderId: 'system',
        senderName: 'WorkSphere Reviews',
        text: `💬 Public response posted by seller ${caller.name}: "${replyObj.text}"`,
        timestamp: new Date().toISOString(),
        type: 'system',
        metadata: { action: 'review_reply_submitted', reply: replyObj }
      };
      recordMessage(sysMsg);
      saveMessagesToDisk();
      broadcastMessage(sysMsg, order.id);
    }
  }

  res.json({ success: true, review });
});
app.get('/api/support-tickets', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'User not found' });

  const isAdmin = caller.role === 'admin' || caller.role === 'super_admin' || caller.role === 'support';

  if (isAdmin) {
    res.json(supportTickets);
  } else {
    res.json(supportTickets.filter(t => t.userId === authUserId));
  }
});
app.get('/api/audit-logs', requireRole(['admin', 'super_admin']), (req, res) => res.json(auditLogs));

// User Email Notifications API
app.get('/api/user-emails/:userId', requireAuth, (req, res) => {
  const userList = userEmails.filter(e => e.userId === req.params.userId);
  res.json(userList);
});

app.patch('/api/user-emails/:id/read', requireAuth, (req, res) => {
  const em = userEmails.find(e => e.id === req.params.id);
  if (!em) return res.status(404).json({ error: 'Notification not found' });
  em.read = true;
  res.json({ success: true });
});

// User Support Ticket Creation API
app.post('/api/support-tickets', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'User not found' });

  const { subject, text, priority = 'medium' } = req.body;
  const userId = caller.id;
  const userName = caller.name;

  const newTicket: SupportTicket = {
    id: 'tick_' + Date.now(),
    userId,
    userName,
    subject: subject || 'General Support Query',
    priority,
    status: 'open',
    createdAt: new Date().toISOString().split('T')[0],
    messages: [
      { sender: userName, text: text || 'I need support assistance regarding my account.', timestamp: new Date().toISOString() }
    ]
  };
  supportTickets.unshift(newTicket);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: userName,
    role: caller.role,
    action: 'SUPPORT_TICKET_OPENED',
    target: `Ticket #${newTicket.id}`,
    details: `User submitted support request: ${subject}`,
    timestamp: new Date().toLocaleString()
  });

  res.status(201).json({ success: true, ticket: newTicket, ...newTicket });
});

const WORKSTREAM_UPLOADS_DIR = path.join(__dirname, 'data', 'uploads', 'workstream');
if (!fs.existsSync(WORKSTREAM_UPLOADS_DIR)) {
  fs.mkdirSync(WORKSTREAM_UPLOADS_DIR, { recursive: true });
}

const WORKSTREAM_FILE_URL_PREFIX = '/api/workstream/files/';
const WORKSTREAM_UPLOAD_INDEX_FILE = path.join(DATA_DIR, 'workstream_uploads.json');
const WORKSTREAM_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const WORKSTREAM_ABANDONED_UPLOAD_TTL_MS = 24 * 3600 * 1000;
// Allowed attachment types. Vectors (.svg) and code (.html, .js, .ts, etc.) are fully supported without restriction.
const WORKSTREAM_ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.txt', '.md', '.csv', '.json',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z',
  '.mp4', '.mov', '.webm', '.mp3', '.wav', '.fig', '.psd', '.ai', '.sketch',
  '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss',
  '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go', '.rs', '.sql', '.sh', '.xml', '.vue', '.svelte', '.yaml', '.yml'
]);
// .html is deliberately NOT inline: it would run uploaded scripts on the app origin. It is still fully downloadable.
const WORKSTREAM_INLINE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.svg', '.txt']);

// Upload ownership index: filename -> who uploaded it and when. Persisted so access rules and
// abandoned-upload cleanup survive restarts.
interface WorkstreamUploadRecord { ownerId: string; createdAt: string; }
let workstreamUploadIndex: Record<string, WorkstreamUploadRecord> = {};
try {
  if (fs.existsSync(WORKSTREAM_UPLOAD_INDEX_FILE)) {
    workstreamUploadIndex = JSON.parse(fs.readFileSync(WORKSTREAM_UPLOAD_INDEX_FILE, 'utf-8')) || {};
  }
} catch (err) {
  console.error('Failed to load workstream upload index:', err);
}

// (Old implementation removed in favor of atomic helper)

function workstreamFilenameFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(WORKSTREAM_FILE_URL_PREFIX)) return null;
  const name = path.basename(url.slice(WORKSTREAM_FILE_URL_PREFIX.length).split('?')[0]);
  return name || null;
}

/** True when any message, deliverable or delivery record still points at this stored file. */
function workstreamFileReferencedBy(filename: string): Array<{ buyerId: string; sellerId: string }> {
  const holders: Array<{ buyerId: string; sellerId: string }> = [];
  const matches = (u: unknown) => workstreamFilenameFromUrl(u) === filename;
  for (const o of orders as any[]) {
    const inOrder =
      (Array.isArray(o.deliverableFiles) && o.deliverableFiles.some((f: any) => matches(f?.url))) ||
      (Array.isArray(o.deliveryHistory) && o.deliveryHistory.some((d: any) => Array.isArray(d.files) && d.files.some((f: any) => matches(f?.url)))) ||
      messages.some(m => m.orderId === o.id && matches(m.fileInfo?.url));
    if (inOrder) holders.push({ buyerId: o.buyerId, sellerId: o.sellerId });
  }
  return holders;
}

function canAccessWorkstreamFile(user: any, filename: string): boolean {
  if (!user) return false;
  if (isStaffUser(user)) return true;
  if (workstreamUploadIndex[filename]?.ownerId === user.id) return true;
  return workstreamFileReferencedBy(filename).some(h => h.buyerId === user.id || h.sellerId === user.id);
}

/** A message attachment must be a file the sender uploaded (or staff attaching one that exists). */
function validateMessageFileInfo(fileInfo: any, sender: any):
  { ok: true; fileInfo: any } | { ok: false; error: string } {
  if (fileInfo === undefined || fileInfo === null) return { ok: true, fileInfo: undefined };
  if (typeof fileInfo !== 'object') return { ok: false, error: 'Invalid file attachment.' };
  const filename = workstreamFilenameFromUrl(fileInfo.url);
  if (!filename || !fs.existsSync(path.join(WORKSTREAM_UPLOADS_DIR, filename))) {
    return { ok: false, error: 'Attachments must be uploaded files; placeholder or external URLs are not accepted.' };
  }
  if (!isStaffUser(sender) && workstreamUploadIndex[filename]?.ownerId !== sender.id) {
    return { ok: false, error: 'You can only attach files that you uploaded.' };
  }
  const bytes = fs.statSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)).size;
  const size = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return {
    ok: true,
    fileInfo: {
      name: typeof fileInfo.name === 'string' && fileInfo.name.trim() ? fileInfo.name.trim().slice(0, 200) : filename,
      size,
      url: `${WORKSTREAM_FILE_URL_PREFIX}${filename}`,
      ...(typeof fileInfo.type === 'string' ? { type: fileInfo.type.slice(0, 100) } : {})
    }
  };
}

// Validates that client-submitted file records point at files actually stored by the upload endpoint
function validateStoredWorkstreamFiles(raw: any[], submitter?: any): { ok: true; files: Array<{ name: string; size: string; url: string }> } | { ok: false; error: string } {
  const out: Array<{ name: string; size: string; url: string }> = [];
  for (const f of raw) {
    const filename = workstreamFilenameFromUrl(f?.url);
    if (!filename) {
      // Non-uploaded deliverable "links" are user-provided content: working, broken or arbitrary URLs and free text
      // (including text such as "javascript:..." or "data:...") are stored as typed and never verified.
      // Safety is enforced where the value is rendered/opened in the browser (src/utils/safeFileLink.ts), not here.
      if (typeof f?.url !== 'string') {
        return { ok: false, error: 'Invalid deliverable link.' };
      }
      const extUrl = f.url.trim();
      out.push({
        name: typeof f?.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 200) : 'External Deliverable',
        size: typeof f?.size === 'string' ? f.size : '1.0 MB',
        url: extUrl
      });
      continue;
    }
    if (!fs.existsSync(path.join(WORKSTREAM_UPLOADS_DIR, filename))) {
      return { ok: false, error: `Uploaded file not found on server: ${filename}` };
    }
    if (submitter && !isStaffUser(submitter) && workstreamUploadIndex[filename]?.ownerId !== submitter.id) {
      return { ok: false, error: 'You can only deliver files that you uploaded.' };
    }
    const bytes = fs.statSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)).size;
    const size = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const parts = filename.split('_');
    const fallbackName = parts.length > 2 ? parts.slice(2).join('_') : filename;
    out.push({ name: typeof f?.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 200) : fallbackName, size, url: `${WORKSTREAM_FILE_URL_PREFIX}${filename}` });
  }
  return { ok: true, files: out };
}

// Remove uploads that were never attached to a message or delivery (WS-31). Only files recorded in
// the upload index are ever deleted; legacy/unknown files are left alone.
function cleanupAbandonedWorkstreamUploads() {
  const now = Date.now();
  let changed = false;

  // 1. Clean the index of abandoned entries
  for (const [filename, rec] of Object.entries(workstreamUploadIndex)) {
    const isOld = now - new Date(rec.createdAt).getTime() > WORKSTREAM_ABANDONED_UPLOAD_TTL_MS;
    if (!isOld) continue;

    const isReferenced = workstreamFileReferencedBy(filename).length > 0;
    if (isReferenced) continue;

    try { fs.unlinkSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)); } catch { /* already gone */ }
    delete workstreamUploadIndex[filename];
    changed = true;
  }

  // 2. Deep Clean: scan filesystem for unindexed "garbage" files
  try {
    const filesOnDisk = fs.readdirSync(WORKSTREAM_UPLOADS_DIR);
    for (const file of filesOnDisk) {
      if (!workstreamUploadIndex[file]) {
        // Unindexed file found. Check if it's old enough to be "orphaned" (e.g. 1 hour old)
        // to avoid deleting files currently being uploaded but not yet indexed.
        const filePath = path.join(WORKSTREAM_UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 3600_000) {
          try { fs.unlinkSync(filePath); } catch {}
        }
      }
    }
  } catch (e) {
    console.error('Error during deep Workstream cleanup:', e);
  }

  if (changed) saveWorkstreamUploadIndex();
}

setInterval(cleanupAbandonedWorkstreamUploads, 3600_000).unref?.();

// ==========================================
// BUYER REVIEW WINDOW & AUTO-ACCEPT ENGINE
// ==========================================
export function processAutoAcceptOrders(customNow?: number): Array<{
  orderId: string;
  acceptedVersion: number;
  amount: number;
  freelancerNet: number;
}> {
  if (!isAutoAcceptEnabled()) {
    return [];
  }

  const days = getReviewWindowDays();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const now = typeof customNow === 'number' ? customNow : Date.now();
  const processed: Array<{ orderId: string; acceptedVersion: number; amount: number; freelancerNet: number }> = [];

  for (const order of orders) {
    // 1. Must be currently in 'delivered' status
    if (order.status !== 'delivered') continue;

    // 2. Must have valid delivery history
    if (!Array.isArray(order.deliveryHistory) || order.deliveryHistory.length === 0) continue;

    const latestDelivery = order.deliveryHistory[order.deliveryHistory.length - 1];
    if (!latestDelivery || !latestDelivery.deliveredAt) continue;

    const deliveredAt = new Date(latestDelivery.deliveredAt).getTime();
    if (isNaN(deliveredAt)) continue;

    // 3. Stays in 'delivered' for REVIEW_WINDOW_DAYS
    if (now - deliveredAt < windowMs) continue;

    // 4. Must have no active requested revision
    if (Array.isArray(order.revisions)) {
      const hasActiveRequestedRevision = order.revisions.some(
        r => r.status === 'requested'
      );
      if (hasActiveRequestedRevision) continue;
    }

    // 5. Must skip disputed orders
    if ((order.status as string) === 'disputed') continue;
    const hasDispute = disputes.some(
      d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation')
    );
    if (hasDispute) continue;

    // 6. Check that refundable/releasable escrow remains in the ledger
    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      continue;
    }

    // 7. Idempotency key for this order and delivery version
    const requestKey = `auto_accept_${order.id}_v${latestDelivery.version}`;

    try {
      console.log(`[ReviewWindow] Auto-accepting order ${order.id} (delivery v${latestDelivery.version}) after ${days} days.`);
      
      // Execute release using the same releaseOrderFunds path as a manual release
      const result = releaseOrderFunds(order, 'System Auto-Accept', `Auto-accept after buyer review window (${days} days) elapsed`, requestKey);

      // Record acceptedVersion
      order.acceptedVersion = latestDelivery.version;
      saveOrdersToDisk();

      // Post system message into workstream
      const sysMsg: Message = {
        id: 'msg_' + now + '_' + Math.random().toString(36).slice(2, 6),
        orderId: order.id,
        senderId: 'system',
        senderName: 'WorkSphere Review Desk',
        text: `🎉 Order #${order.id} automatically accepted: Buyer review window (${days} days) closed without revisions or dispute. Escrow funds released to seller.`,
        timestamp: new Date(now).toISOString(),
        type: 'system',
        metadata: {
          action: 'order_auto_accepted',
          acceptedVersion: latestDelivery.version,
          reviewWindowDays: days
        }
      };
      recordMessage(sysMsg);
      saveMessagesToDisk();
      broadcastMessage(sysMsg, order.id);

      // Log to the audit log
      registerAuditLog({
        id: 'log_' + now + '_' + Math.random().toString(36).slice(2, 6),
        actor: 'System Auto-Accept',
        role: 'super_admin',
        action: 'ORDER_AUTO_ACCEPTED',
        target: `Order #${order.id}`,
        details: `Order auto-accepted after ${days} days in delivered status without revision or dispute. Deliverable v${latestDelivery.version} approved. Escrow of $${order.amount} released (net payout $${result.freelancerNet}).`,
        timestamp: new Date(now).toLocaleString()
      });

      processed.push({
        orderId: order.id,
        acceptedVersion: latestDelivery.version,
        amount: order.amount,
        freelancerNet: result.freelancerNet
      });
    } catch (err: any) {
      console.error(`[ReviewWindow] Failed to auto-accept order ${order.id}:`, err);
    }
  }

  return processed;
}

// Periodically check and auto-accept orders after review window
setInterval(() => {
  try {
    processAutoAcceptOrders();
  } catch (err) {
    console.error('[ReviewWindow] Auto-accept job error:', err);
  }
}, 60 * 1000).unref?.();

// Admin endpoint to trigger or check auto-acceptance
app.post('/api/admin/orders/check-auto-accept', requireAdmin, (req, res) => {
  try {
    const processed = processAutoAcceptOrders();
    res.json({ success: true, processedCount: processed.length, processed });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Auto-accept check failed' });
  }
});
app.post('/api/workstream/upload', requireAuth, rateLimit(5, 60_000), express.raw({ type: '*/*', limit: WORKSTREAM_MAX_UPLOAD_BYTES }), (req, res) => {
  try {
    const caller = (req as any).authenticatedUser;
    const rawName = (req.query.name as string) || 'attachment';
    let decodedName: string;
    try { decodedName = decodeURIComponent(rawName); } catch { decodedName = rawName; }
    const safeBase = path.basename(decodedName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
    const ext = path.extname(safeBase).toLowerCase();
    if (ext && !WORKSTREAM_ALLOWED_EXTENSIONS.has(ext)) {
      WORKSTREAM_ALLOWED_EXTENSIONS.add(ext);
    }
    const nameWithoutExt = path.basename(safeBase, path.extname(safeBase));
    const storedFilename = `${Date.now()}_${randomUUID().slice(0, 8)}_${nameWithoutExt}${ext}`;
    const filePath = path.join(WORKSTREAM_UPLOADS_DIR, storedFilename);

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No file data received' });
    }
    if (buffer.length > WORKSTREAM_MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'File is too large (25 MB maximum).' });
    }

    fs.writeFileSync(filePath, buffer);
    workstreamUploadIndex[storedFilename] = { ownerId: caller.id, createdAt: new Date().toISOString() };
    saveWorkstreamUploadIndex();

    const bytes = buffer.length;
    const sizeStr = bytes > 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

    const mimeType = (req.headers['content-type'] as string) || 'application/octet-stream';

    res.json({
      name: safeBase,
      size: sizeStr,
      url: `${WORKSTREAM_FILE_URL_PREFIX}${storedFilename}`,
      type: mimeType
    });
  } catch (err: any) {
    console.error('Workstream file upload error:', err);
    res.status(500).json({ error: 'Failed to save uploaded file' });
  }
});

app.get('/api/workstream/files/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(WORKSTREAM_UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!canAccessWorkstreamFile((req as any).authenticatedUser, filename)) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this file.' });
  }

  const parts = filename.split('_');
  const originalName = parts.length > 2 ? parts.slice(2).join('_') : filename;
  const ext = path.extname(filename).toLowerCase();

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');

  // Only safe types render inline; everything else is forced to download.
  if (req.query.download === '1' || !WORKSTREAM_INLINE_EXTENSIONS.has(ext)) {
    return res.download(filePath, originalName);
  }

  // Inline SVG can carry <script>; sandbox it so it renders as an image only.
  if (ext === '.svg') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  }
  res.sendFile(filePath);
});

app.get('/api/messages/:orderId', requireAuth, (req, res) => {
  const order = orderIndex.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream((req as any).authenticatedUser, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  const filtered = messageIndex.get(req.params.orderId) || [];
  res.json(filtered);
});

app.post('/api/messages', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'User not found' });
  const orderId = req.body.orderId;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });

  let order = orderIndex.get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream(caller, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  const fileCheck = validateMessageFileInfo(req.body.fileInfo, caller);
  if (!fileCheck.ok) return res.status(400).json({ error: fileCheck.error });

  const clientMessageId = typeof req.body.clientMessageId === 'string' ? req.body.clientMessageId : undefined;
  if (clientMessageId) {
    const existing = messages.find(m => m.orderId === orderId && m.metadata?.clientMessageId === clientMessageId);
    if (existing) return res.json({ success: true, message: existing, deduplicated: true });
  }

  try {
    const newMsg = sanitizeAndCreateMessage(caller, order, req.body, fileCheck);

    recordMessage(newMsg);
    saveMessagesToDisk();
    broadcastMessage(newMsg, order.id);
    res.json(newMsg);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
});

app.post('/api/gigs', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
  if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

  // Enforce Gig Pricing Limits from Site Settings
  const activeSettings = siteSettings.getSettings();
  const gigPrice = Number(req.body.price);
  const minGigPrice = activeSettings.marketplace.minimumGigPrice ?? 10;
  const maxGigPrice = activeSettings.marketplace.maximumGigPrice ?? 10000;
  if (gigPrice < minGigPrice) {
    return res.status(400).json({ error: `Gig price ($${gigPrice}) cannot be lower than the platform minimum of $${minGigPrice}.` });
  }
  if (gigPrice > maxGigPrice) {
    return res.status(400).json({ error: `Gig price ($${gigPrice}) cannot exceed the platform maximum of $${maxGigPrice}.` });
  }

  // Determine publication status based on Admin Gig Moderation setting
  const initialStatus = activeSettings.marketplace.gigModerationRequired ? 'pending' : 'published';

  const newGig: Gig = {
    id: 'gig_' + Date.now(),
    freelancerId: caller.id,
    freelancerName: caller.name,
    freelancerUsername: caller.username || caller.name.toLowerCase().replace(/\s+/g, '_'),
    freelancerAvatar: caller.avatar,
    freelancerLevel: 'Level 1 ★',
    title: escapeHtml(req.body.title || 'Untitled Gig'),
    slug: req.body.title ? req.body.title.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') : 'custom-gig',
    category: req.body.category || 'Development & IT',
    subcategory: req.body.subcategory || 'General',
    description: escapeHtml(req.body.description || ''),
    price: gigPrice,
    deliveryDays: Number(req.body.deliveryDays),
    rating: 5.0,
    reviewsCount: 1,
    image: req.body.image || 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=500&fit=crop',
    status: initialStatus,
    featured: false,
    extras: req.body.extras || []
  };
  gigs.unshift(newGig);
  res.json(newGig);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
  if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

  // Enforce Client Job Post Quota
  const activeSettings = siteSettings.getSettings();
  if (activeSettings.memberships.membershipsEnabled) {
    const planId = (caller as any).buyerMembershipTier || 'buyer_free';
    const plan = activeSettings.memberships.buyerPlans.find(p => p.id === planId) || activeSettings.memberships.buyerPlans[0];
    const quotaLimit = plan?.jobPostsPerMonth ?? 10;

    // Count projects posted by caller in current 30-day window
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentProjects = projects.filter(p => p.buyerId === caller.id && p.createdAt && p.createdAt.substring(0, 10) >= thirtyDaysAgo);

    if (recentProjects.length >= quotaLimit) {
      return res.status(403).json({
        error: `Monthly job post quota reached (${recentProjects.length}/${quotaLimit} posts used). Upgrade your plan to Enterprise Client to post more jobs.`
      });
    }
  }

  // Enforce Minimum Project Budget
  const minBudget = activeSettings.marketplace.minimumProjectBudget ?? 20;
  const budgetMin = Number(req.body.budgetMin);
  if (minBudget > 0 && budgetMin < minBudget) {
    return res.status(400).json({
      error: `Project budget ($${budgetMin}) is below the platform minimum requirement of $${minBudget}.`
    });
  }

  const newProj: Project = {
    id: 'proj_' + Date.now(),
    buyerId: caller.id,
    buyerName: caller.name,
    buyerAvatar: caller.avatar,
    title: escapeHtml(req.body.title || 'Untitled Project'),
    category: req.body.category || 'Development & IT',
    subcategory: req.body.subcategory || 'General',
    description: escapeHtml(req.body.description || ''),
    budgetMin: Number(req.body.budgetMin),
    budgetMax: Number(req.body.budgetMax),
    deadlineDays: 14,
    proposalsCount: 0,
    createdAt: new Date().toISOString().split('T')[0],
    status: 'open',
    featured: false
  };
  projects.unshift(newProj);
  res.json(newProj);
});

// Admin Projects Management Endpoints
app.get('/api/admin/projects', (req, res) => {
  res.json(projects);
});

app.patch('/api/admin/projects/:id', (req, res) => {
  const p = projects.find(proj => proj.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  if (req.body.title !== undefined) p.title = req.body.title;
  if (req.body.category !== undefined) p.category = req.body.category;
  if (req.body.subcategory !== undefined) p.subcategory = req.body.subcategory;
  if (req.body.description !== undefined) p.description = req.body.description;
  if (req.body.budgetMin !== undefined) p.budgetMin = Number(req.body.budgetMin);
  if (req.body.budgetMax !== undefined) p.budgetMax = Number(req.body.budgetMax);
  if (req.body.deadlineDays !== undefined) p.deadlineDays = Number(req.body.deadlineDays);
  if (req.body.status !== undefined) p.status = req.body.status;
  if (req.body.featured !== undefined) p.featured = Boolean(req.body.featured);
  if (req.body.moderationStatus !== undefined) p.moderationStatus = req.body.moderationStatus;
  if (req.body.moderationNotes !== undefined) p.moderationNotes = req.body.moderationNotes;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROJECT_EDITED',
    target: `Project "${p.title}"`,
    details: `Updated project parameters, category, budget, or moderation status`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.patch('/api/admin/projects/:id/status', (req, res) => {
  const p = projects.find(proj => proj.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  const oldStatus = p.status;
  p.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: `PROJECT_STATUS_${req.body.status.toUpperCase()}`,
    target: `Project "${p.title}"`,
    details: `Changed project status from "${oldStatus}" to "${req.body.status}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.patch('/api/admin/projects/:id/feature', (req, res) => {
  const p = projects.find(proj => proj.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  p.featured = !p.featured;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: p.featured ? 'PROJECT_FEATURED' : 'PROJECT_UNFEATURED',
    target: `Project "${p.title}"`,
    details: `${p.featured ? 'Featured' : 'Unfeatured'} project on platform homepage & listings`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.delete('/api/admin/projects/:id', (req, res) => {
  const index = projects.findIndex(proj => proj.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Project not found' });

  const deleted = projects[index];
  projects.splice(index, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROJECT_DELETED',
    target: `Project "${deleted.title}"`,
    details: `Permanently removed project #${deleted.id} by ${deleted.buyerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

// Admin Gigs / Services Management Endpoints
app.get('/api/admin/gigs', (req, res) => {
  res.json(gigs);
});

app.patch('/api/admin/gigs/:id', (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  if (req.body.title !== undefined) g.title = req.body.title;
  if (req.body.category !== undefined) g.category = req.body.category;
  if (req.body.subcategory !== undefined) g.subcategory = req.body.subcategory;
  if (req.body.description !== undefined) g.description = req.body.description;
  if (req.body.price !== undefined) g.price = Number(req.body.price);
  if (req.body.deliveryDays !== undefined) g.deliveryDays = Number(req.body.deliveryDays);
  if (req.body.status !== undefined) g.status = req.body.status;
  if (req.body.featured !== undefined) g.featured = Boolean(req.body.featured);
  if (req.body.moderationStatus !== undefined) g.moderationStatus = req.body.moderationStatus;
  if (req.body.moderationNotes !== undefined) g.moderationNotes = req.body.moderationNotes;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'GIG_EDITED',
    target: `Gig "${g.title}"`,
    details: `Updated gig specifications, pricing, delivery, or moderation verdict: "${g.moderationStatus || 'none'}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.patch('/api/admin/gigs/:id/status', (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  const oldStatus = g.status;
  g.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: `GIG_STATUS_${req.body.status.toUpperCase()}`,
    target: `Gig "${g.title}"`,
    details: `Changed service status from "${oldStatus}" to "${req.body.status}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.patch('/api/admin/gigs/:id/feature', (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  g.featured = !g.featured;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: g.featured ? 'GIG_FEATURED' : 'GIG_UNFEATURED',
    target: `Gig "${g.title}"`,
    details: `${g.featured ? 'Featured' : 'Unfeatured'} freelancer service on marketplace home & listings`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.delete('/api/admin/gigs/:id', (req, res) => {
  const index = gigs.findIndex(gig => gig.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Gig/Service not found' });

  const deleted = gigs[index];
  gigs.splice(index, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'GIG_DELETED',
    target: `Gig "${deleted.title}"`,
    details: `Permanently deleted freelancer gig #${deleted.id} by ${deleted.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

app.delete('/api/gigs/:id', (req, res) => {
  const index = gigs.findIndex(gig => gig.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Gig/Service not found' });

  const deleted = gigs[index];
  gigs.splice(index, 1);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Freelancer / User',
    role: 'freelancer',
    action: 'GIG_DELETED',
    target: `Gig "${deleted.title}"`,
    details: `Permanently deleted freelancer gig #${deleted.id} by ${deleted.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

app.patch('/api/gigs/:id', (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  if (req.body.title !== undefined) g.title = req.body.title;
  if (req.body.category !== undefined) g.category = req.body.category;
  if (req.body.subcategory !== undefined) g.subcategory = req.body.subcategory;
  if (req.body.description !== undefined) g.description = req.body.description;
  if (req.body.price !== undefined) g.price = Number(req.body.price);
  if (req.body.deliveryDays !== undefined) g.deliveryDays = Number(req.body.deliveryDays);
  if (req.body.status !== undefined) g.status = req.body.status;
  if (req.body.featured !== undefined) g.featured = Boolean(req.body.featured);
  if (req.body.moderationStatus !== undefined) g.moderationStatus = req.body.moderationStatus;
  if (req.body.moderationNotes !== undefined) g.moderationNotes = req.body.moderationNotes;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Freelancer / User',
    role: 'freelancer',
    action: 'GIG_UPDATED',
    target: `Gig "${g.title}"`,
    details: `Updated gig details/status to "${g.status}"`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

app.patch('/api/gigs/:id/feature', (req, res) => {
  const g = gigs.find(gig => gig.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Gig/Service not found' });

  g.featured = !g.featured;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Freelancer / User',
    role: 'freelancer',
    action: g.featured ? 'GIG_FEATURED' : 'GIG_UNFEATURED',
    target: `Gig "${g.title}"`,
    details: `${g.featured ? 'Featured' : 'Unfeatured'} gig on marketplace listings`,
    timestamp: new Date().toLocaleString()
  });

  res.json(g);
});

/**
 * Opens (or reuses) the private workstream between a project's owner and a freelancer who bid on it.
 * The owner is the buyer and the freelancer is the seller, so the existing proposal / escrow flow
 * (seller sends a Proposal, buyer accepts and pays into escrow) works unchanged inside this thread.
 * Returns the workstream's order id, or undefined when no chat can be opened (the bid itself still stands).
 */
function openProjectChat(project: any, freelancer: any, proposal: Proposal): string | undefined {
  try {
    if (!project || !['open', 'published'].includes(project.status)) return undefined;
    const owner = users.find(u => u.id === project.buyerId);
    if (!owner || owner.status !== 'active' || owner.id === freelancer.id) return undefined;

    let order: Order | undefined = orders.find(o =>
      o.projectId === project.id && o.buyerId === owner.id && o.sellerId === freelancer.id &&
      !['completed', 'cancelled'].includes(o.status));
    if (!order) {
      const created: Order = {
        id: 'ord_' + randomUUID().slice(0, 12),
        title: `Inquiry: ${project.title}`,
        buyerId: owner.id, sellerId: freelancer.id,
        amount: 0, status: 'in_progress',
        createdAt: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        projectId: project.id
      };
      order = enrichOrderWithServiceInfo(created) as Order;
      recordOrder(order);
      saveOrdersToDisk();
    }

    const sym = siteSettings.getFlattenedSettings().currencySymbol || '$';
    const days = proposal.deliveryDays;
    const text = `Proposal for "${project.title}"\nBid: ${sym}${proposal.bidAmount} · Delivery: ${days} day${days === 1 ? '' : 's'}\n\n${proposal.coverLetter}`.slice(0, 5000);
    const msg: Message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      orderId: order.id,
      senderId: freelancer.id,
      senderName: freelancer.name,
      text,
      timestamp: new Date().toISOString(),
      type: 'message',
      metadata: { action: 'project_proposal' }
    };
    recordMessage(msg);
    saveMessagesToDisk();
    broadcastMessage(msg, order.id);
    return order.id;
  } catch (err) {
    console.error('Failed to open project chat for proposal:', err);
    return undefined;
  }
}

app.post('/api/proposals', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
  if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

  // Enforce Freelancer Proposal Quota
  const activeSettings = siteSettings.getSettings();
  if (activeSettings.memberships.membershipsEnabled) {
    const planId = (caller as any).membershipTier || 'plan_free';
    const plan = activeSettings.memberships.freelancerPlans.find(p => p.id === planId) || activeSettings.memberships.freelancerPlans[0];
    const quotaLimit = plan?.bidsPerMonth ?? 15;

    // Count proposals submitted by caller in current 30-day window
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentBids = proposals.filter(p => p.freelancerId === caller.id && p.createdAt && p.createdAt.substring(0, 10) >= thirtyDaysAgo);

    if (recentBids.length >= quotaLimit) {
      return res.status(403).json({
        error: `Monthly proposal quota reached (${recentBids.length}/${quotaLimit} bids used). Upgrade your membership to WorkPerHour Pro Talent to send more bids.`
      });
    }
  }

  const newProp: Proposal = {
    id: 'prop_' + Date.now(),
    projectId: req.body.projectId,
    freelancerId: caller.id,
    freelancerName: caller.name,
    freelancerAvatar: caller.avatar,
    freelancerTitle: caller.title || 'Senior Engineer',
    coverLetter: escapeHtml(req.body.coverLetter || ''),
    bidAmount: Number(req.body.bidAmount),
    deliveryDays: Number(req.body.deliveryDays),
    createdAt: new Date().toISOString().split('T')[0],
    status: 'pending'
  };
  proposals.unshift(newProp);
  const proj = projects.find(p => p.id === req.body.projectId);
  if (proj) proj.proposalsCount += 1;
  const workstreamOrderId = openProjectChat(proj, caller, newProp);
  res.json({ ...newProp, workstreamOrderId });
});

app.post('/api/orders', requireAuth, rateLimit(30, 60_000), (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (title.length < 3) return res.status(400).json({ error: 'A valid order title is required.' });
    const buyerId = caller.id;
    const sellerId = String(req.body?.sellerId || '');
    const buyer = caller;
    const seller = users.find(u => u.id === sellerId);
    if (!seller) return res.status(404).json({ error: 'Seller not found.' });
    if (buyerId === sellerId) return res.status(400).json({ error: 'You cannot order from yourself.' });
    ensureWallet(buyerId); ensureWallet(sellerId);
    if (buyer.status !== 'active' || seller.status !== 'active') return res.status(403).json({ error: 'Both accounts must be active to place an order.' });

    // Enforce Max Active Orders per Freelancer limit
    const activeSettings = siteSettings.getSettings();
    const maxActiveOrders = activeSettings.marketplace.maxActiveOrdersPerFreelancer;
    if (maxActiveOrders > 0) {
      // Inquiry chats (amount 0, no escrow) are conversations, not work, so they don't count toward the limit.
      const activeSellerOrders = orders.filter(o => o.sellerId === sellerId && Number(o.amount) > 0 && ['funded_in_escrow', 'in_progress', 'delivered', 'revision'].includes(o.status));
      if (activeSellerOrders.length >= maxActiveOrders) {
        return res.status(400).json({
          error: `This seller has reached the maximum allowed active orders (${activeSellerOrders.length}/${maxActiveOrders}). Please try again later.`
        });
      }
    }

    const id = 'ord_' + randomUUID().slice(0, 12);
    const today = new Date().toISOString().split('T')[0];
    let rawAmount = Number(req.body?.amount);
    const isInquiry = rawAmount === 0 && /^inquiry:/i.test(title);
    // Gig orders are priced from the server-side gig + selected add-ons. The browser-sent `amount` is never trusted,
    // otherwise a client could pay any price and every fee (20% / 5.5% / $3.50) would be computed on the fake number.
    if (!isInquiry && req.body?.gigId) {
      const priced = resolveGigOrderPrice(String(req.body.gigId), req.body?.extraIds);
      if (priced.gig.freelancerId !== sellerId) return res.status(400).json({ error: 'This gig does not belong to the selected seller.' });
      rawAmount = priced.gigPrice;
    }

    const requirements = typeof req.body?.requirements === 'string' ? escapeHtml(req.body.requirements.trim()).slice(0, 2000) : '';

    let newOrd: Order;
    if (isInquiry) {
      // Chat thread only: nothing is charged and no escrow exists
      newOrd = { id, title, buyerId, sellerId, amount: 0, status: 'in_progress', createdAt: today, dueDate: req.body.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], gigId: req.body.gigId, projectId: req.body.projectId, ...(requirements ? { requirements } : {}) };
    } else {
      // Debits the buyer wallet into escrow. Throws (and creates nothing) if the balance is too low.
      financeLedger.fundEscrow({ orderId: id, orderTitle: title, amount: rawAmount, buyerId, sellerId, actor: `user:${buyerId}` });
      newOrd = {
        id, title, buyerId, sellerId, amount: rawAmount, status: 'funded_in_escrow', createdAt: today,
        dueDate: req.body.dueDate || new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
        escrowProtectionStartDate: today,
        escrowProtectionEndDate: new Date(Date.now() + DEFAULT_SITE_SETTINGS.commission.escrowProtectionDays * 86400000).toISOString().split('T')[0],
        gigId: req.body.gigId, projectId: req.body.projectId,
        feeBreakdown: financeLedger.quoteOrder(rawAmount),
        ...(requirements ? { requirements } : {})
      };
      syncUserBalances();
    }
    const enriched = enrichOrderWithServiceInfo(newOrd);
    recordOrder(enriched);
    saveOrdersToDisk();
    if (!isInquiry) {
      // Open the workstream with a record of the purchase (and the brief, if one was given) so it is never an empty thread.
      const opening: Array<{ senderId: string; senderName: string; text: string; type: 'system' | 'message' }> = [{
        senderId: 'system', senderName: 'Workstream', type: 'system',
        text: `Order placed: ${title}. Payment is held in escrow until the work is approved.`
      }];
      if (requirements) opening.push({ senderId: buyer.id, senderName: buyer.name, type: 'message', text: `Project requirements: ${requirements}` });
      opening.forEach((m, i) => {
        recordMessage({
          id: 'msg_' + Date.now() + '_' + i + Math.random().toString(36).slice(2, 6),
          orderId: id, ...m, timestamp: new Date(Date.now() + i).toISOString(),
          metadata: { action: i === 0 ? 'order_created' : 'requirements_logged' }
        } as Message);
      });
      saveMessagesToDisk();
    }
    res.status(201).json(enriched);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ==========================================
// WORKSTREAM OFFERS (proposal / invoice / deposit request)
// Real records with a status. Money only moves through financeLedger.fundEscrow when the BUYER accepts.
// ==========================================
type WorkstreamOfferKind = 'proposal' | 'invoice' | 'deposit';
type WorkstreamOfferStatus = 'pending' | 'accepted' | 'paid' | 'declined' | 'cancelled';
interface WorkstreamOffer {
  id: string;
  number: string;
  orderId: string;
  kind: WorkstreamOfferKind;
  title: string;
  amount: number;
  deliveryDays?: number;
  note?: string;
  status: WorkstreamOfferStatus;
  createdBy: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  /** Invoice payments create a new funded order; this is its id. */
  fundedOrderId?: string;
}

const OFFERS_FILE = path.join(DATA_DIR, 'workstream_offers.json');
let workstreamOffers: WorkstreamOffer[] = [];
try {
  if (fs.existsSync(OFFERS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(OFFERS_FILE, 'utf-8'));
    if (Array.isArray(parsed)) workstreamOffers = parsed;
  }
} catch (e) {
  console.error('Failed to load workstream offers:', e);
}
function saveOffersToDisk() { writeJsonAtomic(OFFERS_FILE, workstreamOffers); }

const OFFER_LABEL: Record<WorkstreamOfferKind, string> = { proposal: 'proposal', invoice: 'invoice', deposit: 'deposit request' };
const OFFER_PREFIX: Record<WorkstreamOfferKind, string> = { proposal: 'PRP', invoice: 'INV', deposit: 'DEP' };
const FUNDED_STATUSES = ['funded_in_escrow', 'delivered', 'revision', 'completed', 'disputed'];

function orderHasEscrow(orderId: string): boolean {
  return !!financeLedger.getEscrow(orderId);
}

function viewOffer(o: WorkstreamOffer) {
  let clientTotal: number | undefined;
  try { clientTotal = financeLedger.quoteOrder(o.amount)?.clientTotal; } catch { /* quote is informational only */ }
  return { ...o, clientTotal, currencySymbol: siteSettings.getFlattenedSettings().currencySymbol || '$' };
}

function postOfferMessage(order: Order, offer: WorkstreamOffer, sender: { id: string; name: string } | null, text: string, action: string) {
  const msg: Message = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: sender?.id || 'system',
    senderName: sender?.name || 'Workstream',
    text,
    timestamp: new Date().toISOString(),
    type: sender ? 'message' : 'system',
    metadata: { action, offerId: offer.id, offerKind: offer.kind }
  };
  // recordMessage (not a bare push) so the message is also in messageIndex, which GET /api/messages/:orderId reads.
  recordMessage(msg);
  saveMessagesToDisk();
  broadcastMessage(msg, order.id);
}

function offerCaller(req: Request) {
  const authUserId = (req as any).authenticatedUserId;
  return (req as any).authenticatedUser || users.find(u => u.id === authUserId);
}

// Admin Proposals Management Endpoints

app.get('/api/orders/:id/offers', requireAuth, (req, res) => {
  const caller = offerCaller(req);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream(caller, order)) return res.status(403).json({ error: 'Forbidden' });
  const offers = workstreamOffers
    .filter(o => o.orderId === order.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(viewOffer);
  res.json({
    offers,
    currencySymbol: siteSettings.getFlattenedSettings().currencySymbol || '$',
    escrowFunded: orderHasEscrow(order.id)
  });
});

app.post('/api/orders/:id/offers', requireAuth, rateLimit(20, 60_000), (req, res) => {
  try {
    const caller = offerCaller(req);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    // Only the order's seller may raise proposals, invoices or deposit requests. Staff cannot raise them on a seller's behalf.
    if (caller.id !== order.sellerId) return res.status(403).json({ error: 'Only the seller of this workstream can send this.' });
    if (order.status === 'cancelled') return res.status(400).json({ error: 'This workstream is cancelled.' });

    const kind = req.body?.kind as WorkstreamOfferKind;
    if (!['proposal', 'invoice', 'deposit'].includes(kind)) return res.status(400).json({ error: 'Invalid type.' });

    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    const minAmount = Number(siteSettings.getFlattenedSettings().minOrderAmount) || 0;
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
    if (amount > 100000) return res.status(400).json({ error: 'Amount is too large.' });
    if (amount < minAmount) return res.status(400).json({ error: `Minimum amount is ${siteSettings.getFlattenedSettings().currencySymbol || '$'}${minAmount}.` });

    const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const title = kind === 'deposit' ? (rawTitle || 'Escrow deposit') : rawTitle;
    if (title.length < 3 || title.length > 120) return res.status(400).json({ error: 'Title must be 3-120 characters.' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
    let deliveryDays: number | undefined;
    if (kind === 'proposal') {
      deliveryDays = Math.round(Number(req.body?.deliveryDays));
      if (!Number.isFinite(deliveryDays) || deliveryDays < 1 || deliveryDays > 365) return res.status(400).json({ error: 'Delivery time must be 1-365 days.' });
    }

    const funded = orderHasEscrow(order.id);
    if (kind === 'invoice') {
      if (!funded) return res.status(400).json({ error: 'Invoices are for follow-on work on a funded workstream. Send a proposal or deposit request first.' });
      if (workstreamOffers.filter(o => o.orderId === order.id && o.kind === 'invoice' && o.status === 'pending').length >= 5) {
        return res.status(409).json({ error: 'Too many unpaid invoices on this workstream.' });
      }
    } else {
      if (funded || order.status !== 'in_progress') return res.status(400).json({ error: 'Escrow is already funded for this workstream. Use Raise Invoice for additional work.' });
      if (workstreamOffers.some(o => o.orderId === order.id && o.kind !== 'invoice' && o.status === 'pending')) {
        return res.status(409).json({ error: 'There is already a pending proposal or deposit request. Cancel it first.' });
      }
    }

    const offer: WorkstreamOffer = {
      id: 'off_' + randomUUID().slice(0, 12),
      number: `${OFFER_PREFIX[kind]}-${String(workstreamOffers.filter(o => o.kind === kind).length + 1001)}`,
      orderId: order.id, kind, title, amount, deliveryDays, note: note || undefined,
      status: 'pending', createdBy: caller.id, createdAt: new Date().toISOString()
    };
    workstreamOffers.push(offer);
    saveOffersToDisk();
    postOfferMessage(order, offer, { id: caller.id, name: caller.name }, `New ${OFFER_LABEL[kind]} ${offer.number}: ${title}`, 'offer_created');
    res.status(201).json({ offer: viewOffer(offer) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/offers/:id/:action(accept|decline|cancel)', requireAuth, rateLimit(20, 60_000), (req, res) => {
  try {
    const caller = offerCaller(req);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });
    const offer = workstreamOffers.find(o => o.id === req.params.id);
    const order = offer ? orders.find(o => o.id === offer.orderId) : undefined;
    if (!offer || !order) return res.status(404).json({ error: 'Not found' });
    if (!canAccessOrderWorkstream(caller, order)) return res.status(403).json({ error: 'Forbidden' });
    if (offer.status !== 'pending') return res.status(409).json({ error: `This ${OFFER_LABEL[offer.kind]} is already ${offer.status}.` });

    const action = req.params.action;
    const now = new Date().toISOString();

    if (action === 'cancel') {
      if (caller.id !== order.sellerId) return res.status(403).json({ error: 'Only the seller can cancel this.' });
      offer.status = 'cancelled'; offer.resolvedAt = now; offer.resolvedBy = caller.id;
      saveOffersToDisk();
      postOfferMessage(order, offer, null, `${offer.number} was cancelled by the seller.`, 'offer_cancelled');
      return res.json({ offer: viewOffer(offer) });
    }

    // Accepting / declining belongs to the buyer only (not staff, not the seller).
    if (caller.id !== order.buyerId) return res.status(403).json({ error: 'Only the buyer can respond to this.' });

    if (action === 'decline') {
      offer.status = 'declined'; offer.resolvedAt = now; offer.resolvedBy = caller.id;
      saveOffersToDisk();
      postOfferMessage(order, offer, null, `${offer.number} was declined by the buyer.`, 'offer_declined');
      return res.json({ offer: viewOffer(offer) });
    }

    // ----- accept: real money movement through the ledger -----
    ensureWallet(order.buyerId); ensureWallet(order.sellerId);
    const today = now.split('T')[0];
    const protectionEnd = new Date(Date.now() + siteSettings.getSettings().commission.escrowProtectionDays * 86400000).toISOString().split('T')[0];
    let newOrder: any;

    if (offer.kind === 'invoice') {
      const childId = 'ord_' + randomUUID().slice(0, 12);
      const childTitle = `${offer.title} (${offer.number})`;
      financeLedger.fundEscrow({ orderId: childId, orderTitle: childTitle, amount: offer.amount, buyerId: order.buyerId, sellerId: order.sellerId, actor: `user:${order.buyerId}` });
      const child: Order = {
        id: childId, title: childTitle, buyerId: order.buyerId, sellerId: order.sellerId, amount: offer.amount,
        status: 'funded_in_escrow', createdAt: today,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        escrowProtectionStartDate: today, escrowProtectionEndDate: protectionEnd,
        gigId: order.gigId, projectId: order.projectId,
        feeBreakdown: financeLedger.quoteOrder(offer.amount)
      };
      newOrder = enrichOrderWithServiceInfo(child);
      // recordOrder (not a bare unshift) so the new order is in orderIndex; otherwise its workstream 404s.
      recordOrder(newOrder);
      offer.status = 'paid';
      offer.fundedOrderId = childId;
      // A message on the new order reaches both parties over the socket, so the seller's client learns about it
      // (unknown order -> order list refresh) instead of only seeing it after a reload.
      postOfferMessage(newOrder, offer, null, `${offer.number} was paid. Escrow of ${offer.amount} is funded for this workstream.`, 'offer_accepted');
    } else {
      if (orderHasEscrow(order.id) || order.status !== 'in_progress') {
        return res.status(409).json({ error: 'Escrow is already funded for this workstream.' });
      }
      const newTitle = offer.kind === 'proposal' && /^inquiry:/i.test(order.title) ? offer.title : order.title;
      financeLedger.fundEscrow({ orderId: order.id, orderTitle: newTitle, amount: offer.amount, buyerId: order.buyerId, sellerId: order.sellerId, actor: `user:${order.buyerId}` });
      order.title = newTitle;
      order.amount = offer.amount;
      order.status = 'funded_in_escrow';
      order.escrowProtectionStartDate = today;
      order.escrowProtectionEndDate = protectionEnd;
      order.feeBreakdown = financeLedger.quoteOrder(offer.amount);
      if (offer.kind === 'proposal' && offer.deliveryDays) {
        order.dueDate = new Date(Date.now() + offer.deliveryDays * 86400000).toISOString().split('T')[0];
      }
      offer.status = 'accepted';
    }

    offer.resolvedAt = now; offer.resolvedBy = caller.id;
    syncUserBalances();
    saveOrdersToDisk();
    saveOffersToDisk();
    postOfferMessage(order, offer, null,
      offer.kind === 'invoice' ? `${offer.number} was paid. A new funded workstream was created for it.` : `${offer.number} was accepted and escrow was funded.`,
      'offer_accepted');
    res.json({ offer: viewOffer(offer), order: enrichOrderWithServiceInfo(order), newOrder });
  } catch (err: any) {
    // fundEscrow throws on insufficient balance, frozen wallets, below-minimum amounts, etc. Nothing was changed.
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/proposals/:id', (req, res) => {
  const p = proposals.find(prop => prop.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proposal not found' });

  if (req.body.coverLetter !== undefined) p.coverLetter = req.body.coverLetter;
  if (req.body.bidAmount !== undefined) p.bidAmount = Number(req.body.bidAmount);
  if (req.body.deliveryDays !== undefined) p.deliveryDays = Number(req.body.deliveryDays);
  if (req.body.status !== undefined) p.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROPOSAL_EDITED',
    target: `Proposal #${p.id}`,
    details: `Updated bid parameters ($${p.bidAmount}), delivery days (${p.deliveryDays}d), or status (${p.status}) for freelancer ${p.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.patch('/api/admin/proposals/:id/status', (req, res) => {
  const p = proposals.find(prop => prop.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proposal not found' });

  const oldStatus = p.status;
  p.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: `PROPOSAL_STATUS_${req.body.status.toUpperCase()}`,
    target: `Proposal #${p.id}`,
    details: `Changed proposal status from "${oldStatus}" to "${req.body.status}" for freelancer ${p.freelancerName}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(p);
});

app.delete('/api/admin/proposals/:id', (req, res) => {
  const index = proposals.findIndex(prop => prop.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Proposal not found' });

  const deleted = proposals[index];
  proposals.splice(index, 1);

  // Decrement proposalsCount on project if project exists
  const proj = projects.find(p => p.id === deleted.projectId);
  if (proj && proj.proposalsCount > 0) {
    proj.proposalsCount -= 1;
  }

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'PROPOSAL_DELETED',
    target: `Proposal #${deleted.id}`,
    details: `Permanently removed proposal #${deleted.id} by freelancer ${deleted.freelancerName} from project #${deleted.projectId}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, id: deleted.id });
});

// User Management Endpoints
app.patch('/api/admin/users/:id', (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  
  if (req.body.name !== undefined) u.name = escapeHtml(String(req.body.name));
  if (req.body.email !== undefined) u.email = escapeHtml(String(req.body.email));
  if (req.body.role !== undefined) u.role = req.body.role;
  if (req.body.title !== undefined) u.title = escapeHtml(String(req.body.title));
  if (req.body.bio !== undefined) u.bio = escapeHtml(String(req.body.bio));
  if (req.body.skills !== undefined) u.skills = Array.isArray(req.body.skills) ? req.body.skills : req.body.skills.split(',').map((s: string) => s.trim()).filter(Boolean);
  if (req.body.hourlyRate !== undefined) u.hourlyRate = Number(req.body.hourlyRate);
  // walletBalance is ledger-controlled and intentionally ignored here (use /api/admin/finance/adjustments)
  if (req.body.verified !== undefined) u.verified = Boolean(req.body.verified);
  if (req.body.status !== undefined) u.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'USER_PROFILE_EDITED',
    target: `User ${u.name}`,
    details: `Updated profile details and parameters for ${u.email}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(u);
});

app.patch('/api/admin/users/:id/status', (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  
  const oldStatus = u.status;
  u.status = req.body.status;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: `USER_STATUS_${req.body.status.toUpperCase()}`,
    target: `User ${u.name}`,
    details: `Changed account status from ${oldStatus} to ${req.body.status}`,
    timestamp: new Date().toLocaleString()
  });

  // Disconnect any active WebSocket connections if account is suspended, restricted, or deactivated
  if (u.status !== 'active') {
    for (const client of clients) {
      if ((client as any).authenticatedUserId === u.id) {
        client.close(1008, `Account is ${u.status}`);
      }
    }
  }

  // Notify user via chat message and email notification if suspended, restricted, or deactivated
  if (req.body.status === 'suspended' || req.body.status === 'restricted' || req.body.status === 'deactivated') {
    notifyUserOnAdminAction(u, req.body.status, req.body.notes);
  }

  res.json(u);
});

app.post('/api/admin/users/:id/impersonate', (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'USER_IMPERSONATED',
    target: `User ${u.name}`,
    details: `Initialized administrative impersonation session for ${u.email}`,
    timestamp: new Date().toLocaleString()
  });

  // Send security chat notification & email
  notifyUserOnAdminAction(u, 'impersonated');

  res.json({ success: true, user: u });
});

app.post('/api/admin/users/:id/stop-impersonate', (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'USER_IMPERSONATION_ENDED',
    target: `User ${u.name}`,
    details: `Safely ended administrative impersonation session for ${u.email}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, user: u });
});

app.patch('/api/admin/users/:id/verify', (req, res) => {
  const u = users.find(user => user.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  u.verified = !u.verified;

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: u.verified ? 'USER_VERIFIED' : 'USER_UNVERIFIED',
    target: `User ${u.name}`,
    details: `Verification status changed to ${u.verified}`,
    timestamp: new Date().toLocaleString()
  });

  res.json(u);
});

app.delete('/api/admin/users/:id', (req, res) => {
  const index = users.findIndex(user => user.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'User not found' });

  const target = users[index];
  if (financeLedger.hasOutstandingFunds(target.id)) {
    return res.status(409).json({ error: 'User still has wallet funds, pending withdrawals or active escrow. Resolve these before deleting the account.' });
  }
  if (orders.some(o => (o.buyerId === target.id || o.sellerId === target.id) && o.status !== 'completed' && o.status !== 'cancelled' && o.amount > 0)) {
    return res.status(409).json({ error: 'User has active paid orders. Complete or cancel them first.' });
  }
  const deletedUser = users[index];
  users.splice(index, 1);

  // Clean up listings to maintain references
  gigs = gigs.filter(g => g.freelancerId !== req.params.id);
  projects = projects.filter(p => p.buyerId !== req.params.id);

  registerAuditLog({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'USER_DELETED',
    target: `User ${deletedUser.name}`,
    details: `Permanently deleted user account ${deletedUser.email} and cleared their associated gigs & projects`,
    timestamp: new Date().toLocaleString()
  });

  // Clean up any active WebSocket connections for deleted user
  for (const client of clients) {
    if ((client as any).authenticatedUserId === req.params.id) {
      client.close(1008, 'Account deleted');
    }
  }

  res.json({ success: true, id: deletedUser.id });
});

// Dispute Resolution Endpoint: final outcomes actually move the escrowed money
app.patch('/api/admin/disputes/:id/resolve', requireAdmin, (req, res) => {
  // We don't have orderId yet, so we acquire it inside the try block after looking up the dispute.
  let lockedOrderId: string | null = null;
  try {
    const d = disputes.find(disp => disp.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Dispute not found' });
    const status = req.body.status as Dispute['status'];
    if (!['open', 'under_investigation', 'resolved_refund', 'resolved_release', 'resolved_partial'].includes(status)) {
      return res.status(400).json({ error: 'Invalid dispute status.' });
    }
    if (d.status.startsWith('resolved')) return res.status(409).json({ error: `Dispute is already ${d.status}.` });
    const notes = String(req.body.notes || '');
    const reason = notes.trim().length >= 5 ? notes.trim() : 'Dispute resolved by administrator';
    const order = orderIndex.get(d.orderId);
    if (status.startsWith('resolved')) {
      if (!order) return res.status(404).json({ error: 'Order for this dispute not found' });
      lockedOrderId = order.id;
      acquireOrderLock(lockedOrderId);
      if (status === 'resolved_release') releaseOrderFunds(order, adminActor(req), reason);
      else if (status === 'resolved_refund') refundOrderFunds(order, undefined, adminActor(req), reason);
      else splitOrderFunds(order, Number(req.body.refundAmount), adminActor(req), reason);
    }
    d.status = status;
    d.resolutionNotes = notes;
    registerAuditLog({
      id: 'log_' + randomUUID().slice(0, 12),
      actor: adminActor(req),
      role: 'super_admin',
      action: 'DISPUTE_RESOLVED',
      target: `Dispute #${d.id}`,
      details: `Resolved dispute with status ${status}. Notes: ${notes}`,
      timestamp: new Date().toLocaleString()
    });
    res.json(d);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    if (lockedOrderId) releaseOrderLock(lockedOrderId);
  }
});

// Support Ticket Reply Endpoint
app.post('/api/admin/tickets/:id/reply', (req, res) => {
  const t = supportTickets.find(tick => tick.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  t.messages.push({
    sender: 'WorkPerHour Support Staff',
    text: req.body.text,
    timestamp: new Date().toISOString()
  });
  t.status = 'in_progress';
  res.json(t);
});

// WebSocket Real-Time Chat Server
function broadcastMessage(message: Message, orderId: string) {
  const payload = JSON.stringify({ type: 'MESSAGE_RECEIVED', message });
  const updatePayload = JSON.stringify({ 
    type: 'WORKSTREAM_UPDATED', 
    orderId, 
    lastMessage: message.text, 
    lastMessageTime: message.timestamp 
  });

  const order = orderIndex.get(orderId);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && (client as any).isAuthenticated) {
      const clientUserId = (client as any).authenticatedUserId;
      if (!clientUserId) continue;
      const clientUser = users.find(u => u.id === clientUserId);
      const isAuthorized = !!order && canAccessOrderWorkstream(clientUser, order);
      
      if (isAuthorized) {
        client.send(payload);
        client.send(updatePayload);
      }
    }
  }
}

const clients = new Set<WebSocket>();

wss.on('connection', (ws, req) => {
  try {
    clients.add(ws);
    (ws as any).isAuthenticated = false;
    
    // Set a timeout to authenticate. If no valid AUTHENTICATE message is received within 1 second, close.
    const authTimeout = setTimeout(() => {
      if (!(ws as any).isAuthenticated) {
        try { ws.close(4401, 'Authentication timeout'); } catch {}
      }
    }, 1000);

    setupWebSocketHandlers(ws, authTimeout);
  } catch (err) {
    console.error('WS Connection error:', err);
    try { ws.close(1011, 'Server error during connection'); } catch {}
  }
});

function setupWebSocketHandlers(ws: WebSocket, authTimeout: NodeJS.Timeout) {
  // Rate limiting map for this socket: max 30 messages per 10 seconds
  let messageCount = 0;
  let resetTime = Date.now() + 10000;
  let authAttempts = 0;

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        ws.send(JSON.stringify({ error: 'Binary messages not supported' }));
        return;
      }

      const rawStr = data.toString();
      if (rawStr.length > 51200) {
        ws.send(JSON.stringify({ error: 'Message payload exceeds maximum allowed size' }));
        return;
      }

      const now = Date.now();
      if (now > resetTime) {
        messageCount = 1;
        resetTime = now + 10000;
      } else {
        messageCount++;
        if (messageCount > 30) {
          ws.send(JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }));
          return;
        }
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawStr);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON payload' }));
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (parsed.type === 'AUTHENTICATE') {
        authAttempts++;
        if (authAttempts > 3) {
          ws.send(JSON.stringify({ error: 'Too many authentication attempts' }));
          try { ws.close(4401, 'Too many auth attempts'); } catch {}
          return;
        }

        const token = parsed.token;
        if (!token) {
          ws.send(JSON.stringify({ error: 'Token is required' }));
          return;
        }

        const payload = verifyToken(token);
        if (payload && payload.id) {
          const dbUser = users.find(u => u.id === payload.id);
          if (dbUser && dbUser.status === 'active') {
            (ws as any).authenticatedUserId = dbUser.id;
            (ws as any).isAuthenticated = true;
            clearTimeout(authTimeout);
            
            ws.send(JSON.stringify({ 
              type: 'CONNECTED', 
              userId: dbUser.id,
              serverTime: new Date().toISOString() 
            }));
            return;
          }
        }
        
        ws.send(JSON.stringify({ error: 'Invalid token' }));
        try { ws.close(4401, 'Authentication failed'); } catch {}
        return;
      }

      // Block all other messages until authenticated
      if (!(ws as any).isAuthenticated) {
        ws.send(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }
    } catch (e) {
      console.error('WS message processing error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
}

// Vite middleware integration for development
(async () => {
  async function setupVite() {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(path.join(__dirname, 'dist')));
      app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
      });
    }
  }

  await setupVite();

  const PORT = process.env.PORT || 3000;
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`WorkPerHour server running on http://0.0.0.0:${PORT}`);
    if (bootstrapAdminPasswordNotice) {
      console.warn('[SECURITY] ADMIN_INITIAL_PASSWORD was not set. One-time generated super-admin password: ' + bootstrapAdminPasswordNotice + ' — change it after first login and set ADMIN_INITIAL_PASSWORD next time.');
    }
  });
})();

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Flushing pending writes...`);
  await Promise.all(writeQueue.values());
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
