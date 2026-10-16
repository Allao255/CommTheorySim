// Interface: estado, controles, gráficos e ligação com os simuladores
// analógico (analog.js) e digital (digital.js).

// ---------- Estado ----------

const state = {
  scheme: 'am',
  fc: 10000,
  Ac: 1,
  phi0: 0,
  // analógico
  msg: { type: 'sine', fm: 500, fm2: 1200, a2: 0.5, W: 5000 },
  am: { variant: 'am', mu: 0.5, phaseErr: 0 },
  fm: { mode: 'fm', dev: 1000, kp: 2 },
  // digital
  Rb: 1000,
  bitMode: 'random',
  pattern: '1011001110001011',
  seed: 1,
  ask: { m: 1, pulse: 'rect', beta: 0.35 },
  fsk: { dev: 250, phase: 'continuous', pulse: 'rect', BT: 0.3, dtheta: 90 },
  noise: { on: false, EbN0dB: 15, gammaDb: 20 },
  specView: 'tx',
  specScale: 'db',
  // Analisador de espectro (estilo GNU Radio: FFT janelada, Blackman-Harris)
  an: { mode: 'analyzer', win: 'bh', nfft: 16384, pad: 1, avg: 4 },
  showTheory: true,
};

const ANALOG = ['am', 'fm'], DIGITAL = ['ask', 'fsk'];
const isAnalog = () => ANALOG.includes(state.scheme);

// ---------- Definição dos controles ----------

const toneBeta = () => state.fm.mode === 'pm' ? state.fm.kp : state.fm.dev / state.msg.fm;

const controls = [
  { group: 'Portadora' },
  { key: 'fc', label: 'Frequência da portadora fc', min: 1000, max: 40000, step: 100, fmt: (v) => fmtSI(v, 'Hz') },
  { key: 'Ac', label: 'Amplitude Ac', min: 0.1, max: 2, step: 0.05, fmt: (v) => fmtSI(v, 'V') },
  { key: 'phi0', label: 'Fase inicial φ₀', min: 0, max: 360, step: 5, fmt: (v) => `${v}°` },

  { group: 'Mensagem m(t)', scheme: ANALOG },
  { key: 'msg.type', label: 'Forma de onda', type: 'select', options: [
    ['sine', 'Tom senoidal'], ['two', 'Dois tons'], ['tri', 'Triangular (5 harmônicos)'], ['square', 'Quadrada (5 harmônicos)'],
  ] },
  { key: 'msg.fm', label: 'Frequência fm', min: 100, max: 5000, step: 10, fmt: (v) => fmtSI(v, 'Hz'),
    help: () => state.msg.type === 'tri' || state.msg.type === 'square' ? `harmônicos até 9·fm = ${fmtSI(9 * state.msg.fm, 'Hz')} · |m|máx = 1` : 'm(t) normalizada: |m|máx = 1' },
  { key: 'msg.W', label: 'Banda do canal W', min: 1000, max: 20000, step: 100, fmt: (v) => fmtSI(v, 'Hz'),
    help: () => 'filtro pós-detecção do receptor e referência de γ (ex.: 5 kHz rádio AM, 15 kHz FM)' },
  { key: 'msg.fm2', label: 'Frequência do 2º tom', min: 100, max: 5000, step: 10, fmt: (v) => fmtSI(v, 'Hz'), show: () => state.msg.type === 'two' },
  { key: 'msg.a2', label: 'Amplitude relativa do 2º tom', min: 0, max: 1, step: 0.05, fmt: (v) => v.toFixed(2), show: () => state.msg.type === 'two' },

  { group: 'AM — modulação em amplitude', scheme: 'am' },
  { key: 'am.variant', label: 'Tipo', type: 'select', options: [
    ['am', 'AM convencional (DSB com portadora)'], ['dsbsc', 'DSB-SC (portadora suprimida)'],
    ['usb', 'SSB — banda lateral superior'], ['lsb', 'SSB — banda lateral inferior'],
  ] },
  { key: 'am.mu', label: 'Índice de modulação μ', min: 0, max: 2, step: 0.01, fmt: (v) => `${v.toFixed(2)} (${Math.round(v * 100)}%)`,
    show: () => state.am.variant === 'am',
    help: () => state.am.mu > 1 ? 'μ > 1: sobremodulação!' : state.am.mu === 1 ? 'μ = 1: modulação de 100%' : '' },
  { key: 'am.phaseErr', label: 'Erro de fase do oscilador local θe', min: 0, max: 180, step: 1, fmt: (v) => `${v}°`,
    show: () => state.am.variant !== 'am', help: () => 'detecção coerente: 2·r(t)·cos(ωc t + φ₀ + θe) → passa-baixas' },

  { group: 'FM — modulação angular', scheme: 'fm' },
  { presets: [
    ['FM banda estreita β = 0,2', () => { state.fm.mode = 'fm'; state.msg.type = 'sine'; state.fm.dev = 0.2 * state.msg.fm; }],
    ['β = 2,405 (J₀ = 0)', () => { state.fm.mode = 'fm'; state.msg.type = 'sine'; state.fm.dev = 2.4048 * state.msg.fm; }],
    ['β = 5 (banda larga)', () => { state.fm.mode = 'fm'; state.msg.type = 'sine'; state.fm.dev = 5 * state.msg.fm; }],
  ], scheme: 'fm' },
  { key: 'fm.mode', label: 'Tipo', type: 'select', options: [['fm', 'FM (frequência ∝ m)'], ['pm', 'PM (fase ∝ m)']] },
  { key: 'fm.dev', label: 'Desvio de frequência de pico Δf', min: 10, max: 10000, step: 10, fmt: (v) => fmtSI(v, 'Hz', 4),
    show: () => state.fm.mode === 'fm',
    help: () => state.msg.type === 'sine' ? `β = Δf/fm = ${toneBeta().toFixed(3)}` : `razão de desvio D = Δf/W = ${(state.fm.dev / state.msg.W).toFixed(3)}` },
  { key: 'fm.kp', label: 'Desvio de fase de pico kp', min: 0.05, max: 10, step: 0.05, fmt: (v) => `${v.toFixed(2)} rad`,
    show: () => state.fm.mode === 'pm', help: () => state.msg.type === 'sine' ? `β = kp = ${state.fm.kp.toFixed(2)} (tom)` : '' },

  { group: 'Dados', scheme: DIGITAL },
  { key: 'Rb', label: 'Taxa de bits Rb', min: 100, max: 5000, step: 50, fmt: (v) => fmtSI(v, 'bit/s'), help: () => `Tb = ${fmtSI(1 / state.Rb, 's')}` },
  { key: 'bitMode', label: 'Sequência de bits', type: 'select', options: [
    ['random', 'Aleatória (equiprovável)'], ['prbs9', 'PRBS-9 (x⁹+x⁵+1)'], ['alt', 'Alternada 1010…'], ['custom', 'Personalizada (repete)'],
  ] },
  { key: 'pattern', label: 'Padrão personalizado', type: 'text', show: () => state.bitMode === 'custom' },
  { key: 'seed', label: 'Semente', min: 1, max: 50, step: 1, fmt: (v) => v, show: () => state.bitMode === 'random' },

  { group: 'ASK — chaveamento de amplitude', scheme: 'ask' },
  { key: 'ask.m', label: 'Índice de modulação m', min: 0, max: 1.5, step: 0.01, fmt: (v) => v.toFixed(2),
    help: () => state.ask.m === 1 ? 'm = 1 → OOK (liga/desliga)' : state.ask.m > 1 ? 'sobremodulação' : `níveis: ${fmtSI(state.Ac * (1 - state.ask.m), 'V')} / ${fmtSI(state.Ac * (1 + state.ask.m), 'V')}` },
  { key: 'ask.pulse', label: 'Formatação do pulso', type: 'select', options: [['rect', 'Retangular (NRZ)'], ['rc', 'Cosseno levantado']] },
  { key: 'ask.beta', label: 'Roll-off β', min: 0, max: 1, step: 0.05, fmt: (v) => v.toFixed(2), show: () => state.ask.pulse === 'rc' },

  { group: 'FSK — chaveamento de frequência', scheme: 'fsk' },
  { presets: [
    ['MSK (h = ½)', () => { state.fsk.dev = state.Rb / 4; state.fsk.phase = 'continuous'; state.fsk.pulse = 'rect'; }],
    ['Sunde (h = 1)', () => { state.fsk.dev = state.Rb / 2; state.fsk.phase = 'continuous'; state.fsk.pulse = 'rect'; }],
    ['GMSK BT=0,3', () => { state.fsk.dev = state.Rb / 4; state.fsk.phase = 'continuous'; state.fsk.pulse = 'gauss'; state.fsk.BT = 0.3; }],
  ], scheme: 'fsk' },
  { key: 'fsk.dev', label: 'Desvio de frequência Δf', min: 25, max: 5000, step: 25, fmt: (v) => fmtSI(v, 'Hz'),
    help: () => `f₁ = ${fmtSI(state.fc - state.fsk.dev, 'Hz')}, f₂ = ${fmtSI(state.fc + state.fsk.dev, 'Hz')} · h = 2ΔfTb = ${(2 * state.fsk.dev / state.Rb).toFixed(3)}` },
  { key: 'fsk.phase', label: 'Fase', type: 'select', options: [['continuous', 'Contínua (CPFSK, VCO)'], ['discontinuous', 'Descontínua (chaveia 2 osciladores)']] },
  { key: 'fsk.dtheta', label: 'Fase relativa θ₂ − θ₁', min: 0, max: 180, step: 5, fmt: (v) => `${v}°`, show: () => state.fsk.phase === 'discontinuous' },
  { key: 'fsk.pulse', label: 'Pulso de frequência', type: 'select', options: [['rect', 'Retangular'], ['gauss', 'Gaussiano (GFSK)']], show: () => state.fsk.phase === 'continuous' },
  { key: 'fsk.BT', label: 'Produto BT do filtro', min: 0.1, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2), show: () => state.fsk.phase === 'continuous' && state.fsk.pulse === 'gauss' },

  { group: 'Canal' },
  { key: 'noise.on', label: 'Ruído AWGN', type: 'check' },
  { key: 'noise.gammaDb', label: 'γ = Pₛ/(N₀W)', min: -5, max: 60, step: 0.5, fmt: (v) => `${v} dB`,
    show: () => state.noise.on && isAnalog(), help: () => 'SNR de referência: potência recebida / ruído na banda da mensagem' },
  { key: 'noise.EbN0dB', label: 'Eb/N₀', min: -5, max: 40, step: 0.5, fmt: (v) => `${v} dB`, show: () => state.noise.on && !isAnalog() },
];

