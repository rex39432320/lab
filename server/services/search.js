// Offline semantic equipment search: weighted field matching, prefix matching and
// concept-group expansion ("signal" ~ oscilloscope). Works with or without an LLM.

const CONCEPTS = [
  ['microcontroller', 'mcu', 'arduino', 'stm32', 'esp32', 'embedded', 'firmware', 'dev', 'kit', 'board'],
  ['oscilloscope', 'scope', 'waveform', 'signal', 'probe', 'debug', 'debugging', 'analog', 'measurement'],
  ['wireless', 'wifi', 'bluetooth', 'rf', 'radio', 'antenna', '5g', 'sdr', 'iot', 'spectrum'],
  ['3d', 'printing', 'print', 'printer', 'prototype', 'additive', 'pla', 'resin'],
  ['robot', 'robotic', 'arm', 'automation', 'cobot', 'manipulator', 'ros', 'autonomous', 'navigation'],
  ['ai', 'ml', 'machine', 'learning', 'deep', 'neural', 'gpu', 'cuda', 'inference', 'vision', 'training', 'edge'],
  ['microscope', 'imaging', 'cell', 'cells', 'fluorescence', 'sem', 'afm', 'nanostructure', 'surface', 'nanoscale'],
  ['dna', 'pcr', 'gene', 'genetic', 'crispr', 'molecular', 'amplification', 'protein', 'gel'],
  ['chemical', 'chemistry', 'spectroscopy', 'absorbance', 'chromatography', 'analysis', 'solvent', 'nanoparticle', 'uv'],
  ['pcb', 'circuit', 'solder', 'soldering', 'rework', 'smd', 'assembly', 'milling'],
  ['laser', 'cutting', 'engraving', 'cnc', 'machining', 'fabrication', 'acrylic'],
  ['strength', 'tensile', 'stress', 'materials', 'compression', 'testing'],
  ['fpga', 'verilog', 'vhdl', 'hardware', 'logic', 'xilinx'],
  ['drone', 'uav', 'quadcopter', 'flight', 'aerial', 'px4'],
  ['simulation', 'hpc', 'cfd', 'compute', 'parallel', 'matlab', 'ansys'],
  ['optics', 'photonics', 'interferometer', 'lens', 'alignment', 'laser'],
  ['cad', 'eda', 'design', 'solidworks', 'altium'],
  ['vr', 'ar', 'xr', 'immersive', 'headset', 'unity'],
  ['power', 'supply', 'voltage', 'current', 'bench'],
  ['sterile', 'biosafety', 'culture', 'bacteria', 'cabinet'],
];

const STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'we', 'my', 'our', 'need', 'want', 'to', 'for', 'of', 'in', 'on', 'with', 'and', 'or',
  'is', 'are', 'be', 'can', 'do', 'it', 'that', 'this', 'using', 'use', 'looking', 'find', 'me', 'some', 'any',
  'project', 'something', 'equipment', 'lab', 'help', 'how', 'what', 'which', 'would', 'like', 'build', 'building',
  'make', 'making', 'book', 'get', 'have', 'has', 'about', 'from', 'into', 'work', 'working',
]);

export const tokenize = (text) =>
  String(text).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t));

const conceptIndex = new Map();
for (const group of CONCEPTS) for (const word of group) conceptIndex.set(word, [...(conceptIndex.get(word) ?? []), group]);

function expand(tokens) {
  const direct = new Set(tokens);
  const related = new Set();
  for (const t of direct) for (const group of conceptIndex.get(t) ?? []) for (const w of group) if (!direct.has(w)) related.add(w);
  return { direct, related };
}

function indexOf(eq) {
  return {
    name: new Set(tokenize(eq.name)),
    tags: new Set(eq.tags.flatMap(tokenize)),
    category: new Set(tokenize(eq.category)),
    department: new Set(tokenize(`${eq.department} ${eq.location}`)),
    text: new Set(tokenize(`${eq.description} ${eq.specs.join(' ')}`)),
  };
}

const FIELD_WEIGHTS = { name: 3, tags: 2.5, category: 2, department: 1, text: 1 };

function scoreToken(idx, token, factor) {
  let score = 0;
  let hit = false;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    if (idx[field].has(token)) {
      score += weight * factor;
      hit = true;
    } else if (token.length >= 4 && [...idx[field]].some((w) => w.startsWith(token) || (w.length >= 4 && token.startsWith(w)))) {
      score += weight * factor * 0.6;
      hit = true;
    }
  }
  return { score, hit };
}

/**
 * Rank equipment against a free-text query.
 * @returns {{equipment: object, score: number, matched: string[]}[]}
 */
export function searchEquipment(equipment, query, { extraKeywords = [], limit = 12, minScore = 1.4 } = {}) {
  const tokens = [...tokenize(query), ...extraKeywords.flatMap(tokenize)];
  if (!tokens.length) return [];
  const { direct, related } = expand(tokens);
  const results = [];
  for (const eq of equipment) {
    const idx = indexOf(eq);
    let total = 0;
    const matched = new Set();
    for (const t of direct) {
      const { score, hit } = scoreToken(idx, t, 1);
      total += score;
      if (hit) matched.add(t);
    }
    for (const t of related) {
      const { score, hit } = scoreToken(idx, t, 0.35);
      total += score;
      if (hit && matched.size < 6) matched.add(t);
    }
    if (total >= minScore) results.push({ equipment: eq, score: Math.round(total * 100) / 100, matched: [...matched].slice(0, 5) });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
