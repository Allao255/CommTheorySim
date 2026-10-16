// Núcleo de processamento de sinais: FFT, estimador de PSD (Welch),
// geradores de bits e funções auxiliares.

const TAU = 2 * Math.PI;

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function sinc(x) {
  if (Math.abs(x) < 1e-12) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

// erf (Abramowitz & Stegun 7.1.26, erro < 1.5e-7)
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

// Gerador pseudoaleatório com semente (mulberry32), para resultados reprodutíveis.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruído gaussiano (Box–Muller)
function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand());
}

// Sequência de bits.
//  mode: 'random' | 'prbs9' | 'alt' | 'custom'
function makeBits(n, mode, pattern, seed = 1) {
  const bits = new Uint8Array(n);
  if (mode === 'alt') {
    for (let i = 0; i < n; i++) bits[i] = (i + 1) & 1;
  } else if (mode === 'prbs9') {
    // LFSR x^9 + x^5 + 1 (período 511)
    let s = 0x1ff;
    for (let i = 0; i < n; i++) {
      const b = ((s >> 8) ^ (s >> 4)) & 1;
      s = ((s << 1) | b) & 0x1ff;
      bits[i] = b;
    }
  } else if (mode === 'custom') {
    const p = (pattern || '').replace(/[^01]/g, '');
    if (p.length === 0) return makeBits(n, 'random', '', seed);
    for (let i = 0; i < n; i++) bits[i] = p.charCodeAt(i % p.length) - 48;
  } else {
    const r = rng(seed);
    for (let i = 0; i < n; i++) bits[i] = r() < 0.5 ? 1 : 0;
  }
  return bits;
}

// FFT radix-2 in-place (re, im: Float64Array de tamanho potência de 2)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// Densidade espectral de potência unilateral pelo método de Welch
// (janela de Hann, 50% de sobreposição). Unidade: V²/Hz (carga de 1 Ω).
// Retorna também a ENBW em Hz, necessária para interpretar raias discretas:
// uma senoide de potência P aparece com pico P / ENBW.
function welch(x, fs, nfft) {
  const hop = nfft >> 1;
  const w = new Float64Array(nfft);
  let s2 = 0;
  for (let i = 0; i < nfft; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((TAU * i) / nfft);
    s2 += w[i] * w[i];
  }
  const nb = (nfft >> 1) + 1;
  const acc = new Float64Array(nb);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let segs = 0;
  for (let start = 0; start + nfft <= x.length; start += hop) {
    for (let i = 0; i < nfft; i++) { re[i] = x[start + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < nb; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    segs++;
  }
  const scale = 1 / (fs * s2 * Math.max(segs, 1));
  for (let k = 0; k < nb; k++) acc[k] *= (k === 0 || k === nb - 1) ? scale : 2 * scale;
  let s1 = 0;
  for (let i = 0; i < nfft; i++) s1 += w[i];
  return { psd: acc, df: fs / nfft, segs, enbw: (fs * s2) / (s1 * s1) };
}

// Potência média (V², 1 Ω)
function power(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return s / x.length;
}

// Banda ocupada (fração p da potência) a partir de uma PSD uniforme
function occupiedBandwidth(psd, df, p = 0.99) {
  let total = 0;
  for (let k = 0; k < psd.length; k++) total += psd[k];
  const lo = total * (1 - p) / 2, hi = total * (1 + p) / 2;
  let c = 0, fLo = 0, fHi = 0, gotLo = false;
  for (let k = 0; k < psd.length; k++) {
    c += psd[k];
    if (!gotLo && c >= lo) { fLo = k * df; gotLo = true; }
    if (c >= hi) { fHi = k * df; break; }
  }
  return { fLo, fHi, bw: fHi - fLo };
}

const dB = (v) => 10 * Math.log10(Math.max(v, 1e-30));

// IFFT in-place (mesma convenção da fft, com fator 1/N)
function ifft(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}

// Sinal analítico z = x + j·H{x} via FFT (exato para registros periódicos)
function analytic(x) {
  const n = x.length;
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  for (let k = 1; k < n / 2; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = n / 2 + 1; k < n; k++) { re[k] = 0; im[k] = 0; }
  ifft(re, im);
  return { re, im };
}

// Filtro passa-baixas ideal (zera as raias acima de fcut)
function idealLowpass(x, fs, fcut) {
  const n = x.length;
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  const kc = Math.floor(fcut * n / fs);
  for (let k = kc + 1; k <= n - kc - 1; k++) { re[k] = 0; im[k] = 0; }
  ifft(re, im);
  return re;
}

// Espectro de raias com janela retangular (amostragem coerente: cada raia cai
// exatamente num bin). Retorna a potência por bin, unilateral, em V² (1 Ω).
function lineSpectrum(x) {
  const n = x.length;
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  const nb = n / 2 + 1;
  const P = new Float64Array(nb);
  for (let k = 0; k < nb; k++) {
    const m2 = (re[k] * re[k] + im[k] * im[k]) / (n * n);
    P[k] = (k === 0 || k === n / 2) ? m2 : 2 * m2;
  }
  return P;
}

// Função de Bessel de 1ª espécie J_n(x), n inteiro:
// J_n(x) = (1/π) ∫₀^π cos(nτ − x sin τ) dτ  (regra do trapézio: convergência
// exponencial para integrandos periódicos)
function besselJ(n, x) {
  const M = Math.max(64, 2 * Math.ceil(Math.abs(n) + Math.abs(x)) + 64);
  let s = 0;
  for (let i = 0; i <= M; i++) {
    const t = (Math.PI * i) / M;
    const v = Math.cos(n * t - x * Math.sin(t));
    s += (i === 0 || i === M) ? v / 2 : v;
  }
  return s / M;
}


// Filtro passa-faixa ideal [flo, fhi] (filtro de FI / pré-detecção)
function idealBandpass(x, fs, flo, fhi) {
  const n = x.length;
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  for (let k = 0; k <= n / 2; k++) {
    const f = (k * fs) / n;
    if (f < flo || f > fhi) {
      re[k] = 0; im[k] = 0;
      if (k > 0 && k < n / 2) { re[n - k] = 0; im[n - k] = 0; }
    }
  }
  ifft(re, im);
  return re;
}

// ---------- Analisador de espectro (FFT janelada, estilo GNU Radio) ----------

// Janelas: coeficientes da soma de cossenos w[n] = Σ (−1)^k a_k cos(2πkn/N)
const WINDOWS = {
  rect: { name: 'Retangular', a: [1] },
  hann: { name: 'Hann', a: [0.5, 0.5] },
  hamming: { name: 'Hamming', a: [0.54, 0.46] },
  blackman: { name: 'Blackman', a: [0.42, 0.5, 0.08] },
  bh: { name: 'Blackman-Harris', a: [0.35875, 0.48829, 0.14128, 0.01168] },
  flattop: { name: 'Flat-top', a: [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368] },
};

function makeWindow(type, n) {
  const a = (WINDOWS[type] || WINDOWS.bh).a;
  const w = new Float64Array(n);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < a.length; k++) v += (k % 2 ? -1 : 1) * a[k] * Math.cos((TAU * k * i) / n);
    w[i] = v; s1 += v; s2 += v * v;
  }
  // ENBW em bins: N·Σw²/(Σw)²
  return { w, s1, s2, enbwBins: (n * s2) / (s1 * s1) };
}