const get = (k) => k.split('.').reduce((o, p) => o[p], state);
const set = (k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((o, p) => o[p], state)[last] = v; };
const inScheme = (s) => !s || [].concat(s).includes(state.scheme);

const ctlEls = [];

function buildControls() {
  const root = document.getElementById('controls');
  let groupEl = null;
  for (const c of controls) {
    if (c.group) {
      groupEl = document.createElement('div');
      groupEl.className = 'group';
      groupEl.innerHTML = `<h3>${c.group}</h3>`;
      root.append(groupEl);
      ctlEls.push({ c, el: groupEl });
      continue;
    }
    const el = document.createElement('div');
    if (c.presets) {
      el.className = 'presets';
      for (const [name, fn] of c.presets) {
        const b = document.createElement('button');
        b.className = 'btn small'; b.textContent = name;
        b.onclick = () => { fn(); syncControls(); schedule(); };
        el.append(b);
      }
      groupEl.append(el);
      ctlEls.push({ c, el });
      continue;
    }
    el.className = 'ctl';
    let input;
    if (c.type === 'select') {
      el.innerHTML = `<div class="row"><label>${c.label}</label></div>`;
      input = document.createElement('select');
      for (const [v, t] of c.options) input.add(new Option(t, v));
      input.onchange = () => { set(c.key, input.value); syncControls(); schedule(); };
    } else if (c.type === 'text') {
      el.innerHTML = `<div class="row"><label>${c.label}</label></div>`;
      input = document.createElement('input'); input.type = 'text';
      input.oninput = () => { set(c.key, input.value); schedule(); };
    } else if (c.type === 'check') {
      const lab = document.createElement('label'); lab.className = 'chk';
      input = document.createElement('input'); input.type = 'checkbox';
      lab.append(input, document.createTextNode(' ' + c.label));
      el.append(lab);
      input.onchange = () => { set(c.key, input.checked); syncControls(); schedule(); };
    } else {
      el.innerHTML = `<div class="row"><label>${c.label}</label><span class="val"></span></div>`;
      input = document.createElement('input'); input.type = 'range';
      input.min = c.min; input.max = c.max; input.step = c.step;
      input.oninput = () => { set(c.key, +input.value); syncControls(); schedule(); };
    }
    if (c.type !== 'check') el.append(input);
    const help = document.createElement('div'); help.className = 'help';
    el.append(help);
    groupEl.append(el);
    ctlEls.push({ c, el, input, help, val: el.querySelector('.val') });
  }
}

