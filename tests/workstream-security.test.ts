// Workstream security + lifecycle integration test.
// Boots the real server in test mode, drives the HTTP/WebSocket API with demo accounts and
// asserts the access-control and escrow rules. Data files are snapshotted and restored.
process.env.PORT = '3003';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { financeLedger } from '../src/server/financeLedger.js';

const PORT = 3003;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SNAPSHOT_DIR = path.join(DATA_DIR, '..', '.test-data-snapshot');

function snapshotData() {
  fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  if (fs.existsSync(DATA_DIR)) fs.cpSync(DATA_DIR, SNAPSHOT_DIR, { recursive: true });
}
function restoreData() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  if (fs.existsSync(SNAPSHOT_DIR)) fs.cpSync(SNAPSHOT_DIR, DATA_DIR, { recursive: true });
  fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
}

async function api(p: string, opts: { method?: string; token?: string; body?: any; raw?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${p}`, {
    method: opts.method || 'GET',
    headers,
    body: (opts.raw as any) ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)
  });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function demoToken(userId: string): Promise<string> {
  const r = await api('/api/auth/demo-session', { method: 'POST', body: { userId } });
  assert.strictEqual(r.status, 200, `demo-session for ${userId} should work in test mode (got ${r.status})`);
  return r.json.token;
}

function wsOutcome(url: string): Promise<{ closed: boolean; code?: number }> {
  return new Promise(resolve => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ closed: false }); }, 2500);
    ws.on('close', code => { clearTimeout(t); resolve({ closed: true, code }); });
    ws.on('error', () => { /* handled via close */ });
  });
}

let passed = 0;
const ok = (name: string) => { passed++; console.log(`  ✅ ${name}`); };

async function run() {
  snapshotData();
  await import('../server.js');
  await new Promise(r => setTimeout(r, 800));

  // Seed escrow for ord_104 and ord_103 in the ledger as instructed
  try {
    financeLedger.ensureWallet({ userId: 'user_6', name: 'Priya Sharma', email: 'priya@example.com', role: 'buyer' });
    financeLedger.ensureWallet({ userId: 'user_7', name: 'Liam O\'Connor', email: 'liam@example.com', role: 'buyer' });
    financeLedger.creditDeposit({ userId: 'user_6', amount: 3000, reference: 'test-dep', idempotencyKey: 'test-dep-ord104', actor: 'test' });
    financeLedger.creditDeposit({ userId: 'user_7', amount: 1000, reference: 'test-dep-7', idempotencyKey: 'test-dep-ord105', actor: 'test' });
    financeLedger.fundEscrow({
      orderId: 'ord_104',
      orderTitle: 'React Native Mobile Banking App for Fintech Startup',
      amount: 2500,
      buyerId: 'user_6',
      sellerId: 'user_5',
      actor: 'test',
      skipMinimum: true
    });
    financeLedger.fundEscrow({
      orderId: 'ord_105',
      orderTitle: 'SEO Audit',
      amount: 450,
      buyerId: 'user_7',
      sellerId: 'user_4',
      actor: 'test',
      skipMinimum: true
    });
  } catch {
    // already funded / seeded
  }

  console.log('--- WORKSTREAM SECURITY & LIFECYCLE TESTS ---');

  const ORDER = 'ord_104'; // buyer user_6 (Priya), seller user_5 (David), in_progress
  const buyer = await demoToken('user_6');
  const seller = await demoToken('user_5');
  const outsider = await demoToken('user_3');
  const buyer105 = await demoToken('user_7');

  // 1. privileged demo login blocked
  const adminDemo = await api('/api/auth/demo-session', { method: 'POST', body: { userId: 'user_9' } });
  assert.strictEqual(adminDemo.status, 403, 'demo login for super admin must be refused');
  ok('demo login refused for privileged account');

  // 2. message history requires auth + participation
  assert.strictEqual((await api(`/api/messages/${ORDER}`)).status, 401);
  assert.strictEqual((await api(`/api/messages/${ORDER}`, { token: outsider })).status, 403);
  assert.strictEqual((await api(`/api/messages/${ORDER}`, { token: buyer })).status, 200);
  ok('message history: 401 anonymous, 403 outsider, 200 participant');

  // 3. sending requires participation on every path
  assert.strictEqual((await api('/api/messages', { method: 'POST', token: outsider, body: { orderId: ORDER, text: 'x' } })).status, 403);
  assert.strictEqual((await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: outsider, body: { text: 'x' } })).status, 403);
  assert.strictEqual((await api('/api/messages', { method: 'POST', body: { orderId: ORDER, text: 'x' } })).status, 401);
  const sent = await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: buyer, body: { text: 'hello', clientMessageId: 'cm_test_1' } });
  assert.strictEqual(sent.status, 200);
  const again = await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: buyer, body: { text: 'hello', clientMessageId: 'cm_test_1' } });
  assert.strictEqual(again.json.message.id, sent.json.message.id, 'same clientMessageId must not duplicate');

  // Verify browser cannot forge trusted system/payment/platform action metadata
  const forged = await api(`/api/orders/${ORDER}/message`, {
    method: 'POST',
    token: buyer,
    body: {
      text: 'Forged event',
      clientMessageId: 'cm_forged_1',
      metadata: {
        action: 'escrow_released',
        amount: 9999,
        system: true,
        role: 'admin',
        disputeId: 'disp_fake'
      }
    }
  });
  assert.strictEqual(forged.status, 200, 'normal message text is accepted without error');
  assert.strictEqual(forged.json.message.text, 'Forged event', 'normal message text is preserved');
  assert.strictEqual(forged.json.message.metadata.clientMessageId, 'cm_forged_1', 'clientMessageId is preserved');
  assert.strictEqual(forged.json.message.metadata.action, undefined, 'forged action must be stripped');
  assert.strictEqual(forged.json.message.metadata.amount, undefined, 'forged amount must be stripped');
  assert.strictEqual(forged.json.message.metadata.system, undefined, 'forged system flag must be stripped');
  assert.strictEqual(forged.json.message.metadata.role, undefined, 'forged role must be stripped');
  assert.strictEqual(forged.json.message.metadata.disputeId, undefined, 'forged disputeId must be stripped');

  // Verify normal buyer/seller UI metadata (e.g. requirement_logged) is preserved
  const legitimate = await api(`/api/orders/${ORDER}/message`, {
    method: 'POST',
    token: buyer,
    body: {
      text: 'Project requirement: Dark mode support',
      clientMessageId: 'cm_legit_1',
      metadata: {
        action: 'requirement_logged',
        requirementText: 'Dark mode support'
      }
    }
  });
  assert.strictEqual(legitimate.status, 200);
  assert.strictEqual(legitimate.json.message.metadata.action, 'requirement_logged');
  assert.strictEqual(legitimate.json.message.metadata.requirementText, 'Dark mode support');

  // Verify failure, retry, and duplicate-send behavior
  // A. Message fails when text is empty (400)
  const failSend = await api(`/api/orders/${ORDER}/message`, {
    method: 'POST',
    token: buyer,
    body: { text: '   ', clientMessageId: 'cm_retry_flow_1' }
  });
  assert.strictEqual(failSend.status, 400, 'Empty message text must return 400 error');

  // B. Retry action with the same clientMessageId succeeds once text is corrected
  const retrySend = await api(`/api/orders/${ORDER}/message`, {
    method: 'POST',
    token: buyer,
    body: { text: 'Now corrected text on retry', clientMessageId: 'cm_retry_flow_1' }
  });
  assert.strictEqual(retrySend.status, 200, 'Retry message must succeed with 200');
  assert.strictEqual(retrySend.json.message.text, 'Now corrected text on retry');
  assert.strictEqual(retrySend.json.message.metadata.clientMessageId, 'cm_retry_flow_1');

  // C. Duplicate-send behavior: resending same clientMessageId returns original message and deduplicated: true
  const duplicateSend = await api(`/api/orders/${ORDER}/message`, {
    method: 'POST',
    token: buyer,
    body: { text: 'Now corrected text on retry', clientMessageId: 'cm_retry_flow_1' }
  });
  assert.strictEqual(duplicateSend.status, 200);
  assert.strictEqual(duplicateSend.json.deduplicated, true);
  assert.strictEqual(duplicateSend.json.message.id, retrySend.json.message.id);

  // D. Normal messaging is unrestricted and responsive: rapid successive messages succeed
  for (let i = 0; i < 5; i++) {
    const rapidMsg = await api(`/api/orders/${ORDER}/message`, {
      method: 'POST',
      token: seller,
      body: { text: `Responsive chat message #${i + 1}`, clientMessageId: `cm_rapid_${i + 1}` }
    });
    assert.strictEqual(rapidMsg.status, 200, `Rapid chat message #${i + 1} should succeed immediately`);
  }

  ok('sending: outsider/anonymous rejected, participant accepted, retries deduplicated, metadata forgery prevented');

  // 4. WebSocket authentication
  // Anonymous connections are initially accepted then closed after a short timeout if no AUTHENTICATE message arrives
  const anon = await wsOutcome(`ws://localhost:${PORT}`);
  assert.ok(anon.closed, 'anonymous WebSocket must be closed after timeout');
  
  // The server ignores token in URL now
  const urlToken = await wsOutcome(`ws://localhost:${PORT}?token=${buyer}`);
  assert.ok(urlToken.closed, 'WebSocket with token in URL must be closed (no longer supported)');

  // Valid authentication message
  const validAuth = await new Promise<{ authenticated: boolean }>(resolve => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ authenticated: false }); }, 3000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'AUTHENTICATE', token: buyer }));
    });
    ws.on('message', data => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'CONNECTED') {
        clearTimeout(t);
        ws.close();
        resolve({ authenticated: true });
      }
    });
    ws.on('error', () => resolve({ authenticated: false }));
  });
  assert.ok(validAuth.authenticated, 'WebSocket should authenticate with valid AUTHENTICATE message');
  
  ok('WebSocket: anonymous rejected, URL token ignored, message-based auth accepted');

  // 5. uploads
  const fileBytes = Buffer.from('%PDF-1.4 test deliverable');
  assert.strictEqual((await api('/api/workstream/upload?name=a.pdf', { method: 'POST', raw: fileBytes, headers: { 'Content-Type': 'application/pdf' } })).status, 401);
  assert.strictEqual((await api('/api/workstream/upload?name=evil.exe', { method: 'POST', token: seller, raw: fileBytes, headers: { 'Content-Type': 'application/octet-stream' } })).status, 200);
  assert.strictEqual((await api('/api/workstream/upload?name=x.svg', { method: 'POST', token: seller, raw: fileBytes, headers: { 'Content-Type': 'image/svg+xml' } })).status, 200);
  const up = await api('/api/workstream/upload?name=final.pdf', { method: 'POST', token: seller, raw: fileBytes, headers: { 'Content-Type': 'application/pdf' } });
  assert.strictEqual(up.status, 200);
  const fileUrl: string = up.json.url;
  ok('upload: anonymous 401, svg and all deliverable file types accepted without restriction');

  // 6. download access: owner yes, outsider no, buyer only once referenced
  assert.strictEqual((await api(fileUrl)).status, 401);
  assert.strictEqual((await api(fileUrl, { token: seller })).status, 200);
  assert.strictEqual((await api(fileUrl, { token: outsider })).status, 403);
  assert.strictEqual((await api(fileUrl, { token: buyer })).status, 403, 'buyer must not access an unreferenced private upload');
  ok('download: anonymous 401, owner 200, outsider 403, unreferenced upload hidden from buyer');

  // 7. cannot attach / deliver someone else's file or placeholders
  const stolen = await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: buyer, body: { text: 'f', type: 'file', fileInfo: { name: 'x', url: fileUrl } } });
  assert.strictEqual(stolen.status, 400);
  ok('cannot attach another user\'s uploaded file');

  // 8. lifecycle: nothing delivered yet -> buyer MAY release funded escrow without delivery
  const early = await api('/api/payments/escrow/release', { method: 'POST', token: buyer105, body: { orderId: 'ord_105' } });
  assert.strictEqual(early.status, 200, 'buyer may release funded escrow without prior delivery');
  ok('funded escrow can be released by buyer without delivery');

  // 9. delivery validation
  const empty = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { files: [] } });
  assert.strictEqual(empty.status, 400);
  const notMine = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { files: [{ name: 'x.pdf', url: '/api/workstream/files/does_not_exist.pdf' }] } });
  assert.strictEqual(notMine.status, 400);
  const delivered = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { notes: 'v1', files: [
    { name: 'final.pdf', url: fileUrl },
    { name: 'broken', url: 'https://this-site-does-not-exist.invalid/nope' },
    { name: 'plain text', url: 'Sent via courier, tracking 12345 - ask me for the password later' },
    { name: 'long', size: 'about forty megabytes in total, give or take', url: 'https://example.com/' + 'a'.repeat(5000) },
    { name: 'js', url: 'javascript:alert(1)' },
    { name: 'vbs', url: 'vbscript:msgbox(1)' },
    { name: 'data', url: 'data:text/html,<script>alert(1)</script>' },
    { name: 'any domain', url: 'http://anything.example.org/x?y=1' },
    { name: 'hash only', url: '#' }
  ] } });
  assert.strictEqual(delivered.status, 200, 'any user-provided link/text (incl. javascript:, vbscript:, data:) is accepted and stored');
  const storedFiles = delivered.json.order.deliveryHistory[0].files;
  assert.strictEqual(storedFiles.length, 9, 'all deliverable entries stored');
  assert.ok(storedFiles.some((f: any) => f.url === '#'), '"#" is accepted as ordinary user text');
  assert.ok(storedFiles.some((f: any) => f.url === 'javascript:alert(1)'), 'javascript: text stored verbatim (made safe at render time)');
  assert.strictEqual(delivered.json.order.status, 'delivered');
  ok('delivery: empty list / missing / not-yours uploads rejected; real upload and any free-form link text accepted');

  // 9b. stored messages: ISO timestamps (no "Invalid Date") and text kept exactly as typed
  const typed = '<b>5 < 6 & 7</b> javascript:alert(1)';
  const posted = await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: buyer, body: { text: typed, type: 'message' } });
  assert.strictEqual(posted.status, 200);
  assert.strictEqual(posted.json.message.text, typed, 'message text stored verbatim (no HTML-escaping)');
  const thread = await api(`/api/messages/${ORDER}`, { token: buyer });
  assert.ok(thread.json.length > 0);
  for (const m of thread.json) assert.ok(!Number.isNaN(new Date(m.timestamp).getTime()), `message timestamp must be parseable: ${m.timestamp}`);
  ok('messages: verbatim text, every timestamp parseable');

  // 10. buyer can now download the delivered file; outsider still cannot
  assert.strictEqual((await api(fileUrl, { token: buyer })).status, 200);
  assert.strictEqual((await api(fileUrl, { token: outsider })).status, 403);
  ok('delivered file visible to buyer only (plus seller/staff)');

  // 11. revision -> redelivery
  assert.strictEqual((await api(`/api/orders/${ORDER}/revision`, { method: 'POST', token: buyer, body: { reason: '' } })).status, 400);
  const rev = await api(`/api/orders/${ORDER}/revision`, { method: 'POST', token: buyer, body: { reason: 'Please adjust the colours' } });
  assert.strictEqual(rev.status, 200);
  assert.strictEqual(rev.json.order.status, 'revision');
  const up2 = await api('/api/workstream/upload?name=final_v2.pdf', { method: 'POST', token: seller, raw: Buffer.from('%PDF v2'), headers: { 'Content-Type': 'application/pdf' } });
  const redelivered = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { files: [{ name: 'final_v2.pdf', url: up2.json.url }] } });
  assert.strictEqual(redelivered.status, 200);
  assert.strictEqual(redelivered.json.order.deliveryHistory.length, 2, 'both delivery versions persist');
  ok('revision requested and v2 delivered; both versions stored');

  // 12. release: only buyer, only once
  assert.strictEqual((await api('/api/payments/escrow/release', { method: 'POST', token: outsider, body: { orderId: ORDER } })).status, 403);
  assert.strictEqual((await api('/api/payments/escrow/release', { method: 'POST', token: seller, body: { orderId: ORDER } })).status, 403);
  const released = await api('/api/payments/escrow/release', { method: 'POST', token: buyer, body: { orderId: ORDER, requestKey: 'test-release-1' } });
  assert.strictEqual(released.status, 200, `release should succeed after delivery: ${JSON.stringify(released.json)}`);
  assert.strictEqual(released.json.order.status, 'completed');
  assert.strictEqual((await api('/api/payments/escrow/release', { method: 'POST', token: buyer, body: { orderId: ORDER } })).status, 400, 'second release refused');
  ok('escrow release: buyer only, completes order, cannot repeat');

  // 13. review
  assert.strictEqual((await api('/api/reviews', { method: 'POST', token: outsider, body: { orderId: ORDER, targetUserId: 'user_5', rating: 5, comment: 'x' } })).status, 403);
  assert.strictEqual((await api('/api/reviews', { method: 'POST', token: buyer, body: { orderId: ORDER, targetUserId: 'user_5', rating: 5, comment: '   ' } })).status, 400);
  const review = await api('/api/reviews', { method: 'POST', token: buyer, body: { orderId: ORDER, targetUserId: 'user_5', rating: 4, comment: 'Solid work' } });
  assert.strictEqual(review.status, 201);
  assert.strictEqual((await api('/api/reviews', { method: 'POST', token: buyer, body: { orderId: ORDER, targetUserId: 'user_5', rating: 4, comment: 'again' } })).status, 409);
  const profileReviews = await api('/api/users/user_5/reviews');
  assert.ok(profileReviews.json.some((r: any) => r.orderId === ORDER && r.comment === 'Solid work'), 'review visible on seller profile');

  // Verify review privacy: unauthorized dumping is blocked, normal marketplace reviews remain visible
  const allReviewsRes = await api('/api/reviews');
  assert.strictEqual(allReviewsRes.status, 200);
  assert.ok(Array.isArray(allReviewsRes.json), 'reviews list returned as array');
  assert.ok(allReviewsRes.json.every((r: any) => !r.isCancelledOrder && r.moderationStatus !== 'hidden'), 'unauthorized dump cannot access cancelled/hidden reviews');
  assert.ok(allReviewsRes.json.some((r: any) => r.orderId === ORDER), 'completed public review is visible');

  ok('review: validated, one per order, visible on seller profile, protected from unauthorized dumping');

  console.log(`\n🎉 ${passed} Workstream security/lifecycle checks passed`);
}

run()
  .then(() => { restoreData(); process.exit(0); })
  .catch(err => { console.error('❌ Workstream test failed:', err); restoreData(); process.exit(1); });
