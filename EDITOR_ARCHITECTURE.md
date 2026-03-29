# Voxtory Video Editor — Teknik Mimari Dokumani

> **Bu dokumani okuyan AI'ye talimat:**
> Asagida bir masaustu video editor uygulamasinin mevcut mimarisi anlatilmaktadir.
> Senin gorevin:
> 1. Bu mimariyi analiz et
> 2. Video edit ciktisinin YouTube icin en az CapCut kadar kaliteli olmasini saglayacak **somut iyilestirmeler** oner
> 3. Onerilerini, baska bir AI kodlama asistanina (Claude) verilecek bir **uygulama promptu** olarak yaz
> 4. Bu prompt, mevcut kodu bozmadan sadece video edit pipeline'ini iyilestirecek sekilde olmali
>
> **ONEMLI**: Proje TTS, arsiv vb. baska ozellikler de iceriyor ama sen SADECE video edit kismiyla ilgilen. Digerleri zaten calisiyor.

---

## 1. PROJE GENEL BAKIS

### 1.1 Ne Yapiyoruz?

Turkce YouTube videolari uretiyoruz. Is akisi:
1. **Hikaye yazilir** (kullanici tarafindan)
2. **TTS ile ses uretilir** (Piper TTS — bu kisim calisiyor, dokunma)
3. **Gorseller eklenir** (kullanici yukler — statik gorseller, video degil)
4. **Video editor'de birlestirilir** — gorseller timeline'a dizilir, ses eklenir, altyazi eklenir
5. **Export edilir** — 1920x1080 MP4, YouTube'a yuklenecek

**Sorun**: 4. ve 5. adimda. Video editor ve export ciktisi istenen kalitede degil. CapCut ile ayni isi yaptigimizda cok daha iyi sonuc aliyoruz. Bu uygulamanin video edit ciktisini en az CapCut kadar iyi yapmak istiyoruz.

### 1.2 Teknik Bilgiler

- **Uygulama turu**: Native Windows masaustu (Flask + PyWebView)
- **Frontend**: Vanilla JS, Canvas API (no framework)
- **Backend**: Python Flask
- **Video isleme**: FFmpeg (subprocess ile cagiriliyor)
- **Tamamen Offline**: Internete ihtiyac yok
- **Hedef cozunurluk**: 1920x1080 (16:9) — YouTube standard

---

## 2. DOSYA YAPISI

```
server.py                        <- Flask API (thin layer)
app/core/
    project_renderer.py          <- Editor proje JSON -> FFmpeg render
    video_engine.py              <- Basit gorsel->video pipeline (TTS sayfasi icin)
    ffmpeg_utils.py              <- FFmpeg bulma, GPU tespit, ses suresi
    subtitle_utils.py            <- SRT/ASS altyazi uretimi
    tts_engine.py                <- Piper TTS motor
    job_manager.py               <- Arkaplan is yonetimi
    paths.py                     <- Dosya yolu sabitleri

static/js/editor/
    editor-core.js               <- Proje modeli, state, undo/redo, event sistemi
    editor-timeline.js           <- Canvas tabanli timeline cizimi + etkilesim
    editor-preview.js            <- Canvas tabanli onizleme + oynatma
    editor-panels.js             <- Medya kutuphanesi + ozellikler paneli
    editor-export.js             <- Export dialog + backend iletisimi
    editor-init.js               <- Baslatma, klavye kisayollari

templates/pages/editor.html      <- Editor HTML yapisi
static/css/editor.css            <- Editor stilleri
```

---

## 3. PROJE JSON SEMASI

```json
{
  "version": 1,
  "meta": {
    "baslik": "Proje Adi",
    "cozunurluk": { "w": 1920, "h": 1080 },
    "fps": 25,
    "olusturma": "2026-03-29T10:00:00",
    "guncelleme": "2026-03-29T12:00:00"
  },
  "tracks": [
    {
      "id": "video-track",
      "type": "video",
      "clips": [ /* gorsel klipleri */ ]
    },
    {
      "id": "audio-track",
      "type": "audio",
      "clips": [ /* ses klipleri */ ]
    },
    {
      "id": "subtitle-track",
      "type": "subtitle",
      "clips": [ /* altyazi klipleri */ ]
    }
  ]
}
```

### 3.1 Gorsel Klip (Image Clip)

