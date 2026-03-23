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

// Generate a deterministic sigil SVG from hash
function generateSigil(hash, size = 80) {
  // Parse hash segments into design parameters
  const seg = (start, len) => parseInt(hash.substring(start, start + len), 16);

  const numRings = 2 + (seg(0, 2) % 3);       // 2–4 rings
  const numLines = 3 + (seg(2, 2) % 5);       // 3–7 lines
  const rotation = (seg(4, 2) / 255) * 360;   // 0–360 deg
  const innerRatio = 0.3 + (seg(6, 2) / 255) * 0.25; // 0.3–0.55

  // Colours from hash
  const hue1 = seg(8, 3) % 360;
  const hue2 = (hue1 + 137) % 360; // golden angle offset

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.42;

  let svgParts = [];

  // Rings
  for (let i = 0; i < numRings; i++) {
    const r = maxR * ((i + 1) / numRings);
    const opacity = 0.25 + (i / numRings) * 0.35;
    const hue = (hue1 + i * 40) % 360;
    svgParts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="hsl(${hue},40%,65%)" stroke-width="0.8" opacity="${opacity.toFixed(2)}"/>`
    );
  }

  // Radiating lines
  for (let i = 0; i < numLines; i++) {
    const angle = rotation + (i / numLines) * 360;
    const rad = (angle * Math.PI) / 180;
    const x1 = cx + Math.cos(rad) * maxR * innerRatio;
    const y1 = cy + Math.sin(rad) * maxR * innerRatio;
    const x2 = cx + Math.cos(rad) * maxR;
    const y2 = cy + Math.sin(rad) * maxR;
    const hue = (hue2 + i * 25) % 360;
    svgParts.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="hsl(${hue},35%,60%)" stroke-width="0.7" opacity="0.5"/>`
    );
  }

  // Central polygon (triangle, square, pentagon, or hexagon based on hash)
  const sides = 3 + (seg(10, 2) % 4); // 3–6 sides
  const polyR = maxR * innerRatio * 0.8;
  const polyAngle = (seg(12, 2) / 255) * 360;
  const polyPoints = [];
  for (let i = 0; i < sides; i++) {
    const a = ((polyAngle + (i / sides) * 360) * Math.PI) / 180;
    polyPoints.push(`${(cx + Math.cos(a) * polyR).toFixed(2)},${(cy + Math.sin(a) * polyR).toFixed(2)}`);
  }
  svgParts.push(
    `<polygon points="${polyPoints.join(' ')}" fill="none" stroke="hsl(${hue1},45%,70%)" stroke-width="0.9" opacity="0.6"/>`
  );

  // Central dot
  svgParts.push(
    `<circle cx="${cx}" cy="${cy}" r="1.5" fill="hsl(${hue2},50%,70%)" opacity="0.8"/>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${svgParts.join('')}</svg>`;
}

export { hashEmail, getGhostName, generateTrustToken, generateSigil };
