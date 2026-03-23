// app.js — Page-specific logic; detects current page and initialises

import { hashEmail, getGhostName, generateTrustToken, generateSigil, generateSigilFromParams, defaultSigilParams } from './entity.js';
import { scoreSentiment, containsHarm, isVelocityPaste } from './nlp.js';
import {
  createEntity, setEntityProfile, getEntity, updateEntity,
  getCurrentEntity, setCurrentEntity,
  addWhisper, logOutbound,
  getInboard, getOutboard,
  integrateWhisper, releaseWhisper, clearBoard,
  getIntegratedWhispers, checkRateLimit, incrementRateLimit, isBoardFull,
} from './db.js';

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
        entity = await createEntity({ entityId, ghostName, trustToken });
      }

      setCurrentEntity({ entityId, ghostName, trustToken: entity.trustToken });
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

  if (entity.photoUrl && photoAvatarEl) {
    photoAvatarEl.src = entity.photoUrl;
    photoAvatarEl.classList.remove('hidden');
    if (sigilContainer) sigilContainer.classList.add('hidden');
  } else if (sigilContainer) {
    sigilContainer.innerHTML = generateSigil(current.entityId, 80, entity.sigilParams || null);
  }

  // Expiry selector
  const expirySelect = document.getElementById('expiry-select');
  if (expirySelect) {
    expirySelect.value = entity.expiry || '24h';
    expirySelect.addEventListener('change', async () => {
      await updateEntity(current.entityId, { expiry: expirySelect.value });
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
      copyToClipboard(url, () => showCopyFeedback(copyFeedback, 'Room link copied to the ether.'));
    });
  }

  if (trustBtn) {
    trustBtn.addEventListener('click', () => {
      const url = `${baseUrl}room.html?id=${current.entityId}&trust=${entity.trustToken}`;
      copyToClipboard(url, () => showCopyFeedback(copyFeedback, `Copied: ${url}`));
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

  // Clear board
  const clearBtn = document.getElementById('clear-board-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (confirm('Clear all integrated whispers from your board? They will be released.')) {
        await clearBoard(current.entityId);
        await renderInboard(current.entityId);
        await renderNoteCount(current.entityId);
      }
    });
  }

  // Render data (async — must not block event listener wiring above)
  await renderNoteCount(current.entityId);
  await renderInboard(current.entityId);
  await renderOutboard(current.entityId);
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

  const inboard = await getInboard(entityId);
  const antechamber = inboard.filter(w => w.status === 'antechamber');
  const integrated = inboard.filter(w => w.status === 'integrated');

  let html = '';

  if (antechamber.length === 0 && integrated.length === 0) {
    html = `<div class="text-center py-16 text-muted">
      <p class="text-lg font-serif italic">Silence hangs here, waiting to be filled.</p>
      <p class="text-sm mt-2">Share your room and let the whispers find you.</p>
    </div>`;
  }

  if (antechamber.length > 0) {
    html += `<div class="mb-8">
      <h3 class="text-xs uppercase tracking-widest text-muted mb-4">Antechamber — ${antechamber.length} waiting</h3>
      <div class="space-y-3">`;
    antechamber.forEach(w => {
      html += `<div class="fog-card bg-surface rounded-2xl p-5 relative" id="whisper-${w.id}">
        <div class="fog-overlay absolute inset-0 rounded-2xl"></div>
        <div class="fog-content">
          <p class="font-serif text-text/40 italic text-base">A whisper waits in the quiet…</p>
        </div>
        <div class="revealed-content hidden">
          <p class="font-serif text-text text-base leading-relaxed">"${escapeHtml(w.text)}"</p>
          <p class="text-xs text-muted mt-3">from ${escapeHtml(w.senderGhost)} · ${formatDate(w.createdAt)}</p>
        </div>
        <div class="mt-4 flex gap-3 items-center">
          <button class="unveil-btn btn-ghost text-sm" data-id="${w.id}">Unveil</button>
          <button class="integrate-btn btn-sage text-sm hidden" data-id="${w.id}" data-recipient="${entityId}">Integrate</button>
          <button class="release-btn btn-muted text-sm hidden" data-id="${w.id}" data-recipient="${entityId}">Release</button>
        </div>
      </div>`;
    });
    html += `</div></div>`;
  }

  if (integrated.length > 0) {
    html += `<div>
      <h3 class="text-xs uppercase tracking-widest text-muted mb-4">Integrated — ${integrated.length} carried</h3>
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
  showAnchorOverlay('These are perceptions, not definitions.', () => {
    // Remove fog
    card.classList.add('unveiled');
    card.querySelector('.fog-content').classList.add('hidden');
    card.querySelector('.revealed-content').classList.remove('hidden');
    card.querySelector('.unveil-btn').classList.add('hidden');
    card.querySelector('.integrate-btn').classList.remove('hidden');
    card.querySelector('.release-btn').classList.remove('hidden');
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
      <p class="text-lg font-serif italic">You haven't spoken into the void yet.</p>
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

// --- ROOM PAGE ---
async function initRoom() {
  const params = new URLSearchParams(window.location.search);
  const entityId = params.get('id');
  const trustParam = params.get('trust');

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
    sigilContainer.innerHTML = generateSigil(entityId, 72, entity.sigilParams || null);
  }

  // Board full check
  const full = await isBoardFull(entityId);
  const leaveBtn = document.getElementById('leave-whisper-btn');
  const fullMsg = document.getElementById('board-full-msg');

  if (full) {
    if (leaveBtn) leaveBtn.classList.add('hidden');
    if (fullMsg) fullMsg.classList.remove('hidden');
  } else {
    if (leaveBtn) {
      leaveBtn.addEventListener('click', () => {
        let url = `compose.html?id=${entityId}`;
        if (trustParam && trustParam === entity.trustToken) url += `&trust=${trustParam}`;
        window.location.href = url;
      });
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

  // Get or create sender entity
  let senderEntity = getCurrentEntity();
  let senderId, senderGhost;

  if (senderEntity) {
    senderId = senderEntity.entityId;
    senderGhost = senderEntity.ghostName;
  } else {
    // Anonymous sender — create ephemeral identity
    const anonHash = generateTrustToken() + generateTrustToken();
    senderId = anonHash;
    senderGhost = getGhostName(anonHash);
  }

  // Rate limit check
  const rateCheck = await checkRateLimit(senderId);
  const rateLimitMsg = document.getElementById('rate-limit-msg');
  const liturgyContainer = document.getElementById('liturgy-container');

  if (rateCheck.exceeded) {
    if (rateLimitMsg) rateLimitMsg.classList.remove('hidden');
    if (liturgyContainer) liturgyContainer.classList.add('hidden');
    return;
  }

  const isTrusted = trustParam && trustParam === recipient.trustToken;
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
  const mirrorInput = document.getElementById('mirror-input');
  const mirrorNext = document.getElementById('mirror-next');
  if (mirrorInput && mirrorNext) {
    mirrorInput.addEventListener('input', () => {
      mirrorNext.disabled = mirrorInput.value.trim().toLowerCase() !== 'to help them thrive';
    });
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

      await addWhisper({
        recipientId,
        senderId,
        senderGhost,
        text,
        admire: phaseData.admire,
        appreciate: phaseData.appreciate,
        wish: phaseData.wish,
      });

      await logOutbound({
        senderId,
        senderGhost,
        recipientId,
        recipientGhost: recipient.ghostName,
        text,
        status: 'sent',
      });

      await incrementRateLimit(senderId);

      showFinalMessage(
        'It has been received.',
        'Whether they are ready for it is theirs to decide.'
      );
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

      await incrementRateLimit(senderId);

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
    if (finalMsg) finalMsg.classList.remove('hidden');
  }

  // Start at first phase
  showPhase(0);
}

// --- UTILITIES ---

function showAnchorOverlay(message, callback) {
  const overlay = document.createElement('div');
  overlay.className = 'anchor-overlay';
  overlay.innerHTML = `<p class="font-serif text-text text-xl text-center max-w-xs">${message}</p>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  setTimeout(() => {
    overlay.classList.remove('visible');
    overlay.classList.add('fading');
    setTimeout(() => {
      overlay.remove();
      if (callback) callback();
    }, 600);
  }, 1500);
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
