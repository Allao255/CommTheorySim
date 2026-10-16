// Moduladores (ASK e FSK binários) e densidades espectrais teóricas.

// ---------- Pulsos de formatação ----------

// Cosseno levantado (pulso de Nyquist), p(0) = 1, zeros em kT.
function raisedCosine(t, T, beta) {
  const x = t / T;
  if (beta > 0 && Math.abs(Math.abs(2 * beta * x) - 1) < 1e-9) {
    return (Math.PI / 4) * sinc(1 / (2 * beta));
  }
  return sinc(x) * Math.cos(Math.PI * beta * x) / (1 - (2 * beta * x) ** 2);
}

// |P(f)| normalizado (= 1 em f = 0) do cosseno levantado
function raisedCosineSpectrum(f, T, beta) {
  const af = Math.abs(f);
  const f1 = (1 - beta) / (2 * T), f2 = (1 + beta) / (2 * T);
  if (af <= f1) return 1;
  if (af >= f2) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * T / beta) * (af - f1)));
}

// Pulso de frequência do GFSK: retângulo de largura T convoluído com gaussiana
// de banda B (-3 dB). Soma de pulsos deslocados de T com o mesmo símbolo = 1.
function gaussPulse(t, T, BT) {
  const sigma = Math.sqrt(Math.LN2) / (TAU * (BT / T));
  return Phi((t + T / 2) / sigma) - Phi((t - T / 2) / sigma);
}

// Forma de onda em banda base d(t) = Σ d_k p(t - kT - T/2), d_k = ±1
function shapeSymbols(sym, N, fs, Rb, pulseFn, spanBits) {
  const out = new Float64Array(N);
  const T = 1 / Rb;
  if (!pulseFn) {
    for (let n = 0; n < N; n++) out[n] = sym[Math.min(sym.length - 1, Math.floor((n * Rb) / fs))];
    return out;
  }
  // Pulso tabelado (RES pontos por bit) com interpolação linear
  const RES = 512;
  const L = 2 * spanBits * RES + 2;
  const tab = new Float64Array(L);
  for (let i = 0; i < L; i++) tab[i] = pulseFn((i / RES - spanBits) * T);
  for (let n = 0; n < N; n++) {
    const u = (n * Rb) / fs; // tempo em bits
    const k0 = Math.floor(u);
    let acc = 0;
    for (let k = k0 - spanBits; k <= k0 + spanBits; k++) {
      if (k < 0 || k >= sym.length) continue;
      const pos = (u - k - 0.5 + spanBits) * RES;
      if (pos < 0 || pos >= L - 1) continue;
      const i = Math.floor(pos), fr = pos - i;
      acc += sym[k] * (tab[i] + fr * (tab[i + 1] - tab[i]));
    }
    out[n] = acc;
  }
  return out;
}

// ---------- Escolha de amostragem ----------

function niceUpDigital(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 2.5, 4, 5, 8, 10]) if (m * e >= x) return m * e;
  return 10 * e;
}

// ---------- Simulação ----------

