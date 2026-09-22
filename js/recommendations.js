// Recomendaciones de manejo según los meses de mayor riesgo y la etapa del cultivo.
// Basadas en recomendaciones técnicas generales de Cenicafé / FNC; no reemplazan la visita técnica.
import { MONTHS } from './phenology.js';

const label = (m) => `${MONTHS[m.m]} ${String(m.y).slice(2)}`;
const list = (ms) => ms.map(label).join(', ');

export function recommendations(res, crop) {
  const out = [];
  const risky = (m) => m.Sd * m.pDry + m.Sh * m.pHot;
  const dry = res.months.filter((m) => m.pDry >= 0.35 && m.pDry > m.pDryNeutral + 0.08);
  const hot = res.months.filter((m) => m.pHot >= 0.35 && m.pHot > m.pHotNeutral + 0.08);
  const top = [...res.months].sort((a, b) => risky(b) - risky(a)).slice(0, 3).sort((a, b) => a.y * 12 + a.m - (b.y * 12 + b.m));
  const has = (ms, re) => ms.filter((m) => re.test(m.stage));

  out.push(`<strong>Meses críticos para su lote:</strong> ${list(top)} (mayor combinación de probabilidad de estrés y sensibilidad de la etapa).`);

  if (!res.significant) {
    out.push('Como la señal de El Niño no es significativa en su punto, priorice buenas prácticas generales y siga los boletines agroclimáticos del IDEAM y de la FNC en lugar de inversiones grandes específicas para El Niño.');
  }

  const est = has(dry, /Establecimiento|Levante/);
  if (est.length) {
    out.push(`<strong>Cultivo joven con alta probabilidad de sequía (${list(est)}):</strong> coloque cobertura muerta (residuos de arvenses, pulpa compostada) en el plato, establezca sombrío transitorio y prevea riego de auxilio. Si aún no ha sembrado, evite trasplantar en esos meses.`);
  }
  const zo = has(dry, /zoca|chupones/);
  if (zo.length) {
    out.push(`<strong>Zoca en meses secos (${list(zo)}):</strong> la raíz ya establecida da cierta tolerancia, pero conserve la cobertura del suelo y seleccione chupones una vez haya humedad suficiente.`);
  }
  if (crop.ageMonths > 84 && !crop.zoca) {
    out.push('Si planea zoquear, no lo haga justo antes de los meses de mayor riesgo: los chupones jóvenes y la pérdida de follaje aumentan la exposición del lote.');
  }
  const flo = has(dry, /Floración|Diferenciación/);
  if (flo.length) {
    out.push(`<strong>Floración bajo sequía (${list(flo)}):</strong> riesgo de floraciones dispersas y flores "estrella" (abortadas). Conserve la humedad del suelo: manejo integrado de arvenses, dejando arvenses nobles de porte bajo en las calles y limpiando solo el plato; evite desyerbas a ras o con herbicida de contacto en toda el área.`);
  }
  const fr = has(dry, /Expansión|Llenado/);
  if (fr.length) {
    out.push(`<strong>Desarrollo del fruto bajo déficit hídrico (${list(fr)}):</strong> es la etapa donde la sequía más reduce tamaño de grano y aumenta granos vanos o negros. Fraccione la fertilización y aplíquela solo con el suelo húmedo (sin lluvia se pierde el nitrógeno y no se absorbe el potasio).`);
  }
  const brocaMonths = res.months.filter((m) => m.pHot >= 0.3 && /Llenado|Maduración/.test(m.stage));
  if (brocaMonths.length) {
    out.push(`<strong>Broca (${list(brocaMonths)}):</strong> el calor acelera su ciclo. Haga muestreos mensuales de infestación (actúe si supera 2 %), recolecte a tiempo y haga repase ("re-re") de frutos maduros, sobremaduros y caídos.`);
  }
  if (hot.length && crop.elevation != null && crop.elevation < 1400) {
    out.push(`<strong>Finca baja (${Math.round(crop.elevation)} m) con meses calientes (${list(hot)}):</strong> el sombrío regulado reduce la temperatura del follaje; si no tiene, planifíquelo como adaptación de mediano plazo.`);
  }
  if (dry.length >= 4) {
    out.push('Con 4 o más meses de alta probabilidad de sequía, evalúe cosecha y almacenamiento de agua (reservorios, tanques) para el beneficio y el riego de auxilio de almácigos o lotes jóvenes.');
  }
  out.push('Registre la lluvia en su finca (pluviómetro) para comparar con este pronóstico y consulte a su extensionista del Comité de Cafeteros.');
  return out;
}
