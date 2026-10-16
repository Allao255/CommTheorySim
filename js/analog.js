// Modulações analógicas: AM (convencional, DSB-SC, SSB) e FM/PM,
// com demodulação (detector de envoltória, coerente, discriminador) e
// espectro teórico de raias (bandas laterais, funções de Bessel).

// Resolução espectral fixa: o registro dura 1/DF = 0,1 s e todas as frequências
// (fc, fm) são múltiplas de DF ⇒ amostragem coerente: o sinal é exatamente
// periódico no registro e cada raia cai num único bin da FFT, sem vazamento.
const ANALOG_DF = 10;

// Componentes da mensagem m(t) = Σ a_k cos(2π f_k t), normalizada para |m|max = 1
function messageComponents(msg) {
  const { type, fm } = msg;
  let comps;
  if (type === 'two') {
    comps = [{ f: fm, a: 1 }, { f: msg.fm2, a: msg.a2 }];
  } else if (type === 'tri') {
    // Triangular: (8/π²) Σ_{k ímpar} cos(kω t)/k²  (5 primeiros harmônicos ímpares)
    comps = [1, 3, 5, 7, 9].map((k) => ({ f: k * fm, a: 8 / (Math.PI * Math.PI * k * k) }));
  } else if (type === 'square') {
    // Quadrada de banda limitada: (4/π) Σ_{k ímpar} (−1)^((k−1)/2) cos(kω t)/k
    comps = [1, 3, 5, 7, 9].map((k) => ({ f: k * fm, a: (4 / Math.PI) * ((k - 1) / 2 % 2 ? -1 : 1) / k }));
  } else {
    comps = [{ f: fm, a: 1 }];
  }
  // Junta componentes de mesma frequência e normaliza o pico em 1
  const merged = new Map();
  for (const c of comps) merged.set(c.f, (merged.get(c.f) || 0) + c.a);
  comps = [...merged].map(([f, a]) => ({ f, a })).filter((c) => c.a !== 0);
  const Tm = 1 / ANALOG_DF;
  let peak = 0;
  for (let i = 0; i < 20000; i++) {
    const t = (i / 20000) * Tm;
    let v = 0;
    for (const c of comps) v += c.a * Math.cos(TAU * c.f * t);
    peak = Math.max(peak, Math.abs(v));
  }
  for (const c of comps) c.a /= peak;
  return comps;
}

// Convolução de conjuntos de raias complexas {freq (Hz) → [re, im]}
function convolveLines(A, B) {
  const out = new Map();
  for (const [fa, ca] of A) {
    for (const [fb, cb] of B) {
      const f = fa + fb;
      const re = ca[0] * cb[0] - ca[1] * cb[1];
      const im = ca[0] * cb[1] + ca[1] * cb[0];
      const o = out.get(f) || [0, 0];
      o[0] += re; o[1] += im;
      out.set(f, o);
    }
  }
  for (const [f, c] of out) if (Math.hypot(c[0], c[1]) < 1e-9) out.delete(f);
  return out;
}

// Raias de e^{jβ sin(ωt)} (FM) ou e^{jβ cos(ωt)} (PM): coef. J_n(β) ou jⁿ J_n(β)
function besselLines(beta, f, pm) {
  const L = new Map();
  const nmax = Math.ceil(Math.abs(beta)) + 12;
  for (let n = -nmax; n <= nmax; n++) {
    const J = besselJ(n, beta);
    if (Math.abs(J) < 1e-9) continue;
    // jⁿ = cos(nπ/2) + j sin(nπ/2)
    const c = pm ? [J * Math.round(Math.cos(n * Math.PI / 2)), J * Math.round(Math.sin(n * Math.PI / 2))] : [J, 0];
    L.set(n * f, c);
  }
  return L;
}