function simulateDigital(p) {
  const { scheme, fc, Rb, Ac } = p;
  const T = 1 / Rb;
  const devF = scheme === 'fsk' ? p.fsk.dev : 0;
  const fmax = fc + devF + 3 * Rb;
  const fs = niceUpDigital(20 * fmax);
  const spb = fs / Rb;

  // Registro longo para a estimativa espectral (muitos bits => boa média)
  const MAXN = 1 << 19;
  let nBits = Math.max(200, Math.min(2048, Math.floor(MAXN / spb)));
  const N = Math.min(Math.floor(nBits * spb), 1 << 21);
  nBits = Math.ceil(N / spb) + 1;

  const bits = makeBits(nBits, p.bitMode, p.pattern, p.seed);
  const sym = new Float64Array(nBits);
  for (let i = 0; i < nBits; i++) sym[i] = bits[i] ? 1 : -1;

  const phi0 = (p.phi0 || 0) * Math.PI / 180;
  const s = new Float64Array(N);
  const carrier = new Float64Array(N);
  for (let n = 0; n < N; n++) carrier[n] = Ac * Math.cos(TAU * fc * n / fs + phi0);

  let msg, envelope = null, finst = null, notes = [];

  if (scheme === 'ask') {
    const { m, pulse, beta } = p.ask;
    msg = pulse === 'rc'
      ? shapeSymbols(sym, N, fs, Rb, (t) => raisedCosine(t, T, beta), 8)
      : shapeSymbols(sym, N, fs, Rb, null, 0);
    envelope = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const a = Ac * (1 + m * msg[n]);
      s[n] = a * Math.cos(TAU * fc * n / fs + phi0);
      envelope[n] = Math.abs(a);
    }
    if (m > 1) notes.push('m > 1: sobremodulação — a amplitude a(t) troca de sinal, a envoltória |a(t)| deixa de reproduzir a mensagem (inversão de fase de 180°).');
  } else {
    const { dev, pulse, BT, phase } = p.fsk;
    const usePulse = phase === 'continuous' && pulse === 'gauss';
    msg = usePulse
      ? shapeSymbols(sym, N, fs, Rb, (t) => gaussPulse(t, T, BT), 4)
      : shapeSymbols(sym, N, fs, Rb, null, 0);
    finst = new Float64Array(N);
    if (phase === 'continuous') {
      let th = phi0;
      for (let n = 0; n < N; n++) {
        const f = fc + dev * msg[n];
        finst[n] = f;
        s[n] = Ac * Math.cos(th);
        th += TAU * f / fs;
        if (th > 1e4) th -= TAU * Math.floor(th / TAU);
      }
    } else {
      // Chaveamento entre dois osciladores livres (fases θ₁ = φ₀ e θ₂ = φ₀ + Δθ):
      // a fase salta nas transições de bit
      const dth = (p.fsk.dtheta || 0) * Math.PI / 180;
      for (let n = 0; n < N; n++) {
        const one = msg[n] > 0;
        const f = fc + dev * msg[n];
        finst[n] = f;
        s[n] = Ac * Math.cos(TAU * f * n / fs + phi0 + (one ? dth : 0));
      }
      const h = 2 * dev / Rb;
      if (Math.abs(h - Math.round(h)) < 0.02 && Math.round(h) >= 1) {
        notes.push(`h inteiro: a diferença de fase entre os osciladores, 2π(f₂ − f₁)t, volta ao mesmo valor a cada bit. ${Math.abs(((p.fsk.dtheta || 0) % 360)) < 1 ? 'Com Δθ = 0 os saltos de fase somem — o sinal é idêntico ao CPFSK!' : 'Os saltos de fase são sempre iguais a ±Δθ, um sinal determinístico — o modelo de 2 OOK independentes não se aplica.'}`);
      }
    }
    if (fc - dev <= 0) notes.push('fc − Δf ≤ 0: a frequência inferior é negativa/nula — o espectro se rebate em torno de 0 Hz.');
  }

  // Ruído AWGN com Eb/N0 especificado: N0 unilateral => σ² = N0·fs/2
  const Ps = power(s);
  const Eb = Ps * T;
  let rx = s, N0 = 0;
  if (p.noise.on) {
    N0 = Eb / Math.pow(10, p.noise.EbN0dB / 10);
    const sigma = Math.sqrt(N0 * fs / 2);
    const r = rng(p.seed * 7919 + 13);
    rx = new Float64Array(N);
    for (let n = 0; n < N; n++) rx[n] = s[n] + sigma * gaussian(r);
  }

  // Resolução espectral: RBW ≈ Rb/16, com pelo menos ~16 segmentos na média
  let nfft = nextPow2(Math.ceil(16 * fs / Rb));
  while (nfft > N / 8 && nfft > 256) nfft >>= 1;
  const specRx = welch(rx, fs, nfft);
  const specClean = rx === s ? specRx : welch(s, fs, nfft);
  const specMsg = welch(msg, fs, nfft);
  const obw = occupiedBandwidth(specClean.psd, specClean.df, 0.99);

  const theory = theoreticalPSD(p, fs, nfft, specRx.enbw);

  return {
    params: p, fs, N, spb, nBits, bits, sym, msg, s, rx, carrier, envelope, finst,
    Ps, Prx: power(rx), Eb, N0, nfft, specRx, specClean, specMsg, obw, theory, notes,
  };
}

// ---------- PSD teórica (unilateral, V²/Hz) ----------

// PSD da envoltória complexa do CPFSK binário com pulso retangular
// (Proakis, Digital Communications, PSD do CPFSK M-ário), ∫S_u df = 1.
function cpfskBaseband(f, T, h) {
  const M = 2;
  const beta = Math.sin(M * Math.PI * h) / (M * Math.sin(Math.PI * h));
  const fT = f * T;
  const A = [sinc(fT + h / 2), sinc(fT - h / 2)]; // n = 1, 2
  let sumA = A[0] * A[0] + A[1] * A[1];
  let sumB = 0;
  const den = 1 + beta * beta - 2 * beta * Math.cos(TAU * fT);
  for (let n = 1; n <= 2; n++) {
    for (let m = 1; m <= 2; m++) {
      const alpha = Math.PI * h * (m + n - 1 - M);
      const B = (Math.cos(TAU * fT - alpha) - beta * Math.cos(alpha)) / den;
      sumB += B * A[n - 1] * A[m - 1];
    }
  }
  return T * (sumA / M + (2 / (M * M)) * sumB);
}

