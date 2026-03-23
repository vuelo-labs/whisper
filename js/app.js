// app.js — Page-specific logic; detects current page and initialises

import { hashEmail, getGhostName, generateTrustToken, generateSigil, generateSigilFromParams, defaultSigilParams } from './entity.js';
import { scoreSentiment, containsHarm, isVelocityPaste } from './nlp.js';
import {
  createEntity, setEntityProfile, getEntity, updateEntity, rekeyEntity,
  getCurrentEntity, setCurrentEntity,
  addWhisper, requestEllisWarm, logOutbound,
  getInboard, getOutboard,
  integrateWhisper, releaseWhisper, clearBoard,
  getIntegratedWhispers, isBoardFull,
  joinCircle, getCircleWidth, isCircleMember, getCirclesIn, getTokenBalance,
  createInviteLink, useInviteLink,
  addCircleRequest, getCircleRequests, resolveCircleRequest,
} from './db.js';

const ELLIS_ID = 'e111500000000000000000000000000000000000000000000000000000000000';

// Ellis prompts — suggestions for what to invite others to whisper about
const ELLIS_THINGS = [
  "What's something I do well that I might take for granted?",
  "When have you seen me at my best?",
  "What's a quality in me that you think I underestimate?",
  "What's something I seem to carry alone that I don't have to?",
  "Is there a version of me you see that I don't show enough?",
  "What would you like me to know about how I make you feel?",
  "What's something I could let go of?",
  "What's something you've wanted to tell me but haven't?",
  "Where do you think I am holding myself back?",
  "What's something I do that makes you feel good?",
];

const ELLIS_PUSHES = [
  "What's something about me you think I need to hear?",
  "What would you say to me if you knew I wouldn't get defensive?",
  "What's the gap between how I see myself and how you see me?",
  "What's a pattern in me you've noticed that I probably haven't?",
  "What do I do that makes things harder than they need to be?",
  "What's the one thing you'd change about how I show up?",
  "What are you waiting for permission to say to me?",
  "Where do you think I'm fooling myself?",
  "What's something I've been avoiding that others can see clearly?",
  "What do you think I'm afraid to want?",
];



// Timer helpers
function expiryToMs(expiry) {
  if (expiry === '1h')  return 3600000;
  if (expiry === '24h') return 86400000;
  if (expiry === '7d')  return 7 * 86400000;
  return 86400000;
}

function roomOpenUntilFromExpiry(expiry) {
  return new Date(Date.now() + expiryToMs(expiry)).toISOString();
}

function isRoomOpen(entity) {
  if (!entity.roomOpenUntil) return false;
  return new Date(entity.roomOpenUntil) > new Date();
}

function isQuestionActive(entity) {
  if (!entity.circleQuestion) return false;
  if (!entity.circleQuestionExpiresAt) return true;
  return new Date(entity.circleQuestionExpiresAt) > new Date();
}

function formatRelativeTime(isoString) {
  const ms = new Date(isoString) - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  const m = Math.floor(ms / 60000);
  return `${m}m`;
}

function driftTime(createdAt, expiry) {
  const driftAt = new Date(new Date(createdAt).getTime() + expiryToMs(expiry));
  const ms = driftAt - Date.now();
  if (ms <= 0) return 'drifting…';
  return `drifts in ${formatRelativeTime(driftAt.toISOString())}`;
}

// Detect current page
const page = (() => {
  const path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  if (path === '/' || path === '/index' || path.endsWith('/whisper')) return 'index';
  if (path.endsWith('/onboard'))   return 'onboard';
  if (path.endsWith('/dashboard')) return 'dashboard';
  if (path.endsWith('/room'))      return 'room';
  if (path.endsWith('/compose'))   return 'compose';
  return 'unknown';
})();

// --- INDEX PAGE ---
async function initIndex() {
  const form = document.getElementById('entry-form');
  const emailInput = document.getElementById('email-input');
  const btn = document.getElementById('enter-btn');
  const errEl = document.getElementById('error-msg');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      errEl.textContent = 'A quiet room needs a real address.';
      errEl.classList.remove('hidden');
      return;
    }

    btn.textContent = 'Finding your room…';
    btn.disabled = true;

    try {
      const entityId = await hashEmail(email);
      const ghostName = getGhostName(entityId);
      const trustToken = generateTrustToken();

      let entity = await getEntity(entityId);
      if (!entity) {
        // New user — create with freshly generated token
        entity = await createEntity({ entityId, ghostName, trustToken });
        setCurrentEntity({ entityId, ghostName, trustToken });
      } else {
        // Returning user — always rekey to ensure token is fresh and matches server
        const rekeyResult = await rekeyEntity(entityId, trustToken);
        if (rekeyResult?.ok !== false) {
          setCurrentEntity({ entityId, ghostName, trustToken });
        } else {
          // Rate limited — fall back to stored token if available
          const existing = getCurrentEntity();
          const storedToken = (existing?.entityId === entityId) ? existing?.trustToken : null;
          setCurrentEntity({ entityId, ghostName, trustToken: storedToken || trustToken });
          if (!storedToken) {
            errEl.textContent = 'Session refresh is temporarily limited. Please try again in a few hours.';
            errEl.classList.remove('hidden');
          }
        }
      }
      // New user: no display name yet → onboard first
      window.location.href = entity.displayName ? 'dashboard.html' : 'onboard.html';
    } catch (err) {
      errEl.textContent = 'Something went quiet unexpectedly. Try again.';
      errEl.classList.remove('hidden');
      btn.textContent = 'Enter the silence';
      btn.disabled = false;
    }
  });
}

// --- ONBOARD PAGE ---
const PALETTES = [
  { name: 'Sage',    hue: 85,  color: '#8A9A5B' },
  { name: 'Ember',   hue: 22,  color: '#C97A3A' },
  { name: 'Dusk',    hue: 265, color: '#8A6EC9' },
  { name: 'Rose',    hue: 345, color: '#C96E8A' },
  { name: 'Glacial', hue: 205, color: '#5B8FA0' },
];