function syncControls() {
  let groupOk = true;
  for (const e of ctlEls) {
    const { c, el } = e;
    if (c.group) { groupOk = inScheme(c.scheme); el.style.display = groupOk ? '' : 'none'; continue; }
    el.style.display = groupOk && inScheme(c.scheme) && (!c.show || c.show()) ? '' : 'none';
    if (!e.input) continue;
    const v = get(c.key);
    if (c.type === 'check') e.input.checked = v;
    else if (document.activeElement !== e.input || c.type === 'select') e.input.value = v;
    if (e.val) e.val.textContent = c.fmt ? c.fmt(v) : v;
    e.help.textContent = c.help ? c.help() : '';
  }
}

// ---------- Gráficos ----------

const timeBox = document.getElementById('timePlots');
const freqBox = document.getElementById('freqPlots');
const pMsg = new Plot(timeBox, { title: 'Mensagem m(t)', height: 130, xUnit: 's' });
const pCar = new Plot(timeBox, { title: 'Portadora c(t)', yUnit: 'V', height: 120, xUnit: 's' });
const pMod = new Plot(timeBox, { title: 'Sinal modulado s(t)', yUnit: 'V', height: 190, xUnit: 's' });
const pFi = new Plot(timeBox, { title: 'Frequência instantânea fᵢ(t) = (1/2π)·dθ/dt', yUnit: 'Hz', height: 140, xUnit: 's', xDigits: 5 });
const pDem = new Plot(timeBox, { title: 'Saída do demodulador', height: 150, xUnit: 's' });
const pSpec = new Plot(freqBox, { title: 'Espectro', height: 320, xUnit: 'Hz', xDigits: 5 });
const timePlots = [pMsg, pCar, pMod, pFi, pDem];
for (const a of timePlots) a.link(...timePlots);

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const colors = () => ({
  msg: css('--c-msg'), car: css('--c-car'), mod: css('--c-mod'), env: css('--c-env'),
  th: css('--c-theory'), line: css('--c-line'), noise: css('--c-noise'), muted: css('--muted'),
});

let sim = null;
let lastKeys = {};

function render() {
  if (isAnalog()) renderAnalog(); else renderDigital();
}

// ================= ANALÓGICO =================

function renderAnalog() {
  const p = structuredClone(state);
  sim = simulateAnalog(p);
  const C = colors();
  const dt = 1 / sim.fs;
  const isFM = state.scheme === 'fm';
  const v = state.am.variant;

  const tKey = `${state.scheme}|${state.msg.fm}`;
  const fKey = `${state.scheme}|${state.fc}|${state.am.variant}|${state.msg.type}|${state.msg.fm}|${state.msg.fm2}|${state.msg.W}|${state.specView}|${state.specScale}|${Math.round(sim.peakDev / 200)}`;
  const keepT = lastKeys.t === tKey, keepF = lastKeys.f === fKey;
  lastKeys = { t: tKey, f: fKey };

  const tHome = { x0: 0, x1: 3 / state.msg.fm, min: 0 };
  const per = { x0: 0, dx: dt, periodic: true };

  pMsg.setData({
    series: [{ ...per, y: sim.m, color: C.msg, name: 'm(t)', width: 1.8 }],
    home: tHome, keepView: keepT, yRange: [-1.25, 1.25],
    hlines: [{ y: 0, color: C.muted, dash: [2, 4] }],
  });
  pMsg.titleEl.textContent = 'Mensagem m(t)';

  pCar.setData({
    series: [{ ...per, y: sim.carrier, color: C.car, name: `Ac·cos(2π·${fmtSI(state.fc, 'Hz')}·t + φ₀)` }],
    home: tHome, keepView: keepT, yRange: [-state.Ac * 1.2, state.Ac * 1.2],
  });

  const modSeries = [];
  if (state.noise.on) modSeries.push({ ...per, y: sim.rx, color: C.noise, name: 'r(t) = s(t) + n(t)', width: 1, alpha: 0.7 });
  modSeries.push({ ...per, y: sim.s, color: C.mod, name: 's(t)', width: 1.3 });
  if (sim.envelope) {
    const envName = v === 'am' ? 'envoltória Ac|1 + μm(t)|' : 'envoltória';
    modSeries.push({ ...per, y: sim.envelope, color: C.env, name: envName, dash: [5, 3], width: 1.4 });
    modSeries.push({ ...per, y: sim.envelope.map((x) => -x), color: C.env, dash: [5, 3], width: 1.4 });
  }
  let amax = state.Ac;
  if (!isFM) for (const x of sim.envelope) amax = Math.max(amax, x);
  pMod.setData({ series: modSeries, home: tHome, keepView: keepT, yRange: state.noise.on ? null : [-amax * 1.15, amax * 1.15] });
  pMod.titleEl.textContent = state.noise.on ? 'Sinal modulado s(t) e recebido r(t)' : 'Sinal modulado s(t)';

  pFi.el.style.display = isFM ? '' : 'none';
  if (isFM) {
    const d = Math.max(sim.peakDev, 1);
    pFi.setData({
      series: [{ ...per, y: sim.finst, color: C.mod, name: 'fᵢ(t)', width: 1.6 }],
      hlines: [
        { y: state.fc, color: C.muted, label: 'fc' },
        { y: state.fc + d, color: C.line, label: 'fc + Δf' },
        { y: state.fc - d, color: C.line, label: 'fc − Δf' },
      ],
      home: tHome, keepView: keepT, yRange: [state.fc - d * 1.5, state.fc + d * 1.5],
    });
  }

  pDem.el.style.display = '';
  pDem.titleEl.textContent = `Saída do demodulador (${sim.demodName}) — normalizada`;
  pDem.setData({
    series: [
      { ...per, y: sim.m, color: C.msg, name: 'm(t) original', dash: [5, 3], width: 1.4, alpha: 0.8 },
      { ...per, y: sim.demod, color: C.line, name: 'ŷ(t) demodulado', width: 1.6 },
    ],
    home: tHome, keepView: keepT,
    yRange: null,
  });

  renderSpectrumAnalog(C, keepF);
  renderCardsAnalog();
  renderEquationAnalog();
  document.getElementById('notes').innerHTML = sim.notes.map((n) => `<div>${n}</div>`).join('');
}

let anOffset = 0; // posição do quadro de análise no registro (avança ao vivo)