function theoreticalPSD(p, fs, nfft, enbw) {
  const { scheme, fc, Rb, Ac } = p;
  const T = 1 / Rb;
  const df = fs / nfft;
  const nb = (nfft >> 1) + 1;
  const random = p.bitMode === 'random' || p.bitMode === 'prbs9';
  const out = { curve: null, msgCurve: null, lines: [], valid: random, label: '' };

  if (scheme === 'ask') {
    const { m, pulse, beta } = p.ask;
    const P2 = pulse === 'rc'
      ? (f) => raisedCosineSpectrum(f, T, beta) ** 2
      : (f) => sinc(f * T) ** 2;
    // a(t) = Ac(1 + m d(t)): média μ = Ac, variância σ² = (Ac m)²
    // S_a(f) = σ² T |P(f)|² + μ² δ(f);  S_s,unilateral(f) = ½[S_a(f−fc) + S_a(f+fc)]
    const sig2 = (Ac * m) ** 2;
    const curve = new Float64Array(nb);
    const msgCurve = new Float64Array(nb);
    for (let k = 0; k < nb; k++) {
      const f = k * df;
      curve[k] = 0.5 * sig2 * T * (P2(f - fc) + P2(f + fc));
      msgCurve[k] = (k === 0 ? 1 : 2) * T * P2(f);
    }
    out.curve = curve;
    out.msgCurve = msgCurve;
    out.lines.push({ f: fc, P: Ac * Ac / 2, label: 'portadora' });
    out.label = pulse === 'rc' ? 'teoria: ½σ²T|H_RC(f−fc)|² + raia' : 'teoria: ½σ²T·sinc²((f−fc)T) + raia';
  } else {
    const { dev, pulse, phase } = p.fsk;
    const h = 2 * dev * T;
    const nearInt = Math.abs(h - Math.round(h)) < 0.02 && Math.round(h) >= 1;
    const msgCurve = new Float64Array(nb);
    const P2 = (f) => sinc(f * T) ** 2;
    for (let k = 0; k < nb; k++) msgCurve[k] = (k === 0 ? 1 : 2) * T * P2(k * df);

    if (phase === 'continuous' && pulse === 'gauss') {
      out.label = 'GFSK: sem forma fechada — apenas medida';
      out.msgCurve = null;
    } else if (phase === 'continuous' && !nearInt) {
      const curve = new Float64Array(nb);
      for (let k = 0; k < nb; k++) {
        const f = k * df;
        curve[k] = (Ac * Ac / 2) * (cpfskBaseband(f - fc, T, h) + cpfskBaseband(f + fc, T, h));
      }
      out.curve = curve;
      out.msgCurve = msgCurve;
      out.label = `teoria: CPFSK (h = ${h.toFixed(3)})`;
    } else if (phase === 'continuous') {
      // h inteiro: raias discretas de Ac²/8 em f1 e f2. Para h = 1 (FSK de Sunde)
      // a parte contínua da envoltória complexa normalizada é
      // 4T cos²(πfT) / (π²(4f²T² − 1)²)  (Haykin, Communication Systems).
      const f1 = fc - dev, f2 = fc + dev;
      const sunde = (f) => {
        const x = f * T;
        const d = 4 * x * x - 1;
        if (Math.abs(d) < 1e-9) return T / 4; // limite em x = ±1/2
        return 4 * T * Math.cos(Math.PI * x) ** 2 / (Math.PI ** 2 * d * d);
      };
      if (Math.round(h) === 1) {
        const curve = new Float64Array(nb);
        for (let k = 0; k < nb; k++) {
          const f = k * df;
          curve[k] = (Ac * Ac / 2) * (sunde(f - fc) + sunde(f + fc));
        }
        out.curve = curve;
        out.label = 'teoria: FSK de Sunde (h = 1) + raias';
      } else {
        out.label = `h inteiro (${h.toFixed(2)}): só as raias`;
      }
      out.msgCurve = msgCurve;
      out.lines.push({ f: f1, P: Ac * Ac / 8, label: 'f₁' }, { f: f2, P: Ac * Ac / 8, label: 'f₂' });
    } else if (nearInt) {
      out.label = 'h inteiro: só as raias (ver nota)';
      out.msgCurve = msgCurve;
      out.lines.push({ f: fc - dev, P: Ac * Ac / 8, label: 'f₁' }, { f: fc + dev, P: Ac * Ac / 8, label: 'f₂' });
    } else {
      // Fase descontínua: soma de dois OOK em f1 e f2,
      // cada um com média Ac/2 e desvio Ac/2 => raias de Ac²/8 em f1 e f2.
      const f1 = fc - dev, f2 = fc + dev;
      const sig2 = (Ac / 2) ** 2;
      const curve = new Float64Array(nb);
      for (let k = 0; k < nb; k++) {
        const f = k * df;
        curve[k] = 0.5 * sig2 * T * (P2(f - f1) + P2(f + f1) + P2(f - f2) + P2(f + f2));
      }
      out.curve = curve;
      out.msgCurve = msgCurve;
      out.lines.push({ f: f1, P: Ac * Ac / 8, label: 'f₁' }, { f: f2, P: Ac * Ac / 8, label: 'f₂' });
      out.label = 'teoria: 2 OOK em f₁ e f₂ (aprox.)';
    }
  }
  // Uma raia de potência P aparece na estimativa de Welch com altura P/ENBW
  for (const l of out.lines) l.peak = l.P / enbw;
  return out;
}
