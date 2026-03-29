# Voxtory — CapCut Killer Yol Haritası

> **Amaç:** Voxtory video editörünü CapCut'a ihtiyaç duymayacak seviyeye getirmek.
> **Kural:** Mevcut TTS/arşiv/sidebar yapısına dokunma, sadece video edit pipeline'ını geliştir.
> **Dil:** Tüm kod, yorum, UI metni Türkçe.

---

## MEVCUT DURUM (Tamamlanan)

- [x] Ken Burns zoom/pan efekti (preview + export uyumlu)
- [x] 9 geçiş efekti (fade, dissolve, slide, wipe — xfade ile export)
- [x] Parlaklık/kontrast (ctx.filter + FFmpeg eq uyumu)
- [x] 5 altyazı animasyonu (fadeIn, typewriter, scaleIn, slideUp, none)
- [x] GPU encoder (NVENC/AMF/QSV otomatik tespit)
- [x] YouTube-optimize çıktı (bt709, profile high, GOP, B-frame)
- [x] Temel timeline (3 track: video, ses, altyazı)
- [x] Undo/redo (60 adım)
- [x] Klavye kısayolları

---

## FAZ 1: VIDEO FİLTRELER + RENK DÜZELTME

**Neden önce bu?** CapCut kullanıcılarının %80'i filtre uygulayarak başlıyor. Filtresiz editör "oyuncak" gibi duruyor.

### 1.1 Görsel Filtreler (Preview + Export)

Her görsel klibe uygulanabilir filtreler ekle. `clip.effects` objesine yeni alanlar:

```json
{
  "effects": {
    "kenBurns": { ... },
    "brightness": 0,
    "contrast": 0,
    "saturation": 0,
    "temperature": 0,
    "tint": 0,
    "sharpen": 0,
    "blur": 0,
    "vignette": 0,
    "grain": 0,
    "filter": "none"
  }
}
```

**Preset Filtreler (CapCut tarzı tek tıklama):**

| Filtre Adı | FFmpeg Karşılığı | Açıklama |
|-----------|------------------|----------|
| `none` | — | Orijinal |
| `cinematic` | eq=contrast=1.3:saturation=0.8, colorbalance=rs=0.05:gs=-0.03:bs=0.08 | Sinematik (mavi-turuncu) |
| `warm` | colortemperature=6800, eq=saturation=1.1 | Sıcak tonlar |
| `cool` | colortemperature=4500, eq=saturation=0.9 | Soğuk tonlar |
| `vintage` | curves=vintage, eq=saturation=0.7 | Retro/vintage |
| `bw` | hue=s=0 | Siyah-beyaz |
| `vivid` | eq=saturation=1.5:contrast=1.15 | Canlı renkler |
| `muted` | eq=saturation=0.5:brightness=0.05 | Pastel/solgun |
| `dramatic` | eq=contrast=1.5:brightness=-0.1, unsharp=5:5:1 | Dramatik |
| `dreamy` | gblur=sigma=1.5, eq=brightness=0.08:saturation=0.8 | Rüya gibi |

**Preview tarafı (editor-preview.js):**

```javascript
// ctx.filter ile CSS filter chain oluştur
_buildFilterString(effects) {
    let filters = [];
    const b = effects.brightness || 0;
    const c = effects.contrast || 0;
    const sat = effects.saturation || 0;

    if (b !== 0) filters.push(`brightness(${1 + b/100})`);
    if (c !== 0) filters.push(`contrast(${1 + c/50})`);
    if (sat !== 0) filters.push(`saturate(${1 + sat/50})`);
    if (effects.blur > 0) filters.push(`blur(${effects.blur}px)`);
    if (effects.temperature) {
        // Sıcaklık: sepia + hue-rotate kombinasyonu
        const temp = effects.temperature;
        if (temp > 0) filters.push(`sepia(${temp/200}) saturate(${1 + temp/100})`);
        else filters.push(`saturate(${1 + temp/200}) hue-rotate(${temp/2}deg)`);
    }

    return filters.length ? filters.join(' ') : 'none';
}
```

**Export tarafı (project_renderer.py):**