async function initOnboard() {
  const current = getCurrentEntity();
  if (!current) { window.location.href = 'index.html'; return; }

  const form = document.getElementById('onboard-form');
  const nameInput = document.getElementById('name-input');
  const photoInput = document.getElementById('photo-input');
  const photoPreview = document.getElementById('photo-preview');
  const photoPlaceholder = document.getElementById('photo-placeholder');
  const submitBtn = document.getElementById('onboard-submit');
  const sigilPreview = document.getElementById('sigil-preview');

  // Sigil designer state — seed from hash
  let params = defaultSigilParams(current.entityId);

  function renderPreview() {
    if (sigilPreview) sigilPreview.innerHTML = generateSigilFromParams(params, 140);
  }

  function updateActiveControls() {
    // Rings
    document.querySelectorAll('[data-rings]').forEach(el => {
      el.classList.toggle('control-active', parseInt(el.dataset.rings) === params.rings);
    });
    // Lines
    document.querySelectorAll('[data-lines]').forEach(el => {
      el.classList.toggle('control-active', parseInt(el.dataset.lines) === params.lines);
    });
    // Sides
    document.querySelectorAll('[data-sides]').forEach(el => {
      el.classList.toggle('control-active', parseInt(el.dataset.sides) === params.sides);
    });
    // Palette
    document.querySelectorAll('[data-hue]').forEach(el => {
      el.classList.toggle('palette-active', parseInt(el.dataset.hue) === params.hue);
    });
    // Rotation
    const rotSlider = document.getElementById('rotation-slider');
    if (rotSlider) rotSlider.value = params.rotation;
  }

  // Bind rings buttons
  document.querySelectorAll('[data-rings]').forEach(el => {
    el.addEventListener('click', () => {
      params.rings = parseInt(el.dataset.rings);
      updateActiveControls();
      renderPreview();
    });
  });

  // Bind lines buttons
  document.querySelectorAll('[data-lines]').forEach(el => {
    el.addEventListener('click', () => {
      params.lines = parseInt(el.dataset.lines);
      updateActiveControls();
      renderPreview();
    });
  });

  // Bind sides buttons
  document.querySelectorAll('[data-sides]').forEach(el => {
    el.addEventListener('click', () => {
      params.sides = parseInt(el.dataset.sides);
      updateActiveControls();
      renderPreview();
    });
  });

  // Bind palette swatches
  document.querySelectorAll('[data-hue]').forEach(el => {
    el.addEventListener('click', () => {
      params.hue = parseInt(el.dataset.hue);
      updateActiveControls();
      renderPreview();
    });
  });

  // Rotation slider
  const rotSlider = document.getElementById('rotation-slider');
  if (rotSlider) {
    rotSlider.addEventListener('input', () => {
      params.rotation = parseInt(rotSlider.value);
      renderPreview();
    });
  }

  // Shuffle
  const shuffleBtn = document.getElementById('shuffle-btn');
  if (shuffleBtn) {
    shuffleBtn.addEventListener('click', () => {
      params = {
        rings:      2 + Math.floor(Math.random() * 3),
        lines:      3 + Math.floor(Math.random() * 5),
        rotation:   Math.floor(Math.random() * 360),
        innerRatio: 0.3 + Math.random() * 0.25,
        sides:      3 + Math.floor(Math.random() * 4),
        hue:        Math.floor(Math.random() * 360),
      };
      // Snap hue to nearest palette
      const nearest = PALETTES.reduce((a, b) =>
        Math.abs(b.hue - params.hue) < Math.abs(a.hue - params.hue) ? b : a
      );
      params.hue = nearest.hue;
      updateActiveControls();
      renderPreview();
    });
  }

  // Photo preview
  if (photoInput) {
    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        if (photoPreview) { photoPreview.src = e.target.result; photoPreview.classList.remove('hidden'); }
        if (photoPlaceholder) photoPlaceholder.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    });
  }

  // Name → enable submit
  if (nameInput && submitBtn) {
    nameInput.addEventListener('input', () => {
      submitBtn.disabled = nameInput.value.trim().length < 1;
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = nameInput ? nameInput.value.trim() : '';
      if (!displayName) return;

      const photoUrl = (photoPreview && !photoPreview.classList.contains('hidden'))
        ? photoPreview.src : null;

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Claiming…'; }

      // Validate entity exists before saving (deferred until submit)
      const entity = await getEntity(current.entityId);
      if (!entity) { window.location.href = 'index.html'; return; }
      if (entity.displayName) { window.location.href = 'dashboard.html'; return; }

      await setEntityProfile(current.entityId, { displayName, photoUrl, sigilParams: params });
      setCurrentEntity({ ...current, displayName });
      window.location.href = 'dashboard.html';
    });
  }

  // Render immediately — no async gate
  renderPreview();
  updateActiveControls();
}

