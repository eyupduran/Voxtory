import json
import os
import re
import subprocess
import shutil
import tempfile
import time
import wave
from datetime import datetime
from typing import Callable

from .paths import PIPER_EXE, MODEL_PATH, ESPEAK_DATA, PIPER_SAFE_DIR, METINLER_DIR, CIKTILAR_DIR
from .ffmpeg_utils import find_ffmpeg, SUBPROCESS_FLAGS


def _wav_suresi(wav_yolu: str) -> float:
    """WAV dosyasının süresini saniye olarak döndür (stdlib wave modülü)."""
    try:
        with wave.open(wav_yolu, 'rb') as wf:
            return wf.getnframes() / wf.getframerate()
    except Exception:
        return 0.0


def _cumlelere_bol(metin: str) -> list[str]:
    """Metni cümlelere böl. Nokta, soru işareti, ünlem, üç nokta sonrasından böler."""
    cumleler = re.split(r'(?<=[.!?…])\s+', metin)
    return [c.strip() for c in cumleler if c.strip()]

SES_PROFILLERI = {
    "anlatici": {
        "ad": "Anlatıcı (Varsayılan)",
        "aciklama": "Doğal, sakin hikâye anlatıcısı",
        "length_scale": 1.0,
        "noise_scale": 0.667,
        "noise_w": 0.8,
        "sentence_silence": 0.3,
    },
    "yavas": {
        "ad": "Yavaş & Dramatik",
        "aciklama": "Ağır, derin, gerilim sahneleri için",
        "length_scale": 1.35,
        "noise_scale": 0.5,
        "noise_w": 0.6,
        "sentence_silence": 0.6,
    },
    "hizli": {
        "ad": "Hızlı Anlatım",
        "aciklama": "Tempolu, aksiyonlu sahneler için",
        "length_scale": 0.75,
        "noise_scale": 0.8,
        "noise_w": 0.9,
        "sentence_silence": 0.15,
    },
    "fisiltili": {
        "ad": "Fısıltılı",
        "aciklama": "Alçak, gizemli atmosfer",
        "length_scale": 1.15,
        "noise_scale": 0.9,
        "noise_w": 1.0,
        "sentence_silence": 0.5,
    },
    "enerjik": {
        "ad": "Enerjik",
        "aciklama": "Canlı, yüksek tonlu anlatım",
        "length_scale": 0.85,
        "noise_scale": 0.8,
        "noise_w": 0.5,
        "sentence_silence": 0.2,
    },
    "derin": {
        "ad": "Derin & Ciddi",
        "aciklama": "Kalın, otoriter ses tonu",
        "length_scale": 1.2,
        "noise_scale": 0.4,
        "noise_w": 0.4,
        "sentence_silence": 0.4,
    },
}


def _run_piper(metin: str, output_file: str, profil: dict) -> bool:
    """Piper TTS'i doğrudan subprocess ile çalıştır.

    cwd=PIPER_SAFE_DIR ile Piper kendi dizininden çalışır,
    DLL'ler sorunsuz yüklenir.
    """
    result = subprocess.run(
        [
            PIPER_EXE,
            "--model", "tr_TR-dfki-medium.onnx",
            "--espeak_data", "espeak-ng-data",
            "--length_scale", str(profil["length_scale"]),
            "--noise_scale", str(profil["noise_scale"]),
            "--noise_w", str(profil["noise_w"]),
            "--sentence_silence", str(profil["sentence_silence"]),
            "--output_file", output_file,
        ],
        input=metin,
        capture_output=True, text=True, encoding="utf-8",
        cwd=PIPER_SAFE_DIR,
        creationflags=SUBPROCESS_FLAGS,
    )

    return result.returncode == 0 and os.path.isfile(output_file)