function renderSpectrumAnalog(C, keepF) {
  const view = state.specView;
  const lin = state.specScale === 'lin';
  const an = state.an;
  const ideal = an.mode === 'ideal';
  let P, df, spec = null;
  if (ideal) {
    P = view === 'msg' ? sim.specMsg : view === 'demod' ? sim.specDemod : sim.specRx;
    df = sim.df;
  } else {
    const x = view === 'msg' ? sim.m : view === 'demod' ? sim.demod : sim.rx;
    spec = analyzerSpectrum(x, sim.fs, { ...an, offset: anOffset });
    P = spec.P; df = spec.df;
  }
  sim.anSpec = spec;
  // Linear: amplitude de pico (V) = √(2P); dB: potência (dBW, 1 Ω)
  const conv = lin ? (x, k) => Math.sqrt(k === 0 ? x : 2 * x) : (x) => dB(x);
  const y = Float64Array.from(P, (x, k) => conv(x, k));
  const color = view === 'msg' ? C.msg : view === 'demod' ? C.line : (state.noise.on ? C.noise : C.mod);
  const series = [{ x0: 0, dx: df, y, color, name: ideal ? 'medido (FFT coerente)' : `analisador (${WINDOWS[an.win].name})`, width: 1.3 }];

  // Raias teóricas
  const points = [];
  if (state.showTheory) {
    let lines;
    if (view === 'tx') lines = sim.lines;
    else lines = sim.comps.map((c) => ({ f: c.f, A: Math.abs(c.a), P: c.a * c.a / 2 }));
    for (const l of lines) points.push({ x: l.f, y: lin ? l.A : dB(l.P), color: C.th });
  }
  if (points.length) series.push({ x0: 0, dx: 1, y: new Float64Array(0), color: C.th, name: 'teoria (raias)' });

  const hlines = [];
  if (view === 'tx' && state.noise.on && !lin) {
    const nb = ideal ? sim.N0 * sim.df : sim.N0 * spec.rbw;
    hlines.push({ y: dB(nb), color: C.noise, label: ideal ? `ruído por bin: N₀·Δf = ${dB(nb).toFixed(1)} dBW` : `ruído: N₀·RBW = ${dB(nb).toFixed(1)} dBW` });
  }
  const vlines = [];
  if (view === 'tx') {
    vlines.push({ x: sim.fiLo, color: C.env, dash: [6, 4] }, { x: sim.fiHi, color: C.env, dash: [6, 4], label: `filtro de FI (${sim.BthLabel})`, align: 'right', labelBottom: true });
  } else if (view === 'demod') {
    vlines.push({ x: sim.W, color: C.env, dash: [6, 4], label: 'filtro pós-detecção W', align: 'right' });
  }

  const half = Math.max((sim.fiHi - sim.fiLo) / 2, state.scheme === 'fm' ? sim.peakDev + 3 * sim.Wmsg : 2 * sim.Wmsg) * 1.2;
  const fmid = (sim.fiLo + sim.fiHi) / 2;
  const home = view === 'tx'
    ? { x0: Math.max(0, fmid - half), x1: Math.min(sim.fs / 2, fmid + half), min: 0, max: sim.fs / 2 }
    : { x0: 0, x1: Math.min(sim.fs / 2, view === 'demod' ? 1.3 * sim.W : 2.5 * sim.Wmsg), min: 0, max: sim.fs / 2 };

  let peak = 0;
  for (const x of P) if (x > peak) peak = x;
  const top = lin ? Math.sqrt(2 * peak) : dB(peak);

  pSpec.opts.yUnit = lin ? 'V' : '';
  pSpec.opts.yFmt = lin ? null : (v, ro) => ro ? `${v.toFixed(1)} dBW` : `${Math.round(v)}`;
  const what = view === 'msg' ? 'da mensagem m(t)' : view === 'demod' ? 'da saída demodulada' : 'do sinal modulado';
  pSpec.titleEl.textContent = `Espectro ${what} — ${lin ? 'amplitude de pico [V]' : 'potência [dBW, 1 Ω]'}`;
  updateAnalyzerInfo();
  pSpec.setData({
    series, points, vlines, hlines, home, keepView: keepF,
    yRange: lin ? [0, top * 1.12] : [Math.floor(top - 110), Math.ceil(top + 8)],
  });
}

// Barra de controles do analisador
const AN_OPTS = [
  ['mode', 'Exibição', [['analyzer', 'Analisador (FFT janelada)'], ['ideal', 'Raias ideais (FFT coerente)']]],
  ['win', 'Janela', Object.entries(WINDOWS).map(([k, v]) => [k, v.name])],
  ['nfft', 'FFT', [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].map((n) => [n, String(n)])],
  ['pad', 'Zero-padding', [[1, '×1'], [2, '×2'], [4, '×4'], [8, '×8']]],
  ['avg', 'Médias', [1, 2, 4, 8, 16, 32].map((n) => [n, String(n)])],
];

