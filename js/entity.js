// entity.js — SHA-256 hashing, ghost name generation, sigil SVG generation

// SHA-256 using Web Crypto API
async function hashEmail(email) {
  const normalised = email.trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalised);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Ghost name word lists
const ADJECTIVES = [
  'Saffron','Velvet','Ember','Silver','Moss','Ashen','Quiet','Hollow','Amber','Sage',
  'Lunar','Fern','Tidal','Ivory','Dusk','Haze','Muted','Glacial','Lichen','Onyx',
  'Cobalt','Briar','Willow','Cinder','Flint','Wren','Slate','Pale','Thistle','Murk'
];

const NOUNS = [
  'Heron','Echo','Fern','Tide','Bloom','Wraith','Hollow','Ember','Drift','Shore',
  'Veil','Wisp','Gale','Stone','Crest','Thread','Lantern','Cairn','Mote','Canopy',
  'Lark','Reed','Brine','Plume','Ash','Solstice','Mantle','Rime','Bower','Knoll'
];

// Deterministic ghost name from hash
function getGhostName(hash) {
  const seg1 = parseInt(hash.substring(0, 4), 16);
  const seg2 = parseInt(hash.substring(4, 8), 16);
  const adj = ADJECTIVES[seg1 % ADJECTIVES.length];
  const noun = NOUNS[seg2 % NOUNS.length];
  return `${adj} ${noun}`;
}

// Generate a trust token (16 char hex)
function generateTrustToken() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate sigil SVG from explicit params
// circlesIn: how many circles this entity is a member of — adds outer orbit rings
function generateSigilFromParams({ rings, lines, rotation, innerRatio, sides, hue, circlesIn = 0 }, size = 80) {
  const hue2 = (hue + 137) % 360;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.42;
  const parts = [];

  // Orbit rings (faint outer rings showing how many circles this entity is in)
  // Tiers: 1=1 orbit, 3=2, 6=3, 10=4, 15=5
  const orbitTiers = [1, 3, 6, 10, 15];
  const orbitCount = orbitTiers.filter(t => circlesIn >= t).length;
  for (let i = 0; i < orbitCount; i++) {
    const r = (maxR + (size * 0.06) * (i + 1)).toFixed(2);
    const opacity = (0.12 - i * 0.02).toFixed(2);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="hsl(${hue},30%,70%)" stroke-width="0.5" stroke-dasharray="2 4" opacity="${opacity}"/>`);
  }

  for (let i = 0; i < rings; i++) {
    const r = maxR * ((i + 1) / rings);
    const opacity = (0.25 + (i / rings) * 0.35).toFixed(2);
    const h = (hue + i * 40) % 360;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="hsl(${h},40%,65%)" stroke-width="0.8" opacity="${opacity}"/>`);
  }

  for (let i = 0; i < lines; i++) {
    const angle = rotation + (i / lines) * 360;
    const rad = angle * Math.PI / 180;
    const x1 = (cx + Math.cos(rad) * maxR * innerRatio).toFixed(2);
    const y1 = (cy + Math.sin(rad) * maxR * innerRatio).toFixed(2);
    const x2 = (cx + Math.cos(rad) * maxR).toFixed(2);
    const y2 = (cy + Math.sin(rad) * maxR).toFixed(2);
    const h = (hue2 + i * 25) % 360;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="hsl(${h},35%,60%)" stroke-width="0.7" opacity="0.5"/>`);
  }

  const polyR = maxR * innerRatio * 0.8;
  const polyPoints = Array.from({ length: sides }, (_, i) => {
    const a = (rotation + (i / sides) * 360) * Math.PI / 180;
    return `${(cx + Math.cos(a) * polyR).toFixed(2)},${(cy + Math.sin(a) * polyR).toFixed(2)}`;
  });
  parts.push(`<polygon points="${polyPoints.join(' ')}" fill="none" stroke="hsl(${hue},45%,70%)" stroke-width="0.9" opacity="0.6"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="1.5" fill="hsl(${hue2},50%,70%)" opacity="0.8"/>`);

  // Expand viewBox to show orbits if present
  const padding = orbitCount > 0 ? size * 0.06 * orbitCount + 4 : 0;
  const vbSize = size + padding * 2;
  const vbOffset = -padding;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vbOffset.toFixed(1)} ${vbOffset.toFixed(1)} ${vbSize.toFixed(1)} ${vbSize.toFixed(1)}">${parts.join('')}</svg>`;
}

// Default params seeded from hash (used when no custom params stored)
function defaultSigilParams(hash) {
  const seg = (s, l) => parseInt(hash.substring(s, s + l), 16);
  return {
    rings:      2 + (seg(0, 2) % 3),
    lines:      3 + (seg(2, 2) % 5),
    rotation:   Math.round((seg(4, 2) / 255) * 360),
    innerRatio: parseFloat((0.3 + (seg(6, 2) / 255) * 0.25).toFixed(3)),
    sides:      3 + (seg(10, 2) % 4),
    hue:        seg(8, 3) % 360,
  };
}

// Generate sigil from hash (delegates to generateSigilFromParams)
function generateSigil(hash, size = 80, storedParams = null) {
  return generateSigilFromParams(storedParams || defaultSigilParams(hash), size);
}

export { hashEmail, getGhostName, generateTrustToken, generateSigil, generateSigilFromParams, defaultSigilParams };
