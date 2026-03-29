#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Voxtory — Build Script
PyInstaller ile EXE paketleme + Piper/FFmpeg kopyalama.

Kullanım: python build.py
Çıktı:    dist/Voxtory/
"""

import os
import sys
import subprocess
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, "dist", "Voxtory")
PYTHON = sys.executable


def find_ffmpeg_exe():
    """Sistemdeki ffmpeg.exe yolunu bul."""
    # 1. PATH
    path = shutil.which("ffmpeg")
    if path:
        return path

    # 2. WinGet
    winget_base = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages")
    if os.path.isdir(winget_base):
        for klasor in os.listdir(winget_base):
            if "FFmpeg" in klasor:
                for kok, _, dosyalar in os.walk(os.path.join(winget_base, klasor)):
                    if "ffmpeg.exe" in dosyalar:
                        return os.path.join(kok, "ffmpeg.exe")
    return None


def main():
    print("\n" + "=" * 60)
    print("  Voxtory — Build")
    print("=" * 60)

    # ─── 1. PyInstaller ──────────────────────────
    print("\n[1/4] PyInstaller ile EXE oluşturuluyor...")

    cmd = [
        PYTHON, "-m", "PyInstaller",
        "--noconfirm",
        "--name", "Voxtory",
        "--windowed",
        "--icon", "static/icon.ico",
        "--add-data", "templates;templates",
        "--add-data", "static;static",
        "--add-data", "app;app",
        "--hidden-import", "flask",
        "--hidden-import", "webview",
        "--collect-all", "webview",
        "main.py",
    ]

    result = subprocess.run(cmd, cwd=BASE_DIR)
    if result.returncode != 0:
        print("HATA: PyInstaller başarısız!")
        sys.exit(1)

    # ─── 2. Piper TTS kopyala ────────────────────
    print("\n[2/4] Piper TTS kopyalanıyor...")

    # tts/ klasorundan kopyala (her zaman eksiksiz)
    piper_src = os.path.join(BASE_DIR, "tts")
    piper_dst = os.path.join(DIST_DIR, "piper_data")

    if os.path.isdir(piper_src) and os.path.isfile(os.path.join(piper_src, "piper.exe")):
        if os.path.isdir(piper_dst):
            shutil.rmtree(piper_dst)
        shutil.copytree(piper_src, piper_dst,
                        ignore=shutil.ignore_patterns("texts", "outputs", "__pycache__"))
        print(f"  Kopyalandi: tts/ -> piper_data/")
    else:
        print(f"  UYARI: tts/ klasorunde piper.exe bulunamadi!")

    # ─── 3. FFmpeg kopyala ───────────────────────
    print("\n[3/4] FFmpeg kopyalanıyor...")

    ffmpeg_src = find_ffmpeg_exe()
    if ffmpeg_src:
        ffmpeg_dst = os.path.join(DIST_DIR, "ffmpeg.exe")
        shutil.copy2(ffmpeg_src, ffmpeg_dst)
        print(f"  Kopyalandı: {ffmpeg_src}")
        size_mb = os.path.getsize(ffmpeg_dst) / (1024 * 1024)
        print(f"  Boyut: {size_mb:.0f} MB")
    else:
        print("  UYARI: FFmpeg bulunamadı! Kullanıcının sisteminde olmalı.")

    # ─── 4. Kontroller ───────────────────────────
    print("\n[4/4] Kontroller...")
    print(f"  Kullanıcı verileri: %LOCALAPPDATA%\\Voxtory (çalışma zamanında oluşturulur)")

    # ─── Sonuç ───────────────────────────────────
    total_size = 0
    for dirpath, _, filenames in os.walk(DIST_DIR):
        for f in filenames:
            total_size += os.path.getsize(os.path.join(dirpath, f))
    total_mb = total_size / (1024 * 1024)

    print("\n" + "=" * 60)
    print(f"  Build tamamlandı!")
    print(f"  Klasör: {DIST_DIR}")
    print(f"  Toplam: {total_mb:.0f} MB")
    print(f"  Çalıştır: Voxtory.exe")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