// --- DASHBOARD PAGE ---
async function initDashboard() {
  const current = getCurrentEntity();
  if (!current) {
    window.location.href = 'index.html';
    return;
  }

  // Broken session: token was wiped by a previous bug — prompt recovery
  if (!current.trustToken) {
    document.body.style.background = '#F8F4ED';
    document.body.innerHTML = `
      <div class="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-6" style="background:#F8F4ED;">
        <p style="font-family:'Playfair Display',serif; color:#2C2419; font-size:1.25rem; font-style:italic;">Your session needs refreshing.</p>
        <p style="color:#8C7E6E; font-size:0.875rem; font-weight:300; max-width:22rem; line-height:1.6;">Re-enter your email and your room will be restored exactly as you left it.</p>
        <a href="index.html" style="color:#8A9A5B; font-size:0.875rem;">← Re-enter email</a>
      </div>`;
    return;
  }

  const entity = await getEntity(current.entityId);
  if (!entity) {
    window.location.href = 'index.html';
    return;
  }

  // Render identity: photo or sigil, display name + ghost name
  const sigilContainer = document.getElementById('sigil-container');
  const ghostNameEl = document.getElementById('ghost-name');
  const displayNameEl = document.getElementById('display-name');
  const photoAvatarEl = document.getElementById('photo-avatar');

  const displayName = entity.displayName || entity.ghostName;
  if (displayNameEl) displayNameEl.textContent = displayName;
  if (ghostNameEl) ghostNameEl.textContent = entity.ghostName;

  const circlesIn = await getCirclesIn(current.entityId);

  if (entity.photoUrl && photoAvatarEl) {
    photoAvatarEl.src = entity.photoUrl;
    photoAvatarEl.classList.remove('hidden');
    if (sigilContainer) sigilContainer.classList.add('hidden');
  } else if (sigilContainer) {
    const sigilParams = entity.sigilParams || defaultSigilParams(current.entityId);
    sigilContainer.innerHTML = generateSigilFromParams(sigilParams, 80);
  }

  // Circle width + token balance
  const circleWidth = await getCircleWidth(current.entityId);
  const tokenBalance = await getTokenBalance(current.entityId);

  const circleWidthEl = document.getElementById('circle-width');
  if (circleWidthEl) circleWidthEl.textContent = `In ${circlesIn} circle${circlesIn === 1 ? '' : 's'}`;

  const tokenBalanceEl = document.getElementById('token-balance');
  if (tokenBalanceEl) tokenBalanceEl.textContent = tokenBalance === 0
    ? 'no whispers left today'
    : `${tokenBalance} whisper${tokenBalance === 1 ? '' : 's'} to give`;

  // Ellis prompt — shown when only Ellis is in the circle
  const ellisPromptEl = document.getElementById('ellis-prompt');
  if (ellisPromptEl) {
    if (circleWidth <= 1) {
      ellisPromptEl.classList.remove('hidden');
    } else {
      ellisPromptEl.classList.add('hidden');
    }
  }

  // Room open window — visiting dashboard extends it; show status
  const expiry = entity.expiry || '24h';
  const newOpenUntil = roomOpenUntilFromExpiry(expiry);
  try { await updateEntity(current.entityId, { roomOpenUntil: newOpenUntil }); } catch {}

  const roomStatusEl = document.getElementById('room-status');
  if (roomStatusEl) roomStatusEl.textContent = `open for ${formatRelativeTime(newOpenUntil)}`;

  // Expiry selector — also resets the open window
  const expirySelect = document.getElementById('expiry-select');
  if (expirySelect) {
    expirySelect.value = expiry;
    expirySelect.addEventListener('change', async () => {
      const newExpiry = expirySelect.value;
      const until = roomOpenUntilFromExpiry(newExpiry);
      await updateEntity(current.entityId, { expiry: newExpiry, roomOpenUntil: until });
      if (roomStatusEl) roomStatusEl.textContent = `open for ${formatRelativeTime(until)}`;
    });
  }

  // Share buttons
  const shareBtn = document.getElementById('share-btn');
  const trustBtn = document.getElementById('trust-btn');
  const copyFeedback = document.getElementById('copy-feedback');

  const baseUrl = `${window.location.origin}/`;

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const url = `${baseUrl}room.html?id=${current.entityId}`;
      showLinkFeedback(copyFeedback, url, 'Sharing this takes courage.');
    });
  }

  if (trustBtn) {
    trustBtn.addEventListener('click', async () => {
      trustBtn.disabled = true;
      trustBtn.textContent = 'Generating…';
      const invite = await createInviteLink(current.entityId);
      trustBtn.disabled = false;
      trustBtn.textContent = 'Generate invite link';
      if (!invite?.id) {
        showLinkFeedback(copyFeedback, null, 'Session expired — <a href="index.html" style="text-decoration:underline;">re-enter your email</a> to restore access.');
        return;
      }
      const url = `${baseUrl}room.html?id=${current.entityId}&invite=${invite.id}`;
      showLinkFeedback(copyFeedback, url, 'Ready to hear what they see.');
    });
  }

  // Tabs
  const tabInboard = document.getElementById('tab-inboard');
  const tabOutboard = document.getElementById('tab-outboard');
  const panelInboard = document.getElementById('panel-inboard');
  const panelOutboard = document.getElementById('panel-outboard');

  function switchTab(active) {
    if (active === 'inboard') {
      tabInboard.classList.add('tab-active');
      tabOutboard.classList.remove('tab-active');
      panelInboard.classList.remove('hidden');
      panelOutboard.classList.add('hidden');
    } else {
      tabOutboard.classList.add('tab-active');
      tabInboard.classList.remove('tab-active');
      panelOutboard.classList.remove('hidden');
      panelInboard.classList.add('hidden');
    }
  }

  if (tabInboard) tabInboard.addEventListener('click', () => switchTab('inboard'));
  if (tabOutboard) tabOutboard.addEventListener('click', () => switchTab('outboard'));

  // Circle question
  const questionInput   = document.getElementById('circle-question-input');
  const questionBtn     = document.getElementById('circle-question-btn');
  const questionActive  = document.getElementById('circle-question-active');
  const questionText    = document.getElementById('circle-question-text');
  const questionClear   = document.getElementById('circle-question-clear');
  const questionForm    = document.getElementById('circle-question-form');

  function renderCircleQuestion(q, expiresAt) {
    if (q && isQuestionActive({ circleQuestion: q, circleQuestionExpiresAt: expiresAt })) {
      if (questionText) questionText.textContent = `"${q}"`;
      const expiryHint = document.getElementById('circle-question-expiry-hint');
      if (expiryHint && expiresAt) expiryHint.textContent = `closes in ${formatRelativeTime(expiresAt)}`;
      if (questionActive) questionActive.classList.remove('hidden');
      if (questionForm) questionForm.classList.add('hidden');
    } else {
      if (questionActive) questionActive.classList.add('hidden');
      if (questionForm) questionForm.classList.remove('hidden');
    }
  }

  renderCircleQuestion(entity.circleQuestion, entity.circleQuestionExpiresAt);

  if (questionBtn) {
    questionBtn.addEventListener('click', async () => {
      const q = (questionInput?.value || '').trim();
      if (!q) return;
      const durationEl = document.getElementById('circle-question-duration');
      const durationMs = expiryToMs(durationEl?.value || '24h');
      const expiresAt  = new Date(Date.now() + durationMs).toISOString();
      await updateEntity(current.entityId, { circleQuestion: q, circleQuestionExpiresAt: expiresAt });
      renderCircleQuestion(q, expiresAt);
    });
  }
  if (questionInput) {
    questionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') questionBtn?.click();
    });
  }
  if (questionClear) {
    questionClear.addEventListener('click', async () => {
      await updateEntity(current.entityId, { circleQuestion: null, circleQuestionExpiresAt: null });
      if (questionInput) questionInput.value = '';
      renderCircleQuestion(null, null);
    });
  }

  // Ellis buttons
  const ellisThingBtn = document.getElementById('ellis-thing-btn');
  const ellisPushBtn  = document.getElementById('ellis-push-btn');
  const ellisWarmBtn  = document.getElementById('ellis-warm-btn');

  if (ellisThingBtn) {
    ellisThingBtn.addEventListener('click', () => {
      const pool = ELLIS_THINGS;
      const text = pool[Math.floor(Math.random() * pool.length)];
      showEllisPromptModal(text);
    });
  }
  if (ellisPushBtn) {
    ellisPushBtn.addEventListener('click', () => {
      const pool = ELLIS_PUSHES;
      const text = pool[Math.floor(Math.random() * pool.length)];
      showEllisPromptModal(text);
    });
  }
  if (ellisWarmBtn) {
    ellisWarmBtn.addEventListener('click', async () => {
      ellisWarmBtn.disabled = true;
      try {
        await requestEllisWarm(current.entityId);
        await renderInboard(current.entityId);
        await renderNoteCount(current.entityId);
      } catch {}
      ellisWarmBtn.disabled = false;
    });
  }

  // Clear board
  const clearBtn = document.getElementById('clear-board-btn');
  if (clearBtn) {
    let clearPending = false;
    let clearTimer = null;
    clearBtn.addEventListener('click', async () => {
      if (!clearPending) {
        clearPending = true;
        clearBtn.textContent = 'tap again to clear everything';
        clearTimer = setTimeout(() => {
          clearPending = false;
          clearBtn.textContent = 'clear the air ↑';
        }, 3000);
        return;
      }
      clearTimeout(clearTimer);
      clearPending = false;
      clearBtn.textContent = 'clear the air ↑';
      await clearBoard(current.entityId);
      await renderInboard(current.entityId);
      await renderNoteCount(current.entityId);
    });
  }

  // Render data (async — must not block event listener wiring above)
  await renderNoteCount(current.entityId);
  await renderInboard(current.entityId);
  await renderOutboard(current.entityId);
  await renderCircleRequests(current.entityId);
}

