// db.js — Supabase client + data access layer
// Mirrors the storage.js API exactly so app.js can swap seamlessly.
// Falls back to storage.js (localStorage) when SUPABASE_URL is empty.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as local from './storage.js';

// ── Client ────────────────────────────────────────────────────────────────────

let _sb = null;

function sb() {
  if (!_sb) {
    const { createClient } = window.supabase;
    _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _sb;
}

export const isRemote = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Set entity context so RLS policies can identify the caller
async function setContext(entityId) {
  if (!entityId) return;
  await sb().rpc('set_config', {
    setting: 'app.eid',
    value: entityId,
    is_local: true,
  }).catch(() => {}); // non-fatal if rpc not available
}

// ── Entities ──────────────────────────────────────────────────────────────────

export async function createEntity({ entityId, ghostName, trustToken }) {
  if (!isRemote) return local.createEntity({ entityId, ghostName, trustToken });

  const row = {
    entity_id:   entityId,
    ghost_name:  ghostName,
    trust_token: trustToken,
  };
  const { data, error } = await sb().from('entities').upsert(row).select().single();
  if (error) throw error;
  return remapEntity(data);
}

export async function getEntity(entityId) {
  if (!isRemote) return local.getEntity(entityId);

  const { data } = await sb().from('entities').select('*').eq('entity_id', entityId).maybeSingle();
  return data ? remapEntity(data) : null;
}

export async function setEntityProfile(entityId, { displayName, photoUrl, sigilParams }) {
  if (!isRemote) return local.setEntityProfile(entityId, { displayName, photoUrl, sigilParams });

  await setContext(entityId);
  const update = {};
  if (displayName  !== undefined) update.display_name  = displayName;
  if (photoUrl     !== undefined) update.photo_url     = photoUrl;
  if (sigilParams  !== undefined) update.sigil_params  = sigilParams;

  const { data, error } = await sb().from('entities').update(update)
    .eq('entity_id', entityId).select().single();
  if (error) throw error;
  return remapEntity(data);
}

export async function updateEntity(entityId, updates) {
  if (!isRemote) return local.updateEntity(entityId, updates);

  await setContext(entityId);
  const dbUpdates = {};
  if (updates.expiry    !== undefined) dbUpdates.expiry    = updates.expiry;
  if (updates.noteCount !== undefined) dbUpdates.note_count = updates.noteCount;

  const { data, error } = await sb().from('entities').update(dbUpdates)
    .eq('entity_id', entityId).select().single();
  if (error) throw error;
  return remapEntity(data);
}

// Current entity lives in localStorage regardless of backend
export const getCurrentEntity  = local.getCurrentEntity;
export const setCurrentEntity  = local.setCurrentEntity;
export const clearCurrentEntity = local.clearCurrentEntity;

// ── Whispers ──────────────────────────────────────────────────────────────────

export async function addWhisper({ recipientId, senderId, senderGhost, text, admire, appreciate, wish }) {
  if (!isRemote) return local.addWhisper({ recipientId, senderId, senderGhost, text, admire, appreciate, wish });

  const row = {
    recipient_id: recipientId,
    sender_id:    senderId,
    sender_ghost: senderGhost,
    text,
    admire:    admire    || null,
    appreciate: appreciate || null,
    wish:      wish      || null,
    status:    'antechamber',
  };
  const { data, error } = await sb().from('whispers').insert(row).select().single();
  if (error) throw error;
  return remapWhisper(data);
}

export async function getInboard(entityId) {
  if (!isRemote) return local.getInboard(entityId);

  await setContext(entityId);
  const { data, error } = await sb().from('whispers')
    .select('*')
    .eq('recipient_id', entityId)
    .in('status', ['antechamber', 'integrated'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(remapWhisper);
}

export async function getIntegratedWhispers(entityId) {
  if (!isRemote) return local.getIntegratedWhispers(entityId);

  const { data, error } = await sb().from('whispers')
    .select('*')
    .eq('recipient_id', entityId)
    .eq('status', 'integrated')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(remapWhisper);
}

export async function integrateWhisper(recipientId, whisperId) {
  if (!isRemote) return local.integrateWhisper(recipientId, whisperId);

  await setContext(recipientId);
  const { error } = await sb().from('whispers').update({ status: 'integrated' })
    .eq('id', whisperId).eq('recipient_id', recipientId);
  if (error) throw error;
}

export async function releaseWhisper(recipientId, whisperId) {
  if (!isRemote) return local.releaseWhisper(recipientId, whisperId);

  await setContext(recipientId);
  const { error } = await sb().from('whispers').update({ status: 'released' })
    .eq('id', whisperId).eq('recipient_id', recipientId);
  if (error) throw error;
}

export async function clearBoard(entityId) {
  if (!isRemote) return local.clearBoard(entityId);

  await setContext(entityId);
  const { error } = await sb().from('whispers').update({ status: 'released' })
    .eq('recipient_id', entityId).eq('status', 'integrated');
  if (error) throw error;
}

export async function isBoardFull(entityId) {
  if (!isRemote) return local.isBoardFull(entityId);

  const { count, error } = await sb().from('whispers')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', entityId)
    .in('status', ['antechamber', 'integrated']);
  if (error) return false;
  return (count || 0) >= 100;
}

// ── Outbound log ──────────────────────────────────────────────────────────────

export async function logOutbound({ senderId, senderGhost, recipientId, recipientGhost, text, status = 'sent' }) {
  if (!isRemote) return local.logOutbound({ senderId, senderGhost, recipientId, recipientGhost, text, status });

  const row = { sender_id: senderId, recipient_id: recipientId, recipient_ghost: recipientGhost, text, status };
  const { data, error } = await sb().from('outbound_log').insert(row).select().single();
  if (error) throw error;
  return remapOutbound(data);
}

export async function getOutboard(entityId) {
  if (!isRemote) return local.getOutboard(entityId);

  await setContext(entityId);
  const { data, error } = await sb().from('outbound_log')
    .select('*').eq('sender_id', entityId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(remapOutbound);
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

export async function checkRateLimit(senderId) {
  if (!isRemote) return local.checkRateLimit(senderId);

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await sb().from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('sender_id', senderId).gte('sent_at', cutoff);
  return { count: count || 0, exceeded: (count || 0) >= 3 };
}

export async function incrementRateLimit(senderId) {
  if (!isRemote) return local.incrementRateLimit(senderId);

  await sb().from('rate_limits').insert({ sender_id: senderId });
}

// ── Remappers: snake_case DB → camelCase app ──────────────────────────────────

function remapEntity(r) {
  return {
    entityId:    r.entity_id,
    ghostName:   r.ghost_name,
    displayName: r.display_name  || null,
    photoUrl:    r.photo_url     || null,
    sigilParams: r.sigil_params  || null,
    trustToken:  r.trust_token,
    expiry:      r.expiry,
    noteCount:   r.note_count,
    createdAt:   r.created_at,
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