// Raias teóricas do sinal passa-faixa: s = Re{Ac·u(t)·e^{j2πfc t}}
function theoreticalLines(p, comps) {
  const { scheme, fc, Ac } = p;
  let U = new Map([[0, [1, 0]]]);
  if (scheme === 'am') {
    const v = p.am.variant;
    U = new Map();
    if (v === 'am') U.set(0, [1, 0]);
    const g = v === 'am' ? p.am.mu : 1;
    for (const c of comps) {
      if (v === 'am' || v === 'dsbsc') {
        U.set(c.f, [g * c.a / 2, 0]);
        U.set(-c.f, [g * c.a / 2, 0]);
      } else if (v === 'usb') {
        U.set(c.f, [c.a / 2, 0]);
      } else {
        U.set(-c.f, [c.a / 2, 0]);
      }
    }
  } else {
    const pm = p.fm.mode === 'pm';
    for (const c of comps) {
      const beta = pm ? p.fm.kp * c.a : (p.fm.dev * c.a) / c.f;
      U = convolveLines(U, besselLines(beta, c.f, pm));
    }
  }
  // Translada para fc e rebate frequências negativas (contribuem com o conjugado)
  const lines = new Map();
  let folded = 0;
  for (const [nu, c] of U) {
    let f = fc + nu, cc = c;
    if (f < 0) { f = -f; cc = [c[0], -c[1]]; folded = Math.max(folded, Ac * Math.hypot(c[0], c[1])); }
    const o = lines.get(f) || [0, 0];
    o[0] += cc[0]; o[1] += cc[1];
    lines.set(f, o);
  }
  const out = [];
  for (const [f, c] of lines) {
    const A = Ac * Math.hypot(c[0], c[1]);
    if (A < 1e-7 * Ac) continue;
    out.push({ f, A, P: f === 0 ? A * A : A * A / 2 });
  }
  out.sort((a, b) => a.f - b.f);
  out.folded = folded;
  return out;
}

