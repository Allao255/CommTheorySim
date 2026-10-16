// Plotter em canvas: séries uniformemente amostradas, decimação min/max,
// zoom (roda do mouse), arrasto (pan), duplo clique para reiniciar,
// cursor com leitura de valores e grupos de eixos x sincronizados.

const SI = [
  [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'],
];

function fmtSI(v, unit = '', digits = 3) {
  if (v === 0 || !isFinite(v)) return `${v === 0 ? 0 : v} ${unit}`.trim();
  const a = Math.abs(v);
  for (const [m, p] of SI) {
    if (a >= m * 0.9995) return `${+(v / m).toPrecision(digits)} ${p}${unit}`.trim();
  }
  return `${v.toExponential(2)} ${unit}`.trim();
}

function niceStep(range, target) {
  const raw = range / target;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / e;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * e;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

class Plot {
  constructor(container, opts = {}) {
    this.opts = Object.assign({
      xUnit: '', yUnit: '', yLabel: '', title: '', height: 180,
      yDigits: 3, xDigits: 4, yRangeFn: null,
    }, opts);
    this.el = document.createElement('div');
    this.el.className = 'plot';
    this.head = document.createElement('div');
    this.head.className = 'plot-head';
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'plot-title';
    this.titleEl.textContent = this.opts.title;
    this.legendEl = document.createElement('span');
    this.legendEl.className = 'plot-legend';
    this.readout = document.createElement('span');
    this.readout.className = 'plot-readout';
    this.head.append(this.titleEl, this.legendEl, this.readout);
    this.canvas = document.createElement('canvas');
    this.canvas.style.height = this.opts.height + 'px';
    this.el.append(this.head, this.canvas);
    container.append(this.el);

    this.series = [];
    this.vlines = [];
    this.hlines = [];
    this.labels = [];
    this.view = null;   // {x0, x1}
    this.home = null;
    this.yr = [-1, 1];
    this.hoverX = null;
    this.linked = [];
    this.pad = { l: 58, r: 12, t: 8, b: 24 };
    this._bind();
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  link(...others) {
    for (const o of others) if (o !== this && !this.linked.includes(o)) this.linked.push(o);
  }

  setData({ series, vlines = [], hlines = [], labels = [], points = [], home, yRange, keepView = false }) {
    this.series = series;
    this.points = points;
    this.vlines = vlines;
    this.hlines = hlines;
    this.labels = labels;
    this.home = home;
    if (!keepView || !this.view) this.view = { ...home };
    this.view.x0 = Math.max(this.view.x0, home.min ?? -Infinity);
    this.view.x1 = Math.min(this.view.x1, home.max ?? Infinity);
    this.fixedY = yRange || null;
    this.legendEl.innerHTML = series.filter((s) => s.name).map((s) =>
      `<i style="background:${s.color}${s.dash ? ';opacity:.6' : ''}"></i>${s.name}`).join('');
    this.draw();
  }

  setView(x0, x1, propagate = true) {
    const h = this.home;
    if (!h) return;
    const span = x1 - x0;
    const minSpan = (h.x1 - h.x0) * 1e-4;
    if (span < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
    if (h.min !== undefined && x0 < h.min) { x1 += h.min - x0; x0 = h.min; }
    if (h.max !== undefined && x1 > h.max && span < h.max - (h.min || 0)) { x0 -= x1 - h.max; x1 = h.max; }
    if (h.min !== undefined) x0 = Math.max(x0, h.min);
    this.view = { x0, x1 };
    this.draw();
    if (propagate) for (const o of this.linked) o.setView(x0, x1, false);
  }

  _xToPx(x) { const { l, r } = this.pad; return l + (x - this.view.x0) / (this.view.x1 - this.view.x0) * (this.w - l - r); }
  _pxToX(px) { const { l, r } = this.pad; return this.view.x0 + (px - l) / (this.w - l - r) * (this.view.x1 - this.view.x0); }
  _yToPx(y) { const { t, b } = this.pad; return t + (this.yr[1] - y) / (this.yr[1] - this.yr[0]) * (this.h - t - b); }

  _bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('wheel', (e) => {
      // Zoom só com Ctrl/Shift (ou pinça no touchpad), para não prender a rolagem da página
      if (!e.ctrlKey && !e.shiftKey) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const x = this._pxToX(e.clientX - r.left);
      const k = Math.exp((e.deltaY || e.deltaX) * 0.0015);
      this.setView(x - (x - this.view.x0) * k, x + (this.view.x1 - x) * k);
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      drag = { px: e.clientX, x0: this.view.x0, x1: this.view.x1 };
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (drag) {
        const dx = (e.clientX - drag.px) / (this.w - this.pad.l - this.pad.r) * (drag.x1 - drag.x0);
        this.setView(drag.x0 - dx, drag.x1 - dx);
      }
      this._hover(this._pxToX(e.clientX - r.left));
    });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('pointerleave', () => { this._hover(null); });
    c.addEventListener('dblclick', () => this.setView(this.home.x0, this.home.x1));
  }

  _hover(x, propagate = true) {
    if (!this.home) return;
    this.hoverX = x;
    this.draw();
    if (propagate) for (const o of this.linked) o._hover(x, false);
  }

  _valueAt(s, x) {
    let i = Math.round((x - s.x0) / s.dx);
    if (s.periodic) i = ((i % s.y.length) + s.y.length) % s.y.length;
    if (i < 0 || i >= s.y.length) return null;
    return s.y[i];
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h || !this.view) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    this.w = w; this.h = h;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { l, r, t, b } = this.pad;
    const pw = w - l - r, ph = h - t - b;
    const { x0, x1 } = this.view;

    // Faixa y: fixa ou automática sobre a janela visível
    if (this.fixedY) {
      this.yr = this.fixedY;
    } else {
      let lo = Infinity, hi = -Infinity;
      for (const s of this.series) {
        if (s.noAuto) continue;
        const L = s.y.length;
        const i0 = s.periodic ? Math.floor((x0 - s.x0) / s.dx) : Math.max(0, Math.floor((x0 - s.x0) / s.dx));
        const i1 = s.periodic ? Math.min(i0 + L, Math.ceil((x1 - s.x0) / s.dx)) : Math.min(L - 1, Math.ceil((x1 - s.x0) / s.dx));
        for (let i = i0; i <= i1; i++) { const v = s.y[s.periodic ? ((i % L) + L) % L : i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      if (!isFinite(lo)) { lo = -1; hi = 1; }
      if (hi - lo < 1e-12) { lo -= 1; hi += 1; }
      const m = (hi - lo) * 0.08;
      this.yr = this.opts.yRangeFn ? this.opts.yRangeFn(lo, hi) : [lo - m, hi + m];
    }

    const col = {
      grid: cssVar('--grid'), axis: cssVar('--muted'), text: cssVar('--text'), cursor: cssVar('--accent'),
    };

    // Grade e eixos
    g.font = '11px ui-sans-serif, system-ui, sans-serif';
    g.lineWidth = 1;
    g.strokeStyle = col.grid;
    g.fillStyle = col.axis;
    const xs = niceStep(x1 - x0, Math.max(3, pw / 90));
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let x = Math.ceil(x0 / xs) * xs; x <= x1 + xs * 1e-6; x += xs) {
      const px = Math.round(this._xToPx(x)) + 0.5;
      g.beginPath(); g.moveTo(px, t); g.lineTo(px, t + ph); g.stroke();
      g.fillText(fmtSI(Math.abs(x) < xs * 1e-6 ? 0 : x, this.opts.xUnit, this.opts.xDigits), px, t + ph + 5);
    }
    const [y0, y1] = this.yr;
    const ys = niceStep(y1 - y0, Math.max(2, ph / 40));
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let y = Math.ceil(y0 / ys) * ys; y <= y1 + ys * 1e-6; y += ys) {
      const py = Math.round(this._yToPx(y)) + 0.5;
      g.beginPath(); g.moveTo(l, py); g.lineTo(l + pw, py); g.stroke();
      const v = Math.abs(y) < ys * 1e-6 ? 0 : y;
      g.fillText(this.opts.yFmt ? this.opts.yFmt(v) : fmtSI(v, this.opts.yUnit, this.opts.yDigits), l - 6, py);
    }
    g.strokeStyle = col.axis;
    g.strokeRect(l + 0.5, t + 0.5, pw, ph);

    g.save();
    g.beginPath(); g.rect(l, t, pw, ph); g.clip();

    // Linhas horizontais de referência
    for (const hl of this.hlines) {
      const py = this._yToPx(hl.y);
      g.strokeStyle = hl.color; g.setLineDash(hl.dash || [4, 4]);
      g.beginPath(); g.moveTo(l, py); g.lineTo(l + pw, py); g.stroke();
      g.setLineDash([]);
      if (hl.label) { g.fillStyle = hl.color; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(hl.label, l + 6, py - 2); }
    }

    // Séries
    for (const s of this.series) this._drawSeries(g, s, pw);

    // Marcadores de pontos (ex.: raias teóricas)
    for (const pt of this.points || []) {
      const px = this._xToPx(pt.x), py = this._yToPx(pt.y);
      if (px < l - 4 || px > l + pw + 4) continue;
      g.strokeStyle = pt.color; g.lineWidth = 1.6;
      if (py > t + ph + 2 || py < t - 2) continue;
      g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1;
    }

    // Linhas verticais (raias, marcadores)
    for (const vl of this.vlines) {
      const px = this._xToPx(vl.x);
      if (px < l - 2 || px > l + pw + 2) continue;
      g.strokeStyle = vl.color; g.lineWidth = vl.width || 1;
      g.setLineDash(vl.dash || []);
      const yTop = vl.y !== undefined ? this._yToPx(vl.y) : t;
      g.beginPath(); g.moveTo(px, t + ph); g.lineTo(px, yTop); g.stroke();
      g.setLineDash([]);
      if (vl.arrow) {
        g.fillStyle = vl.color;
        g.beginPath(); g.moveTo(px, yTop - 1); g.lineTo(px - 4, yTop + 7); g.lineTo(px + 4, yTop + 7); g.fill();
      }
      if (vl.label) {
        g.fillStyle = vl.color;
        g.textAlign = vl.align === 'right' ? 'right' : 'left';
        g.textBaseline = 'top';
        const ly = vl.labelBottom ? t + ph - 16 : Math.max(t + 2, yTop - 14);
        g.fillText(vl.label, px + (vl.align === 'right' ? -4 : 4), ly);
      }
      g.lineWidth = 1;
    }

    // Rótulos de texto (ex.: bits)
    if (this.labels.length) {
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.font = '600 12px ui-monospace, monospace';
      const spanPx = pw / Math.max(1, (x1 - x0) / (this.labels[1] ? this.labels[1].x - this.labels[0].x : 1));
      if (spanPx > 9) {
        for (const lb of this.labels) {
          const px = this._xToPx(lb.x);
          if (px < l || px > l + pw) continue;
          g.fillStyle = lb.color || col.text;
          g.fillText(lb.text, px, t + 3);
        }
      }
      g.font = '11px ui-sans-serif, system-ui, sans-serif';
    }

    // Cursor
    if (this.hoverX !== null && this.hoverX >= x0 && this.hoverX <= x1) {
      const px = Math.round(this._xToPx(this.hoverX)) + 0.5;
      g.strokeStyle = col.cursor; g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(px, t); g.lineTo(px, t + ph); g.stroke();
      g.globalAlpha = 1;
      const parts = [`${fmtSI(this.hoverX, this.opts.xUnit, 5)}`];
      for (const s of this.series) {
        if (!s.name) continue;
        const v = this._valueAt(s, this.hoverX);
        if (v === null) continue;
        const py = this._yToPx(v);
        g.fillStyle = s.color;
        g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
        parts.push(`<b style="color:${s.color}">${s.name}</b> ${this.opts.yFmt ? this.opts.yFmt(v, true) : fmtSI(v, this.opts.yUnit, 4)}`);
      }
      this.readout.innerHTML = parts.join(' · ');
    } else {
      this.readout.textContent = '';
    }
    g.restore();
  }

  _drawSeries(g, s, pw) {
    const { x0, x1 } = this.view;
    const L = s.y.length;
    const i0 = s.periodic ? Math.floor((x0 - s.x0) / s.dx) - 1 : Math.max(0, Math.floor((x0 - s.x0) / s.dx) - 1);
    const i1 = s.periodic ? Math.ceil((x1 - s.x0) / s.dx) + 1 : Math.min(L - 1, Math.ceil((x1 - s.x0) / s.dx) + 1);
    if (i1 <= i0) return;
    const Y = s.periodic ? (i) => s.y[((i % L) + L) % L] : (i) => s.y[i];
    g.strokeStyle = s.color;
    g.lineWidth = s.width || 1.4;
    g.globalAlpha = s.alpha ?? 1;
    g.setLineDash(s.dash || []);
    g.lineJoin = 'round';
    g.beginPath();
    const n = i1 - i0;
    if (n > pw * 2 && !s.step) {
      // Decimação min/max por coluna de pixel: preserva os picos
      const perPx = n / pw;
      for (let c = 0; c < pw; c++) {
        const a = i0 + Math.floor(c * perPx), bnd = Math.min(i1, i0 + Math.floor((c + 1) * perPx));
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i <= bnd; i++) { const v = Y(i); if (v < lo) lo = v; if (v > hi) hi = v; }
        const px = this.pad.l + c + 0.5;
        if (c === 0) g.moveTo(px, this._yToPx(hi)); else g.lineTo(px, this._yToPx(hi));
        g.lineTo(px, this._yToPx(lo));
      }
    } else {
      for (let i = i0; i <= i1; i++) {
        const px = this._xToPx(s.x0 + i * s.dx), py = this._yToPx(Y(i));
        if (i === i0) g.moveTo(px, py); else g.lineTo(px, py);
      }
    }
    g.stroke();
    if (s.fill) {
      g.lineTo(this._xToPx(s.x0 + i1 * s.dx), this._yToPx(this.yr[0]));
      g.lineTo(this._xToPx(s.x0 + i0 * s.dx), this._yToPx(this.yr[0]));
      g.closePath();
      g.fillStyle = s.color; g.globalAlpha = 0.12; g.fill();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
  }
}
