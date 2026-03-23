// nlp.js — Sentiment scoring and harm detection

// AFINN-style word scores (-5 to +5)
const AFINN = {
  // Strong positive
  'love': 3, 'wonderful': 3, 'beautiful': 3, 'amazing': 4, 'brilliant': 3,
  'excellent': 3, 'fantastic': 4, 'incredible': 4, 'outstanding': 4, 'superb': 3,
  'magnificent': 4, 'glorious': 3, 'radiant': 3, 'luminous': 3, 'inspired': 3,
  'inspiring': 3, 'gifted': 3, 'courageous': 3, 'generous': 3, 'kind': 2,
  'gentle': 2, 'warm': 2, 'caring': 2, 'compassionate': 3, 'empathetic': 3,
  'thoughtful': 2, 'creative': 2, 'talented': 3, 'strong': 2, 'resilient': 3,
  'brave': 3, 'honest': 2, 'genuine': 2, 'authentic': 2, 'wise': 2,
  'calm': 2, 'serene': 2, 'peaceful': 2, 'joyful': 3, 'happy': 3,
  'grateful': 3, 'thankful': 2, 'hopeful': 2, 'alive': 2, 'vibrant': 2,
  'energetic': 2, 'enthusiastic': 2, 'passionate': 2, 'devoted': 2, 'loyal': 2,
  'trust': 2, 'safe': 2, 'secure': 2, 'comfort': 2, 'cherish': 3,
  'admire': 3, 'appreciate': 2, 'respect': 2, 'honour': 2, 'celebrate': 2,
  'thrive': 3, 'flourish': 3, 'grow': 2, 'shine': 2, 'bloom': 2,
  'wonder': 2, 'awe': 2, 'delight': 3, 'joy': 3, 'bliss': 3,
  'grace': 2, 'elegant': 2, 'refined': 2, 'artful': 2, 'capable': 2,
  'remarkable': 3, 'exceptional': 3, 'extraordinary': 4, 'unique': 2, 'precious': 3,
  'meaningful': 2, 'significant': 2, 'powerful': 2, 'impactful': 2, 'profound': 2,

  // Mild positive
  'good': 1, 'nice': 1, 'fine': 1, 'pleasant': 1, 'like': 1,
  'enjoy': 1, 'interesting': 1, 'useful': 1, 'helpful': 1, 'smart': 1,
  'clever': 1, 'able': 1, 'skilled': 1, 'clean': 1, 'clear': 1,
  'fair': 1, 'sweet': 1, 'bright': 1, 'light': 1, 'open': 1,

  // Mild negative (hurt — allowed, not harm)
  'sad': -1, 'tired': -1, 'quiet': 0, 'distant': -1, 'withdrawn': -1,
  'missed': -1, 'absent': -1, 'lost': -1, 'uncertain': -1, 'unsure': -1,
  'confused': -1, 'overwhelmed': -2, 'struggling': -1, 'difficult': -1, 'hard': -1,
  'hurt': -2, 'pain': -2, 'lonely': -2, 'alone': -1, 'misunderstood': -2,
  'dismissed': -2, 'ignored': -2, 'invisible': -2, 'forgotten': -1, 'overlooked': -1,
  'disappointed': -2, 'disappointing': -2, 'frustrating': -2, 'frustrated': -2, 'annoyed': -1,
  'uncomfortable': -1, 'awkward': -1, 'uneasy': -1, 'anxious': -2, 'worried': -1,
  'nervous': -1, 'scared': -2, 'afraid': -2, 'fear': -2, 'doubt': -1,
  'broken': -2, 'fragile': -1, 'vulnerable': -1, 'exposed': -1, 'raw': -1,
  'empty': -2, 'hollow': -2, 'numb': -2, 'cold': -1, 'sharp': -1,
  'bitter': -2, 'heavy': -1, 'dark': -1, 'bleak': -2, 'grey': -1,
  'slow': -1, 'stuck': -1, 'stagnant': -1, 'blocked': -1, 'trapped': -2,
  'suffocating': -3, 'drowning': -2, 'sinking': -2, 'falling': -1, 'failing': -2,
  'wrong': -1, 'mistake': -1, 'error': -1, 'fail': -2, 'lack': -1,
  'miss': -1, 'wish': 0, 'regret': -2, 'guilt': -2, 'shame': -3,

  // Stronger negative (still allowed — discomfort is growth)
  'angry': -3, 'anger': -3, 'rage': -4, 'furious': -4, 'livid': -4,
  'hostile': -3, 'aggressive': -3, 'violent': -4, 'cruel': -4, 'selfish': -2,
  'arrogant': -2, 'reckless': -2, 'careless': -2, 'thoughtless': -2, 'dismissive': -2,
  'condescending': -3, 'patronising': -3, 'manipulative': -4, 'dishonest': -3, 'deceptive': -3,
  'cowardly': -2, 'weak': -1, 'pathetic': -3, 'useless': -3, 'worthless': -4,
  'terrible': -3, 'horrible': -3, 'awful': -3, 'dreadful': -3, 'disgusting': -4,
  'repulsive': -4, 'revolting': -4, 'vile': -4, 'nasty': -3, 'toxic': -4,

  // Very negative (approach harm threshold — check with containsHarm too)
  'hate': -4, 'despise': -4, 'loathe': -4, 'detest': -4, 'abhor': -4,
  'evil': -4, 'wicked': -4, 'corrupt': -3, 'sinister': -3, 'malicious': -4,
};

// Harm detection — slurs and hate speech patterns
// Only genuine slurs and dehumanising language; not strong but valid criticism
const HARM_PATTERNS = [
  /\bn[i1][g9][g9][ae3]r\b/i,
  /\bf[a@][g9][g9][o0]t\b/i,
  /\bf[a@][g9]\b/i,
  /\bc[u*][n*][t*]\b/i,
  /\bk[i1]k[e3]\b/i,
  /\bsp[i1][c(]k?\b/i,
  /\bch[i1]nk\b/i,
  /\btr[a@]nn[yi1][e3]?\b/i,
  /\br[e3]t[a@]rd\b/i,
  /\bgo\s*kill\s+yourself\b/i,
  /\bkill\s+yourself\b/i,
  /\byou\s+should\s+(die|be\s+dead)\b/i,
  /\bwh[o0]re\b/i,
  /\bsl[u*][t*]\b/i,
  /\bp[e3]d[o0](ph[i1]le)?\b/i,
  /\bj[e3]w[s]?\s+are\b/i,
  /\bsubhuman\b/i,
  /\bvermin\b/i,
  /\bparas[i1]te[s]?\b/i,
];

// Score sentiment — returns a numeric score
function scoreSentiment(text) {
  const words = text.toLowerCase().match(/\b[a-z']+\b/g) || [];
  return words.reduce((sum, word) => sum + (AFINN[word] || 0), 0);
}

// Check for actual harm (slurs/dehumanisation)
function containsHarm(text) {
  return HARM_PATTERNS.some(pattern => pattern.test(text));
}

// Velocity check — flags if large paste into a reflective space
function isVelocityPaste(text, elapsedMs) {
  const wordCount = (text.match(/\S+/g) || []).length;
  return wordCount > 60 && elapsedMs < 5000;
}

export { scoreSentiment, containsHarm, isVelocityPaste, AFINN };
