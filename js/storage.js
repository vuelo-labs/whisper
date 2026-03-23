// storage.js — All localStorage CRUD operations for Whisper

const ELLIS_ID = 'e111500000000000000000000000000000000000000000000000000000000000';

const KEYS = {
  CURRENT_ENTITY: 'whisper_current_entity',
  ENTITIES: 'whisper_entities',
  inboard: (id) => `whisper_inboard_${id}`,
  outboard: (id) => `whisper_outboard_${id}`,
  circle: (id) => `whisper_circle_${id}`,
  tokens: (id) => `whisper_tokens_${id}`,
};

// --- Helpers ---

function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// --- Entity ---

function createEntity({ entityId, ghostName, trustToken }) {
  const entities = readJSON(KEYS.ENTITIES, {});
  if (entities[entityId]) return entities[entityId]; // existing — don't overwrite
  const entity = {
    entityId,
    ghostName,
    trustToken,
    displayName: null,
    photoUrl: null,
    sigilParams: null,
    circleQuestion: null,
    circleQuestionExpiresAt: null,
    roomOpenUntil: null,
    expiry: '24h',
    noteCount: 1,
    createdAt: new Date().toISOString(),
  };
  entities[entityId] = entity;
  writeJSON(KEYS.ENTITIES, entities);
  // Welcome whisper from Ellis
  addWhisper({
    recipientId: entityId,
    senderId: ELLIS_ID,
    senderGhost: 'Ellis',
    text: "You've opened your quiet room. Whatever arrives here is yours to hold or release. Take your time.",
    admire: '', appreciate: '', wish: '',
  });
  // 1 starter token
  const today = new Date().toISOString().slice(0, 10);
  writeJSON(KEYS.tokens(entityId), { balance: 1, accrued_date: today });
  return entity;
}

function setEntityProfile(entityId, { displayName, photoUrl, sigilParams }) {
  const entities = readJSON(KEYS.ENTITIES, {});
  if (!entities[entityId]) return null;
  if (displayName !== undefined) entities[entityId].displayName = displayName;
  if (photoUrl !== undefined) entities[entityId].photoUrl = photoUrl;
  if (sigilParams !== undefined) entities[entityId].sigilParams = sigilParams;
  writeJSON(KEYS.ENTITIES, entities);
  return entities[entityId];
}

function getEntity(entityId) {
  const entities = readJSON(KEYS.ENTITIES, {});
  return entities[entityId] || null;
}

function updateEntity(entityId, updates) {
  const entities = readJSON(KEYS.ENTITIES, {});
  if (!entities[entityId]) return null;
  entities[entityId] = { ...entities[entityId], ...updates };
  writeJSON(KEYS.ENTITIES, entities);
  return entities[entityId];
}

function rekeyEntity(entityId, newToken) {
  const entities = readJSON(KEYS.ENTITIES, {});
  if (!entities[entityId]) return { ok: false };
  entities[entityId].trustToken = newToken;
  writeJSON(KEYS.ENTITIES, entities);
  return { ok: true };
}

function getCurrentEntity() {
  return readJSON(KEYS.CURRENT_ENTITY, null);
}

function setCurrentEntity(entityData) {
  writeJSON(KEYS.CURRENT_ENTITY, entityData);
}

function clearCurrentEntity() {
  localStorage.removeItem(KEYS.CURRENT_ENTITY);
}

// --- Whispers ---

function addWhisper({ recipientId, senderId, senderGhost, text, admire, appreciate, wish, fromCircle }) {
  // Derive fromCircle from local circle membership if not provided
  if (fromCircle === undefined) {
    const circle = readJSON(KEYS.circle(recipientId), []);
    fromCircle = circle.some(m => m.memberId === senderId || m === senderId);
  }
  const whisper = {
    id: generateId(),
    recipientId,
    senderId,
    senderGhost,
    text,
    admire: admire || '',
    appreciate: appreciate || '',
    wish: wish || '',
    fromCircle: !!fromCircle,
    status: 'antechamber',
    createdAt: new Date().toISOString(),
  };

  // Add to recipient's inboard
  const inboard = readJSON(KEYS.inboard(recipientId), []);
  inboard.unshift(whisper);
  writeJSON(KEYS.inboard(recipientId), inboard);

  // Update entity note count
  const entities = readJSON(KEYS.ENTITIES, {});
  if (entities[recipientId]) {
    entities[recipientId].noteCount = (entities[recipientId].noteCount || 0) + 1;
    writeJSON(KEYS.ENTITIES, entities);
  }

  return whisper;
}

