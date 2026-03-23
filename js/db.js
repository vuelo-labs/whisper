// db.js — Data access layer
// Uses the /api/* Pages Function (Cloudflare D1) when deployed.
// Falls back to localStorage (storage.js) when running locally without a Worker.

import * as local from './storage.js';

// ── Remote detection ──────────────────────────────────────────────────────────
// In production the Pages Function is on the same origin at /api/*.
// Locally (python3 -m http.server) there's no Worker, so we use localStorage.

export const isRemote = !(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);

const API = '/api';

// Current entity always lives in localStorage (session state)
export const getCurrentEntity   = local.getCurrentEntity;
export const setCurrentEntity   = local.setCurrentEntity;
export const clearCurrentEntity = local.clearCurrentEntity;

// ── Auth header ───────────────────────────────────────────────────────────────
// Pass the entity's trust_token as a Bearer token for owner-only operations.

function authHeader(trustToken) {
  return trustToken ? { Authorization: `Bearer ${trustToken}` } : {};
}

function currentToken() {
  const e = local.getCurrentEntity();
  return e?.trustToken || '';
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function get(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(path, data, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patch(path, data, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Entities ──────────────────────────────────────────────────────────────────

export async function createEntity({ entityId, ghostName, trustToken }) {
  if (!isRemote) return local.createEntity({ entityId, ghostName, trustToken });
  return post('/entity', { entityId, ghostName, trustToken });
}

export async function getEntity(entityId) {
  if (!isRemote) return local.getEntity(entityId);
  try { return await get(`/entity/${entityId}`); }
  catch { return null; }
}

export async function setEntityProfile(entityId, { displayName, photoUrl, sigilParams }) {
  if (!isRemote) return local.setEntityProfile(entityId, { displayName, photoUrl, sigilParams });
  return patch(`/entity/${entityId}`, { displayName, photoUrl, sigilParams }, currentToken());
}

export async function updateEntity(entityId, updates) {
  if (!isRemote) return local.updateEntity(entityId, updates);
  return patch(`/entity/${entityId}`, updates, currentToken());
}

// ── Whispers ──────────────────────────────────────────────────────────────────

export async function addWhisper({ recipientId, senderId, senderGhost, text, admire, appreciate, wish }) {
  if (!isRemote) return local.addWhisper({ recipientId, senderId, senderGhost, text, admire, appreciate, wish });
  return post('/whisper', { recipientId, senderId, senderGhost, text, admire, appreciate, wish }, currentToken());
}

export async function requestEllisWarm(entityId) {
  if (!isRemote) {
    // Local: pick from pool and insert directly
    const WARMTH = [
      "You carry more than people realise, and you do it quietly. That takes a kind of strength most people never develop.",
      "There is something in the way you move through difficulty that tells a story about who you really are. It's a good story.",
      "The people who matter most to you feel it — even when you think they can't see it.",
      "You have rebuilt yourself more times than you give yourself credit for.",
      "Your instincts about people are better than you let yourself believe.",
      "The version of you that others talk about when you leave the room is kinder and more impressive than the one you see.",
      "Some of the things you think make you difficult are the same things that make you worth knowing.",
      "You are not as far behind as you feel right now. You are exactly where a person like you needs to be.",
      "The care you put into small things says everything about the kind of person you are.",
      "There is a warmth in you that draws people closer without you noticing it happening.",
      "You underestimate how often your presence alone is the thing that steadies someone else.",
      "Something you dismissed as ordinary about yourself is genuinely rare.",
      "The fact that you keep going, even on the days it doesn't feel worth it, is not nothing. It's everything.",
      "Your sensitivity is not a weakness. It is how you notice things other people walk past.",
      "You have already done the hardest part of something important. You just haven't seen the result yet.",
    ];
    const text = WARMTH[Math.floor(Math.random() * WARMTH.length)];
    const ELLIS_ID = 'e111500000000000000000000000000000000000000000000000000000000000';
    return local.addWhisper({ recipientId: entityId, senderId: ELLIS_ID, senderGhost: 'Ellis', text, admire: '', appreciate: '', wish: '' });
  }
  return post(`/entity/${entityId}/warm`, {}, currentToken());
}

export async function getInboard(entityId) {
  if (!isRemote) return local.getInboard(entityId);
  try { return await get(`/whispers/${entityId}`, currentToken()); }
  catch { return []; }
}

export async function getIntegratedWhispers(entityId) {
  if (!isRemote) return local.getIntegratedWhispers(entityId);
  return get(`/whispers/${entityId}/public`);
}

export async function integrateWhisper(recipientId, whisperId) {
  if (!isRemote) return local.integrateWhisper(recipientId, whisperId);
  return patch(`/whisper/${whisperId}`, { status: 'integrated', recipientId }, currentToken());
}

export async function releaseWhisper(recipientId, whisperId) {
  if (!isRemote) return local.releaseWhisper(recipientId, whisperId);
  return patch(`/whisper/${whisperId}`, { status: 'released', recipientId }, currentToken());
}

export async function clearBoard(entityId) {
  if (!isRemote) return local.clearBoard(entityId);
  return post(`/board/${entityId}/clear`, {}, currentToken());
}

export async function isBoardFull(entityId) {
  if (!isRemote) return local.isBoardFull(entityId);
  const { full } = await get(`/board/${entityId}/full`);
  return full;
}

// ── Outbound log ──────────────────────────────────────────────────────────────

export async function logOutbound({ senderId, senderGhost, recipientId, recipientGhost, text, status = 'sent' }) {
  if (!isRemote) return local.logOutbound({ senderId, senderGhost, recipientId, recipientGhost, text, status });
  return post('/outboard', { senderId, recipientId, recipientGhost, text, status }, currentToken());
}

export async function getOutboard(entityId) {
  if (!isRemote) return local.getOutboard(entityId);
  try { return await get(`/outboard/${entityId}`, currentToken()); }
  catch { return []; }
}

// ── Trust Circle ──────────────────────────────────────────────────────────────

export async function joinCircle(ownerId, memberId) {
  if (!isRemote) return local.joinCircle(ownerId, memberId);
  try { return await post(`/circle/${ownerId}/join`, { memberId }, currentToken()); }
  catch { return { ok: false }; }
}

export async function getCircleWidth(ownerId) {
  if (!isRemote) return local.getCircleWidth(ownerId);
  try { const { width } = await get(`/circle/${ownerId}/width`); return width; }
  catch { return 0; }
}

export async function isCircleMember(ownerId, memberId) {
  if (!isRemote) return local.isCircleMember(ownerId, memberId);
  try { const { member } = await get(`/circle/${ownerId}/member/${memberId}`); return member; }
  catch { return false; }
}

export async function getCirclesIn(entityId) {
  if (!isRemote) return local.getCirclesIn(entityId);
  try { const { circlesIn } = await get(`/circle/in/${entityId}`, currentToken()); return circlesIn; }
  catch { return 0; }
}

// ── Invite Links ──────────────────────────────────────────────────────────────

export async function createInviteLink(ownerId) {
  if (!isRemote) return local.createInviteLink(ownerId);
  try { return await post('/invite', { ownerId }, currentToken()); }
  catch { return null; }
}

export async function useInviteLink(inviteId, { name, requesterId }) {
  if (!isRemote) return local.useInviteLink(inviteId, { name, requesterId });
  try { return await post(`/invite/${inviteId}`, { name, requesterId }); }
  catch { return { status: 'invalid' }; }
}

// ── Circle Requests ───────────────────────────────────────────────────────────

export async function addCircleRequest(ownerId, { name, requesterId }) {
  if (!isRemote) return local.addCircleRequest(ownerId, { name, requesterId });
  try { return await post(`/circle/${ownerId}/request`, { name, requesterId }); }
  catch { return { ok: false }; }
}

export async function getCircleRequests(ownerId) {
  if (!isRemote) return local.getCircleRequests(ownerId);
  try { const { requests } = await get(`/circle/${ownerId}/requests`, currentToken()); return requests || []; }
  catch { return []; }
}

export async function resolveCircleRequest(ownerId, requestId, action) {
  if (!isRemote) return local.resolveCircleRequest(ownerId, requestId, action);
  try { return await patch(`/circle/${ownerId}/requests/${requestId}`, { action }, currentToken()); }
  catch { return { ok: false }; }
}

// ── Tokens ────────────────────────────────────────────────────────────────────

export async function getTokenBalance(entityId) {
  if (!isRemote) return local.getTokenBalance(entityId);
  try { const { balance } = await get(`/tokens/${entityId}`, currentToken()); return balance; }
  catch { return 0; }
}