```python
def _build_effect_filters(self, fx):
    """Görsel efektlerden FFmpeg filter chain oluştur."""
    parts = []

    b = fx.get("brightness", 0)
    c = fx.get("contrast", 0)
    sat = fx.get("saturation", 0)

    if b != 0 or c != 0 or sat != 0:
        eq_parts = []
        if b != 0: eq_parts.append(f"brightness={b/100.0}")
        if c != 0: eq_parts.append(f"contrast={1.0 + c/50.0}")
        if sat != 0: eq_parts.append(f"saturation={1.0 + sat/50.0}")
        parts.append(f"eq={':'.join(eq_parts)}")

    temp = fx.get("temperature", 0)
    if temp != 0:
        # Renk sıcaklığı: colorbalance filtresi
        if temp > 0:
            r = temp / 200.0
            parts.append(f"colorbalance=rs={r:.3f}:gs={-r/3:.3f}:bs={-r:.3f}")
        else:
            b_val = -temp / 200.0
            parts.append(f"colorbalance=rs={-b_val:.3f}:gs={b_val/3:.3f}:bs={b_val:.3f}")

    blur = fx.get("blur", 0)
    if blur > 0:
        sigma = blur / 10.0
        parts.append(f"gblur=sigma={sigma:.1f}")

    sharpen = fx.get("sharpen", 0)
    if sharpen > 0:
        parts.append(f"unsharp=5:5:{sharpen/25.0:.2f}")

    vignette = fx.get("vignette", 0)
    if vignette > 0:
        parts.append(f"vignette=a={vignette/50.0:.2f}")

    grain = fx.get("grain", 0)
    if grain > 0:
        parts.append(f"noise=c0s={grain}:c0f=t+u")

    # Preset filtre
    preset = fx.get("filter", "none")
    if preset != "none":
        parts.extend(FILTER_PRESETS.get(preset, []))

    return ",".join(parts)
```

### 1.2 UI — Özellikler Panelinde Filtre Kontrolleri

`editor-panels.js` `_renderImageProps` içine yeni grup:

```html
<div class="props-group">
    <div class="props-group-title">RENK DÜZELTME</div>
    <div class="props-row">
        <span class="props-label">Doygunluk</span>
        <input type="range" id="prop-saturation" min="-50" max="50" value="0">
        <span class="props-value" id="prop-saturation-val">0</span>
    </div>
    <div class="props-row">
        <span class="props-label">Sıcaklık</span>
        <input type="range" id="prop-temperature" min="-50" max="50" value="0">
        <span class="props-value" id="prop-temperature-val">0</span>
    </div>
    <div class="props-row">
        <span class="props-label">Keskinlik</span>
        <input type="range" id="prop-sharpen" min="0" max="50" value="0">
        <span class="props-value" id="prop-sharpen-val">0</span>
    </div>
    <div class="props-row">
        <span class="props-label">Bulanıklık</span>
        <input type="range" id="prop-blur" min="0" max="30" value="0">
        <span class="props-value" id="prop-blur-val">0</span>
    </div>
    <div class="props-row">
        <span class="props-label">Vinyet</span>
        <input type="range" id="prop-vignette" min="0" max="50" value="0">
        <span class="props-value" id="prop-vignette-val">0</span>
    </div>
</div>

<div class="props-group">
    <div class="props-group-title">FİLTRE PROFİLLERİ</div>
    <div class="filter-grid" id="filter-presets">
        <!-- Küçük önizleme kutucukları ile filtre seçimi -->
    </div>
</div>
```

### Değiştirilecek Dosyalar
- `editor-core.js` — `addImageClip()` varsayılan efektlere yeni alanlar ekle
- `editor-preview.js` — `_drawImageClip()` içinde `_buildFilterString()` ile ctx.filter
- `editor-panels.js` — Yeni slider'lar ve filtre grid
- `project_renderer.py` — `_build_effect_filters()` ve klip render'da kullan
- `editor.css` — Filtre grid stilleri

---

## FAZ 2: ÇOKLU VİDEO TRACK + OVERLAY

**Neden?** Tek video track ile logo, PiP, arka plan görseli ekleyemiyorsun. CapCut'un en temel özelliği.

### 2.1 Proje JSON Şeması Güncellemesi