function buildAnalyzerBar() {
  const bar = document.getElementById('analyzerBar');
  if (!isAnalog()) { bar.innerHTML = ''; return; }
  bar.innerHTML = AN_OPTS.map(([k, label, opts]) =>
    `<label data-k="${k}">${label} <select data-k="${k}">${opts.map(([v, t]) =>
      `<option value="${v}"${String(state.an[k]) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')
    + '<span class="rbw" id="rbwInfo"></span>';
  for (const sel of bar.querySelectorAll('select')) {
    sel.onchange = () => {
      const k = sel.dataset.k;
      state.an[k] = k === 'mode' || k === 'win' ? sel.value : +sel.value;
      updateAnalyzerBarVisibility();
      schedule();
    };
  }
  updateAnalyzerBarVisibility();
}

function updateAnalyzerBarVisibility() {
  for (const l of document.querySelectorAll('#analyzerBar label')) {
    l.style.display = l.dataset.k === 'mode' || state.an.mode === 'analyzer' ? '' : 'none';
  }
}

function updateAnalyzerInfo() {
  const el = document.getElementById('rbwInfo');
  if (!el) return;
  const s = sim.anSpec;
  el.textContent = s
    ? `bin = ${fmtSI(s.binHz, 'Hz', 3)} · RBW = ${fmtSI(s.rbw, 'Hz', 3)} (${s.enbwBins.toFixed(2)} bins)${s.nfft < state.an.nfft ? ` · FFT limitada a ${s.nfft}` : ''}`
    : `resolução ${sim.df} Hz, sem janela: cada raia cai exatamente num bin`;
}

// Atualização ao vivo: o analisador "consome" novos quadros do sinal, como no GNU Radio
let lastLive = 0;
function liveSpectrum(now) {
  if (!isAnalog() || state.an.mode !== 'analyzer' || !sim || sim.params.scheme !== state.scheme || now - lastLive < 120) return;
  lastLive = now;
  anOffset = (anOffset + Math.min(state.an.nfft, sim.N) * Math.max(1, state.an.avg) / 2) % sim.N;
  renderSpectrumAnalog(colors(), true);
}

function renderCardsAnalog() {
  const s = sim, p = state;
  const isFM = p.scheme === 'fm';
  const fcBin = Math.round(p.fc / s.df);
  const Pcar = s.specClean[fcBin];
  const PcarTh = (s.lines.find((l) => l.f === p.fc) || { P: 0 }).P;
  const cards = [
    ['Amostragem fs', fmtSI(s.fs, 'Hz', 4), `${(s.fs / p.fc).toFixed(1)} amostras/ciclo da portadora`],
    ['Potência média', fmtSI(s.Ps, 'W', 4), `teórica ${fmtSI(s.Pth, 'W', 4)} (1 Ω)`],
    ['Potência na portadora', Pcar > 1e-12 ? fmtSI(Pcar, 'W', 4) : '0 W', `teórica ${PcarTh > 1e-12 ? fmtSI(PcarTh, 'W', 4) : '0 W'} · ${(100 * Pcar / s.Ps).toFixed(1)}% do total`],
    ['Banda ocupada 99%', s.obw.bw > 0 ? fmtSI(s.obw.bw, 'Hz', 4) : '≈ 0 Hz (1 raia)', `canal: ${s.BthLabel} = ${fmtSI(s.Bth, 'Hz', 4)}`],
  ];
  if (!isFM && p.am.variant === 'am') cards.splice(2, 0, ['Eficiência η', `${(100 * s.eta).toFixed(1)} %`, 'η = μ²⟨m²⟩ / (1 + μ²⟨m²⟩)']);
  if (isFM && p.msg.type === 'sine') {
    const b = toneBeta();
    cards.splice(2, 0, ['Índice β', b.toFixed(3), `J₀(β) = ${besselJ(0, b).toFixed(4)} · ${b < 0.3 ? 'banda estreita' : 'banda larga'}`]);
  }
  if (p.noise.on) {
    const cnr = s.Ps / (s.N0 * s.Bth);
    cards.push(['Ruído no canal', `γ = ${p.noise.gammaDb} dB`, `CNR na banda B = ${dB(cnr).toFixed(1)} dB`]);
    cards.push(['SNR de saída', `${dB(s.snrOut).toFixed(1)} dB`, `teoria (acima do limiar): ${dB(s.snrTh).toFixed(1)} dB · ganho ${dB(s.snrTh / s.gamma).toFixed(1)} dB`]);
  } else {
    cards.push(['Fidelidade da saída', `${Math.min(dB(s.snrOut), 200).toFixed(1)} dB`, 'sinal / distorção (sem ruído)']);
  }
  document.getElementById('cards').innerHTML = cards.map(([k, val, sub]) =>
    `<div class="card"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${sub}</div></div>`).join('');
}

function renderEquationAnalog() {
  const el = document.getElementById('equation');
  const sub = (x) => `<sub>${x}</sub>`;
  if (state.scheme === 'am') {
    const v = state.am.variant;
    const eq = {
      am: `s(t) = A${sub('c')}[1 + μ·m(t)] cos(2πf${sub('c')}t + φ${sub('0')})`,
      dsbsc: `s(t) = A${sub('c')}·m(t) cos(2πf${sub('c')}t + φ${sub('0')})`,
      usb: `s(t) = (A${sub('c')}/2)[m(t) cos(2πf${sub('c')}t) − m̂(t) sin(2πf${sub('c')}t)],&nbsp; m̂ = transformada de Hilbert de m`,
      lsb: `s(t) = (A${sub('c')}/2)[m(t) cos(2πf${sub('c')}t) + m̂(t) sin(2πf${sub('c')}t)],&nbsp; m̂ = transformada de Hilbert de m`,
    }[v];
    const spec = {
      am: `S(f) = (A${sub('c')}/2)[δ(f − f${sub('c')}) + μ·M(f − f${sub('c')})] + (freq. negativas) &nbsp;⇒ tom: raias em f${sub('c')} e f${sub('c')} ± f${sub('m')} com amplitude μA${sub('c')}/2`,
      dsbsc: `S(f) = (A${sub('c')}/2)·M(f − f${sub('c')}) + … &nbsp;⇒ só as bandas laterais, sem raia em f${sub('c')}`,
      usb: `só a banda lateral superior: raias em f${sub('c')} + f${sub('k')} com amplitude A${sub('c')}a${sub('k')}/2`,
      lsb: `só a banda lateral inferior: raias em f${sub('c')} − f${sub('k')} com amplitude A${sub('c')}a${sub('k')}/2`,
    }[v];
    el.innerHTML = `<div class="eq">${eq}</div><div class="eq">${spec}</div>
      <div class="where">Teorema da modulação: multiplicar por cos(2πf${sub('c')}t) translada o espectro da mensagem para ±f${sub('c')}. AM é linear: a mensagem com N raias gera exatamente 2N bandas laterais (N no SSB).</div>`;
  } else if (state.fm.mode === 'fm') {
    el.innerHTML = `
      <div class="eq">s(t) = A${sub('c')} cos(2πf${sub('c')}t + 2πΔf ∫${sub('0')}<sup>t</sup> m(τ)dτ + φ${sub('0')}),&nbsp;&nbsp; f${sub('i')}(t) = f${sub('c')} + Δf·m(t)</div>
      <div class="eq">tom: s(t) = A${sub('c')} Σ${sub('n')} J${sub('n')}(β) cos(2π(f${sub('c')} + n f${sub('m')})t),&nbsp;&nbsp; β = Δf/f${sub('m')}</div>
      <div class="where">FM é não linear: infinitas raias espaçadas de f${sub('m')} com amplitudes A${sub('c')}|J${sub('n')}(β)|. A potência total é sempre A${sub('c')}²/2 — ela só é redistribuída entre as raias (Σ J${sub('n')}² = 1).</div>`;
  } else {
    el.innerHTML = `
      <div class="eq">s(t) = A${sub('c')} cos(2πf${sub('c')}t + k${sub('p')}·m(t) + φ${sub('0')}),&nbsp;&nbsp; f${sub('i')}(t) = f${sub('c')} + (k${sub('p')}/2π)·dm/dt</div>
      <div class="eq">tom: s(t) = A${sub('c')} Σ${sub('n')} J${sub('n')}(β) cos(2π(f${sub('c')} + n f${sub('m')})t + nπ/2),&nbsp;&nbsp; β = k${sub('p')}</div>
      <div class="where">PM é FM da derivada da mensagem: o desvio de frequência cresce com f${sub('m')} — mude f${sub('m')} e compare com o FM, onde o desvio é fixo e β = Δf/f${sub('m')} cai.</div>`;
  }
}

// ================= DIGITAL =================

function renderDigital() {
  const p = structuredClone(state);
  sim = simulateDigital(p);
  const { fs, N } = sim;
  const Rb = state.Rb;
  const dt = 1 / fs;
  const T = 1 / Rb;
  const C = colors();

  const tKey = `${state.scheme}|${Rb}`;
  const fKey = `${state.scheme}|${state.fc}|${Rb}|${state.fsk.dev}|${state.specView}|${state.specScale}`;
  const keepT = lastKeys.t === tKey, keepF = lastKeys.f === fKey;
  lastKeys = { t: tKey, f: fKey };

  const tHome = { x0: 0, x1: 8 * T, min: 0, max: (N - 1) * dt };
  const labels = [];
  for (let k = 0; k < Math.min(sim.nBits, 400); k++) labels.push({ x: (k + 0.5) * T, text: String(sim.bits[k]) });

  const isFsk = state.scheme === 'fsk';
  const msgName = isFsk
    ? (state.fsk.pulse === 'gauss' && state.fsk.phase === 'continuous' ? 'd(t) filtrado (gaussiano)' : 'd(t)')
    : (state.ask.pulse === 'rc' ? 'd(t) com cosseno levantado' : 'd(t) NRZ');
  pMsg.titleEl.textContent = 'Mensagem (banda base)';
  pMsg.setData({
    series: [{ x0: 0, dx: dt, y: sim.msg, color: C.msg, name: msgName, width: 1.8 }],
    labels, home: tHome, keepView: keepT, yRange: [-1.7, 1.9],
    hlines: [{ y: 0, color: C.muted, dash: [2, 4] }],
  });

  pCar.setData({
    series: [{ x0: 0, dx: dt, y: sim.carrier, color: C.car, name: `Ac·cos(2π·${fmtSI(state.fc, 'Hz')}·t + φ₀)` }],
    home: tHome, keepView: keepT, yRange: [-state.Ac * 1.2, state.Ac * 1.2],
  });

  const modSeries = [];
  if (state.noise.on) modSeries.push({ x0: 0, dx: dt, y: sim.rx, color: C.noise, name: 'r(t) = s(t) + n(t)', width: 1, alpha: 0.7 });
  modSeries.push({ x0: 0, dx: dt, y: sim.s, color: C.mod, name: 's(t)', width: 1.4 });
  if (sim.envelope) {
    modSeries.push({ x0: 0, dx: dt, y: sim.envelope, color: C.env, name: 'envoltória |a(t)|', dash: [5, 3], width: 1.4 });
    modSeries.push({ x0: 0, dx: dt, y: sim.envelope.map((v) => -v), color: C.env, dash: [5, 3], width: 1.4 });
  }
  const amax = isFsk ? state.Ac : state.Ac * (1 + state.ask.m) * (state.ask.pulse === 'rc' ? 1.2 : 1);
  pMod.setData({ series: modSeries, home: tHome, keepView: keepT, yRange: state.noise.on ? null : [-amax * 1.15, amax * 1.15] });
  pMod.titleEl.textContent = state.noise.on ? 'Sinal modulado s(t) e recebido r(t)' : 'Sinal modulado s(t)';

  pDem.el.style.display = 'none';
  pFi.el.style.display = isFsk ? '' : 'none';
  if (isFsk) {
    const d = state.fsk.dev;
    pFi.setData({
      series: [{ x0: 0, dx: dt, y: sim.finst, color: C.mod, name: 'fᵢ(t)', width: 1.6 }],
      hlines: [
        { y: state.fc, color: C.muted, label: 'fc' },
        { y: state.fc - d, color: C.line, label: 'f₁ (bit 0)' },
        { y: state.fc + d, color: C.line, label: 'f₂ (bit 1)' },
      ],
      home: tHome, keepView: keepT, yRange: [state.fc - d * 1.8 - 1, state.fc + d * 1.8 + 1],
    });
  }

  renderSpectrumDigital(C, keepF);
  renderCardsDigital();
  renderEquationDigital();
  document.getElementById('notes').innerHTML = sim.notes.map((n) => `<div>${n}</div>`).join('')
    + (!sim.theory.valid && state.showTheory ? '<div>A curva teórica supõe bits aleatórios equiprováveis. Com sequência periódica o espectro vira um conjunto de raias discretas — compare!</div>' : '');
}

function renderSpectrumDigital(C, keepF) {
  const { specRx, specMsg, theory } = sim;
  const isMsg = state.specView === 'msg';
  const spec = isMsg ? specMsg : specRx;
  const dfr = spec.df;
  const lin = state.specScale === 'lin';
  const conv = lin ? (v) => v : (v) => dB(v);
  const y = Float64Array.from(spec.psd, conv);

  const series = [{ x0: 0, dx: dfr, y, color: isMsg ? C.msg : (state.noise.on ? C.noise : C.mod), name: 'medida (Welch)', width: 1.3, fill: !lin }];
  const vlines = [];
  const hlines = [];
  let peak = 0;
  for (const v of spec.psd) if (v > peak) peak = v;

  const theoryCurve = isMsg ? theory.msgCurve : theory.curve;
  if (state.showTheory && theoryCurve) {
    let tc = theoryCurve;
    if (!isMsg && state.noise.on) tc = Float64Array.from(tc, (v) => v + sim.N0);
    series.push({ x0: 0, dx: dfr, y: Float64Array.from(tc, conv), color: C.th, name: theory.label, dash: [6, 3], width: 1.6 });
  }
  if (!isMsg && state.showTheory) {
    for (const [i, l] of theory.lines.entries()) {
      vlines.push({ x: l.f, y: conv(l.peak + (state.noise.on ? sim.N0 : 0)), color: C.line, width: 2, arrow: true,
        align: theory.lines.length > 1 && i === 0 ? 'right' : 'left',
        label: `${l.label}: P = ${(10 * Math.log10(l.P)).toFixed(1)} dBW` });
      peak = Math.max(peak, l.peak);
    }
    if (state.noise.on) hlines.push({ y: conv(sim.N0), color: C.noise, label: `N₀ = ${(10 * Math.log10(sim.N0)).toFixed(1)} dBW/Hz` });
  }
  if (!isMsg) vlines.push({ x: sim.obw.fLo, color: C.muted, dash: [3, 3] }, { x: sim.obw.fHi, color: C.muted, dash: [3, 3], label: 'B99%', labelBottom: true });

  const Rb = state.Rb;
  const span = state.scheme === 'fsk' ? state.fsk.dev + 6 * Rb : 6 * Rb;
  const home = isMsg
    ? { x0: 0, x1: 6 * Rb, min: 0, max: sim.fs / 2 }
    : { x0: Math.max(0, state.fc - span), x1: Math.min(sim.fs / 2, state.fc + span), min: 0, max: sim.fs / 2 };

  const top = conv(peak);
  pSpec.opts.yUnit = lin ? 'V²/Hz' : '';
  pSpec.opts.yFmt = lin ? null : (v, ro) => ro ? `${v.toFixed(1)} dBW/Hz` : `${Math.round(v)}`;
  pSpec.titleEl.textContent = (isMsg ? 'PSD da mensagem d(t)' : 'PSD do sinal modulado') + (lin ? ' [V²/Hz, 1 Ω]' : ' [dBW/Hz, 1 Ω]');
  pSpec.setData({ series, vlines, hlines, home, keepView: keepF, yRange: lin ? [0, peak * 1.1] : [Math.floor(top - 80), Math.ceil(top + 6)] });
}

function renderCardsDigital() {
  const s = sim, p = state;
  const T = 1 / p.Rb;
  let Pth, bwTh, bwThLabel;
  if (p.scheme === 'ask') {
    const e2 = p.ask.pulse === 'rc' ? 1 - p.ask.beta / 4 : 1;
    Pth = (p.Ac ** 2 / 2) * (1 + p.ask.m ** 2 * e2);
    bwTh = p.ask.pulse === 'rc' ? (1 + p.ask.beta) * p.Rb : 2 * p.Rb;
    bwThLabel = p.ask.pulse === 'rc' ? 'banda (1+β)Rb' : 'nulo-a-nulo 2Rb';
  } else {
    Pth = p.Ac ** 2 / 2;
    bwTh = 2 * (p.fsk.dev + p.Rb);
    bwThLabel = 'Carson 2(Δf + Rb)';
  }
  const cards = [
    ['Amostragem fs', fmtSI(s.fs, 'Hz'), `${s.spb.toFixed(1)} amostras/bit · Nyquist ${fmtSI(s.fs / 2, 'Hz')}`],
    ['Potência média', `${fmtSI(s.Ps, 'W', 4)}`, `teórica ${fmtSI(Pth, 'W', 4)} (1 Ω)`],
    ['Energia por bit Eb', fmtSI(s.Eb, 'J', 3), 'Eb = P·Tb'],
    ['Banda ocupada 99%', fmtSI(s.obw.bw, 'Hz', 4), `${bwThLabel} = ${fmtSI(bwTh, 'Hz', 4)}`],
    ['Eficiência espectral', `${(p.Rb / s.obw.bw).toFixed(2)} bit/s/Hz`, 'Rb / B99%'],
    ['Resolução (RBW)', fmtSI(s.specRx.enbw, 'Hz', 3), `Welch, Hann, ${s.specRx.segs} médias · ${s.nBits} bits`],
  ];
  if (p.scheme === 'fsk') cards.splice(2, 0, ['Índice h = 2ΔfTb', (2 * p.fsk.dev * T).toFixed(3), p.fsk.phase === 'continuous' ? 'fase contínua' : 'fase descontínua']);
  if (p.noise.on) cards.push(['Ruído', `Eb/N₀ = ${p.noise.EbN0dB} dB`, `N₀ = ${fmtSI(s.N0, 'W/Hz', 3)}`]);
  document.getElementById('cards').innerHTML = cards.map(([k, v, sub]) =>
    `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join('');
}

function renderEquationDigital() {
  const el = document.getElementById('equation');
  if (state.scheme === 'ask') {
    el.innerHTML = `
      <div class="eq">s(t) = A<sub>c</sub> [1 + m·d(t)] cos(2πf<sub>c</sub>t + φ<sub>0</sub>),&nbsp;&nbsp; d(t) = Σ<sub>k</sub> d<sub>k</sub> p(t − kT<sub>b</sub>),&nbsp; d<sub>k</sub> ∈ {−1, +1}</div>
      <div class="eq">S<sub>s</sub>(f) = ½ A<sub>c</sub><sup>2</sup>m<sup>2</sup> T<sub>b</sub> |P(f − f<sub>c</sub>)|<sup>2</sup> + (A<sub>c</sub><sup>2</sup>/2)·δ(f − f<sub>c</sub>)</div>
      <div class="where">ASK é o AM com mensagem digital: o espectro é o da mensagem (sinc² para NRZ) deslocado para f<sub>c</sub>, mais a raia da portadora.</div>`;
  } else {
    el.innerHTML = `
      <div class="eq">s(t) = A<sub>c</sub> cos(2πf<sub>c</sub>t + 2πΔf ∫<sub>0</sub><sup>t</sup> d(τ) dτ + φ<sub>0</sub>),&nbsp;&nbsp; f<sub>i</sub>(t) = f<sub>c</sub> + Δf·d(t)</div>
      <div class="eq">h = 2Δf·T<sub>b</sub> &nbsp;·&nbsp; envoltória constante ⇒ P = A<sub>c</sub><sup>2</sup>/2</div>
      <div class="where">${state.fsk.phase === 'continuous'
        ? 'Fase contínua: a fase é a integral da frequência, sem saltos ⇒ lóbulos laterais decaem rápido (∝ 1/f⁴ para pulso retangular).'
        : 'Fase descontínua: dois osciladores chaveados ⇒ saltos de fase nas transições ⇒ lóbulos laterais decaem como 1/f².'}</div>`;
  }
}

// ---------- Interação geral ----------

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

function buildSpecViewButtons() {
  const el = document.getElementById('specView');
  const opts = isAnalog()
    ? [['tx', 'Sinal modulado'], ['msg', 'Mensagem'], ['demod', 'Saída demodulada']]
    : [['tx', 'Sinal modulado'], ['msg', 'Mensagem d(t)']];
  if (!opts.some(([v]) => v === state.specView)) state.specView = 'tx';
  el.innerHTML = opts.map(([v, t]) => `<button data-v="${v}" class="${v === state.specView ? 'active' : ''}">${t}</button>`).join('');
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.scheme = b.dataset.scheme;
  for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('active', x === b);
  lastKeys = {};
  buildSpecViewButtons(); buildAnalyzerBar(); syncControls(); renderExplain(); schedule();
});

function segmented(id, key) {
  const el = document.getElementById(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state[key] = b.dataset.v;
    for (const x of el.querySelectorAll('button')) x.classList.toggle('active', x === b);
    schedule();
  });
}
segmented('specView', 'specView');
segmented('specScale', 'specScale');
document.getElementById('showTheory').onchange = (e) => { state.showTheory = e.target.checked; schedule(); };

// Animação: a janela de tempo desliza como num osciloscópio.
// Analógico: 1 período da mensagem a cada 1,5 s (o registro é periódico, então corre sem fim).
// Digital: 1 bit a cada 0,4 s, voltando ao início no fim do registro.
const animBtn = document.getElementById('animate');
let anim = null;
function startAnim() {
  animBtn.textContent = '❚❚ Pausar';
  let last = performance.now();
  const step = (now) => {
    const dtw = Math.min(0.1, (now - last) / 1000); last = now;
    const v = pMsg.view, h = pMsg.home;
    if (v && h) {
      const adv = isAnalog() ? dtw / (1.5 * state.msg.fm) : dtw / (0.4 * state.Rb);
      let x0 = v.x0 + adv, x1 = v.x1 + adv;
      if (h.max !== undefined && x1 > h.max) { x1 -= x0; x0 = 0; }
      pMsg.setView(x0, x1);
    }
    liveSpectrum(now);
    anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function stopAnim() { cancelAnimationFrame(anim); anim = null; animBtn.textContent = '▶ Animar'; }
animBtn.onclick = () => (anim ? stopAnim() : startAnim());

function renderExplain() {
  const el = document.getElementById('explain');
  const T = {
    am: `
    <h4>O que observar (AM)</h4>
    <ul>
      <li><b>Bandas laterais:</b> com um tom, o espectro tem 3 raias: portadora em f<sub>c</sub> (amplitude A<sub>c</sub>) e f<sub>c</sub> ± f<sub>m</sub> (amplitude μA<sub>c</sub>/2). Passe para "dois tons" ou "quadrada" e veja cada harmônico virar um par de raias.</li>
      <li><b>Eficiência:</b> mesmo com μ = 1, só 1/3 da potência de um tom está nas bandas laterais (η = 33%) — o resto é a portadora, que não carrega informação.</li>
      <li><b>Sobremodulação (μ &gt; 1):</b> a envoltória "dobra" em zero, o detector de envoltória distorce e surgem harmônicos em 2f<sub>m</sub>, 3f<sub>m</sub>… na saída. Mas o espectro transmitido continua com 3 raias: quem distorce é o detector, não o canal.</li>
      <li><b>DSB-SC × SSB:</b> sem portadora não dá para usar envoltória — é preciso um oscilador local sincronizado. Mude o erro de fase θe: o DSB-SC atenua por cos θe (some em 90°); o SSB mantém o nível, mas distorce a fase.</li>
      <li><b>Analisador × raias ideais:</b> um sinal infinito tem raias (impulsos); o analisador vê só N amostras multiplicadas por uma janela, e o que aparece é a transformada da janela centrada em cada raia. Retangular + zero-padding mostra o sinc (lóbulos a −13 dB); Blackman-Harris (padrão do GNU Radio) troca lóbulo principal mais largo por lóbulos laterais a −92 dB. Fora do centro de um bin a raia aparece mais baixa (até −3,9 dB na retangular); a flat-top corrige isso.</li>
    </ul>`,
    fm: `
    <h4>O que observar (FM/PM)</h4>
    <ul>
      <li><b>Bessel:</b> com um tom, as raias ficam em f<sub>c</sub> ± n·f<sub>m</sub> com amplitude A<sub>c</sub>|J<sub>n</sub>(β)|. Os círculos roxos são a teoria; no modo "raias ideais" a FFT cai exatamente em cima, no modo analisador cada raia vira a forma da janela.</li>
      <li><b>β = 2,405:</b> J<sub>0</sub>(β) = 0 — a raia da portadora desaparece! (É assim que se calibra o desvio de um transmissor FM.)</li>
      <li><b>Regra de Carson:</b> B ≈ 2(Δf + W) contém ~98% da potência. Compare com a banda 99% medida.</li>
      <li><b>Banda estreita (β ≪ 1):</b> só f<sub>c</sub> e f<sub>c</sub> ± f<sub>m</sub> importam, como no AM — mas a raia inferior tem fase invertida (a envoltória fica quase constante).</li>
      <li><b>Ruído e limiar:</b> ligue o ruído. Acima do limiar, a SNR de saída do FM cresce com β² (troca banda por qualidade). Abaixo de ~10 dB de CNR aparecem cliques e a SNR despenca.</li>
    </ul>`,
    ask: `
    <h4>O que observar (ASK)</h4>
    <ul>
      <li><b>Teorema da modulação:</b> o espectro é o da mensagem (sinc² para NRZ) deslocado para f<sub>c</sub>.</li>
      <li><b>Raia da portadora:</b> a altura da raia na estimativa de Welch é P/ENBW — depende da resolução, por isso ela é desenhada à parte.</li>
      <li><b>Pulso NRZ × cosseno levantado:</b> o cosseno levantado limita a banda a (1+β)R<sub>b</sub>.</li>
      <li><b>Sequência alternada 1010:</b> vira uma onda quadrada periódica ⇒ o espectro contínuo some e aparecem raias.</li>
    </ul>`,
    fsk: `
    <h4>O que observar (FSK)</h4>
    <ul>
      <li><b>Índice h:</b> h = ½ é o MSK. h = 1 (Sunde) concentra metade da potência em duas raias em f<sub>1</sub> e f<sub>2</sub>.</li>
      <li><b>Fase contínua × descontínua:</b> compare os lóbulos laterais em dB.</li>
      <li><b>GFSK/GMSK:</b> filtrar a frequência com uma gaussiana suaviza f<sub>i</sub>(t) e reduz os lóbulos laterais (GSM, Bluetooth).</li>
    </ul>`,
  };
  el.innerHTML = T[state.scheme];
}

buildControls();
buildSpecViewButtons();
buildAnalyzerBar();
syncControls();
renderExplain();
render();
startAnim();
