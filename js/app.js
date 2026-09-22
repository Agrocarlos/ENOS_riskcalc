import { ONI, ONI_META } from '../data/oni.js';
import { buildDataset } from './climate.js';
import { oniTemplate, scenarioTrajectory, SCENARIOS } from './scenario.js';
import { sensitivityCalendar, patternFromLatitude, HARVEST_PATTERNS, MONTHS, cropDiagnosis } from './phenology.js';
import { computeRisk, analogs } from './risk.js';
import { DEPARTAMENTOS, fetchMonthlyClimate, fetchElevation, geocode, reverseGeocode } from './data.js';
import { recommendations } from './recommendations.js';

const $ = (id) => document.getElementById(id);
const state = { lat: null, lon: null, elevation: null, place: '', precision: '' };
let map, marker, chart;

const fmt = (v, d = 0) => v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `${fmt(100 * v)} %`;
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`;
const monthLabel = (y, m) => `${MONTHS[m]} ${String(y).slice(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function init() {
  $('dep').innerHTML = DEPARTAMENTOS.map((d) => `<option${d === 'Caldas' ? ' selected' : ''}>${d}</option>`).join('');
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const y0 = m >= 2 ? y : y - 1;
  $('year0').innerHTML = [y0 - 1, y0, y0 + 1].map((v) => `<option value="${v}"${v === y0 ? ' selected' : ''}>${v}–${String(v + 1).slice(2)}</option>`).join('');
  const next = new Date(y, m + 1, 1);
  $('start').value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;

  if (ONI_META.provisional) {
    const b = $('oni-warning');
    b.hidden = false;
    b.textContent = 'Aviso: la serie ONI embebida es provisional (no verificada contra NOAA CPC). El administrador debe ejecutar la acción "Actualizar ONI" del repositorio antes de usar resultados para decisiones.';
  }

  initMap();
  document.querySelectorAll('input[name=zoca]').forEach((r) => r.addEventListener('change', () => {
    $('zoca-fields').hidden = zocaSelected() === false;
    updateStageNow();
  }));
  ['age-y', 'age-m', 'zoca-y', 'zoca-m', 'pattern'].forEach((id) => $(id).addEventListener('input', updateStageNow));
  $('btn-search').addEventListener('click', onSearch);
  $('btn-gps').addEventListener('click', onGps);
  $('btn-run').addEventListener('click', run);
  $('muni').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(); });
  $('vereda').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(); });
  updateStageNow();
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([4.6, -74.5], 6);
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
  });
  osm.addTo(map);
  L.control.layers({ Mapa: osm, Satélite: sat }).addTo(map);
  map.on('click', (e) => setLocation(e.latlng.lat, e.latlng.lng, 'punto'));
}

async function setLocation(lat, lon, precision, label) {
  state.lat = lat; state.lon = lon; state.precision = precision;
  if (!marker) {
    marker = L.marker([lat, lon], { draggable: true }).addTo(map);
    marker.on('dragend', () => { const p = marker.getLatLng(); setLocation(p.lat, p.lng, 'punto'); });
  } else marker.setLatLng([lat, lon]);
  $('btn-run').disabled = false;
  $('loc-info').textContent = `Lat ${lat.toFixed(5)}, Lon ${lon.toFixed(5)} · consultando altitud…`;
  const [elev, place] = await Promise.all([fetchElevation(lat, lon), label ? Promise.resolve(label) : reverseGeocode(lat, lon)]);
  if (state.lat !== lat || state.lon !== lon) return; // el usuario movió el punto mientras tanto
  state.elevation = elev;
  state.place = place;
  const prec = precision === 'municipio' ? ' · ⚠ ubicación aproximada (centro del municipio): ajuste el marcador' : '';
  $('loc-info').textContent = `${place ? place + ' · ' : ''}Lat ${lat.toFixed(5)}, Lon ${lon.toFixed(5)}${elev != null ? ` · ${fmt(elev)} m s.n.m.` : ''}${prec}`;
  updateStageNow();
}