function simulateAnalog(p) {
  const { scheme, fc, Ac } = p;
  const phi0 = (p.phi0 || 0) * Math.PI / 180;
  const comps = messageComponents(p.msg);
  const Wmsg = Math.max(...comps.map((c) => c.f));
  // W: banda do canal de mensagem (ex.: 5 kHz no AM de radiodifusão, 15 kHz no FM).
  // É a banda do filtro pós-detecção e a referência de γ = Ps/(N0·W).
  const W = Math.max(p.msg.W || Wmsg, ANALOG_DF);
  const Pm = comps.reduce((s, c) => s + c.a * c.a / 2, 0); // <m²>

  // Desvio de pico (Hz): FM = Δf; PM = kp·max|dm/dt|/2π (limitante)
  const isFM = scheme === 'fm', isPM = isFM && p.fm.mode === 'pm';
  const peakDev = !isFM ? 0 : isPM ? p.fm.kp * comps.reduce((s, c) => s + Math.abs(c.a) * c.f, 0) : p.fm.dev;
  const fmax = fc + (isFM ? peakDev + 4 * Math.max(W, Wmsg) : Math.max(W, Wmsg));
  const N = Math.min(1 << 18, Math.max(1 << 14, nextPow2(Math.ceil(20 * fmax / ANALOG_DF))));
  const fs = ANALOG_DF * N;

  const m = new Float64Array(N), mh = new Float64Array(N);
  const carrier = new Float64Array(N), s = new Float64Array(N);
  const finst = isFM ? new Float64Array(N) : null;
  let envelope = null;

  for (let n = 0; n < N; n++) {
    const t = n / fs;
    let v = 0, vh = 0, dv = 0;
    for (const c of comps) {
      const w = TAU * c.f * t;
      v += c.a * Math.cos(w);
      vh += c.a * Math.sin(w);
      dv -= c.a * c.f * Math.sin(w) * TAU;
    }
    m[n] = v; mh[n] = vh;
    const wc = TAU * fc * t + phi0;
    carrier[n] = Ac * Math.cos(wc);
    if (isFM) {
      // FM: θ(t) = 2πΔf ∫m = Σ (Δf·a_k/f_k) sin(ω_k t)   (integral exata)
      // PM: θ(t) = kp·m(t)
      let th = 0;
      if (isPM) th = p.fm.kp * v;
      else for (const c of comps) th += (p.fm.dev * c.a / c.f) * Math.sin(TAU * c.f * t);
      s[n] = Ac * Math.cos(wc + th);
      finst[n] = isPM ? fc + p.fm.kp * dv / TAU : fc + p.fm.dev * v;
    }
  }

  if (!isFM) {
    envelope = new Float64Array(N);
    const v = p.am.variant;
    for (let n = 0; n < N; n++) {
      const wc = TAU * fc * n / fs + phi0;
      if (v === 'am') { s[n] = Ac * (1 + p.am.mu * m[n]) * Math.cos(wc); envelope[n] = Ac * Math.abs(1 + p.am.mu * m[n]); }
      else if (v === 'dsbsc') { s[n] = Ac * m[n] * Math.cos(wc); envelope[n] = Ac * Math.abs(m[n]); }
      else {
        const sg = v === 'usb' ? -1 : 1;
        s[n] = (Ac / 2) * (m[n] * Math.cos(wc) + sg * mh[n] * Math.sin(wc));
        envelope[n] = (Ac / 2) * Math.hypot(m[n], mh[n]);
      }
    }
  }

  const Ps = power(s);

  // Ruído AWGN com densidade N0 do canal (W/Hz, unilateral); σ² = N0·fs/2.
  // A SNR de referência resulta dela: γ = Ps/(N0·W)
  let rx = s, N0 = 0;
  if (p.noise.on) {
    N0 = Math.pow(10, p.noise.N0dB / 10);
    const sigma = Math.sqrt(N0 * fs / 2);
    const r = rng(p.seed * 7919 + 17);
    rx = new Float64Array(N);
    for (let n = 0; n < N; n++) rx[n] = s[n] + sigma * gaussian(r);
  }

  // ---------- Receptor ----------
  // Filtro de FI (pré-detecção) ideal com a banda de transmissão B
  let Bth, BthLabel, fiLo, fiHi;
  if (!isFM) {
    const v = p.am.variant;
    if (v === 'usb') { Bth = W; BthLabel = 'B = W'; fiLo = fc; fiHi = fc + W; }
    else if (v === 'lsb') { Bth = W; BthLabel = 'B = W'; fiLo = fc - W; fiHi = fc; }
    else { Bth = 2 * W; BthLabel = 'B = 2W'; fiLo = fc - W; fiHi = fc + W; }
  } else {
    Bth = 2 * (peakDev + W);
    BthLabel = 'Carson 2(Δf + W)';
    fiLo = fc - Bth / 2; fiHi = fc + Bth / 2;
  }
  const rxf = idealBandpass(rx, fs, fiLo - 1e-6, fiHi + 1e-6);

  // ---------- Demodulação ----------
  const fcut = W * 1.001; // filtro pós-detecção ideal de banda W
  let demod, demodName;
  if (!isFM && p.am.variant === 'am') {
    // Detector de envoltória ideal: |sinal analítico|, bloqueio de DC, passa-baixas
    const z = analytic(rxf);
    const env = new Float64Array(N);
    let mean = 0;
    for (let n = 0; n < N; n++) { env[n] = Math.hypot(z.re[n], z.im[n]); mean += env[n]; }
    mean /= N;
    for (let n = 0; n < N; n++) env[n] = (env[n] - mean) / (Ac * p.am.mu || 1);
    demod = idealLowpass(env, fs, fcut);
    demodName = 'detector de envoltória';
  } else if (!isFM) {
    // Detecção coerente: oscilador local com erro de fase θe
    const th = (p.am.phaseErr || 0) * Math.PI / 180;
    const gain = p.am.variant === 'dsbsc' ? 2 / Ac : 4 / Ac;
    const mix = new Float64Array(N);
    for (let n = 0; n < N; n++) mix[n] = gain * rxf[n] * Math.cos(TAU * fc * n / fs + phi0 + th);
    demod = idealLowpass(mix, fs, fcut);
    demodName = 'detecção coerente';
  } else {
    // Discriminador: fase do sinal analítico levado à banda base
    const z = analytic(rxf);
    const zr = new Float64Array(N), zi = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const w = TAU * fc * n / fs + phi0;
      const c = Math.cos(w), sn = Math.sin(w);
      zr[n] = z.re[n] * c + z.im[n] * sn;
      zi[n] = z.im[n] * c - z.re[n] * sn;
    }
    const out = new Float64Array(N);
    if (!isPM) {
      // f_i − fc = (1/2π) dθ/dt, diferença central de fase (registro periódico)
      for (let n = 0; n < N; n++) {
        const a = (n + 1) % N, b = (n - 1 + N) % N;
        const re = zr[a] * zr[b] + zi[a] * zi[b];
        const im = zi[a] * zr[b] - zr[a] * zi[b];
        out[n] = (Math.atan2(im, re) * fs / (2 * TAU)) / p.fm.dev;
      }
      demodName = 'discriminador de frequência';
    } else {
      // Detector de fase: fase desenrolada
      let ph = Math.atan2(zi[0], zr[0]);
      out[0] = ph;
      for (let n = 1; n < N; n++) {
        const re = zr[n] * zr[n - 1] + zi[n] * zi[n - 1];
        const im = zi[n] * zr[n - 1] - zr[n] * zi[n - 1];
        ph += Math.atan2(im, re);
        out[n] = ph;
      }
      let mean = 0;
      for (let n = 0; n < N; n++) mean += out[n];
      mean /= N;
      for (let n = 0; n < N; n++) out[n] = (out[n] - mean) / p.fm.kp;
      demodName = 'detector de fase';
    }
    demod = idealLowpass(out, fs, fcut);
  }

  // SNR de saída: ganho ótimo g por mínimos quadrados; erro = y − g·m
  let ym = 0, mm = 0;
  for (let n = 0; n < N; n++) { ym += demod[n] * m[n]; mm += m[n] * m[n]; }
  const g = ym / mm;
  let pe = 0;
  for (let n = 0; n < N; n++) { const e = demod[n] - g * m[n]; pe += e * e; }
  const snrOut = (g * g * mm) / Math.max(pe, 1e-30);

  // ---------- Teoria ----------
  const lines = theoreticalLines(p, comps);
  let Pth, snrTh = null, eta = null;
  if (!isFM) {
    const v = p.am.variant;
    if (v === 'am') {
      Pth = (Ac * Ac / 2) * (1 + p.am.mu ** 2 * Pm);
      eta = p.am.mu ** 2 * Pm / (1 + p.am.mu ** 2 * Pm);
    } else if (v === 'dsbsc') Pth = Ac * Ac * Pm / 2;
    else Pth = Ac * Ac * Pm / 4;
  } else {
    Pth = Ac * Ac / 2;
  }
  const gamma = p.noise.on ? Ps / (N0 * W) : null;
  if (gamma !== null) {
    if (!isFM) snrTh = p.am.variant === 'am' ? eta * gamma : gamma;
    else snrTh = isPM ? p.fm.kp ** 2 * Pm * gamma : 3 * (p.fm.dev / W) ** 2 * Pm * gamma;
  }

  const specRx = lineSpectrum(rx);
  const specClean = rx === s ? specRx : lineSpectrum(s);
  const obw = occupiedBandwidth(specClean, ANALOG_DF, 0.99);

  const notes = [];
  if (Wmsg > W) notes.push(`A mensagem tem componentes até ${Wmsg} Hz, acima da banda do canal W = ${W} Hz: o filtro do receptor corta essas componentes (a saída perde harmônicos).`);
  if (!isFM && p.am.variant === 'am' && p.am.mu > 1) {
    notes.push('μ > 1: sobremodulação. 1 + μ·m(t) fica negativo, a envoltória |1 + μm| não é mais a mensagem — veja a saída do detector de envoltória distorcer (surgem harmônicos no espectro da saída).');
  }
  if (lines.folded > 1e-3 * Ac) {
    notes.push('Raias abaixo de 0 Hz se rebatem para frequências positivas e interferem com as demais (fc pequena demais para a banda do sinal).');
  }
  if (isFM && p.noise.on) {
    const cnr = Ps / (N0 * Bth);
    if (10 * Math.log10(cnr) < 10) notes.push(`CNR na banda de Carson = ${(10 * Math.log10(cnr)).toFixed(1)} dB < ~10 dB: abaixo do limiar do FM. O ruído passa a "capturar" a fase e aparecem cliques (picos) na saída do discriminador — a fórmula de SNR acima do limiar deixa de valer.`);
  }
  if (!isFM && p.am.variant !== 'am' && Math.abs(p.am.phaseErr) > 0) {
    notes.push(p.am.variant === 'dsbsc'
      ? `Erro de fase θe = ${p.am.phaseErr}°: a saída do DSB-SC é atenuada por cos θe = ${Math.cos(p.am.phaseErr * Math.PI / 180).toFixed(3)} (em 90° some!).`
      : `Erro de fase θe = ${p.am.phaseErr}° no SSB: a saída vira m·cos θe ∓ m̂·sin θe — mesma amplitude espectral, mas fases distorcidas (forma de onda muda).`);
  }

  return {
    params: p, fs, N, df: ANALOG_DF, comps, W, Wmsg, Pm, peakDev, fiLo, fiHi,
    m, carrier, s, rx, envelope, finst, demod, demodName,
    Ps, Pth, N0, Bth, BthLabel, eta, gamma, snrOut, snrTh,
    lines, specRx, specClean, specMsg: lineSpectrum(m), specDemod: lineSpectrum(demod), obw, notes,
  };
}