```json
{
  "id": "clip-0042",
  "type": "image",
  "source": "gorsel_01.png",
  "startTime": 5.0,
  "duration": 3.0,
  "effects": {
    "kenBurns": {
      "enabled": true,
      "startScale": 1.0,
      "endScale": 1.3,
      "startX": 0.5,
      "startY": 0.5,
      "endX": 0.5,
      "endY": 0.5
    },
    "brightness": 0,
    "contrast": 0,
    "fitMode": "fill"
  },
  "transition": {
    "type": "fade",
    "duration": 0.5
  }
}
```

**fitMode**: `fill` (kirp, YouTube icin ideal) | `fit` (siyah serit) | `stretch` (oran bozulur)

**kenBurns**: scale 1.0-2.0x arasi, center 0.0-1.0 arasi (0.5 = merkez)

**transition turleri**: none, fade, dissolve, slideleft, slideright, slideup, slidedown, wipeleft, wiperight

### 3.2 Ses Klip (Audio Clip)

```json
{
  "id": "clip-0043",
  "type": "audio",
  "source": "ses_01.wav",
  "startTime": 0,
  "duration": 30,
  "trimStart": 0,
  "trimEnd": 30,
  "volume": 1.0,
  "fadeIn": 0,
  "fadeOut": 0,
  "speed": 1.0,
  "pitch": 0
}
```

**volume**: 0-2.0 carpan | **speed**: 0.5-2.0x | **pitch**: -12 ile +12 yarim ton | **fade**: saniye cinsinden

### 3.3 Altyazi Klip (Subtitle Clip)

```json
{
  "id": "clip-0044",
  "type": "subtitle",
  "text": "Merhaba dunya",
  "startTime": 2.0,
  "duration": 3.0,
  "style": {
    "font": "Segoe UI",
    "size": 52,
    "color": "#FFFFFF",
    "outlineColor": "#000000",
    "outlineWidth": 3,
    "bold": true,
    "italic": false,
    "position": "bottom",
    "shadow": true,
    "animation": "none"
  }
}
```

**animation**: none | fadeIn | typewriter
**position**: bottom | middle | top
**font secenekleri**: Segoe UI, Arial, Tahoma, Verdana, Georgia, Times New Roman, Consolas
**size secenekleri**: 32, 40, 48, 52, 64, 80

---

## 4. FRONTEND PREVIEW SISTEMI (Canvas)

### 4.1 Onizleme Canvas'i

- HTML canvas: `width="960" height="540"` (CSS ile responsive)
- Icerik 1920x1080 olarak render edilir, tarayici scale eder
- `requestAnimationFrame` ile 60fps oynatma

### 4.2 Gorsel Render Mantigi

**Statik gorsel (Ken Burns kapali):**

```javascript
_drawImageScaled(ctx, img, W, H, fitMode) {
    const imgR = img.width / img.height;
    const canR = W / H;

    if (fitMode === 'fill') {
        // Ekrani doldur, fazlayi kirp (YouTube icin ideal)
        if (imgR > canR) {
            dh = H; dw = H * imgR; dx = (W - dw) / 2; dy = 0;
        } else {
            dw = W; dh = W / imgR; dx = 0; dy = (H - dh) / 2;
        }
    } else if (fitMode === 'stretch') {
        dx = 0; dy = 0; dw = W; dh = H; // Oran bozulur
    } else { // fit
        // Siyah seritli sigdir
        if (imgR > canR) {
            dw = W; dh = W / imgR; dx = 0; dy = (H - dh) / 2;
        } else {
            dh = H; dw = H * imgR; dx = (W - dw) / 2; dy = 0;
        }
    }
    ctx.drawImage(img, dx, dy, dw, dh);
}
```

**Ken Burns efekti:**

```javascript
_drawImageWithKenBurns(ctx, img, W, H, scale, centerX, centerY) {
    // Fill mode ile temel boyut hesapla
    const imgR = img.width / img.height;
    const canR = W / H;
    let baseW, baseH;
    if (imgR > canR) {
        baseH = H; baseW = H * imgR;   // Genis gorsel
    } else {
        baseW = W; baseH = W / imgR;   // Dar/kare gorsel
    }

    // Scale uygula — gorsel buyur
    const drawW = baseW * scale;
    const drawH = baseH * scale;

    // Offset hesapla — gorunmeyen kisim kirpilir
    const offsetX = -(drawW - W) * centerX;
    const offsetY = -(drawH - H) * centerY;

    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
}
```

