import os
import sys

# PyInstaller frozen exe desteği
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Kullanıcı verileri: geliştirme modunda proje klasörü, paketlenmiş EXE'de %LOCALAPPDATA%\Voxtory
if getattr(sys, 'frozen', False):
    DATA_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Voxtory")
else:
    DATA_DIR = BASE_DIR

TTS_DIR = os.path.join(DATA_DIR, "tts")
METINLER_DIR = os.path.join(TTS_DIR, "texts")
CIKTILAR_DIR = os.path.join(TTS_DIR, "outputs")
GORSELLER_DIR = os.path.join(DATA_DIR, "images")
VIDEOLAR_DIR = os.path.join(DATA_DIR, "videos")

# Piper — ASCII-safe yol gerekli (Türkçe karakter crash eder)
# Sırayla kontrol: exe yanı → C:\ProgramData → LOCALAPPDATA
_piper_candidates = [
    os.path.join(BASE_DIR, "piper_data"),
    os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "piper_data"),
    os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "piper_data"),
]

PIPER_SAFE_DIR = _piper_candidates[-1]  # varsayılan
for _candidate in _piper_candidates:
    if os.path.isdir(_candidate) and os.path.isfile(os.path.join(_candidate, "piper.exe")):
        PIPER_SAFE_DIR = _candidate
        break

PIPER_EXE = os.path.join(PIPER_SAFE_DIR, "piper.exe")
MODEL_PATH = os.path.join(PIPER_SAFE_DIR, "tr_TR-dfki-medium.onnx")
ESPEAK_DATA = os.path.join(PIPER_SAFE_DIR, "espeak-ng-data")

# Klasörleri oluştur
for d in [METINLER_DIR, CIKTILAR_DIR, GORSELLER_DIR, VIDEOLAR_DIR]:
    os.makedirs(d, exist_ok=True)
