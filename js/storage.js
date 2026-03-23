// storage.js — All localStorage CRUD operations for Whisper

const KEYS = {
  CURRENT_ENTITY: 'whisper_current_entity',
  ENTITIES: 'whisper_entities',
  inboard: (id) => `whisper_inboard_${id}`,
  outboard: (id) => `whisper_outboard_${id}`,
  rateLimit: (id) => `whisper_ratelimit_${id}`,
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
  const entity = {
    entityId,
    ghostName,
    trustToken,
    displayName: null,
    photoUrl: null,
    expiry: '24h',
    noteCount: 0,
    createdAt: new Date().toISOString(),
  };
  entities[entityId] = entity;
  writeJSON(KEYS.ENTITIES, entities);
  return entity;
}

function setEntityProfile(entityId, { displayName, photoUrl }) {
  const entities = readJSON(KEYS.ENTITIES, {});
  if (!entities[entityId]) return null;
  if (displayName !== undefined) entities[entityId].displayName = displayName;
  if (photoUrl !== undefined) entities[entityId].photoUrl = photoUrl;
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

function addWhisper({ recipientId, senderId, senderGhost, text, admire, appreciate, wish }) {
  const whisper = {
    id: generateId(),
    recipientId,
    senderId,
    senderGhost,
    text,
    admire: admire || '',
    appreciate: appreciate || '',
    wish: wish || '',
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
  return readJSON(KEYS.inboard(entityId), []);
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
  // Move all integrated/released to released, keep structure
  const inboard = readJSON(KEYS.inboard(entityId), []);
  const cleared = inboard.map(w => w.status === 'integrated' ? { ...w, status: 'released' } : w);
  writeJSON(KEYS.inboard(entityId), cleared);

  // Reset note count
  const entities = readJSON(KEYS.ENTITIES, {});
  if (entities[entityId]) {
    const activeCount = cleared.filter(w => w.status === 'antechamber').length;
    entities[entityId].noteCount = activeCount;
    writeJSON(KEYS.ENTITIES, entities);
  }
}

function getIntegratedWhispers(entityId) {
  const inboard = readJSON(KEYS.inboard(entityId), []);
  return inboard.filter(w => w.status === 'integrated');
}

// --- Rate limiting ---

function getRateLimit(senderId) {
  const data = readJSON(KEYS.rateLimit(senderId), { sends: [] });
  // Clean up entries older than 30 days
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  data.sends = (data.sends || []).filter(ts => ts > cutoff);
  writeJSON(KEYS.rateLimit(senderId), data);
  return data;
}

function incrementRateLimit(senderId) {
  const data = getRateLimit(senderId);
  data.sends.push(Date.now());
  writeJSON(KEYS.rateLimit(senderId), data);
}

function checkRateLimit(senderId) {
  const data = getRateLimit(senderId);
  return {
    count: data.sends.length,
    exceeded: data.sends.length >= 3,
  };
}

// Board capacity check (100 notes max)
function isBoardFull(entityId) {
  const inboard = readJSON(KEYS.inboard(entityId), []);
  const active = inboard.filter(w => w.status === 'antechamber' || w.status === 'integrated');
  return active.length >= 100;
}

export {
  KEYS,
  createEntity,
  setEntityProfile,
  getEntity,
  updateEntity,
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
  getRateLimit,
  incrementRateLimit,
  checkRateLimit,
  isBoardFull,
};