function logOutbound({ senderId, senderGhost, recipientId, recipientGhost, text, status = 'sent' }) {
  const entry = {
    id: generateId(),
    recipientId,
    recipientGhost,
    text,
    status,
    createdAt: new Date().toISOString(),
  };
  const outboard = readJSON(KEYS.outboard(senderId), []);
  outboard.unshift(entry);
  writeJSON(KEYS.outboard(senderId), outboard);
  return entry;
}

function getInboard(entityId) {
  const inboard = readJSON(KEYS.inboard(entityId), []);
  const entity  = getEntity(entityId);
  const expiry  = entity?.expiry || '24h';
  const msMap   = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
  const ms      = msMap[expiry] || 86400000;
  const cutoff  = Date.now() - ms;
  let drifted   = false;
  const updated = inboard.map(w => {
    if (w.status === 'antechamber' && new Date(w.createdAt).getTime() < cutoff) {
      drifted = true;
      return { ...w, status: 'released' };
    }
    return w;
  });
  if (drifted) writeJSON(KEYS.inboard(entityId), updated);
  return updated;
}

function getOutboard(entityId) {
  return readJSON(KEYS.outboard(entityId), []);
}

function updateWhisperStatus(recipientId, whisperId, status) {
  const inboard = readJSON(KEYS.inboard(recipientId), []);
  const idx = inboard.findIndex(w => w.id === whisperId);
  if (idx === -1) return null;
  inboard[idx].status = status;
  writeJSON(KEYS.inboard(recipientId), inboard);
  return inboard[idx];
}

function integrateWhisper(recipientId, whisperId) {
  return updateWhisperStatus(recipientId, whisperId, 'integrated');
}

function releaseWhisper(recipientId, whisperId) {
  return updateWhisperStatus(recipientId, whisperId, 'released');
}

function clearBoard(entityId) {
  const inboard = readJSON(KEYS.inboard(entityId), []);
  const cleared = inboard.map(w =>
    (w.status === 'antechamber' || w.status === 'integrated') ? { ...w, status: 'released' } : w
  );
  writeJSON(KEYS.inboard(entityId), cleared);

  const entities = readJSON(KEYS.ENTITIES, {});
  if (entities[entityId]) {
    entities[entityId].noteCount = 0;
    writeJSON(KEYS.ENTITIES, entities);
  }
}

function getIntegratedWhispers(entityId) {
  const inboard = readJSON(KEYS.inboard(entityId), []);
  return inboard.filter(w => w.status === 'integrated');
}

// Board capacity check (100 notes max)
function isBoardFull(entityId) {
  const inboard = readJSON(KEYS.inboard(entityId), []);
  const active = inboard.filter(w => w.status === 'antechamber' || w.status === 'integrated');
  return active.length >= 100;
}

// --- Trust Circle (local fallback) ---

function joinCircle(ownerId, memberId) {
  if (ownerId === memberId) return { ok: false };
  const circle = readJSON(KEYS.circle(ownerId), []);
  if (!circle.includes(memberId)) {
    circle.push(memberId);
    writeJSON(KEYS.circle(ownerId), circle);
  }
  return { ok: true };
}

function getCircleWidth(ownerId) {
  return readJSON(KEYS.circle(ownerId), []).length;
}

function isCircleMember(ownerId, memberId) {
  return readJSON(KEYS.circle(ownerId), []).includes(memberId);
}

function getCirclesIn(entityId) {
  // Count how many circles this entity is a member of
  // In local mode, scan all circle keys
  let count = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('whisper_circle_')) {
      const members = readJSON(key, []);
      if (members.includes(entityId)) count++;
    }
  }
  return count;
}

// --- Invite Links (local fallback) ---

function createInviteLink(ownerId) {
  const invites = readJSON('whisper_invites', {});
  const id = generateId();
  invites[id] = { id, ownerId, usedBy: null, usedAt: null, createdAt: new Date().toISOString() };
  writeJSON('whisper_invites', invites);
  return { id };
}