**Onemli**: Ken Burns her zaman fill mode kullanir. fitMode sadece statik gorseller icin gecerli.

### 4.3 Gecis Efekti (Transition) — Preview

Sadece basit alpha blend uygulanir:

```javascript
if (transition.type !== 'none') {
    const progress = (time - transStart) / transDur;
    ctx.globalAlpha = 1 - progress;
    this._drawImageClip(ctx, prevClip, time, W, H, 1 - progress);
    ctx.globalAlpha = 1;
}
```

**SORUN**: Tum gecis turleri (fade, dissolve, slide, wipe) ayni alpha-blend ile gosteriliyor. Sadece fade dogru calisiyor, digerleri gercek efektlerini gostermiyor.

### 4.4 Altyazi Render

- Font boyutu canvas yuksekligine gore olceklenir: `fontSize * (H / 1080)`
- Metin 85% genislikte word-wrap yapilir
- Outline (stroke) once, dolgu (fill) sonra cizilir
- Golge sadece outline katmanina uygulanir (cift golge onlenir)
- Animasyonlar: fadeIn (ilk %25'te), typewriter (karakter karakter)

### 4.5 Ses Oynatma

- Her ses klibi icin ayri `Audio` nesnesi
- Volume: fade in/out hesaplanarak uygulanir
- Speed: `playbackRate` ile
- Senkronizasyon: `currentTime = elapsed * speed`, 0.5sn sapma toleransi
- Aktif olmayan sesler `pause()` edilir

---

## 5. FFMPEG EXPORT PIPELINE (Backend)

### 5.1 Render Adimlari

```
1. Gorselleri temp dizine kopyala              [%5]
2. Sesleri temp dizine kopyala                 [%8]
3. Her gorsel klip -> ayri MP4                 [%10-55]
4. Tum klipleri birlestir (concat)             [%58]
5. ASS altyazi dosyasi olustur                 [%68]
6. Ses islemleri (trim, speed, pitch, mix)     [%73]
7. Final birlestirme (video + ses + altyazi)   [%85]
8. Cikti dizinine tasi                         [%95]
```

### 5.2 Ken Burns FFmpeg Filtresi

```python
# 1) Gorsel boyutunu ffprobe ile oku
imgW, imgH = self._get_image_size(img_path)

# 2) Fill mode ile temel boyut (preview ile ayni)
imgR = imgW / imgH
canR = W / H
if imgR > canR:
    baseW = H * imgR;  baseH = H
else:
    baseW = W;          baseH = W / imgR

# 3) Buffer = base * max_scale
bufW = int(baseW * max_s / 2) * 2
bufH = int(baseH * max_s / 2) * 2

# 4) FFmpeg filter chain:
# scale={bufW}:{bufH}:flags=lanczos,
# crop=w={W*max_s/scale}:h={H*max_s/scale}:x={(bufW-crop_w)*cx}:y={(bufH-crop_h)*cy}:exact=1,
# scale={W}:{H}:flags=lanczos,
# fps={FPS},format=yuv420p
```

**t interpolasyonu**: `t = n / (frames - 1)` — 0.0'dan 1.0'a

### 5.3 Statik Klip FFmpeg Filtresi

```python
if fit == "fill":
    vf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
elif fit == "stretch":
    vf = f"scale={W}:{H},setsar=1"
else:  # fit
    vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
```

### 5.4 Ses Isleme

Her ses klibi icin sirayla:
1. `atrim=0:{dur}` + `asetpts=PTS-STARTPTS` — kesilme
2. `atempo={speed}` — hiz (0.5-2.0x)
3. `asetrate=44100*{ratio},aresample=44100` — pitch
4. `volume={vol}` — ses seviyesi
5. `afade=t=in/out` — fade efektleri
6. `adelay={ms}|{ms}` — timeline pozisyonu (gecikme)

Birden fazla ses: `amix=inputs=N:duration=longest:normalize=0`

### 5.5 Altyazi (ASS Format)

```
[V4+ Styles]
Style: Default, Segoe UI, 52, &H00FFFFFF, ..., Bold, Outline, Shadow, Alignment

[Events]
Dialogue: 0, 0:00:02.00, 0:00:05.00, Default,,0,0,0,,Merhaba dunya
```

- 45+ karakter satirlar `\N` ile bolunur
- fadeIn animasyonu: `{\fad(250,0)}` ASS tagi
- Renk donusumu: HEX -> ASS `&H00BBGGRR` formati

### 5.6 Kalite ve Encoder

| Kalite | CPU (libx264) | NVIDIA (h264_nvenc) |
|--------|---------------|---------------------|
| hizli  | preset=fast, crf=25 | preset=p1, qp=28 |
| normal | preset=medium, crf=21 | preset=p4, qp=22 |
| yuksek | preset=slow, crf=17 | preset=p5, qp=18 |

GPU encoder tespit sirasi: NVIDIA NVENC > AMD AMF > Intel QSV > CPU libx264

Final cikti: `-c:a aac -b:a 320k -ar 44100 -movflags +faststart`

### 5.7 Klip Birlestirme

```
ffmpeg -f concat -safe 0 -i concat.txt -c copy merged.mp4
```

Yani her klip ayri encode edilir, sonra `-c copy` ile sifir-maliyetli birlestirme yapilir.

---

## 6. TIMELINE SISTEMI (Canvas)

### 6.1 Gorunum

```
+--[  0s    1s    2s    3s    4s    5s  ]--+  <- Cetvel (28px)
|  [  gorsel_01.png  ][  gorsel_02.png  ]  |  <- Video track (56px)
|  [=====  ses_01.wav  =================]  |  <- Audio track (56px)
|     [ Merhaba ]   [ Dunya ]              |  <- Subtitle track (56px)
+--[ playhead | ]--------- snap guide -----+
```

### 6.2 Etkilesimler

- **Klip tasima**: Surukle-birak, yapisma (snap), cakisma onleme
- **Klip boyutlandirma**: Sol/sag kenardan (8px algilama bolgesi)
- **Cetvel tiklamasi**: Playhead konumlandirma
- **Zoom**: Ctrl+tekerlek (10x-300x), fit-to-content
- **Kaydirma**: Tekerlek ile yatay
- **Sag tiklama**: Cogalt, Bol, Sil

### 6.3 Klavye Kisayollari

| Tus | Islem |
|-----|-------|
| Space | Oynat/Duraklat |
| Delete/Backspace | Secili klibi sil |
| Ctrl+Z | Geri al |
| Ctrl+Y | Yinele |
| Ctrl+D | Cogalt |
| Ctrl+S | Kaydet |
| Sol ok | 1 kare geri |
| Sag ok | 1 kare ileri |
| Home | Basa don |
| End | Sona git |

---

## 7. UI YAPISI

```
+-----------------------------------------------------------+
|  Toolbar: [<-] [Kaydet] [Geri Al] [Yinele] [Export]       |  44px
+----------+--------------------------+---------------------+
|  Medya   |                          |  Ozellikler         |
|  Kutupha |     Preview Canvas       |  Paneli             |
|  nesi    |     (960x540)            |                     |
|  [Gorsel]|                          |  - Baslangic        |
|  [Ses]   |                          |  - Sure             |
|  [Alt.]  |                          |  - Gecis            |
|          |  [|<] [<] [>] [>|] [>>]  |  - Ken Burns        |
|  250px   |                          |  - Sigdirma         |
+----------+--------------------------+  - Parlaklik        |
|  Timeline Canvas                    |  - Kontrast         |
|  [Cetvel________________________]   |                     |
|  [Video: gorsel_01 | gorsel_02  ]   |  260px              |
|  [Audio: ses_01.wav             ]   |                     |
|  [Sub:   Merhaba | Dunya       ]   |                     |
|  240px                              +---------------------+
+-----------------------------------------------------------+
```

---

## 8. API ENDPOINT'LERI

| Endpoint | Method | Aciklama |
|----------|--------|----------|
| `/api/editor/render` | POST | Proje render et (body: {project, baslik, kalite}) |
| `/api/editor/audio-meta/{file}` | GET | Ses dosyasi suresi |
| `/api/editor/altyazi-parcala` | POST | Metni zamanli altyazilara bol |
| `/api/editor/project/save` | POST | Proje kaydet (body: {ad, project}) |
| `/api/editor/project/load/{name}` | GET | Proje yukle |
| `/api/editor/project/list` | GET | Kayitli projeleri listele |
| `/api/editor/project/delete/{name}` | DELETE | Proje sil |
| `/api/gorsel-yukle` | POST | Gorsel yukle (multipart) |
| `/api/gorsel-sil/{file}` | DELETE | Gorsel sil |
| `/api/video-kaynaklar` | GET | Mevcut gorseller ve sesler |
| `/api/is-durumu/{id}` | GET | Is takibi (ilerleme + durum) |
| `/images/{file}` | GET | Gorsel dosyasi sun |
| `/outputs/{file}` | GET | Ses dosyasi sun |
| `/videos/{file}` | GET | Video dosyasi sun |

---

## 9. BILINEN SORUNLAR VE SINIRLAMALAR

### 9.1 Ken Burns Export/Preview Uyumsuzlugu (KRITIK)

**Sorun**: Preview'de gorsel merkezden disariya dogru uniform zoom yaparken, export'ta yukaridan asagiya dogru kayma/pan efekti olustuyor.

**Muhtemel sebepler**:
- FFmpeg expression-based crop ifadeleri compile-time sabit degerler ile runtime `iw/ih` degerleri arasinda fark olusabilir
- `trunc()` yuvarlama farklari piksel kaymalarina yol acar
- FFmpeg'in `exact=1` crop modu ile expression degerlendirmesi arasinda tutarsizlik olabilir
- Ayni gorselin farkli boyutlarda (kare 512x512 vs dikdortgen) farkli davranmasi

**Denenen cozumler**:
1. `force_original_aspect_ratio=increase` + sabit crop -> gorsel oranini bozuyordu
2. Python'da gorsel boyutu okuyup kesin piksel buffer -> matematiksel olarak dogru ama pratikte hala kaydirma goruluyor
3. `t = n/(frames-1)` duzeltmesi -> son frame interpolasyonu duzeltildi ama temel sorun devam ediyor

**Olasi kok neden**: FFmpeg expression engine'inin `trunc()` fonksiyonu her frame'de farkli yuvarlama yaparak asimetrik crop kaymasina neden oluyor olabilir. Alternatif yaklasim gerekli (zoompan filtresi veya farkli strateji).

### 9.2 Gecis Efektleri Eksik

**Sorun**: 9 farkli gecis turu tanimli (fade, dissolve, slide*, wipe*) ama:
- **Preview**: Hepsi ayni alpha-blend ile gosteriliyor
- **Export**: Gecis efektleri hic uygulanmiyor (sadece kesme gecis)

### 9.3 Tek Video Track

Sadece 1 video track var. Gorsel ustune gorsel bindirme (overlay/PiP) mumkun degil.

### 9.4 Efekt Kisitlamalari

- Parlaklik/kontrast preview'de basit overlay ile, export'ta FFmpeg `eq` filtresi ile yapiliyor (gorsel fark var)
- Renk duzeltme (color grading) yok
- Hareket animasyonlari (slide in/out, bounce) yok
- Filtreler (blur, vignette, sepia) yok
- Yazi/metin overlay (altyazi disinda) yok

### 9.5 Altyazi Kisitlamalari

- Kelime bazli vurgulama yok (CapCut'taki gibi aktif kelime highlight)
- Ozel font yukleme yok
- Altyazi pozisyonu sadece 3 konum (ust/orta/alt), pixel-bazli drag yok
- Altyazi animasyonlari sinirli (3 tur)

### 9.6 Performans

- Her frame'de tum timeline canvas yeniden ciziliyor
- Gorsel cache siniri 60 (buyuk projelerde yetersiz olabilir)
- Export sirasinda GPU encoder tespiti var ama Ken Burns clip'leri her zaman CPU (libx264) ile render ediliyor

---

## 10. CAPCUT ILE KARSILASTIRMA

| Ozellik | Voxtory (Mevcut) | CapCut |
|---------|--------------------|--------|
| Timeline katmanlari | 3 (video, ses, altyazi) | Sinirsiz |
| Gorsel ustune gorsel | Yok | PiP, overlay, chroma key |
| Gecis efektleri | 9 tur (sadece fade calisiyor) | 100+ animasyonlu gecis |
| Ken Burns | Zoom + pan | Keyframe tabanli animasyon |
| Filtreler | Parlaklik + kontrast | 50+ filtre (LUT, blur, glow...) |
| Altyazi | Basit styling | Kelime vurgulama, animasyonlu template |
| Ses | Volume, speed, pitch, fade | + equalizer, noise reduction, beat sync |
| Keyframe | Yok | Her parametre icin keyframe |
| Maske/Kirpma | Yok | Serbest kirpma, maske sekilleri |
| Yazi/Sticker | Yok | Metin overlay, sticker, emoji |
| Renk duzeltme | Yok | Curves, HSL, white balance |
| Video icerigi | Sadece gorsel (statik) | Video + gorsel |
| Preview dogrulugu | Export ile fark var | WYSIWYG |

---

## 11. SENDEN ISTENEN

### 11.1 Benim Is Akisim

Ben YouTube icin Turkce icerik uretiyorum. Tipik is akisim:
1. Bir hikaye/senaryo yaziyorum
2. TTS ile seslendiriyorum (Piper TTS — bu kisim tamam, dokunma)
3. Hikayeye uygun gorseller ekliyorum (statik PNG/JPG, video degil)
4. Video editor'de gorselleri timeline'a diziyorum, sesi ekliyorum, altyazi ekliyorum
5. Export edip YouTube'a yukluyorum

**Sorunum**: 4 ve 5. adimlarda. Video editor'un ciktisi profesyonel gorsel kalitede degil. Ayni islemi CapCut'ta yaptigimda cok daha iyi sonuc aliyorum. Bu uygulamayi CapCut'a ihtiyac duymayacagim seviyeye getirmek istiyorum.

### 11.2 En Kritik Sorunlar (Oncelik Sirasina Gore)

**1. PREVIEW-EXPORT UYUMSUZLUGU (EN ACIL)**
Preview'de gordugum sey ile export edilen video birbirini tutmuyor. Ozellikle:
- Ken Burns zoom efekti preview'de merkezden disariya buyurken, export'ta yukari-asagi kaydirma gibi gorunuyor
- Bu sorun defalarca duzeltilmeye calisildi, matematiksel olarak dogru gorunse de pratikte hala fark var
- FFmpeg expression-based crop yaklasimi guvenilmez gozukuyor

**2. GECIS EFEKTLERI CALISMIYOR**
9 tur gecis tanimli ama:
- Preview'de hepsi ayni alpha-blend
- Export'ta gecis efekti hic yok (hard cut)
- YouTube videolarinda akici gecisler sart

**3. SINIRLI EFEKT SISTEMI**
CapCut'a kiyasla cok az sey var:
- Sadece parlaklik/kontrast (ve bunlar bile preview ile export'ta farkli gorunuyor)
- Filtre yok (blur, vignette, sepia, color grading)
- Keyframe animasyon yok
- Altyazi animasyonlari cok basit

### 11.3 Senden Bekledigim Cikti

Yukaridaki mimariyi analiz et ve bana bir **uygulama promptu** yaz. Bu promptu Claude kodlama asistanina verecegim ve o mevcut kodu iyilestirecek.

Promptun su konulari kapsamali:

1. **Ken Burns / zoom efektinin export'ta preview ile birebir ayni calismasini saglayacak guvenilir bir FFmpeg stratejisi** — mevcut expression-based crop calismadi, alternatif ne? (zoompan? per-frame render? baska?)

2. **Gecis efektlerinin hem preview hem export'ta gercekten calismasi** — FFmpeg xfade kullanimi, preview'de canvas animasyonlari

3. **YouTube'a optimize cikti** — 1920x1080 16:9, siyah serit yok, her gorsel boyutunda dogru sonuc

4. **Daha zengin ama uygulanabilir efektler** — CapCut'un her ozelligini istemiyorum, ama YouTube videolari icin gereken temel seyler:
   - Akici gecisler (fade, dissolve, slide en az)
   - Daha iyi altyazi (animasyon cesitliligi, belki kelime vurgulama)
   - Temel filtreler (opsiyonel, oncelik degil)

5. **WYSIWYG garantisi** — ne onerirsem onerin, preview ile export ayni gorunmeli

Promptu yazarken:
- Mevcut dosya yapisini koru (hangi dosya ne is yapiyor belli)
- Mevcut API endpoint yapisini koru
- Sadece video edit pipeline'ini iyilestir, TTS/arsiv/diger sayfalara dokunma
- Her degisiklik icin hem frontend (JS canvas) hem backend (FFmpeg) tarafini belirt
- Somut ol — "su fonksiyonu su sekilde degistir" seviyesinde yaz