async function onSearch() {
  const muni = $('muni').value.trim();
  if (!muni) { setStatus('Escriba el municipio.', true); return; }
  setStatus('Buscando…');
  try {
    const r = await geocode($('dep').value, muni, $('vereda').value);
    map.fitBounds([[r.bbox[0], r.bbox[2]], [r.bbox[1], r.bbox[3]]]);
    if (r.precision === 'vereda') map.setView([r.lat, r.lon], 14);
    await setLocation(r.lat, r.lon, r.precision, r.label.split(',').slice(0, 3).join(','));
    setStatus(r.precision === 'vereda' ? 'Vereda encontrada. Ajuste el marcador a su lote si es necesario.'
      : ($('vereda').value.trim() ? 'No se encontró la vereda en OpenStreetMap; se ubicó el municipio. Toque el mapa sobre su finca.' : 'Municipio encontrado. Toque el mapa sobre su finca.'));
  } catch (e) {
    setStatus(e.message, true);
  }
}

function onGps() {
  if (!navigator.geolocation) { setStatus('Este dispositivo no permite geolocalización.', true); return; }
  setStatus('Obteniendo ubicación GPS…');
  navigator.geolocation.getCurrentPosition(
    (p) => { map.setView([p.coords.latitude, p.coords.longitude], 15); setLocation(p.coords.latitude, p.coords.longitude, 'gps'); setStatus('Ubicación GPS obtenida.'); },
    () => setStatus('No se pudo obtener el GPS. Ubique la finca en el mapa.', true),
    { enableHighAccuracy: true, timeout: 15000 },
  );
}

function zocaSelected() {
  return document.querySelector('input[name=zoca]:checked').value === 'si';
}

function readCrop() {
  const n = (id) => Math.max(0, parseInt($(id).value, 10) || 0);
  const ageMonths = n('age-y') * 12 + Math.min(11, n('age-m'));
  const zoca = zocaSelected();
  const monthsSinceZoca = n('zoca-y') * 12 + Math.min(11, n('zoca-m'));
  let pattern = $('pattern').value;
  if (pattern === 'auto') pattern = state.lat != null ? patternFromLatitude(state.lat) : 'centro';
  return { ageMonths, zoca, monthsSinceZoca, pattern, elevation: state.elevation };
}

function updateStageNow() {
  const crop = readCrop();
  const now = new Date();
  const [c] = sensitivityCalendar({ ...crop, ageMonths: crop.ageMonths - 1, monthsSinceZoca: crop.monthsSinceZoca - 1 },
    [{ y: now.getFullYear(), m: now.getMonth() }]);
  const pat = HARVEST_PATTERNS[crop.pattern].label;
  const auto = $('pattern').value === 'auto' ? ' (asignado por latitud; cámbielo si su finca es distinta)' : '';
  $('stage-now').innerHTML = `Etapa estimada hoy: <strong>${esc(c.stage)}</strong>. Patrón de cosecha: ${esc(pat)}${auto}.`;
}

function setStatus(msg, err = false) {
  $('status').textContent = msg;
  $('status').className = 'status' + (err ? ' err' : '');
}

async function run() {
  if (state.lat == null) return;
  const btn = $('btn-run');
  btn.disabled = true;
  try {
    setStatus('Descargando 75 años de clima diario (ERA5-Land) para su punto… puede tardar 10-30 s.');
    const clim = await fetchMonthlyClimate(state.lat, state.lon);
    setStatus('Ajustando modelos por mes y remuestreando (bootstrap, 1000 réplicas)…');
    await new Promise((r) => setTimeout(r, 30));

    const crop = readCrop();
    const scenKey = document.querySelector('input[name=scen]:checked').value;
    const customPeak = parseFloat($('peak').value);
    const peak = Number.isFinite(customPeak) ? customPeak : SCENARIOS[scenKey].peak;
    const year0 = parseInt($('year0').value, 10);
    const [sy, sm] = $('start').value.split('-').map(Number);

    const dataset = buildDataset(clim.monthly, ONI);
    const tpl = oniTemplate(ONI, 1.5);
    const traj = scenarioTrajectory(tpl, peak, year0, sy, sm - 1);
    const cal = sensitivityCalendar(crop, traj);
    const res = computeRisk(dataset, traj, cal);
    const an = analogs(dataset, tpl.events, traj, cal, year0);
    render({ res, an, crop, clim, peak, scenKey, customPeak, year0, traj });
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus(`No se pudo completar el cálculo: ${e.message}. Verifique su conexión e intente de nuevo.`, true);
  } finally {
    btn.disabled = false;
  }
}