async function renderNoteCount(entityId) {
  const countEl = document.getElementById('note-count');
  if (!countEl) return;
  const inboard = await getInboard(entityId);
  const active = inboard.filter(w => w.status === 'antechamber' || w.status === 'integrated').length;
  countEl.textContent = `${active} / 100`;
}

async function renderInboard(entityId) {
  const container = document.getElementById('inboard-container');
  if (!container) return;

  const [inboard, entityData] = await Promise.all([getInboard(entityId), getEntity(entityId)]);
  const entityExpiry = entityData?.expiry || '24h';
  const antechamber = inboard.filter(w => w.status === 'antechamber');
  const integrated = inboard.filter(w => w.status === 'integrated');

  let html = '';

  // First-visit welcome: show when the board is empty and entity was just created (no notes ever)
  const isFirstVisit = antechamber.length === 0 && integrated.length === 0 && (entityData?.noteCount || 0) === 0;
  if (isFirstVisit) {
    html = `<div class="rounded-2xl p-6 mb-6 text-center" style="background: rgba(201,168,76,0.04); border: 1px solid rgba(201,168,76,0.08);">
      <p class="font-serif text-text text-lg italic mb-3">Your room is ready.</p>
      <p class="text-muted text-sm font-light leading-relaxed mb-4">
        Share your room link and whispers will arrive here. You choose when to open them.<br/>
        Your <strong class="text-text/70 font-normal">circle</strong> is the people you trust. Invite them, and they earn you more whispers each day.<br/>
        <strong class="text-text/70 font-normal">Ellis</strong> is always here — ask for a prompt to share, or ask for something good.
      </p>
      <p class="text-muted/50 text-xs font-light italic">Whispers wait in the antechamber until you're ready. Unread ones drift away after your room's window closes.</p>
    </div>`;
  } else if (antechamber.length === 0 && integrated.length === 0) {
    html = `<div class="text-center py-16 text-muted">
      <p class="text-lg font-serif italic">Your room is quiet.</p>
      <p class="text-sm mt-2">When someone leaves a whisper, it will wait here for you.</p>
    </div>`;
  }

  // Antechamber — always visible so people know it exists
  html += `<div class="mb-8">
    <h3 class="text-xs uppercase tracking-widest text-muted mb-1">Antechamber${antechamber.length > 0 ? ` — ${antechamber.length} waiting` : ''}</h3>
    <p class="text-muted/40 text-xs font-light mb-4">whispers from others wait here until you're ready to open them</p>
    <div class="space-y-3">`;
  if (antechamber.length === 0) {
    html += `<p class="text-muted/30 text-sm font-serif italic py-4">Quiet for now. Share your room and whispers will arrive here.</p>`;
  } else {
    antechamber.forEach(w => {
      const drift = driftTime(w.createdAt, entityExpiry);
      html += `<div class="fog-card bg-surface rounded-2xl p-5 relative" id="whisper-${w.id}">
        <div class="fog-overlay absolute inset-0 rounded-2xl"></div>
        <div class="fog-content">
          <div class="flex items-center justify-between">
            <p class="font-serif text-text/40 italic text-base">A whisper waits in the quiet…</p>
            <span class="text-xs text-muted/40 font-light ml-3 shrink-0">${drift}</span>
          </div>
        </div>
        <div class="revealed-content hidden">
          <p class="font-serif text-text text-base leading-relaxed">"${escapeHtml(w.text)}"</p>
          <p class="text-xs text-muted mt-3">from ${escapeHtml(w.senderGhost)} · ${formatDate(w.createdAt)}</p>
        </div>
        <div class="mt-4 flex gap-3 items-center flex-wrap">
          <button class="unveil-btn btn-ghost text-sm" data-id="${w.id}">Open</button>
          <button class="integrate-btn btn-sage text-sm hidden" data-id="${w.id}" data-recipient="${entityId}">Carry</button>
          <button class="release-btn btn-muted text-sm hidden" data-id="${w.id}" data-recipient="${entityId}">Release</button>
          <span class="carry-release-hint hidden text-muted/40 text-xs font-light">Carry — keep it with you &nbsp;·&nbsp; Release — let it go</span>
        </div>
      </div>`;
    });
  }
  html += `</div></div>`;

  if (integrated.length > 0) {
    html += `<div>
      <h3 class="text-xs uppercase tracking-widest text-muted mb-4">Carried — ${integrated.length}</h3>
      <div class="space-y-3">`;
    integrated.forEach(w => {
      html += `<div class="whisper-card bg-surface rounded-2xl p-5">
        <p class="font-serif text-text text-base leading-relaxed">"${escapeHtml(w.text)}"</p>
        <p class="text-xs text-muted mt-3">from ${escapeHtml(w.senderGhost)} · ${formatDate(w.createdAt)}</p>
      </div>`;
    });
    html += `</div></div>`;
  }

  container.innerHTML = html;

  // Bind unveil buttons
  container.querySelectorAll('.unveil-btn').forEach(btn => {
    btn.addEventListener('click', () => handleUnveil(btn.dataset.id, entityId));
  });

  container.querySelectorAll('.integrate-btn').forEach(btn => {
    btn.addEventListener('click', () => handleIntegrate(btn.dataset.id, entityId));
  });

  container.querySelectorAll('.release-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRelease(btn.dataset.id, entityId));
  });

}

function handleUnveil(whisperId, entityId) {
  const card = document.getElementById(`whisper-${whisperId}`);
  if (!card) return;

  // Show anchor overlay
  showAnchorOverlay('These are perceptions, not definitions. It takes courage to hear what others see.', () => {
    // Remove fog
    card.classList.add('unveiled');
    card.querySelector('.fog-content').classList.add('hidden');
    card.querySelector('.revealed-content').classList.remove('hidden');
    card.querySelector('.unveil-btn').classList.add('hidden');
    card.querySelector('.integrate-btn').classList.remove('hidden');
    card.querySelector('.release-btn').classList.remove('hidden');
    card.querySelector('.carry-release-hint')?.classList.remove('hidden');
  });
}

async function handleIntegrate(whisperId, entityId) {
  const card = document.getElementById(`whisper-${whisperId}`);
  await integrateWhisper(entityId, whisperId);
  if (card) card.classList.add('dissolving');
  setTimeout(async () => {
    await renderInboard(entityId);
    await renderNoteCount(entityId);
  }, 1300);
}