// Espectro como um analisador mostra: quadros de nfft amostras (50% de
// sobreposição, registro tratado como contínuo/circular), janela, zero-padding
// opcional e média de potência. Escala: uma senoide de amplitude A exatamente
// no centro de um bin aparece com P = A²/2 (dBW); fora do centro aparece menor
// (perda de "scalloping"). Ruído branco aparece com N0·RBW por bin.
// circular = false: os quadros ficam dentro do registro (sinal não periódico).
// density = true: divide pela RBW ⇒ PSD em V²/Hz (equivale ao método de Welch).
function analyzerSpectrum(x, fs, { nfft, win, pad = 1, avg = 1, offset = 0, circular = true, density = false }) {
  const N = x.length;
  nfft = Math.min(nfft, N);
  const span = N - nfft + 1;
  const M = nfft * pad;
  const { w, s1, enbwBins } = makeWindow(win, nfft);
  const nb = M / 2 + 1;
  const acc = new Float64Array(nb);
  const re = new Float64Array(M), im = new Float64Array(M);
  const hop = nfft >> 1;
  for (let a = 0; a < avg; a++) {
    const start = circular ? offset + a * hop : (offset + a * hop) % span;
    re.fill(0); im.fill(0);
    for (let i = 0; i < nfft; i++) re[i] = x[(((start + i) % N) + N) % N] * w[i];
    fft(re, im);
    for (let k = 0; k < nb; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  const rbw = (enbwBins * fs) / nfft;
  const scale = 1 / (s1 * s1 * avg * (density ? rbw : 1));
  for (let k = 0; k < nb; k++) acc[k] *= (k === 0 || k === nb - 1) ? scale : 2 * scale;
  return { P: acc, df: fs / M, rbw, binHz: fs / nfft, nfft, enbwBins, avg };
}
