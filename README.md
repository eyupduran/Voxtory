# Voxtory

Yapay zeka araçlarıyla tamamen yerel (çevrimdışı) çalışan, ücretsiz ve sınırsız kullanılabilen bir içerik üretim ve video düzenleme uygulaması.

## Özellikler

### Ses Üretimi (TTS)
- **Piper TTS** ile Türkçe metin seslendirme
- 6 farklı ses profili (Anlatıcı, Yavaş & Dramatik, Hızlı, Fısıltılı, Enerjik, Derin & Ciddi)
- Cümle bazlı zamanlama verisi — altyazı senkronizasyonu için otomatik `.timing.json` üretimi
- Toplu paragraf işleme, MP3 çıktı
 
### Video Editör (CapCut Tarzı)
- **Çoklu track sistemi** — Görsel, Overlay, Metin, Ses, Altyazı track'leri
- **Dinamik track ekleme/silme** — Sınırsız overlay ve metin katmanı
- **Ken Burns efekti** — Zoom/pan animasyonu (preview + export uyumlu)
- **9 geçiş efekti** — Fade, dissolve, slide, wipe (FFmpeg xfade ile)
- **9 preset görsel filtre** — Sinematik, sıcak, soğuk, vintage, siyah-beyaz, canlı, pastel, dramatik, rüya
- **Renk düzeltme** — Parlaklık, kontrast, doygunluk, sıcaklık, keskinlik, bulanıklık, vinyet, grenaj
- **Metin/başlık overlay** — 7 hazır şablon (Başlık, Alt Başlık, CTA, Alıntı, Bölüm, Sayaç, Lokasyon)
- **10 metin animasyonu** — fadeIn, slideUp/Down/Left/Right, scaleIn, bounceIn, typewriter, popIn
- **Overlay sistemi** — Logo, filigran, PiP (konum, boyut, opaklık ayarlanabilir)
- **Canvas üzerinde sürükle-bırak** — Metin ve overlay'leri doğrudan preview'da konumlandır ve boyutlandır
- **Otomatik altyazı** — TTS metninden cümle bazlı tam senkron altyazı oluşturma
- **Altyazı stil yönetimi** — Konum, boyut, renk, animasyon seçimi + toplu stil uygulama
- **5 altyazı animasyonu** — fadeIn, typewriter, scaleIn, slideUp, none
- **Undo/redo** — 60 adım geri alma
- **Klavye kısayolları** — Space, Ctrl+Z/Y/D/S, Delete, ok tuşları
- **GPU hızlandırma** — NVENC/AMF/QSV otomatik tespit
- **YouTube-optimize çıktı** — bt709, profile high, GOP, B-frame

### Transkript
- **Whisper** ile ses dosyasından otomatik metin çıkarma (opsiyonel)

### Arşiv
- Üretilen ses ve video dosyalarını yönetme, indirme, silme

## İlk Kurulum

### 1. Repoyu klonla

```bash
git clone https://github.com/KULLANICI/Voxtory.git
cd Voxtory
```

### 2. Python bağımlılıklar

Python 3.10+ gerekli.

```bash
pip install flask pywebview Pillow
```

### 3. Piper TTS

Piper dosyaları repo'da yer almaz (~100 MB). Manuel indirip yerleştir:

1. [Piper Releases](https://github.com/rhasspy/piper/releases) sayfasından **piper_windows_amd64.zip** indir
2. ZIP içindeki tüm dosyaları aşağıdaki konumlardan birine çıkart:
   - Uygulama dizini
   - `C:\ProgramData\piper_data` (önerilen — ASCII-safe)
   - `%LOCALAPPDATA%\piper_data`
3. [Piper Voices](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium) sayfasından Türkçe modeli indir:
   - `tr_TR-dfki-medium.onnx`
   - `tr_TR-dfki-medium.onnx.json`
4. Model dosyalarını da aynı klasöre koy

```
piper_data/
├── piper.exe
├── espeak-ng-data/
├── *.dll
├── tr_TR-dfki-medium.onnx
└── tr_TR-dfki-medium.onnx.json
```

### 4. FFmpeg

FFmpeg PATH'te veya WinGet ile kurulu olmalı:

```bash
winget install Gyan.FFmpeg
```

### 5. Çalıştır

```bash
# Masaüstü uygulaması (PyWebView penceresi)
python main.py

# Geliştirme modu (tarayıcıda açar)
python server.py
```

## Build & Paketleme (EXE)

Kullanıcıya dağıtılacak installer oluşturmak için:

```bash
# 1. EXE oluştur
pip install pyinstaller
python build.py

# 2. Installer oluştur (Inno Setup 6 gerekli)
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

Çıktı: `Output/Voxtory_Setup.exe`

Installer her şeyi içerir (Python runtime, Piper, FFmpeg). Son kullanıcı hiçbir şey yüklemek zorunda değil.

## Mimari

```
main.py                      ← Giriş noktası (PyWebView başlatıcı)
server.py                    ← Flask API sunucusu
app/
  core/                      ← İş mantığı (UI bağımsız)
    paths.py                 ← Dosya yolu sabitleri, Piper konum tespiti
    ffmpeg_utils.py          ← FFmpeg tespiti, GPU encoder, ses süresi
    tts_engine.py            ← Piper TTS: 6 ses profili, cümle bazlı zamanlama
    video_engine.py          ← FFmpeg video pipeline: klip, birleştirme, altyazı
    project_renderer.py      ← Editör proje JSON → FFmpeg render (overlay, metin, filtre)
    transcriber.py           ← Faster-Whisper konuşma-metin dönüştürücü
    subtitle_utils.py        ← SRT/ASS altyazı üretimi, sessizlik tespiti
    job_manager.py           ← Arka plan iş yönetimi
templates/
  base.html                  ← Ana sayfa düzeni (sidebar + sayfalar)
  pages/
    tts.html                 ← Ses Üretimi sayfası
    editor.html              ← Video Editör sayfası
    archive.html             ← Arşiv sayfası
static/
  css/                       ← base, sidebar, components, pages, editor stilleri
  js/
    app.js                   ← Navigasyon, bildirim, sistem durumu
    tts.js                   ← TTS sayfa mantığı
    editor/                  ← Video editör modülleri
      editor-core.js         ← Proje modeli, track/klip yönetimi, undo/redo
      editor-timeline.js     ← Canvas tabanlı timeline çizimi + etkileşim
      editor-preview.js      ← Canvas önizleme, overlay render, sürükle-boyutlandır
      editor-panels.js       ← Medya kütüphanesi, özellikler paneli, otomatik altyazı
      editor-export.js       ← Dışa aktarma diyaloğu
      editor-init.js         ← Başlatma, klavye kısayolları, proje I/O
```

## Veri Yolları

| Veri | Geliştirme | Paketlenmiş EXE |
|------|-----------|-----------------|
| Metinler | `tts/texts/` | `%LOCALAPPDATA%\Voxtory\tts\texts\` |
| Ses çıktıları | `tts/outputs/` | `%LOCALAPPDATA%\Voxtory\tts\outputs\` |
| Görseller | `images/` | `%LOCALAPPDATA%\Voxtory\images\` |
| Videolar | `videos/` | `%LOCALAPPDATA%\Voxtory\videos\` |
| Projeler | `projects/` | `%LOCALAPPDATA%\Voxtory\projects\` |

## Lisans

Bu proje özel kullanım amaçlıdır.