async function handleRelease(whisperId, entityId) {
  const card = document.getElementById(`whisper-${whisperId}`);
  await releaseWhisper(entityId, whisperId);
  if (card) {
    card.classList.add('dissolving');
    showAnchorOverlay('You have heard them. You do not have to carry it.');
  }
  setTimeout(async () => {
    await renderInboard(entityId);
    await renderNoteCount(entityId);
  }, 1300);
}

async function renderOutboard(entityId) {
  const container = document.getElementById('outboard-container');
  if (!container) return;

  const outboard = await getOutboard(entityId);
  if (outboard.length === 0) {
    container.innerHTML = `<div class="text-center py-16 text-muted">
      <p class="text-lg font-serif italic">You haven't left a whisper for anyone yet.</p>
      <p class="text-sm mt-2">When you leave a whisper for someone, it will appear here.</p>
    </div>`;
    return;
  }

  container.innerHTML = `<div class="space-y-3">` +
    outboard.map(entry => `
      <div class="whisper-card bg-surface rounded-2xl p-5">
        <p class="font-serif text-text text-base leading-relaxed">"${escapeHtml(entry.text)}"</p>
        <div class="flex items-center justify-between mt-3">
          <p class="text-xs text-muted">to ${escapeHtml(entry.recipientGhost || 'the void')} · ${formatDate(entry.createdAt)}</p>
          ${entry.status === 'void' ? '<span class="text-xs text-muted italic">cast to void</span>' : ''}
        </div>
      </div>`).join('') + `</div>`;
}

