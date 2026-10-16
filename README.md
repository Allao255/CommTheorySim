# CommTheorySim

Bancada virtual de modulação: AM, FM/PM, ASK e FSK no tempo e na frequência, com a
teoria sobreposta ao que é medido. Os sinais são gerados amostra a amostra e o espectro
sai de uma FFT de verdade, não de fórmulas desenhadas.

Sem dependências e sem build: HTML + JavaScript + canvas.

## Como abrir

Dê duplo clique no `index.html`. Funciona direto pelo arquivo, sem internet; as fontes
IBM Plex vêm do Google Fonts e, sem internet, caem nas fontes do sistema.

Se preferir servir a pasta:

```bash
python3 -m http.server 8765
```

e abra http://localhost:8765. Depois de atualizar o código, recarregue com `Ctrl+Shift+R`.

## Como usar

- **Abas**: AM e FM (analógico), ASK e FSK (digital).
- **Gráficos de tempo**: `Ctrl` + roda do mouse dá zoom, arrastar desloca, duplo clique volta à
  janela padrão. Os gráficos de tempo andam juntos e o cursor mostra os valores.
- **RUN/STOP**: liga/desliga a varredura. A animação é sempre em câmera lenta (uma portadora de
  10 kHz em tempo real seria um borrão): no analógico, 1 período da mensagem a cada 1,5 s. **VEL.**
  muda a velocidade e a leitura "câmera lenta ×N" mostra o fator.
- **Janela de tempo**: mostra 3 períodos da mensagem. Com fc ≫ fm cabem centenas de ciclos da
  portadora e o sinal vira uma faixa preenchida pela envoltória, como num osciloscópio; dê zoom
  para ver os ciclos.
- **Ruído**: o slider controla o nível N₀ do canal (dBW/Hz) e mais à direita é mais ruído. A SNR
  resultante (γ ou Eb/N₀) aparece logo abaixo e depende também da potência do sinal.

## Analógico (AM e FM)

**Mensagem**: tom, dois tons, triangular ou quadrada (5 harmônicos), normalizada para |m|máx = 1.
**W** é a banda do canal de mensagem (ex.: 5 kHz no rádio AM, 15 kHz no FM).

**AM**: convencional `Ac[1 + μm(t)]cos(2πfc t)`, DSB-SC e SSB (USB/LSB via transformada de Hilbert).
Mostra envoltória, eficiência η e a potência na portadora; μ > 1 sobremodula.

**FM/PM**: fase calculada analiticamente (`2πΔf∫m` exato) e frequência instantânea fᵢ(t).
Presets: banda estreita (β = 0,2), β = 2,405 (J₀ = 0: a portadora some), β = 5 e
"Didático no tempo" (fc = 2 kHz), em que a compressão dos ciclos fica visível em s(t).

**Receptor**: filtro de FI ideal (2W, W no SSB, Carson no FM) → detector de envoltória (AM),
detector coerente com erro de fase θe (DSB-SC/SSB), discriminador (FM) ou detector de fase (PM)
→ passa-baixas de banda W.

**Ruído**: γ = Pₛ/(N₀W). A SNR de saída medida é comparada com a teoria acima do limiar:

| Modulação | SNR de saída |
|---|---|
| AM (envoltória) | η·γ |
| DSB-SC, SSB | γ |
| FM | 3(Δf/W)²⟨m²⟩·γ |
| PM | kp²⟨m²⟩·γ |

Abaixo de ~10 dB de CNR na banda de Carson aparece o efeito limiar do FM (cliques).

## Digital (ASK e FSK)

- **ASK**: `Ac[1 + m·d(t)]cos(2πfc t)` com pulso NRZ ou cosseno levantado (roll-off β); m = 1 é OOK.
- **FSK**: fase contínua (CPFSK, pulso retangular ou gaussiano/GFSK) ou descontínua (dois
  osciladores chaveados com fase relativa Δθ). Presets MSK, Sunde (h = 1) e GMSK.
- **Bits**: aleatórios, PRBS-9, alternados 1010 ou padrão próprio.
- **PSD teórica**: sinc², cosseno levantado, CPFSK (Proakis), FSK de Sunde e FSK descontínuo
  como dois OOK. Raias discretas aparecem com altura P/RBW.

## Espectro

O padrão é um **analisador**, como o QT GUI Frequency Sink do GNU Radio: quadros de N amostras,
janela (retangular, Hann, Hamming, Blackman, Blackman-Harris, flat-top), zero-padding, média de
quadros e atualização ao vivo. Por isso as raias aparecem com a forma da janela (sinc na
retangular), com vazamento e perda entre bins, e não como impulsos.

- Analógico: potência em dBW (1 Ω). Uma senoide de amplitude A no centro de um bin aparece com
  A²/2; o ruído aparece em N₀·RBW. O modo **raias ideais** mostra a FFT coerente sem janela
  (registro de 0,1 s com todas as frequências múltiplas de 10 Hz, então cada raia cai num bin).
- Digital: PSD em dBW/Hz; com janela Hann e "todas" as médias equivale ao método de Welch.
- Círculos/curvas claras são a teoria (bandas laterais μAc/2, Bessel Ac|Jₙ(β)|, PSDs fechadas).

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html` | página |
| `css/style.css` | tema (bancada escura, cores de canal de osciloscópio) |
| `js/dsp.js` | FFT/IFFT, Welch, analisador com janelas, sinal analítico, filtros ideais, Bessel, geradores |
| `js/analog.js` | AM/FM/PM, demoduladores, raias teóricas e SNR |
| `js/digital.js` | ASK/FSK e PSDs teóricas |
| `js/plot.js` | plotter em canvas (zoom, arrasto, cursor sincronizado, decimação min/max) |
| `js/main.js` | interface, estado, analisador e animação |

---

Feito por [Allao255](https://github.com/Allao255).
