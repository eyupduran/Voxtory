# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Voxtory** is a Turkish-language, fully offline content production pipeline with a CapCut-style video editor. It generates narrated videos from text using local AI tools: Piper TTS for speech synthesis, Whisper for transcription (optional), and FFmpeg for video assembly. The app is a **native Windows desktop application** using Flask + PyWebView.

All UI text, variable names, function names, comments, and error messages are in **Turkish**. Maintain this convention.

## Architecture

```
main.py                      <- Entry point (PyWebView launcher, starts Flask in background)
server.py                    <- Flask API (thin layer calling core modules)
app/
  core/                      <- Business logic (no UI/Flask dependency)
    paths.py                 <- Filesystem path constants, Piper location detection
    ffmpeg_utils.py          <- FFmpeg detection, GPU encoder detection, audio duration helper
    tts_engine.py            <- Piper TTS: 6 voice profiles, sentence-level timing (.timing.json)
    video_engine.py          <- FFmpeg video pipeline: clips, concat, ASS subtitles
    project_renderer.py      <- Editor project JSON -> FFmpeg renderer (overlays, text, filters)
    transcriber.py           <- Faster-Whisper speech-to-text (optional)
    subtitle_utils.py        <- SRT/ASS subtitle generation, silence detection, sync alignment
    job_manager.py           <- Background thread management with progress callbacks
templates/
  base.html                  <- Main layout (sidebar + includes pages)
  pages/
    tts.html                 <- Ses Üretimi page
    editor.html              <- Video Editör page (CapCut-like timeline editor)
    archive.html             <- Arşiv page
static/
  css/
    base.css                 <- Reset, colors, layout, splash, scrollbar, editor-mode sidebar hide
    sidebar.css              <- Sidebar navigation styles
    components.css           <- Card, button, form, progress, toast, file-list
    pages.css                <- Pipeline cards, image grid, video thumb selector
    editor.css               <- Video editor: layout, timeline, panels, preview, filter grid, text templates, track controls
  js/
    app.js                   <- Navigation, toast, system status, splash, editor-mode toggle
    tts.js                   <- TTS page logic
    editor/                  <- Video editor modules
      editor-core.js         <- Project model, multi-track management, clip CRUD, overlay/text clips, undo/redo
      editor-timeline.js     <- Canvas-based timeline rendering, dynamic track headers, drop handler
      editor-preview.js      <- Canvas preview, overlay/text render, drag-to-position, resize handles, audio preload
      editor-panels.js       <- Media library, properties panel, auto-subtitle with style, text templates
      editor-export.js       <- Export dialog + backend communication
      editor-init.js         <- Initialization, keyboard shortcuts, project I/O, track add menu, beforeunload guard
  icon.svg                   <- App icon (SVG source)
  icon.ico                   <- App icon (Windows ICO)
  icon.png                   <- App icon (PNG)
```

## Running the App

```bash
# Development (Flask directly, opens in browser)
python server.py

# Desktop mode (native PyWebView window)
python main.py

# Build standalone EXE
python build.py

# Then compile installer with Inno Setup:
# Open installer.iss -> Build -> Compile
```

## Dependencies

**pip:** `flask`, `pywebview`, `Pillow` (for build icon only)

**External tools:** Piper TTS (`piper.exe`), FFmpeg — resolved at runtime. Piper searched in: app directory > `C:\ProgramData\piper_data` > `%LOCALAPPDATA%\piper_data`.

## Key Technical Details

- **Piper TTS sentence timing:** `tts_engine.py` generates audio sentence-by-sentence, measures each WAV duration with Python `wave` module, saves cumulative timing as `.timing.json`. This provides exact subtitle sync without Whisper.
- **Piper path detection** (`paths.py`): Checks three locations in order: exe directory, `C:\ProgramData\piper_data`, `%LOCALAPPDATA%\piper_data`.
- **Multi-track editor:** Project supports unlimited tracks: video, overlay, text, audio, subtitle. Track order enforced: video > overlay > text > audio > subtitle. Dynamic add/remove with `addTrack()`/`removeTrack()`.
- **Overlay system:** Image overlays with position (0-1 normalized), size, opacity. Canvas drag-to-position and corner-handle resize. FFmpeg `overlay` filter for export.
- **Text overlay system:** 7 templates (title, subtitle, CTA, quote, section, counter, location). 10 enter animations + exit animations. Background box with color/padding/border-radius. FFmpeg `drawtext` filter for export.
- **Filter system:** 9 preset filters (cinematic, warm, cool, vintage, bw, vivid, muted, dramatic, dreamy). Preview uses CSS `ctx.filter`, export uses FFmpeg `eq`/`colorbalance`/`gblur`/`unsharp`/`vignette`/`noise`.
- **Canvas interaction:** Preview canvas supports click-to-select, drag-to-move, corner-handle resize for text/overlay clips. Bounding boxes stored per-render for hit testing.
- **Auto subtitle:** Audio clip panel has "Otomatik Altyazı Oluştur" — reads `.timing.json` for exact sync, falls back to character-ratio splitting. Style selection (position, size, color, animation) and bulk apply/clear.
- **Sidebar hide:** Editor layout hides sidebar via `.editor-mode-active` class on `.app`. Sidebar returns on welcome screen.
- **PyInstaller bundling** (`build.py`): Templates/static go into `sys._MEIPASS`, Piper/FFmpeg copied alongside the exe. `server.py` uses `_BUNDLE_DIR` for Flask template/static paths in frozen mode.
- **Modular frontend:** Each page is a separate HTML template (`{% include %}`), each feature has its own JS file. Adding a new page: create HTML in `templates/pages/`, JS in `static/js/`, add nav-item to `base.html`, add routes to `server.py`.
- **Job tracking:** Background tasks use `isler` dict with UUID keys, polled from frontend via `/api/is-durumu/<id>`.
- **Installer:** Inno Setup (`installer.iss`) packages dist folder. Piper data goes to `{commonappdata}\piper_data` (ASCII-safe `C:\ProgramData`).
- **beforeunload guard:** Unsaved changes trigger browser/PyWebView confirmation on window close.