async function renderCircleRequests(entityId) {
  const section   = document.getElementById('circle-requests-section');
  const container = document.getElementById('circle-requests-container');
  if (!section || !container) return;

  const requests = await getCircleRequests(entityId);
  if (requests.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = requests.map(r => `
    <div class="flex items-center justify-between bg-surface rounded-xl px-4 py-3" id="req-${r.id}">
      <span class="text-sm font-light text-text">${escapeHtml(r.name || r.requester_id?.slice(0, 8))}</span>
      <div class="flex gap-2">
        <button class="req-approve-btn text-xs px-3 py-1 rounded-lg transition-colors" style="color: #8A9A5B; border: 1px solid rgba(138,154,91,0.3);" data-id="${r.id}">Let in</button>
        <button class="req-decline-btn text-xs px-3 py-1 rounded-lg text-muted/60 transition-colors hover:text-muted" data-id="${r.id}">Decline</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.req-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await resolveCircleRequest(entityId, btn.dataset.id, 'approve');
      await renderCircleRequests(entityId);
      // Refresh circle stats
      const cw = await getCircleWidth(entityId);
      const ci = await getCirclesIn(entityId);
      const el = document.getElementById('circle-width');
      if (el) el.textContent = `In ${ci} circle${ci === 1 ? '' : 's'}`;
      const ellisEl = document.getElementById('ellis-prompt');
      if (ellisEl) {
        if (cw <= 1) ellisEl.classList.remove('hidden');
        else ellisEl.classList.add('hidden');
      }
    });
  });

  container.querySelectorAll('.req-decline-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await resolveCircleRequest(entityId, btn.dataset.id, 'decline');
      await renderCircleRequests(entityId);
    });
  });
}

// --- ROOM PAGE ---
async function initRoom() {
  const params = new URLSearchParams(window.location.search);
  const entityId = params.get('id');

  if (!entityId) {
    document.body.innerHTML = `<div class="min-h-screen flex items-center justify-center text-muted font-serif italic text-xl">This room does not exist.</div>`;
    return;
  }

  const entity = await getEntity(entityId);
  if (!entity) {
    document.body.innerHTML = `<div class="min-h-screen flex items-center justify-center text-muted font-serif italic text-xl">This room has not yet been opened.</div>`;
    return;
  }

  // Render identity
  const sigilContainer = document.getElementById('sigil-container');
  const ownerNameEl = document.getElementById('ghost-name');
  const photoAvatarEl = document.getElementById('photo-avatar');

  const ownerName = entity.displayName || entity.ghostName;
  if (ownerNameEl) ownerNameEl.textContent = ownerName;

  if (entity.photoUrl && photoAvatarEl) {
    photoAvatarEl.src = entity.photoUrl;
    photoAvatarEl.classList.remove('hidden');
    if (sigilContainer) sigilContainer.classList.add('hidden');
  } else if (sigilContainer) {
    const sigilParams = entity.sigilParams || defaultSigilParams(entityId);
    sigilContainer.innerHTML = generateSigilFromParams(sigilParams, 72);
  }

  // Invite link flow
  const inviteParam = params.get('invite');
  const joinSection  = document.getElementById('join-circle-section');
  const joinBtn      = document.getElementById('join-circle-btn');
  const joinDone     = document.getElementById('join-circle-done');
  const joinAlready  = document.getElementById('join-circle-already');
  const joinForm     = document.getElementById('join-circle-form');

  if (inviteParam && joinSection) {
    // Self-invite guard (client-side)
    const visitor = getCurrentEntity();
    if (visitor && visitor.entityId === entityId) {
      // Owner visiting their own room via invite link — hide the form silently
    } else {
      joinSection.classList.remove('hidden');
      if (joinBtn) {
        joinBtn.addEventListener('click', async () => {
          const nameEl  = document.getElementById('join-name');
          const emailEl = document.getElementById('join-email');
          const name  = (nameEl?.value || '').trim();
          const email = (emailEl?.value || '').trim();
          if (!name || !email) { alert('Please enter your name and email.'); return; }

          joinBtn.disabled = true;
          joinBtn.textContent = 'Joining…';

          const requesterId = await hashEmail(email);
          const result = await useInviteLink(inviteParam, { name, requesterId });

          if (joinForm) joinForm.classList.add('hidden');
          if (result?.status === 'self') {
            // Server-side catch — they hashed the owner's email
            if (joinAlready) { joinAlready.textContent = 'This is your own circle.'; joinAlready.classList.remove('hidden'); }
          } else if (result?.status === 'member') {
            if (joinAlready) joinAlready.classList.remove('hidden');
          } else if (result?.status === 'joined') {
            if (joinDone) { joinDone.textContent = 'You\'re in. They\'ll be able to whisper to you soon.'; joinDone.classList.remove('hidden'); }
          } else {
            // 'pending' or 'invalid' — link was already used, request queued
            if (joinDone) { joinDone.textContent = 'This link was already used. Your request has been sent for approval.'; joinDone.classList.remove('hidden'); }
          }
        });
      }
    }
  }

  // Room open/closed state
  const roomOpen = isRoomOpen(entity);
  const leaveBtn2 = document.getElementById('leave-whisper-btn');
  const roomRestingEl = document.getElementById('room-resting-msg');
  if (!roomOpen) {
    if (leaveBtn2) leaveBtn2.classList.add('hidden');
    if (roomRestingEl) roomRestingEl.classList.remove('hidden');
  }

  // Circle question (check expiry)
  const questionSection = document.getElementById('circle-question-section');
  const questionDisplay = document.getElementById('circle-question-display');
  const answerBtn       = document.getElementById('answer-question-btn');
  if (isQuestionActive(entity) && questionSection) {
    if (questionDisplay) questionDisplay.textContent = `"${entity.circleQuestion}"`;
    questionSection.classList.remove('hidden');
    if (answerBtn) {
      answerBtn.addEventListener('click', () => {
        window.location.href = `compose.html?id=${entityId}&question=${encodeURIComponent(entity.circleQuestion)}`;
      });
    }
  }

  // Board full check (only relevant if room is open)
  const leaveBtn = document.getElementById('leave-whisper-btn');
  const fullMsg = document.getElementById('board-full-msg');
  if (roomOpen) {
    const full = await isBoardFull(entityId);
    if (full) {
      if (leaveBtn) leaveBtn.classList.add('hidden');
      if (fullMsg) fullMsg.classList.remove('hidden');
    } else {
      if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
          window.location.href = `compose.html?id=${entityId}`;
        });
      }
    }
  }

  // Render integrated whispers
  const whispersList = document.getElementById('whispers-list');
  const emptyState = document.getElementById('empty-state');
  const integrated = await getIntegratedWhispers(entityId);

  if (integrated.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (whispersList) whispersList.classList.add('hidden');
  } else {
    if (emptyState) emptyState.classList.add('hidden');
    if (whispersList) {
      whispersList.innerHTML = integrated.map(w => `
        <div class="whisper-card bg-surface rounded-2xl p-5">
          <p class="font-serif text-text text-base leading-relaxed">"${escapeHtml(w.text)}"</p>
          <p class="text-xs text-muted mt-3">${formatDate(w.createdAt)}</p>
        </div>`).join('');
    }
  }
}

// --- COMPOSE PAGE ---
async function initCompose() {
  const params = new URLSearchParams(window.location.search);
  const recipientId = params.get('id');
  const trustParam = params.get('trust');

  if (!recipientId) {
    window.location.href = 'index.html';
    return;
  }

  const recipient = await getEntity(recipientId);
  if (!recipient) {
    document.body.innerHTML = `<div class="min-h-screen flex items-center justify-center text-muted font-serif italic text-xl">This room does not exist.</div>`;
    return;
  }

  // Show circle question context if answering one
  const questionParam = params.get('question');
  const questionContext = document.getElementById('question-context');
  if (questionParam && questionContext) {
    questionContext.textContent = `"${questionParam}"`;
    questionContext.closest?.('[data-question-wrap]')?.classList.remove('hidden');
    const wrap = document.getElementById('question-context-wrap');
    if (wrap) wrap.classList.remove('hidden');
  }

  // Show recipient's name and photo
  const recipientNameEl = document.getElementById('recipient-name');
  const recipientPhotoEl = document.getElementById('recipient-photo');
  const recipientSigilEl = document.getElementById('recipient-sigil');

  const recipientName = recipient.displayName || recipient.ghostName;
  if (recipientNameEl) recipientNameEl.textContent = recipientName;

  if (recipient.photoUrl && recipientPhotoEl) {
    recipientPhotoEl.src = recipient.photoUrl;
    recipientPhotoEl.classList.remove('hidden');
    if (recipientSigilEl) recipientSigilEl.classList.add('hidden');
  } else if (recipientSigilEl) {
    recipientSigilEl.innerHTML = generateSigil(recipientId, 48, recipient.sigilParams || null);
  }

  // Sender must have an entity to send
  const senderEntity = getCurrentEntity();
  const noTokenMsg = document.getElementById('rate-limit-msg');
  const liturgyContainer = document.getElementById('liturgy-container');

  if (!senderEntity) {
    if (noTokenMsg) {
      noTokenMsg.innerHTML = `<p class="font-serif italic text-muted text-base leading-relaxed">You need your own quiet room before you can leave a whisper.</p><a href="/" class="text-sage text-sm mt-3 inline-block hover:underline">Open your room →</a>`;
      noTokenMsg.classList.remove('hidden');
    }
    if (liturgyContainer) liturgyContainer.classList.add('hidden');
    return;
  }

  const senderId   = senderEntity.entityId;
  const senderGhost = senderEntity.ghostName;

  // Token check
  const balance = await getTokenBalance(senderId);
  if (balance < 1) {
    if (noTokenMsg) {
      noTokenMsg.innerHTML = `<p class="font-serif italic text-muted text-base leading-relaxed">You have no whispers left today. Return at midnight — your circle will refill your voice.</p>`;
      noTokenMsg.classList.remove('hidden');
    }
    if (liturgyContainer) liturgyContainer.classList.add('hidden');
    return;
  }

  // Trusted mode: sender is a circle member of the recipient (skips liturgy phases)
  const isTrusted = await isCircleMember(recipientId, senderId);
  const trustedBadge = document.getElementById('trusted-badge');
  if (isTrusted && trustedBadge) {
    trustedBadge.classList.remove('hidden');
    document.querySelector('.compose-wrapper')?.classList.add('trusted-mode');
  }

  // Phase management
  const phases = isTrusted
    ? ['whisper']
    : ['admire', 'appreciate', 'wish', 'mirror', 'whisper'];

  let currentPhase = 0;
  let phaseData = { admire: '', appreciate: '', wish: '' };
  let whisperText = '';
  let composeStartTime = Date.now();

  function showPhase(index) {
    document.querySelectorAll('.phase').forEach(el => el.classList.add('hidden'));
    const phaseEl = document.getElementById(`phase-${phases[index]}`);
    if (phaseEl) {
      phaseEl.classList.remove('hidden');
      phaseEl.classList.add('phase-enter');
      setTimeout(() => phaseEl.classList.remove('phase-enter'), 600);
    }

    // Update phase dots
    const allDots = document.querySelectorAll('.phase-dot');
    allDots.forEach((dot, i) => {
      dot.classList.remove('active', 'completed');
      if (i < index) dot.classList.add('completed');
      else if (i === index) dot.classList.add('active');
    });

    // Start timer if applicable
    const phaseKey = phases[index];
    if (['admire', 'appreciate', 'wish'].includes(phaseKey) && !isTrusted) {
      startPhaseTimer(phaseKey, 60);
    } else if (phaseKey === 'whisper' && isTrusted) {
      startPhaseTimer('whisper-trusted', 60);
    }

    // In trusted mode, hide the non-trusted timer; show trusted timer
    const trustedTimerEl = document.getElementById('trusted-timer');
    if (trustedTimerEl) {
      trustedTimerEl.style.display = isTrusted ? 'inline-flex' : 'none';
    }
  }

  function startPhaseTimer(phaseKey, seconds) {
    const timerEl = document.getElementById(`timer-${phaseKey}`);
    const circleEl = document.getElementById(`circle-${phaseKey}`);
    if (!timerEl && !circleEl) return;

    let remaining = seconds;
    const circumference = 2 * Math.PI * 28; // r=28
    if (circleEl) {
      circleEl.style.strokeDasharray = circumference;
      circleEl.style.strokeDashoffset = 0;
    }

    const interval = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = remaining;
      if (circleEl) {
        const progress = (seconds - remaining) / seconds;
        circleEl.style.strokeDashoffset = circumference * (1 - progress);
      }
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
  }

  // Admire phase
  const admireNext = document.getElementById('admire-next');
  const admireTextarea = document.getElementById('admire-textarea');
  if (admireNext && admireTextarea) {
    admireTextarea.addEventListener('input', () => {
      admireNext.disabled = admireTextarea.value.trim().length < 30;
    });
    admireNext.addEventListener('click', () => {
      phaseData.admire = admireTextarea.value.trim();
      currentPhase++;
      showPhase(currentPhase);
    });
  }

  // Appreciate phase
  const appreciateNext = document.getElementById('appreciate-next');
  const appreciateTextarea = document.getElementById('appreciate-textarea');
  if (appreciateNext && appreciateTextarea) {
    appreciateTextarea.addEventListener('input', () => {
      appreciateNext.disabled = appreciateTextarea.value.trim().length < 30;
    });
    appreciateNext.addEventListener('click', () => {
      phaseData.appreciate = appreciateTextarea.value.trim();
      currentPhase++;
      showPhase(currentPhase);
    });
  }

  // Wish phase
  const wishNext = document.getElementById('wish-next');
  const wishTextarea = document.getElementById('wish-textarea');
  if (wishNext && wishTextarea) {
    wishTextarea.addEventListener('input', () => {
      wishNext.disabled = wishTextarea.value.trim().length < 30;
    });
    wishNext.addEventListener('click', () => {
      phaseData.wish = wishTextarea.value.trim();
      currentPhase++;
      showPhase(currentPhase);
    });
  }

  // Mirror phase
  const mirrorNext = document.getElementById('mirror-next');
  if (mirrorNext) {
    mirrorNext.addEventListener('click', () => {
      currentPhase++;
      showPhase(currentPhase);
      composeStartTime = Date.now();
    });
  }

  // Whisper phase — NLP + hold button
  const whisperTextarea = document.getElementById('whisper-textarea');
  const harmWarning = document.getElementById('harm-warning');
  const weightWarning = document.getElementById('weight-warning');
  const pasteWarning = document.getElementById('paste-warning');
  const charCount = document.getElementById('char-count');
  const holdBtn = document.getElementById('hold-btn');
  const holdRing = document.getElementById('hold-ring');
  const holdCircle = document.getElementById('hold-circle');
  const holdLabel = document.getElementById('hold-label');
  const sendChoices = document.getElementById('send-choices');
  const exhaleBtn = document.getElementById('exhale-btn');
  const voidBtn = document.getElementById('void-btn');
  const composeWrapper = document.querySelector('.compose-main');

  // Cycling placeholder
  const placeholders = [
    'Something I noticed about your spirit today…',
    'A small moment where you made me feel seen…',
    'A quality you carry that you might not realise is there…',
    'There is a space that feels like it was made for a conversation we haven\'t had yet…',
  ];
  let placeholderIdx = 0;
  if (whisperTextarea) {
    whisperTextarea.placeholder = placeholders[0];
    setInterval(() => {
      if (document.activeElement !== whisperTextarea && !whisperTextarea.value) {
        placeholderIdx = (placeholderIdx + 1) % placeholders.length;
        whisperTextarea.placeholder = placeholders[placeholderIdx];
      }
    }, 4000);

    whisperTextarea.addEventListener('input', () => {
      const text = whisperTextarea.value;
      whisperText = text;
      const elapsed = Date.now() - composeStartTime;

      // Char count
      if (charCount) charCount.textContent = `${text.length} / 280`;
      if (text.length > 280) whisperTextarea.value = text.slice(0, 280);

      // NLP checks
      const isHarm = containsHarm(text);
      const score = scoreSentiment(text);
      const isPaste = isVelocityPaste(text, elapsed);

      if (harmWarning) harmWarning.classList.toggle('hidden', !isHarm);
      if (weightWarning) weightWarning.classList.toggle('hidden', isHarm || score >= -3);
      if (pasteWarning) pasteWarning.classList.toggle('hidden', !isPaste);

      // Hold button availability
      if (holdBtn) holdBtn.disabled = isHarm || text.trim().length < 10;

      // Warm glow
      if (composeWrapper) {
        if (score > 2) {
          composeWrapper.classList.add('warm-glow');
          composeWrapper.style.backgroundColor = 'rgba(229, 193, 205, 0.04)';
        } else {
          composeWrapper.style.backgroundColor = '';
        }
      }
    });
  }

  // Hold-to-exhale button
  let holdInterval = null;
  let holdProgress = 0;
  const holdDuration = 2500;
  const circumference = 2 * Math.PI * 48; // r=48 matches the SVG circle in compose.html

  if (holdCircle) {
    holdCircle.style.strokeDasharray = circumference;
    holdCircle.style.strokeDashoffset = circumference;
  }

  function startHold() {
    if (holdBtn && holdBtn.disabled) return;
    holdProgress = 0;
    const startTime = Date.now();

    holdInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      holdProgress = Math.min(elapsed / holdDuration, 1);

      if (holdCircle) {
        holdCircle.style.strokeDashoffset = circumference * (1 - holdProgress);
      }
      if (holdLabel) {
        holdLabel.textContent = holdProgress < 1 ? 'hold…' : 'release';
      }

      if (holdProgress >= 1) {
        clearInterval(holdInterval);
        holdInterval = null;
        if (sendChoices) sendChoices.classList.remove('hidden');
        if (holdBtn) holdBtn.classList.add('hidden');
      }
    }, 30);
  }

  function cancelHold() {
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
    holdProgress = 0;
    if (holdCircle) holdCircle.style.strokeDashoffset = circumference;
    if (holdLabel) holdLabel.textContent = 'hold to exhale';
  }

  if (holdBtn) {
    holdBtn.addEventListener('mousedown', startHold);
    holdBtn.addEventListener('touchstart', startHold, { passive: true });
    holdBtn.addEventListener('mouseup', cancelHold);
    holdBtn.addEventListener('mouseleave', cancelHold);
    holdBtn.addEventListener('touchend', cancelHold);
  }

  // Send choices
  if (exhaleBtn) {
    exhaleBtn.addEventListener('click', async () => {
      const text = whisperTextarea ? whisperTextarea.value.trim() : '';
      if (!text) return;

      exhaleBtn.disabled = true;
      try {
        await addWhisper({
          recipientId,
          senderId,
          senderGhost,
          text,
          admire: phaseData.admire,
          appreciate: phaseData.appreciate,
          wish: phaseData.wish,
        });
        // Log is best-effort — don't block the send if it fails
        logOutbound({ senderId, senderGhost, recipientId, recipientGhost: recipient.ghostName, text, status: 'sent' }).catch(() => {});
        showFinalMessage(
          'That was brave.',
          'It has landed quietly. Whether they are ready for it is theirs to decide.'
        );
      } catch {
        exhaleBtn.disabled = false;
        if (sendChoices) sendChoices.classList.add('hidden');
        if (holdBtn) holdBtn.classList.remove('hidden');
        if (harmWarning) {
          harmWarning.textContent = 'Something went quiet. Check your connection and try again.';
          harmWarning.classList.remove('hidden');
        }
      }
    });
  }

  if (voidBtn) {
    voidBtn.addEventListener('click', async () => {
      const text = whisperTextarea ? whisperTextarea.value.trim() : '';
      if (!text) return;

      await logOutbound({
        senderId,
        senderGhost,
        recipientId,
        recipientGhost: recipient.ghostName,
        text,
        status: 'void',
      });

      const whisperPhase = document.getElementById('phase-whisper');
      if (whisperPhase) whisperPhase.classList.add('dissolving');

      setTimeout(() => {
        showFinalMessage(
          'It\'s out there now.',
          'You can let it go.'
        );
      }, 1200);
    });
  }

  function showFinalMessage(title, subtitle) {
    const liturgy = document.getElementById('liturgy-container');
    const finalMsg = document.getElementById('final-message');
    const finalTitle = document.getElementById('final-title');
    const finalSub = document.getElementById('final-subtitle');

    if (liturgy) liturgy.classList.add('hidden');
    if (finalTitle) finalTitle.textContent = title;
    if (finalSub) finalSub.textContent = subtitle;

    // Replace static links with meaningful destinations
    const linksEl = document.getElementById('final-links');
    if (linksEl) {
      const roomUrl = `room.html?id=${recipientId}`;
      const hasSender = !!getCurrentEntity();
      linksEl.innerHTML = `
        <a href="${roomUrl}" class="inline-block mt-8 text-muted/50 text-xs hover:text-muted/70 transition-colors font-light">
          ← back to their room
        </a>
        ${hasSender ? `<a href="dashboard.html" class="inline-block mt-4 text-muted/40 text-xs hover:text-muted/60 transition-colors font-light">
          open your own room →
        </a>` : ''}`;
    }

    if (finalMsg) finalMsg.classList.remove('hidden');
  }

  // Start at first phase
  showPhase(0);
}

// --- UTILITIES ---

function showEllisPromptModal(text) {
  const modal = document.createElement('div');
  modal.className = 'anchor-overlay';
  modal.style.cssText = 'cursor: pointer;';
  modal.innerHTML = `
    <div class="max-w-sm w-full mx-6" style="background: #EDE8DC; border: 1px solid rgba(201,168,76,0.25); border-radius: 1.5rem; padding: 2rem;">
      <p class="text-xs uppercase tracking-widest mb-4" style="color: rgba(201,168,76,0.5);">Ellis suggests asking</p>
      <p class="font-serif text-text text-lg leading-relaxed italic mb-6">"${escapeHtml(text)}"</p>
      <div class="flex gap-3">
        <button class="ellis-modal-copy flex-1 py-2.5 rounded-xl text-sm font-sans tracking-wide transition-all" style="background: rgba(201,168,76,0.08); color: #C9A84C; border: 1px solid rgba(201,168,76,0.2);">Copy to share</button>
        <button class="ellis-modal-close px-4 py-2.5 rounded-xl text-sm font-sans text-muted transition-all" style="border: 1px solid rgba(107,103,98,0.2);">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('visible'));

  function dismiss() {
    modal.classList.remove('visible');
    modal.classList.add('fading');
    setTimeout(() => modal.remove(), 600);
  }

  modal.querySelector('.ellis-modal-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(text, () => {
      const btn = modal.querySelector('.ellis-modal-copy');
      btn.textContent = 'Copied';
      setTimeout(dismiss, 1000);
    });
  });
  modal.querySelector('.ellis-modal-close').addEventListener('click', dismiss);
  modal.addEventListener('click', (e) => { if (e.target === modal) dismiss(); });
}

