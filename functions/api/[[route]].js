// functions/api/[[route]].js
// Cloudflare Pages Function — handles all /api/* requests
// Bound to D1 database via env.DB

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function uid() {
  return crypto.randomUUID();
}

const ELLIS_ID = 'e111500000000000000000000000000000000000000000000000000000000000';

// Verify trust token against stored entity — used for owner-only writes
async function authorize(env, entityId, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  const row = await env.DB.prepare(
    'SELECT trust_token FROM entities WHERE entity_id = ?'
  ).bind(entityId).first();
  return row && row.trust_token === token;
}

// Accrue daily tokens for an entity (lazy — called at send-time)
// Returns the current balance after accrual.
async function accrueTokens(env, entityId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Get or create ledger row
  let ledger = await env.DB.prepare(
    'SELECT * FROM token_ledger WHERE entity_id = ?'
  ).bind(entityId).first();

  if (!ledger) {
    await env.DB.prepare(`
      INSERT INTO token_ledger (entity_id, balance, accrued_date, circle_size_snapshot)
      VALUES (?, 0, ?, 0)
    `).bind(entityId, today).run();
    ledger = { balance: 0, accrued_date: today, circle_size_snapshot: 0 };
  }

  // Only accrue if we haven't yet today
  if (ledger.accrued_date === today) {
    return ledger.balance;
  }

  // Count current circle size
  const circleRow = await env.DB.prepare(
    'SELECT COUNT(*) as c FROM trust_circle WHERE owner_id = ?'
  ).bind(entityId).first();
  const circleSize = circleRow?.c || 0;

  // Tokens to add = min(circleSize, 5), capped so total doesn't exceed 5
  const toAdd = Math.min(circleSize, 5);
  const newBalance = Math.min((ledger.balance || 0) + toAdd, 5);

  await env.DB.prepare(`
    UPDATE token_ledger
    SET balance = ?, accrued_date = ?, circle_size_snapshot = ?
    WHERE entity_id = ?
  `).bind(newBalance, today, circleSize, entityId).run();

  return newBalance;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url    = new URL(request.url);
  const parts  = url.pathname.replace('/api/', '').split('/');
  const method = request.method;

  let body = {};
  if (['POST', 'PATCH'].includes(method)) {
    try { body = await request.json(); } catch {}
  }

  // ── Entities ────────────────────────────────────────────────────────────────

  // GET /api/entity/:id
  if (method === 'GET' && parts[0] === 'entity' && parts[1]) {
    const row = await env.DB.prepare(
      'SELECT * FROM entities WHERE entity_id = ?'
    ).bind(parts[1]).first();
    if (!row) return err('Not found', 404);
    return json(remapEntity(row));
  }

  // POST /api/entity  — create / upsert
  if (method === 'POST' && parts[0] === 'entity') {
    const { entityId, ghostName, trustToken } = body;
    if (!entityId || !ghostName || !trustToken) return err('Missing fields');
    await env.DB.prepare(`
      INSERT INTO entities (entity_id, ghost_name, trust_token)
      VALUES (?, ?, ?)
      ON CONFLICT(entity_id) DO NOTHING
    `).bind(entityId, ghostName, trustToken).run();
    const row = await env.DB.prepare(
      'SELECT * FROM entities WHERE entity_id = ?'
    ).bind(entityId).first();

    // Auto-join Ellis into the new entity's circle (gives 1 token/day from day 1)
    await env.DB.prepare(`
      INSERT INTO trust_circle (owner_id, member_id)
      VALUES (?, ?)
      ON CONFLICT(owner_id, member_id) DO NOTHING
    `).bind(entityId, ELLIS_ID).run();

    return json(remapEntity(row));
  }

  // PATCH /api/entity/:id  — update profile (auth required)
  if (method === 'PATCH' && parts[0] === 'entity' && parts[1]) {
    const entityId = parts[1];
    if (!(await authorize(env, entityId, request))) return err('Unauthorized', 401);

    const fields = [];
    const vals   = [];
    if (body.displayName              !== undefined) { fields.push('display_name = ?');               vals.push(body.displayName); }
    if (body.photoUrl                 !== undefined) { fields.push('photo_url = ?');                  vals.push(body.photoUrl); }
    if (body.sigilParams              !== undefined) { fields.push('sigil_params = ?');               vals.push(JSON.stringify(body.sigilParams)); }
    if (body.expiry                   !== undefined) { fields.push('expiry = ?');                     vals.push(body.expiry); }
    if (body.circleQuestion           !== undefined) { fields.push('circle_question = ?');            vals.push(body.circleQuestion || null); }
    if (body.circleQuestionExpiresAt  !== undefined) { fields.push('circle_question_expires_at = ?'); vals.push(body.circleQuestionExpiresAt || null); }
    if (body.roomOpenUntil            !== undefined) { fields.push('room_open_until = ?');            vals.push(body.roomOpenUntil || null); }
    if (!fields.length) return err('Nothing to update');

    fields.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(entityId);

    await env.DB.prepare(
      `UPDATE entities SET ${fields.join(', ')} WHERE entity_id = ?`
    ).bind(...vals).run();

    const row = await env.DB.prepare(
      'SELECT * FROM entities WHERE entity_id = ?'
    ).bind(entityId).first();
    return json(remapEntity(row));
  }

  // ── Whispers ─────────────────────────────────────────────────────────────────

  // GET /api/whispers/:recipientId  — inboard (auth required)
  // Auto-releases antechamber whispers older than the entity's expiry before returning.
  if (method === 'GET' && parts[0] === 'whispers' && parts[1] && !parts[2]) {
    const recipientId = parts[1];
    if (!(await authorize(env, recipientId, request))) return err('Unauthorized', 401);

    // Drift old antechamber whispers based on entity expiry setting
    const entityRow = await env.DB.prepare(
      'SELECT expiry FROM entities WHERE entity_id = ?'
    ).bind(recipientId).first();
    const expiry = entityRow?.expiry || '24h';
    const intervalMap = { '1h': '-1 hours', '24h': '-24 hours', '7d': '-7 days' };
    const interval = intervalMap[expiry] || '-24 hours';
    await env.DB.prepare(`
      UPDATE whispers SET status = 'released'
      WHERE recipient_id = ? AND status = 'antechamber'
      AND created_at < datetime('now', ?)
    `).bind(recipientId, interval).run();

    const { results } = await env.DB.prepare(`
      SELECT * FROM whispers
      WHERE recipient_id = ? AND status IN ('antechamber','integrated')
      ORDER BY created_at DESC
    `).bind(recipientId).all();
    return json((results || []).map(remapWhisper));
  }

  // GET /api/whispers/:recipientId/public  — integrated only (public)
  if (method === 'GET' && parts[0] === 'whispers' && parts[1] && parts[2] === 'public') {
    const { results } = await env.DB.prepare(`
      SELECT * FROM whispers
      WHERE recipient_id = ? AND status = 'integrated'
      ORDER BY created_at DESC
      LIMIT 20
    `).bind(parts[1]).all();
    return json((results || []).map(remapWhisper));
  }

  // POST /api/whisper  — send a whisper (costs 1 token)
  if (method === 'POST' && parts[0] === 'whisper') {
    const { recipientId, senderId, senderGhost, text, admire, appreciate, wish } = body;
    if (!recipientId || !senderId || !text) return err('Missing fields');
    if (text.length > 280) return err('Too long');

    // Check board capacity
    const count = await env.DB.prepare(`
      SELECT COUNT(*) as c FROM whispers
      WHERE recipient_id = ? AND status IN ('antechamber','integrated')
    `).bind(recipientId).first();
    if ((count?.c || 0) >= 100) return err('Board is full', 409);

    // Accrue and check token balance
    const balance = await accrueTokens(env, senderId);
    if (balance < 1) return err('No tokens', 402);

    // Spend 1 token
    await env.DB.prepare(
      'UPDATE token_ledger SET balance = balance - 1 WHERE entity_id = ?'
    ).bind(senderId).run();

    const id = uid();
    await env.DB.prepare(`
      INSERT INTO whispers (id, recipient_id, sender_id, sender_ghost, text, admire, appreciate, wish)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, recipientId, senderId, senderGhost, text, admire || null, appreciate || null, wish || null).run();

    const row = await env.DB.prepare('SELECT * FROM whispers WHERE id = ?').bind(id).first();
    return json(remapWhisper(row), 201);
  }

  // PATCH /api/whisper/:id  — update status (auth: recipient's trust token)
  if (method === 'PATCH' && parts[0] === 'whisper' && parts[1]) {
    const whisperId = parts[1];
    const { status, recipientId } = body;
    if (!recipientId || !status) return err('Missing fields');
    if (!['integrated','released'].includes(status)) return err('Invalid status');
    if (!(await authorize(env, recipientId, request))) return err('Unauthorized', 401);

    await env.DB.prepare(
      'UPDATE whispers SET status = ? WHERE id = ? AND recipient_id = ?'
    ).bind(status, whisperId, recipientId).run();
    return json({ ok: true });
  }

  // POST /api/board/:recipientId/clear  — release all integrated (auth required)
  if (method === 'POST' && parts[0] === 'board' && parts[2] === 'clear') {
    const recipientId = parts[1];
    if (!(await authorize(env, recipientId, request))) return err('Unauthorized', 401);
    await env.DB.prepare(
      "UPDATE whispers SET status = 'released' WHERE recipient_id = ? AND status = 'integrated'"
    ).bind(recipientId).run();
    return json({ ok: true });
  }

  // GET /api/board/:recipientId/full  — capacity check (public)
  if (method === 'GET' && parts[0] === 'board' && parts[2] === 'full') {
    const count = await env.DB.prepare(`
      SELECT COUNT(*) as c FROM whispers
      WHERE recipient_id = ? AND status IN ('antechamber','integrated')
    `).bind(parts[1]).first();
    return json({ full: (count?.c || 0) >= 100 });
  }

  // ── Outbound log ─────────────────────────────────────────────────────────────

  // GET /api/outboard/:senderId  (auth required)
  if (method === 'GET' && parts[0] === 'outboard' && parts[1]) {
    const senderId = parts[1];
    if (!(await authorize(env, senderId, request))) return err('Unauthorized', 401);
    const { results } = await env.DB.prepare(`
      SELECT * FROM outbound_log WHERE sender_id = ? ORDER BY created_at DESC
    `).bind(senderId).all();
    return json((results || []).map(remapOutbound));
  }

  // POST /api/outboard
  if (method === 'POST' && parts[0] === 'outboard') {
    const { senderId, recipientId, recipientGhost, text, status } = body;
    if (!senderId || !recipientId || !text) return err('Missing fields');
    const id = uid();
    await env.DB.prepare(`
      INSERT INTO outbound_log (id, sender_id, recipient_id, recipient_ghost, text, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, senderId, recipientId, recipientGhost || '', text, status || 'sent').run();
    return json({ id }, 201);
  }

  // ── Trust Circle ─────────────────────────────────────────────────────────────

  // POST /api/circle/:ownerId/join  — join an owner's circle (requires sender auth)
  if (method === 'POST' && parts[0] === 'circle' && parts[2] === 'join') {
    const ownerId  = parts[1];
    const { memberId } = body;
    if (!memberId) return err('Missing memberId');
    if (memberId === ownerId) return err('Cannot join your own circle');

    // Ensure member entity exists
    const member = await env.DB.prepare(
      'SELECT entity_id FROM entities WHERE entity_id = ?'
    ).bind(memberId).first();
    if (!member) return err('Member entity not found', 404);

    // Insert — silently ignore if already in circle
    await env.DB.prepare(`
      INSERT INTO trust_circle (owner_id, member_id)
      VALUES (?, ?)
      ON CONFLICT(owner_id, member_id) DO NOTHING
    `).bind(ownerId, memberId).run();

    return json({ ok: true });
  }

  // GET /api/circle/:ownerId/width  — circle member count (public)
  if (method === 'GET' && parts[0] === 'circle' && parts[2] === 'width') {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM trust_circle WHERE owner_id = ?'
    ).bind(parts[1]).first();
    return json({ width: row?.c || 0 });
  }

  // GET /api/circle/:ownerId/member/:memberId  — check membership (public)
  if (method === 'GET' && parts[0] === 'circle' && parts[2] === 'member' && parts[3]) {
    const row = await env.DB.prepare(
      'SELECT 1 FROM trust_circle WHERE owner_id = ? AND member_id = ?'
    ).bind(parts[1], parts[3]).first();
    return json({ member: !!row });
  }

  // GET /api/circle/in/:memberId  — how many circles this entity is IN (auth required)
  if (method === 'GET' && parts[0] === 'circle' && parts[1] === 'in' && parts[2]) {
    const memberId = parts[2];
    if (!(await authorize(env, memberId, request))) return err('Unauthorized', 401);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM trust_circle WHERE member_id = ?'
    ).bind(memberId).first();
    return json({ circlesIn: row?.c || 0 });
  }

  // ── Invite Links ─────────────────────────────────────────────────────────────

  // POST /api/invite  — create a one-time invite link (owner-only)
  if (method === 'POST' && parts[0] === 'invite' && !parts[1]) {
    const { ownerId } = body;
    if (!ownerId) return err('Missing ownerId');
    if (!(await authorize(env, ownerId, request))) return err('Unauthorized', 401);
    const id = uid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO invite_links (id, owner_id, expires_at) VALUES (?, ?, ?)'
    ).bind(id, ownerId, expiresAt).run();
    return json({ id }, 201);
  }

  // POST /api/invite/:id  — use an invite link
  // Auto-accepts if first use; falls back to circle_request if already used
  if (method === 'POST' && parts[0] === 'invite' && parts[1] && !parts[2]) {
    const inviteId = parts[1];
    const { name, requesterId } = body;
    if (!name || !requesterId) return err('Missing name or requesterId');

    const invite = await env.DB.prepare(
      'SELECT * FROM invite_links WHERE id = ?'
    ).bind(inviteId).first();
    if (!invite) return err('Invite not found', 404);
    if (invite.expires_at && invite.expires_at < new Date().toISOString()) {
      return json({ status: 'expired' });
    }

    const ownerId = invite.owner_id;
    if (requesterId === ownerId) return json({ status: 'self' });

    // Already in circle?
    const already = await env.DB.prepare(
      'SELECT 1 FROM trust_circle WHERE owner_id = ? AND member_id = ?'
    ).bind(ownerId, requesterId).first();
    if (already) return json({ status: 'member' });

    if (!invite.used_by) {
      // First use — auto-accept
      await env.DB.prepare(
        'UPDATE invite_links SET used_by = ?, used_at = datetime("now") WHERE id = ?'
      ).bind(requesterId, inviteId).run();
      await env.DB.prepare(`
        INSERT INTO trust_circle (owner_id, member_id)
        VALUES (?, ?)
        ON CONFLICT(owner_id, member_id) DO NOTHING
      `).bind(ownerId, requesterId).run();
      return json({ status: 'joined' });
    }

    // Already used — create an approval request
    const id = uid();
    await env.DB.prepare(`
      INSERT INTO circle_requests (id, owner_id, requester_id, name, status)
      VALUES (?, ?, ?, ?, 'pending')
      ON CONFLICT(owner_id, requester_id) DO UPDATE SET name = excluded.name, status = 'pending'
    `).bind(id, ownerId, requesterId, name.trim().slice(0, 80)).run();
    return json({ status: 'pending' });
  }

  // ── Circle Requests ──────────────────────────────────────────────────────────

  // POST /api/circle/:ownerId/request  — ask to join (public, no auth)
  if (method === 'POST' && parts[0] === 'circle' && parts[2] === 'request') {
    const ownerId = parts[1];
    const { name, requesterId } = body;
    if (!name || !requesterId) return err('Missing name or requesterId');
    if (requesterId === ownerId) return err('Cannot request your own circle');

    const owner = await env.DB.prepare(
      'SELECT entity_id FROM entities WHERE entity_id = ?'
    ).bind(ownerId).first();
    if (!owner) return err('Circle not found', 404);

    // Already a member?
    const already = await env.DB.prepare(
      'SELECT 1 FROM trust_circle WHERE owner_id = ? AND member_id = ?'
    ).bind(ownerId, requesterId).first();
    if (already) return json({ ok: true, status: 'member' });

    const id = uid();
    await env.DB.prepare(`
      INSERT INTO circle_requests (id, owner_id, requester_id, name, status)
      VALUES (?, ?, ?, ?, 'pending')
      ON CONFLICT(owner_id, requester_id) DO UPDATE SET name = excluded.name, status = 'pending'
    `).bind(id, ownerId, requesterId, name.trim().slice(0, 80)).run();
    return json({ ok: true, status: 'pending' }, 201);
  }

  // GET /api/circle/:ownerId/requests  — pending requests (owner-only)
  if (method === 'GET' && parts[0] === 'circle' && parts[2] === 'requests') {
    const ownerId = parts[1];
    if (!(await authorize(env, ownerId, request))) return err('Unauthorized', 401);
    const { results } = await env.DB.prepare(`
      SELECT id, name, requester_id, created_at
      FROM circle_requests WHERE owner_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).bind(ownerId).all();
    return json({ requests: results || [] });
  }

  // PATCH /api/circle/:ownerId/requests/:requestId  — approve or decline (owner-only)
  if (method === 'PATCH' && parts[0] === 'circle' && parts[2] === 'requests' && parts[3]) {
    const ownerId   = parts[1];
    const requestId = parts[3];
    const { action } = body; // 'approve' | 'decline'
    if (!action) return err('Missing action');
    if (!(await authorize(env, ownerId, request))) return err('Unauthorized', 401);

    const req = await env.DB.prepare(
      'SELECT * FROM circle_requests WHERE id = ? AND owner_id = ?'
    ).bind(requestId, ownerId).first();
    if (!req) return err('Request not found', 404);

    await env.DB.prepare(
      'UPDATE circle_requests SET status = ? WHERE id = ?'
    ).bind(action === 'approve' ? 'approved' : 'declined', requestId).run();

    if (action === 'approve') {
      await env.DB.prepare(`
        INSERT INTO trust_circle (owner_id, member_id)
        VALUES (?, ?)
        ON CONFLICT(owner_id, member_id) DO NOTHING
      `).bind(ownerId, req.requester_id).run();
    }

    return json({ ok: true });
  }

  // ── Tokens ───────────────────────────────────────────────────────────────────

  // GET /api/tokens/:entityId  — get balance (accrues if needed, auth required)
  if (method === 'GET' && parts[0] === 'tokens' && parts[1]) {
    const entityId = parts[1];
    if (!(await authorize(env, entityId, request))) return err('Unauthorized', 401);
    const balance = await accrueTokens(env, entityId);
    return json({ balance });
  }

  return err('Not found', 404);
}

// ── Remappers ─────────────────────────────────────────────────────────────────

function remapEntity(r) {
  return {
    entityId:                 r.entity_id,
    ghostName:                r.ghost_name,
    displayName:              r.display_name              || null,
    photoUrl:                 r.photo_url                 || null,
    sigilParams:              r.sigil_params              ? JSON.parse(r.sigil_params) : null,
    trustToken:               r.trust_token,
    circleQuestion:           r.circle_question           || null,
    circleQuestionExpiresAt:  r.circle_question_expires_at || null,
    roomOpenUntil:            r.room_open_until            || null,
    expiry:                   r.expiry,
    noteCount:                r.note_count,
    createdAt:                r.created_at,
  };
}

function remapWhisper(r) {
  return {
    id:          r.id,
    recipientId: r.recipient_id,
    senderId:    r.sender_id,
    senderGhost: r.sender_ghost,
    text:        r.text,
    admire:      r.admire      || '',
    appreciate:  r.appreciate  || '',
    wish:        r.wish        || '',
    status:      r.status,
    createdAt:   r.created_at,
  };
}

function remapOutbound(r) {
  return {
    id:             r.id,
    recipientId:    r.recipient_id,
    recipientGhost: r.recipient_ghost,
    text:           r.text,
    status:         r.status,
    createdAt:      r.created_at,
  };
}
