# Simulador de Modulação

Simulador interativo de modulações analógicas (AM, FM/PM) e digitais (ASK, FSK)
no tempo e na frequência, com a teoria sobreposta à medida.
Sem dependências nem build: HTML + JavaScript + canvas.

## Como abrir

Dê duplo clique no `index.html` (funciona direto pelo arquivo), ou sirva a pasta:

```bash
python3 -m http.server 8765
```

e abra http://localhost:8765.

## Analógico (AM e FM)

- **Mensagem**: tom, dois tons, triangular ou quadrada (5 harmônicos), normalizada para |m|máx = 1.
  **W** é a banda do canal de mensagem (filtro pós-detecção do receptor).
- **AM**: convencional `Ac[1 + μm(t)]cos(2πfc t)`, DSB-SC, SSB (USB/LSB via transformada de Hilbert).
- **FM/PM**: fase calculada analiticamente (`2πΔf∫m` exato), frequência instantânea mostrada.
- **Receptor**: filtro de FI ideal (2W, W no SSB, Carson no FM) → detector de envoltória (AM),
  detector coerente com erro de fase θe (DSB-SC/SSB), discriminador (FM) ou detector de fase (PM)
  → passa-baixas de banda W.
- **Espectro**: amostragem coerente (registro de 0,1 s, todas as frequências múltiplas de 10 Hz), então
  cada raia cai num único bin da FFT, sem vazamento. Os círculos são as raias teóricas
  (bandas laterais μAc/2, Bessel Ac|Jn(β)|, calculadas por convolução para mensagens com vários tons).
- **Analisador (padrão)**: como o QT GUI Frequency Sink do GNU Radio: quadros de N amostras, janela
  (retangular, Hann, Hamming, Blackman, Blackman-Harris, flat-top), zero-padding, média de quadros e
  atualização ao vivo. Escala: senoide de amplitude A no centro de um bin aparece com A²/2 dBW;
  ruído aparece com N0·RBW. O modo "raias ideais" mostra a FFT coerente, sem janela.
- **Ruído**: γ = Ps/(N0·W). A SNR de saída medida é comparada com a teoria: ηγ (AM), γ (DSB-SC/SSB),
  3(Δf/W)²⟨m²⟩γ (FM), kp²⟨m²⟩γ (PM). O efeito limiar do FM aparece abaixo de ~10 dB de CNR.

## Digital (ASK e FSK)

- PSD por Welch (Hann) comparada com as PSDs teóricas (sinc², cosseno levantado, CPFSK pelo Proakis,
  FSK de Sunde, FSK descontínuo como dois OOK). Raias aparecem com altura P/ENBW.

## Estrutura

- `js/dsp.js`: FFT/IFFT, Welch, sinal analítico, filtros ideais, Bessel, geradores.
- `js/analog.js`: AM/FM/PM, demoduladores e raias teóricas.
- `js/digital.js`: ASK/FSK e PSDs teóricas.
- `js/plot.js`: plotter em canvas (Ctrl+roda: zoom, arrastar, duplo clique reinicia, cursor sincronizado).
- `js/main.js`: interface, estado e animação.