function showAnchorOverlay(message, callback) {
  const overlay = document.createElement('div');
  overlay.className = 'anchor-overlay';
  overlay.style.cursor = 'pointer';
  overlay.innerHTML = `
    <div class="text-center max-w-xs">
      <p class="font-serif text-text text-xl">${escapeHtml(message)}</p>
      <p class="text-muted/50 text-xs mt-4 font-light tracking-wide">tap to continue</p>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  function dismiss() {
    overlay.classList.remove('visible');
    overlay.classList.add('fading');
    setTimeout(() => {
      overlay.remove();
      if (callback) callback();
    }, 600);
  }

  overlay.addEventListener('click', dismiss);
  // Fallback auto-dismiss after 8s in case user doesn't know to tap
  setTimeout(dismiss, 8000);
}

function copyToClipboard(text, onSuccess) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      // Fallback for HTTP or blocked clipboard
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      onSuccess();
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    onSuccess();
  }
}

function showCopyFeedback(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function showLinkFeedback(el, url, message) {
  if (!el) return;
  if (!url) {
    el.innerHTML = `<p class="text-muted/60 text-xs text-center font-light italic py-1">${message}</p>`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
    return;
  }
  el.innerHTML = `
    <p class="text-muted/50 text-xs text-center font-light italic mb-2">${escapeHtml(message)}</p>
    <div class="flex gap-2 items-center" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 0.75rem; padding: 0.5rem 0.75rem;">
      <input
        type="text"
        value="${escapeHtml(url)}"
        readonly
        class="flex-1 bg-transparent text-muted text-xs font-mono outline-none min-w-0"
        style="cursor: text;"
        onclick="this.select()"
      />
      <button
        class="text-xs text-muted/60 hover:text-muted shrink-0 transition-colors font-sans"
        style="padding: 0.1rem 0.4rem;"
        onclick="navigator.clipboard && navigator.clipboard.writeText('${escapeHtml(url)}').then(()=>{ this.textContent='copied'; setTimeout(()=>{ this.textContent='copy'; },1500); }).catch(()=>{}); this.textContent='copy';"
      >copy</button>
    </div>`;
  el.classList.remove('hidden');
  // Auto-attempt clipboard on show
  copyToClipboard(url, () => {});
  setTimeout(() => el.classList.add('hidden'), 15000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
  switch (page) {
    case 'index':     initIndex();     break;
    case 'onboard':   initOnboard();   break;
    case 'dashboard': initDashboard(); break;
    case 'room':      initRoom();      break;
    case 'compose':   initCompose();   break;
  }
});