```json
{
  "tracks": [
    { "id": "video-1", "type": "video", "clips": [...] },
    { "id": "video-2", "type": "video", "clips": [...] },
    { "id": "video-3", "type": "video", "clips": [...] },
    { "id": "overlay-1", "type": "overlay", "clips": [...] },
    { "id": "audio-track", "type": "audio", "clips": [...] },
    { "id": "subtitle-track", "type": "subtitle", "clips": [...] }
  ]
}
```

### 2.2 Overlay Klip Yapısı

```json
{
  "id": "clip-0050",
  "type": "overlay",
  "source": "logo.png",
  "startTime": 0,
  "duration": 30,
  "position": { "x": 0.85, "y": 0.05 },
  "size": { "w": 0.15, "h": 0 },
  "opacity": 0.8,
  "effects": { "blur": 0, "brightness": 0 }
}
```

- `position.x/y`: 0.0-1.0 arası (canvas'a göre oran)
- `size.w`: Genişlik oranı (yükseklik otomatik — aspect ratio korunur)
- `size.h`: 0 = otomatik (aspect ratio'dan)
- `opacity`: 0.0-1.0

### 2.3 Preview'de Overlay Render

```javascript
// render() içinde video track'ten sonra:
const overlayTracks = Editor.project.tracks.filter(t => t.type === 'overlay');
for (const track of overlayTracks) {
    for (const clip of track.clips) {
        if (time >= clip.startTime && time < clip.startTime + clip.duration) {
            this._drawOverlayClip(ctx, clip, time, W, H);
        }
    }
}
```

### 2.4 Export'ta Overlay

FFmpeg `overlay` filtresi ile:

```
[0:v]...[base];
[1:v]scale=288:-1[logo];
[base][logo]overlay=x=1632:y=54:format=auto[out]
```

### 2.5 Timeline'da Ek Track'ler

- Track ekleme butonu (+)
- Video track'ler arası sürükle-bırak
- Track gizle/göster toggle

### Değiştirilecek Dosyalar
- `editor-core.js` — Yeni track tipleri, overlay klip CRUD
- `editor-timeline.js` — Dinamik track sayısı, overlay track rengi
- `editor-preview.js` — Overlay render, drag-to-position
- `editor-panels.js` — Overlay özellikleri (konum, boyut, opaklık)
- `project_renderer.py` — FFmpeg overlay filter chain
- `editor.html` — Track ekleme UI
- `editor.css` — Ek track stilleri

---

## FAZ 3: METİN/BAŞLIK OVERLAY SİSTEMİ

**Neden?** YouTube videoları başlık kartları, CTA'lar, açıklama metinleri olmadan profesyonel durmuyor.

### 3.1 Metin Overlay Klip Yapısı

```json
{
  "id": "clip-0060",
  "type": "text",
  "text": "BU VİDEO NEDEN ÖNEMLİ?",
  "startTime": 2.0,
  "duration": 4.0,
  "position": { "x": 0.5, "y": 0.3 },
  "style": {
    "font": "Segoe UI",
    "size": 72,
    "color": "#FFFFFF",
    "backgroundColor": "rgba(0,0,0,0.6)",
    "padding": 20,
    "borderRadius": 12,
    "outlineColor": "#000000",
    "outlineWidth": 0,
    "bold": true,
    "italic": false,
    "align": "center",
    "letterSpacing": 2,
    "lineHeight": 1.4,
    "maxWidth": 0.8
  },
  "animation": {
    "enter": "fadeIn",
    "exit": "fadeOut",
    "enterDuration": 0.5,
    "exitDuration": 0.3
  }
}
```

### 3.2 Metin Animasyonları

**Giriş animasyonları:**
- `none` — Anında görünür
- `fadeIn` — Opaklık 0→1
- `slideUp` — Aşağıdan yukarı kayarak gelir
- `slideDown` — Yukarıdan aşağı
- `slideLeft` — Sağdan sola
- `slideRight` — Soldan sağa
- `scaleIn` — Küçükten büyüğe
- `bounceIn` — Zıplayarak gelir
- `typewriter` — Harf harf yazılır
- `popIn` — Elastik büyüme

**Çıkış animasyonları:** Aynıların tersi (fadeOut, slideOut*, scaleOut)

### 3.3 Metin Şablonları (Template)

Hazır metin şablonları — tek tıklama ile ekle:

| Şablon | Açıklama |
|--------|----------|
| Başlık Kartı | Büyük font, arka plan kutulu, ortada |
| Alt Başlık | Küçük font, ekranın altında |
| CTA (Call to Action) | "ABONE OL" tarzı, renkli arka plan |
| Alıntı | İtalik, tırnak işaretli |
| Liste Maddesi | Bullet point ile |
| Bölüm Başlığı | Sol üst köşe, çizgi ile |
| Sayaç/Numara | Büyük numara, açıklama altında |
| Lokasyon Etiketi | Alt sol köşe, ikon ile |

### 3.4 Preview + Export

**Preview:** Canvas `fillText`/`strokeText` + `fillRect` arka plan

**Export:** FFmpeg `drawtext` filtresi:
```
drawtext=text='BAŞLIK':fontfile='segoeui.ttf':fontsize=72:
fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=20:
x=(w-text_w)/2:y=h*0.3
```

### Değiştirilecek Dosyalar
- `editor-core.js` — `addTextClip()`, text track
- `editor-preview.js` — Metin render, animasyon, arka plan kutusu
- `editor-panels.js` — Metin özellikleri paneli (font, renk, arka plan, animasyon)
- `editor-timeline.js` — Text track görünümü
- `project_renderer.py` — drawtext filter chain
- `editor.html` — Metin şablonları UI
- `editor.css` — Metin panel stilleri

---

## FAZ 4: GELİŞMİŞ ALTYAZI SİSTEMİ

**Neden?** CapCut'un en viral özelliği kelime-bazlı vurgulama (karaoke tarzı). YouTube Shorts'ta standart.

### 4.1 Kelime Bazlı Zamanlama

```json
{
  "type": "subtitle",
  "text": "Bu video çok önemli",
  "words": [
    { "word": "Bu", "start": 0.0, "end": 0.3 },
    { "word": "video", "start": 0.3, "end": 0.7 },
    { "word": "çok", "start": 0.7, "end": 0.9 },
    { "word": "önemli", "start": 0.9, "end": 1.5 }
  ],
  "style": {
    "highlightColor": "#FFD700",
    "highlightMode": "word"
  }
}
```

### 4.2 Yeni Altyazı Animasyonları (Toplam 12)

| Animasyon | Açıklama | Preview | Export (ASS) |
|-----------|----------|---------|--------------|
| `none` | Sabit | — | — |
| `fadeIn` | Belirme | globalAlpha | \fad |
| `typewriter` | Daktilo | char substring | per-word Dialogue |
| `scaleIn` | Büyüyerek | ctx.scale | \fscx\fscy\t |
| `slideUp` | Alttan kayma | translateY | \move |
| `bounceIn` | Zıplama | easeOutBounce | \t ile keyframe |
| `popIn` | Elastik pop | easeOutElastic scale | \t\fscx\fscy |
| `wave` | Dalga dalga harfler | per-char offset | per-char \pos |
| `rotateIn` | Dönerek gelme | ctx.rotate | \frz\t |
| `glowPulse` | Parlama efekti | shadow pulse | \bord\t |
| `colorCycle` | Renk değişimi | fillStyle animate | \c\t |
| `karaoke` | Kelime vurgulama | highlight rect | \k timing |

### 4.3 Otomatik Altyazı Oluşturma (Whisper Entegrasyonu)

Mevcut Whisper transkripsiyon modülünü editörle entegre et:
1. Ses klibini seç → "Otomatik Altyazı" butonu
2. Whisper word-level timestamp çıkarır
3. Timeline'a kelime zamanlı altyazı klipleri eklenir
4. Kullanıcı düzenleyebilir

### Değiştirilecek Dosyalar
- `editor-core.js` — words[] dizisi, highlight ayarları
- `editor-preview.js` — Kelime vurgulama render, yeni animasyonlar
- `editor-panels.js` — Highlight renk seçici, animasyon dropdown genişlet
- `project_renderer.py` — ASS \k tagleri ile karaoke, yeni animasyonlar
- `server.py` — Whisper → kelime zamanlı JSON endpoint

---

## FAZ 5: KEYFRAME ANİMASYON SİSTEMİ

**Neden?** Keyframe olmadan dinamik hareketler yapılamaz. CapCut'un her parametresi keyframe destekler.

### 5.1 Keyframe Veri Yapısı

```json
{
  "type": "image",
  "keyframes": {
    "scale": [
      { "time": 0.0, "value": 1.0, "easing": "linear" },
      { "time": 2.0, "value": 1.5, "easing": "easeInOut" }
    ],
    "positionX": [
      { "time": 0.0, "value": 0.5 },
      { "time": 3.0, "value": 0.8 }
    ],
    "positionY": [...],
    "rotation": [...],
    "opacity": [...]
  }
}
```

### 5.2 Easing Fonksiyonları

- `linear` — Sabit hız
- `easeIn` — Yavaş başla
- `easeOut` — Yavaş bitir
- `easeInOut` — Yavaş başla/bitir
- `easeOutBounce` — Zıplama
- `easeOutElastic` — Elastik

### 5.3 Timeline'da Keyframe Gösterimi

- Klip üzerinde küçük elmas (◆) işaretleri
- Keyframe ekleme: playhead konumunda sağ tık → "Keyframe Ekle"
- Keyframe düzenleme: Özellikler panelinde değer inputları

### 5.4 Preview'de Keyframe İnterpolasyonu

```javascript
_interpolateKeyframes(keyframes, clipTime) {
    // İki keyframe arası easing ile interpolasyon
    const sorted = keyframes.sort((a, b) => a.time - b.time);
    // İlk keyframe'den önce: ilk değer
    // Son keyframe'den sonra: son değer
    // Arası: easing fonksiyonu ile lerp
}
```

### 5.5 Export'ta Keyframe

FFmpeg expression'ları ile:
```
crop=x='if(lt(t,2), iw*0.5, iw*0.5+(t-2)*(iw*0.3)/1)'
```

Karmaşık keyframe'ler için: per-frame değer hesapla, FFmpeg'e sabit expression olarak ver.

### Değiştirilecek Dosyalar
- `editor-core.js` — Keyframe CRUD, interpolasyon
- `editor-preview.js` — Keyframe tabanlı transform
- `editor-timeline.js` — Keyframe elmas işaretleri, keyframe düzenleme
- `editor-panels.js` — Keyframe ekleme/silme UI
- `project_renderer.py` — Keyframe → FFmpeg expression
- `editor.css` — Keyframe stilleri

---

## FAZ 6: GÖRSEL KIRPMA + MASKE

### 6.1 Kırpma (Crop)

Görsel klibe uygulanabilir kırpma:

```json
{
  "effects": {
    "crop": {
      "enabled": false,
      "top": 0,
      "bottom": 0,
      "left": 0,
      "right": 0
    }
  }
}
```

### 6.2 Maske Şekilleri

```json
{
  "effects": {
    "mask": {
      "type": "none",
      "feather": 10
    }
  }
}
```

Maske türleri: `none`, `circle`, `rectangle`, `roundedRect`, `heart`, `star`

### 6.3 Preview + Export

**Preview:** Canvas `clip()` path ile
**Export:** FFmpeg `alphamerge` + şekil overlay

---

## FAZ 7: SES GELİŞTİRMELERİ

### 7.1 Equalizer (3-Bant)

```json
{
  "equalizer": {
    "bass": 0,
    "mid": 0,
    "treble": 0
  }
}
```

FFmpeg: `equalizer=f=100:t=h:w=200:g={bass},equalizer=f=1000:...`

### 7.2 Ses Efektleri

| Efekt | FFmpeg | Açıklama |
|-------|--------|----------|
| Echo | `aecho=0.8:0.88:60:0.4` | Yankı |
| Reverb | `aecho=0.8:0.9:1000:0.3` | Reverb |
| Normalize | `loudnorm` | Ses seviyesi normalize |
| DeNoise | `afftdn=nf=-25` | Gürültü azaltma |

### 7.3 Ses Dalga Formu Görselleştirme

Timeline'da ses klibinin dalga formunu göster:
- Backend: FFmpeg ile waveform data çıkar
- Frontend: Canvas'ta dalga çiz

---

## FAZ 8: VİDEO İÇERİK DESTEĞİ

**Neden?** Şu an sadece statik görsel (PNG/JPG) eklenebilir. Video klip desteği temel eksik.

### 8.1 Video Klip

```json
{
  "type": "video",
  "source": "intro.mp4",
  "startTime": 0,
  "duration": 5,
  "trimStart": 2,
  "trimEnd": 7,
  "volume": 0,
  "speed": 1.0,
  "effects": { ... }
}
```

### 8.2 Preview'de Video Oynatma

HTML5 `<video>` elementi ile frame-sync:
- Video elementi gizli tutulur
- Canvas'a `drawImage(videoElement, ...)` ile çizilir
- `currentTime` ile senkronize

### 8.3 Export'ta Video Klip

FFmpeg ile video girdi:
```
-i video_clip.mp4 -ss 2 -t 5 -vf "scale=1920:1080:..."
```

---

## FAZ 9: STİCKER / ŞEKİL / EMOJİ OVERLAY

### 9.1 Şekil Overlay

Temel şekiller: dikdörtgen, daire, çizgi, ok
Renklenebilir, opaklık ayarlanabilir, animasyonlu

### 9.2 Emoji/Sticker

Sistem emoji + SVG sticker seti
Timeline'a eklenebilir, boyut/konum ayarlanabilir

---

## FAZ 10: İLERİ SEVİYE

### 10.1 Proje Şablonları
Hazır proje şablonları (YouTube intro, outro, slideshow)

### 10.2 Toplu İşlem
Birden fazla görsel aynı ayarlarla ekle

### 10.3 Otomatik Klipler
Ses süresine göre görselleri otomatik dizme

### 10.4 Aspect Ratio Desteği
9:16 (Shorts), 1:1 (Instagram), 4:3 vb.

---

## ÖNCELİK SIRASI

| Faz | Zorluk | Etki | Tahmini Süre |
|-----|--------|------|------|
| **Faz 1** — Filtreler + Renk | Orta | ★★★★★ | İlk |
| **Faz 2** — Çoklu Track | Yüksek | ★★★★☆ | İkinci |
| **Faz 3** — Metin Overlay | Orta | ★★★★☆ | Üçüncü |
| **Faz 4** — Gelişmiş Altyazı | Orta | ★★★★★ | Dördüncü |
| **Faz 5** — Keyframe | Yüksek | ★★★☆☆ | Beşinci |
| **Faz 6** — Kırpma/Maske | Orta | ★★★☆☆ | Altıncı |
| **Faz 7** — Ses Geliştirme | Düşük | ★★☆☆☆ | Yedinci |
| **Faz 8** — Video İçerik | Yüksek | ★★★★☆ | Sekizinci |
| **Faz 9** — Sticker/Şekil | Düşük | ★★☆☆☆ | Dokuzuncu |
| **Faz 10** — İleri Seviye | Yüksek | ★★☆☆☆ | Onuncu |

---

## DEĞİŞTİRİLECEK DOSYALAR (ÖZET)

| Dosya | Fazlar |
|-------|--------|
| `app/core/project_renderer.py` | 1, 2, 3, 4, 5, 6, 7, 8 |
| `static/js/editor/editor-core.js` | 1, 2, 3, 4, 5, 6, 8 |
| `static/js/editor/editor-preview.js` | 1, 2, 3, 4, 5, 6, 8 |
| `static/js/editor/editor-panels.js` | 1, 2, 3, 4, 5, 6, 7 |
| `static/js/editor/editor-timeline.js` | 2, 3, 5, 7 |
| `static/js/editor/editor-export.js` | — (mevcut yeterli) |
| `static/js/editor/editor-init.js` | 2, 3 (yeni kısayollar) |
| `templates/pages/editor.html` | 1, 2, 3, 4, 9 |
| `static/css/editor.css` | 1, 2, 3, 4, 5, 9 |
| `server.py` | 2, 4, 8 (yeni endpoint'ler) |

## DOKUNULMAYACAK DOSYALAR

- `app/core/tts_engine.py`
- `app/core/transcriber.py` (Faz 4 hariç — sadece editör entegrasyonu)
- `app/core/paths.py`
- `templates/pages/tts.html`
- `templates/pages/archive.html`
- `static/js/app.js`
- `static/js/tts.js`
- `main.py`, `build.py`, `installer.iss`