function useInviteLink(inviteId, { name, requesterId }) {
  const invites = readJSON('whisper_invites', {});
  const invite = invites[inviteId];
  if (!invite) return { status: 'invalid' };
  if (requesterId === invite.ownerId) return { status: 'self' };

  const circle = readJSON(KEYS.circle(invite.ownerId), []);
  if (circle.includes(requesterId)) return { status: 'member' };

  if (!invite.usedBy) {
    // First use — auto-accept
    invite.usedBy = requesterId;
    invite.usedAt = new Date().toISOString();
    writeJSON('whisper_invites', invites);
    joinCircle(invite.ownerId, requesterId);
    return { status: 'joined' };
  }

  // Already used — create approval request
  addCircleRequest(invite.ownerId, { name, requesterId });
  return { status: 'pending' };
}

// --- Circle Requests (local fallback) ---

function addCircleRequest(ownerId, { name, requesterId }) {
  if (requesterId === ownerId) return { ok: false };
  const circle = readJSON(KEYS.circle(ownerId), []);
  if (circle.includes(requesterId)) return { ok: true, status: 'member' };

  const key = `whisper_crequests_${ownerId}`;
  const requests = readJSON(key, []);
  const existing = requests.find(r => r.requesterId === requesterId);
  if (existing) {
    existing.name = name;
    existing.status = 'pending';
  } else {
    requests.push({ id: generateId(), ownerId, requesterId, name, status: 'pending', createdAt: new Date().toISOString() });
  }
  writeJSON(key, requests);
  return { ok: true, status: 'pending' };
}

function getCircleRequests(ownerId) {
  const key = `whisper_crequests_${ownerId}`;
  return readJSON(key, []).filter(r => r.status === 'pending');
}

function resolveCircleRequest(ownerId, requestId, action) {
  const key = `whisper_crequests_${ownerId}`;
  const requests = readJSON(key, []);
  const req = requests.find(r => r.id === requestId);
  if (!req) return { ok: false };
  req.status = action === 'approve' ? 'approved' : 'declined';
  writeJSON(key, requests);
  if (action === 'approve') joinCircle(ownerId, req.requesterId);
  return { ok: true };
}

// --- Tokens (local fallback) ---

function getTokenBalance(entityId) {
  const today = new Date().toISOString().slice(0, 10);
  const ledger = readJSON(KEYS.tokens(entityId), null);

  if (!ledger) {
    // No ledger yet — start with 1
    writeJSON(KEYS.tokens(entityId), { balance: 1, accrued_date: today });
    return 1;
  }

  if (ledger.accrued_date === today) return ledger.balance;

  // Real circle members = those who are not Ellis
  const allMembers = readJSON(KEYS.circle(entityId), []);
  const realCircleSize = allMembers.filter(id => id !== ELLIS_ID).length;

  // Testing mode: 1000/day flat
  const toAdd = 1000;
  const maxBalance = 1000;
  const newBalance = Math.min((ledger.balance || 0) + toAdd, maxBalance);
  writeJSON(KEYS.tokens(entityId), { balance: newBalance, accrued_date: today });
  return newBalance;
}

function spendToken(entityId) {
  const today = new Date().toISOString().slice(0, 10);
  const ledger = readJSON(KEYS.tokens(entityId), { balance: 0, accrued_date: today });
  if (ledger.balance < 1) return false;
  ledger.balance -= 1;
  writeJSON(KEYS.tokens(entityId), ledger);
  return true;
}

export {
  KEYS,
  createInviteLink,
  useInviteLink,
  addCircleRequest,
  getCircleRequests,
  resolveCircleRequest,
  createEntity,
  setEntityProfile,
  getEntity,
  updateEntity,
  rekeyEntity,
  getCurrentEntity,
  setCurrentEntity,
  clearCurrentEntity,
  addWhisper,
  logOutbound,
  getInboard,
  getOutboard,
  integrateWhisper,
  releaseWhisper,
  clearBoard,
  getIntegratedWhispers,
  isBoardFull,
  joinCircle,
  getCircleWidth,
  isCircleMember,
  getCirclesIn,
  getTokenBalance,
  spendToken,
};
