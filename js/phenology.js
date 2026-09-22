// Fenología del café arábica y sensibilidad a déficit hídrico (Sd) y a calor (Sh) por mes.
//
// Pesos de sensibilidad (0-1): síntesis de literatura, NO estimados estadísticamente:
//  - Camargo & Camargo (2001) Bragantia 60(1): fases fenológicas del café arábica; déficit
//    hídrico crítico en floración, expansión ("chumbinho") y llenado del grano.
//  - DaMatta & Ramalho (2006) Braz. J. Plant Physiol. 18(1): sequía y temperatura en café.
//  - Arcila et al. (2007) Cenicafé, "Sistemas de producción de café en Colombia": ciclo
//    floración-cosecha ≈ 32 semanas; distribución de cosecha según latitud.
//  - Jaramillo et al. (2009, 2011) PLoS ONE: temperatura y desarrollo de la broca
//    (Hypothenemus hampei); más generaciones por año con +1 °C.
// Son parámetros explícitos y editables; ver README (sección limitaciones).

export const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Etapas reproductivas relativas al mes de floración F (desfase en meses).
const REPRO = [
  { from: -2, to: -1, name: 'Diferenciación floral / latencia de yemas', Sd: 0.3, Sh: 0.4 },
  { from: 0, to: 0, name: 'Floración', Sd: 0.85, Sh: 0.9 },
  { from: 1, to: 3, name: 'Expansión del fruto', Sd: 1.0, Sh: 0.6 },
  { from: 4, to: 5, name: 'Llenado del grano', Sd: 0.9, Sh: 0.75 },
  { from: 6, to: 8, name: 'Maduración y cosecha', Sd: 0.45, Sh: 0.8 },
];
const VEGETATIVE = { name: 'Crecimiento vegetativo', Sd: 0.35, Sh: 0.3 };

// Etapas no productivas.
const JUVENILE = [
  { max: 6, name: 'Establecimiento (post-trasplante)', Sd: 1.0, Sh: 0.6 },
  { max: 18, name: 'Levante (sin producción)', Sd: 0.75, Sh: 0.45 },
];
const ZOCA = [
  { max: 6, name: 'Rebrote de zoca', Sd: 0.55, Sh: 0.4 },
  { max: 18, name: 'Desarrollo de chupones (sin producción)', Sd: 0.5, Sh: 0.35 },
];
export const FIRST_HARVEST_MONTHS = 18;

// Patrones de cosecha (mes pico de cosecha 0-11 y peso relativo del ciclo).
export const HARVEST_PATTERNS = {
  norte: { label: 'Una cosecha principal (Oct–Dic)', cycles: [{ harvest: 10, w: 1.0 }] },
  centro: { label: 'Principal Oct–Dic + mitaca Abr–Jun', cycles: [{ harvest: 10, w: 1.0 }, { harvest: 4, w: 0.6 }] },
  sur: { label: 'Principal Abr–Jun + traviesa Oct–Dic', cycles: [{ harvest: 5, w: 1.0 }, { harvest: 10, w: 0.5 }] },
};

// Aproximación por latitud (Arcila et al. 2007): norte >7°N, centro 3.5–7°N, sur <3.5°N.
export function patternFromLatitude(lat) {
  if (lat >= 7) return 'norte';
  if (lat >= 3.5) return 'centro';
  return 'sur';
}

const FLOWER_TO_HARVEST = 8; // meses (~32 semanas)

function reproStage(calMonth, cycles) {
  let best = { ...VEGETATIVE, Sd: VEGETATIVE.Sd, Sh: VEGETATIVE.Sh };
  for (const c of cycles) {
    const F = (c.harvest - FLOWER_TO_HARVEST + 12) % 12;
    let off = (calMonth - F + 12) % 12;
    if (off > 8) off -= 12; // -3..8
    const st = REPRO.find((s) => off >= s.from && off <= s.to);
    if (!st) continue;
    const Sd = Math.max(VEGETATIVE.Sd, st.Sd * c.w);
    const Sh = Math.max(VEGETATIVE.Sh, st.Sh * c.w);
    if (Sd + Sh > best.Sd + best.Sh) {
      best = { name: st.name + (c.w < 1 ? ' (mitaca/traviesa)' : ''), Sd, Sh };
    }
  }
  return best;
}

// Modificador de sensibilidad al calor por altitud: los cafetales bajos operan más cerca
// del límite térmico del arábica (óptimo ~18-22 °C media).
export function altitudeHeatFactor(elev) {
  if (elev == null) return 1;
  if (elev < 1300) return 1.25;
  if (elev > 1700) return 0.85;
  return 1;
}

/**
 * crop: { ageMonths, zoca: bool, monthsSinceZoca, pattern: 'norte'|'centro'|'sur', elevation }
 * months: [{y, m}] meses de proyección.
 * Devuelve por mes: { stage, Sd, Sh, age }
 */
export function sensitivityCalendar(crop, months) {
  const cycles = HARVEST_PATTERNS[crop.pattern].cycles;
  const hf = altitudeHeatFactor(crop.elevation);
  return months.map(({ y, m }, i) => {
    const age = (crop.zoca ? crop.monthsSinceZoca : crop.ageMonths) + i + 1;
    const table = crop.zoca ? ZOCA : JUVENILE;
    let st;
    let mod = 1;
    if (age < FIRST_HARVEST_MONTHS) {
      st = table.find((s) => age < s.max) || table[table.length - 1];
    } else {
      st = reproStage(m, cycles);
      // Primer año productivo: raíces aún superficiales en siembra nueva.
      if (!crop.zoca && age < 30) mod = 1.1;
      // Cafetal envejecido (>7 años desde siembra o >5 desde zoca): menor vigor.
      if ((!crop.zoca && age > 84) || (crop.zoca && age > 60)) mod = 1.1;
    }
    return {
      y, m, age,
      stage: st.name,
      Sd: Math.min(1, st.Sd * mod),
      Sh: Math.min(1, st.Sh * mod * hf),
    };
  });
}

export function cropDiagnosis(crop) {
  const notes = [];
  const total = crop.ageMonths;
  if (crop.zoca) {
    if (crop.monthsSinceZoca > 60) notes.push('Más de 5 años desde la zoca: productividad en declive, planifique renovación.');
  } else if (total > 84) {
    notes.push('Cafetal de más de 7 años sin zoca: vigor reducido; la renovación (zoca o siembra) es prioritaria, pero evite hacerla justo antes de los meses de mayor riesgo.');
  }
  if (crop.elevation != null && (crop.elevation < 1000 || crop.elevation > 2300)) {
    notes.push(`Altitud ${Math.round(crop.elevation)} m fuera de la franja típica del café en Colombia (1000–2300 m): interprete con cautela.`);
  }
  return notes;
}