class TTSEngine:
    def __init__(self):
        self.ffmpeg_cmd = find_ffmpeg()

    def profiller(self) -> dict:
        return SES_PROFILLERI

    def generate_preview(self, profil_id: str) -> str | None:
        """Ses profili önizleme dosyası üret. Önbellekten döndürür varsa."""
        if profil_id not in SES_PROFILLERI:
            return None

        profil = SES_PROFILLERI[profil_id]
        onizleme_dir = os.path.join(CIKTILAR_DIR, "_onizleme")
        os.makedirs(onizleme_dir, exist_ok=True)
        dosya = os.path.join(onizleme_dir, f"{profil_id}.wav")

        if not os.path.isfile(dosya):
            ornek_metin = "Karanlık ormanın derinliklerinden garip sesler yükseliyordu. Yolcu bir an duraksadı ve etrafına bakındı."
            _run_piper(ornek_metin, dosya, profil)

        return dosya if os.path.isfile(dosya) else None

    def generate(
        self,
        metin: str,
        dosya_adi: str,
        profil_id: str = "anlatici",
        progress_cb: Callable[[int, str], None] | None = None,
    ) -> str | None:
        """Metinden ses üret. Cümle bazlı zamanlama verisi de kaydeder.

        Üretim akışı:
        1. Metin → cümlelere böl
        2. Her cümle ayrı WAV olarak Piper ile üret
        3. Her WAV'ın gerçek süresini wave modülüyle ölç
        4. Zamanlama verisini .timing.json dosyasına kaydet
        5. WAV'ları birleştir → MP3'e çevir
        """
        profil = SES_PROFILLERI.get(profil_id, SES_PROFILLERI["anlatici"])

        def rapor(yuzde, mesaj):
            if progress_cb:
                progress_cb(yuzde, mesaj)

        # Metni kaydet
        metin_dosya = os.path.join(METINLER_DIR, f"{dosya_adi}.txt")
        with open(metin_dosya, "w", encoding="utf-8") as f:
            f.write(metin)

        # Cümlelere böl
        cumleler = _cumlelere_bol(metin)
        if not cumleler:
            cumleler = [metin]

        toplam = len(cumleler)
        rapor(5, f"{toplam} cümle işlenecek ({profil['ad']})...")

        gecici = tempfile.mkdtemp(prefix="piper_desktop_", dir=PIPER_SAFE_DIR)
        parca_dosyalari = []
        zamanlama = []  # [{ "metin": str, "baslangic": float, "bitis": float }]
        kumulatif = 0.0
        baslangic = time.time()

        for i, cumle in enumerate(cumleler, 1):
            rapor(int((i - 1) / toplam * 85), f"Cümle {i}/{toplam} seslendiriliyor...")

            parca = os.path.join(gecici, f"s_{i:04d}.wav")
            if _run_piper(cumle, parca, profil):
                sure = _wav_suresi(parca)
                parca_dosyalari.append(parca)
                zamanlama.append({
                    "metin": cumle,
                    "baslangic": round(kumulatif, 3),
                    "bitis": round(kumulatif + sure, 3),
                })
                kumulatif += sure

        if not parca_dosyalari:
            shutil.rmtree(gecici, ignore_errors=True)
            rapor(0, "Ses üretilemedi. Piper TTS veya bash kurulu mu kontrol et.")
            return None

        # Zamanlama verisini kaydet
        zamanlama_dosya = os.path.join(METINLER_DIR, f"{dosya_adi}.timing.json")
        with open(zamanlama_dosya, "w", encoding="utf-8") as f:
            json.dump(zamanlama, f, ensure_ascii=False, indent=2)

        # Birleştir
        rapor(88, "Parçalar birleştiriliyor...")
        cikti_wav = os.path.join(CIKTILAR_DIR, f"{dosya_adi}.wav")

        if len(parca_dosyalari) == 1:
            shutil.copy2(parca_dosyalari[0], cikti_wav)
        else:
            liste = os.path.join(gecici, "list.txt")
            with open(liste, "w", encoding="utf-8") as f:
                for p in parca_dosyalari:
                    f.write(f"file '{p.replace(chr(92), '/')}'\n")
            subprocess.run(
                [self.ffmpeg_cmd, "-y", "-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", cikti_wav],
                capture_output=True, creationflags=SUBPROCESS_FLAGS,
            )

        shutil.rmtree(gecici, ignore_errors=True)

        if not os.path.isfile(cikti_wav):
            rapor(0, "Birleştirme başarısız oldu.")
            return None

        # WAV → MP3
        rapor(95, "MP3'e dönüştürülüyor...")
        cikti_mp3 = os.path.join(CIKTILAR_DIR, f"{dosya_adi}.mp3")
        subprocess.run(
            [self.ffmpeg_cmd, "-y", "-i", cikti_wav, "-codec:a", "libmp3lame", "-b:a", "192k", cikti_mp3],
            capture_output=True, creationflags=SUBPROCESS_FLAGS,
        )

        if os.path.isfile(cikti_mp3):
            os.remove(cikti_wav)
            sure = time.time() - baslangic
            boyut = os.path.getsize(cikti_mp3) / (1024 * 1024)
            rapor(100, f"Tamamlandı! ({boyut:.1f} MB, {sure:.1f} sn, {toplam} cümle)")
            return cikti_mp3
        else:
            sure = time.time() - baslangic
            boyut = os.path.getsize(cikti_wav) / (1024 * 1024)
            rapor(100, f"Tamamlandı! WAV olarak ({boyut:.1f} MB, {sure:.1f} sn)")
            return cikti_wav

    def list_audio(self) -> list[dict]:
        """Üretilmiş ses dosyalarını listele."""
        dosyalar = []
        for f in sorted(os.listdir(CIKTILAR_DIR), reverse=True):
            if f.startswith("_"):
                continue
            if f.endswith((".wav", ".mp3")):
                yol = os.path.join(CIKTILAR_DIR, f)
                dosyalar.append({
                    "ad": f,
                    "yol": yol,
                    "boyut_mb": round(os.path.getsize(yol) / (1024 * 1024), 1),
                    "tarih": datetime.fromtimestamp(os.path.getmtime(yol)).strftime("%d.%m.%Y %H:%M"),
                })
        return dosyalar

    def download_audio(self, dosya_adi: str) -> str | None:
        """Ses dosyasını İndirilenler klasörüne kopyala."""
        yol = os.path.join(CIKTILAR_DIR, dosya_adi)
        if not os.path.isfile(yol):
            return None

        indirilenler = os.path.join(os.path.expanduser("~"), "Downloads")
        if not os.path.isdir(indirilenler):
            indirilenler = os.path.join(os.environ.get("USERPROFILE", ""), "Downloads")

        hedef = os.path.join(indirilenler, dosya_adi)
        if os.path.isfile(hedef):
            ad, uzanti = os.path.splitext(dosya_adi)
            sayac = 1
            while os.path.isfile(hedef):
                hedef = os.path.join(indirilenler, f"{ad} ({sayac}){uzanti}")
                sayac += 1

        shutil.copy2(yol, hedef)
        return hedef

    def delete_audio(self, dosya_adi: str):
        """Ses ve ilgili metin dosyasını sil."""
        yol = os.path.join(CIKTILAR_DIR, dosya_adi)
        if os.path.isfile(yol):
            os.remove(yol)
        metin_yol = os.path.join(METINLER_DIR, dosya_adi.replace(".mp3", ".txt").replace(".wav", ".txt"))
        if os.path.isfile(metin_yol):
            os.remove(metin_yol)

    @staticmethod
    def safe_filename(baslik: str) -> str:
        """Güvenli dosya adı oluştur."""
        guvenli = "".join(c if c.isalnum() or c in "-_ " else "" for c in baslik).strip().replace(" ", "_")
        if not guvenli:
            import time as _t
            guvenli = f"ses_{int(_t.time())}"
        return guvenli
