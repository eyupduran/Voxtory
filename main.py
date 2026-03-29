#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Voxtory — Masaüstü Uygulaması
PyWebView ile Flask sunucusunu native pencerede açar.
"""

import os
import sys
import traceback
import threading
import time
import socket

# pythonw ile çalışırken stdout/stderr None olabilir
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

# Uygulama dizinini ayarla
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(BASE_DIR)
sys.path.insert(0, BASE_DIR)

LOG_FILE = os.path.join(BASE_DIR, "hata_log.txt")


def hata_kaydet(mesaj):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {mesaj}\n")
    except Exception:
        pass


def port_musait_mi(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def bos_port_bul(baslangic=5000):
    for port in range(baslangic, baslangic + 100):
        if port_musait_mi(port):
            return port
    return baslangic


def sunucu_baslat(port):
    from server import app
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


def sunucu_hazir_mi(port, timeout=15):
    baslangic = time.time()
    while time.time() - baslangic < timeout:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


def main():
    import signal
    import webview

    signal.signal(signal.SIGINT, lambda *_: os._exit(0))

    port = bos_port_bul(5000)

    # Flask'ı arka planda başlat
    sunucu = threading.Thread(target=sunucu_baslat, args=(port,), daemon=True)
    sunucu.start()

    if not sunucu_hazir_mi(port):
        hata_kaydet("Sunucu başlatılamadı! Port: " + str(port))
        sys.exit(1)

    # PyWebView native pencere
    pencere = webview.create_window(
        title="Voxtory",
        url=f"http://127.0.0.1:{port}",
        width=1200,
        height=800,
        min_size=(900, 600),
        resizable=True,
        text_select=True,
        confirm_close=False,
    )

    webview.start(gui="edgechromium", debug=False)

    # Pencere kapandı — temizlik
    pid = os.getpid()
    try:
        import subprocess
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=0x08000000,
        )
    except Exception:
        pass
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        hata_kaydet(traceback.format_exc())
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0,
                f"Voxtory başlatılırken hata oluştu:\n\n{str(e)}\n\nDetay için hata_log.txt dosyasına bakın.",
                "Voxtory - Hata",
                0x10,
            )
        except Exception:
            pass
        sys.exit(1)