function render(ctx) {
  const { res, an, crop, clim, peak, scenKey, customPeak, year0 } = ctx;
  const scenName = Number.isFinite(customPeak) ? `El Niño con pico ONI ${fmt(peak, 1)}` : SCENARIOS[scenKey].label;
  const first = res.months[0], last = res.months[res.months.length - 1];
  const period = `${monthLabel(first.y, first.m)} – ${monthLabel(last.y, last.m)}`;
  const verdict = res.significant
    ? `Con un escenario de ${scenName} el riesgo de su cafetal sube de ${fmt(res.ircNeutral)} a ${fmt(res.irc)} puntos (${signed(res.delta, 0)}). El aumento es <strong>estadísticamente significativo</strong> (bootstrap p = ${res.pBoot < 0.001 ? '< 0,001' : fmt(res.pBoot, 3)}; IC 90 % del aumento: ${signed(res.ciDelta[0], 0)} a ${signed(res.ciDelta[1], 0)}).`
    : `En esta ubicación la señal de El Niño <strong>no es estadísticamente significativa</strong> (bootstrap p = ${fmt(res.pBoot, 2)}): el aumento estimado (${signed(res.delta, 0)} puntos) no se distingue de la variabilidad natural. Esto no significa riesgo cero; significa que el historial de 75 años no muestra un efecto consistente de El Niño aquí.`;
  const notes = cropDiagnosis(crop);
  if (clim.model !== 'era5_land') notes.push('ERA5-Land no estuvo disponible; se usó ERA5 (0,25°), de menor resolución.');
  const recs = recommendations(res, crop);

  const rows = res.months.map((m) => {
    const sD = m.qSlopeD < 0.05 ? '<span class="sig" title="Señal ENOS significativa (FDR 5 %)">*</span>' : '<span class="ns-mark" title="Señal no significativa">ns</span>';
    const sT = m.qSlopeT < 0.05 ? '<span class="sig" title="Señal ENOS significativa (FDR 5 %)">*</span>' : '<span class="ns-mark" title="Señal no significativa">ns</span>';
    return `<tr>
      <td>${monthLabel(m.y, m.m)}</td><td>${fmt(m.oni, 1)}</td><td class="stage">${esc(m.stage)}</td>
      <td>${pct(m.pDry)} <small class="ns-mark">(${pct(m.pDryNeutral)})</small></td>
      <td>${signed(m.dPpct, 0)} % ${sD}</td>
      <td>${pct(m.pHot)} <small class="ns-mark">(${pct(m.pHotNeutral)})</small></td>
      <td>${signed(m.dTmax, 1)} °C ${sT}</td>
    </tr>`;
  }).join('');

  const anRows = an.filter((a) => a.available).sort((a, b) => b.peak - a.peak).map((a) => `<tr>
      <td>${a.year0}–${String(a.year0 + 1).slice(2)}</td><td>${fmt(a.peak, 1)}</td><td>${esc(a.class)}</td>
      <td>${fmt(a.ircObserved)}</td><td>${a.dryMonths} / 12</td><td>${a.hotMonths} / 12</td></tr>`).join('');

  const el = $('results');
  el.hidden = false;
  el.innerHTML = `
  <section class="card">
    <h2>Resultado · ${esc(scenName)} · ${period}</h2>
    <div class="hero">
      <div class="hero-num">
        <div class="v">${fmt(res.irc)}</div>
        <div class="of">Índice de Riesgo Climático para Café (0–100)</div>
        <div class="chip ${res.category.key}"><span class="dot" aria-hidden="true"></span>Riesgo ${res.category.label}</div>
      </div>
      <div>
        <div class="stats">
          <div class="stat"><div class="k">IC 90 % (bootstrap)</div><div class="v">${fmt(res.ci[0])} – ${fmt(res.ci[1])}</div></div>
          <div class="stat"><div class="k">Mismo cafetal, año neutro</div><div class="v">${fmt(res.ircNeutral)} <small>(${res.categoryNeutral.label})</small></div></div>
          <div class="stat"><div class="k">Riesgo relativo</div><div class="v">× ${fmt(res.ratio, 2)}</div></div>
          <div class="stat"><div class="k">Meses con señal significativa</div><div class="v">${res.nSigMonthsD} seq. · ${res.nSigMonthsT} calor</div></div>
        </div>
        <p class="verdict${res.significant ? '' : ' ns'}">${verdict}</p>
      </div>
    </div>
    ${notes.length ? `<ul class="hint">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <p class="hint">El índice es la probabilidad media, ponderada por la sensibilidad de cada etapa del cultivo, de que un mes sea anormalmente seco (balance hídrico de 3 meses en el 20 % más seco) o caliente (temperatura máxima en el 20 % más alto). En un clima sin cambios valdría ≈ 20.</p>

    <h3>Probabilidad de mes seco y caliente bajo el escenario</h3>
    <div class="legend">
      <span><i style="background:var(--series-1)"></i>Mes seco (déficit hídrico)</span>
      <span><i style="background:var(--series-2)"></i>Mes caliente (Tmax)</span>
      <span><i class="line" style="background:var(--muted)"></i>Referencia climatológica (20 %)</span>
    </div>
    <div class="chart-box"><canvas id="chart" aria-label="Probabilidad mensual de estrés bajo el escenario"></canvas></div>

    <h3>Detalle mensual</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Mes</th><th>ONI</th><th>Etapa del cultivo</th><th>P(mes seco)<br><small>(año neutro)</small></th><th>Cambio lluvia</th><th>P(mes caliente)<br><small>(año neutro)</small></th><th>Cambio Tmax</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint">* señal ENOS significativa en ese mes tras corrección por comparaciones múltiples (Benjamini-Hochberg, FDR 5 %); ns = no significativa.</p>

    <h3>¿Qué pasó en su finca en Niños fuertes anteriores?</h3>
    <p class="hint">Índice calculado con los datos <em>observados</em> en su punto, en la misma ventana de meses y con la misma etapa del cultivo. Sirve para contrastar el modelo con la realidad.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Evento</th><th>Pico ONI</th><th>Clase</th><th>Índice observado</th><th>Meses secos</th><th>Meses calientes</th></tr></thead>
      <tbody>${anRows || '<tr><td colspan="6">Sin eventos con datos completos.</td></tr>'}</tbody>
    </table></div>

    <h3>Recomendaciones para su lote</h3>
    <ul class="recs">${recs.map((r) => `<li>${r}</li>`).join('')}</ul>

    <div class="actions">
      <button class="secondary" type="button" id="btn-csv">Descargar CSV</button>
      <button class="secondary" type="button" onclick="window.print()">Imprimir / PDF</button>
    </div>

    <details class="method">
      <summary>Cómo se calcula (metodología)</summary>
      <h4>Datos</h4>
      <p>Clima diario ${clim.model === 'era5_land' ? 'ERA5-Land (≈9 km)' : 'ERA5 (≈28 km)'} de ${res.yearsRange[0]} a ${res.yearsRange[1]} en su punto: lluvia, evapotranspiración de referencia FAO-56 (ET0) y temperatura máxima. Índice ONI de NOAA${ONI_META.provisional ? ' (serie provisional)' : ` (actualizado ${ONI_META.updated})`}.</p>
      <h4>Amenaza</h4>
      <p>Para cada mes del año se ajusta una regresión <code>z = b0 + b1·ONI + b2·tendencia</code> sobre ${first.nYears} años, donde z es la anomalía estandarizada (normal 1991-2020) del balance hídrico de 3 meses (P − ET0, tipo SPEI-3) o de la Tmax. El término de tendencia separa el calentamiento de largo plazo del efecto de El Niño. La probabilidad de mes seco/caliente bajo el escenario se obtiene de la distribución empírica de residuos (sin suponer normalidad).</p>
      <h4>Vulnerabilidad fenológica</h4>
      <p>Cada mes recibe un peso de sensibilidad a sequía y a calor según la etapa del cultivo (establecimiento, levante, rebrote de zoca, floración, expansión, llenado, maduración), la edad del lote y la altitud (${state.elevation != null ? fmt(state.elevation) + ' m' : 'sin dato'}). Estos pesos provienen de la literatura agronómica (Camargo & Camargo 2001; DaMatta & Ramalho 2006; Arcila et al. 2007, Cenicafé) y son supuestos expertos, no estimados estadísticamente.</p>
      <h4>Significancia</h4>
      <p>Pendientes b1 con prueba t y control de falsos descubrimientos (Benjamini-Hochberg). Incertidumbre del índice por bootstrap de años completos (${res.nBoot} réplicas); p = proporción de réplicas en que el escenario no supera al año neutro.</p>
      <h4>Escenario</h4>
      <p>Trayectoria mensual del ONI = forma media de los ${tplCount()} Niños con pico ≥ 1,5 desde 1950, escalada a un pico de ${fmt(peak, 1)}, con año de desarrollo ${year0}.</p>
    </details>
  </section>`;

  $('btn-csv').addEventListener('click', () => downloadCsv(res));
  drawChart(res);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function tplCount() {
  return oniTemplate(ONI, 1.5).events.length;
}

function cssVar(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

function drawChart(res) {
  if (chart) chart.destroy();
  const labels = res.months.map((m) => monthLabel(m.y, m.m));
  const ink2 = cssVar('--ink-2'), line = cssVar('--line'), muted = cssVar('--muted'), surface = cssVar('--surface');
  chart = new Chart($('chart'), {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Mes seco', data: res.months.map((m) => 100 * m.pDry), backgroundColor: cssVar('--series-1'), borderRadius: 4, borderSkipped: 'start', borderColor: surface, borderWidth: { left: 1, right: 1 }, maxBarThickness: 22 },
        { type: 'bar', label: 'Mes caliente', data: res.months.map((m) => 100 * m.pHot), backgroundColor: cssVar('--series-2'), borderRadius: 4, borderSkipped: 'start', borderColor: surface, borderWidth: { left: 1, right: 1 }, maxBarThickness: 22 },
        { type: 'line', label: 'Climatología', data: labels.map(() => 20), borderColor: muted, borderWidth: 2, pointRadius: 0, pointHitRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (i) => i.datasetIndex < 2,
          callbacks: {
            title: (items) => `${items[0].label} · ${res.months[items[0].dataIndex].stage}`,
            label: (i) => {
              const m = res.months[i.dataIndex];
              return i.datasetIndex === 0
                ? `Seco: ${pct(m.pDry)} (neutro ${pct(m.pDryNeutral)})`
                : `Caliente: ${pct(m.pHot)} (neutro ${pct(m.pHotNeutral)})`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink2 }, border: { color: cssVar('--axis') } },
        y: { min: 0, max: 100, ticks: { color: ink2, callback: (v) => `${v} %` }, grid: { color: line }, border: { display: false } },
      },
    },
  });
}

function downloadCsv(res) {
  const head = ['anio', 'mes', 'oni', 'etapa', 'Sd', 'Sh', 'p_seco', 'p_seco_neutro', 'p_caliente', 'p_caliente_neutro', 'cambio_lluvia_pct', 'cambio_tmax_C', 'q_senal_seco', 'q_senal_calor'];
  const lines = res.months.map((m) => [m.y, m.m + 1, m.oni.toFixed(2), `"${m.stage}"`, m.Sd.toFixed(2), m.Sh.toFixed(2),
    m.pDry.toFixed(3), m.pDryNeutral.toFixed(3), m.pHot.toFixed(3), m.pHotNeutral.toFixed(3),
    m.dPpct.toFixed(1), m.dTmax.toFixed(2), m.qSlopeD.toFixed(4), m.qSlopeT.toFixed(4)].join(','));
  const meta = `# lat=${state.lat},lon=${state.lon},elev=${state.elevation},IRCC=${res.irc.toFixed(1)},IRCC_neutro=${res.ircNeutral.toFixed(1)},p_boot=${res.pBoot.toFixed(4)}`;
  const blob = new Blob([[meta, head.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'riesgo_cafe_el_nino.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

init();
