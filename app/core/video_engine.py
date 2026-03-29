import os
import subprocess
import shutil
import tempfile
import time
from datetime import datetime
from typing import Callable

from .paths import GORSELLER_DIR, CIKTILAR_DIR, VIDEOLAR_DIR
from .ffmpeg_utils import find_ffmpeg, get_audio_duration, SUBPROCESS_FLAGS
from .subtitle_utils import generate_ass, generate_srt


class VideoEngine:
    def __init__(self):
        self.ffmpeg_cmd = find_ffmpeg()

    def list_sources(self) -> dict:
        """Video için kullanılabilir görselleri ve ses dosyalarını listele."""
        images = []
        for f in sorted(os.listdir(GORSELLER_DIR)):
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                images.append(f)

        sesler = []
        for f in sorted(os.listdir(CIKTILAR_DIR)):
            if f.startswith("_"):
                continue
            if f.lower().endswith((".mp3", ".wav")):
                sesler.append(f)

        return {"images": images, "sesler": sesler}

    def generate(
        self,
        images: list[str],
        ses: str,
        dosya_adi: str,
        gorsel_suresi: float = 0,
        efekt: str = "fade",
        altyazi_metni: str = "",
        altyazi_stil: dict | None = None,
        progress_cb: Callable[[int, str], None] | None = None,
    ) -> str | None:
        """Images + ses → MP4 video üret."""

        def rapor(yuzde, mesaj):
            if progress_cb:
                progress_cb(yuzde, mesaj)

        rapor(5, "Ses dosyası analiz ediliyor...")
        baslangic = time.time()

        ses_yolu = os.path.join(CIKTILAR_DIR, ses)
        if not os.path.isfile(ses_yolu):
            rapor(0, "Ses dosyası bulunamadı.")
            return None

        toplam_sure = get_audio_duration(self.ffmpeg_cmd, ses_yolu)
        if toplam_sure <= 0:
            rapor(0, "Ses süresi alınamadı.")
            return None

        gorsel_sayisi = len(images)
        if gorsel_suresi <= 0:
            sure_per_gorsel = toplam_sure / gorsel_sayisi
        else:
            sure_per_gorsel = gorsel_suresi

        rapor(10, f"{gorsel_sayisi} görsel, {toplam_sure:.0f} sn ses — video oluşturuluyor...")

        # Türkçe karakterli yollarda FFmpeg sorun çıkarabilir — PIPER_SAFE_DIR ASCII-safe
        from .paths import PIPER_SAFE_DIR
        gecici = tempfile.mkdtemp(prefix="vid_", dir=PIPER_SAFE_DIR)
        gecici_mp4 = os.path.join(gecici, "final.mp4")
        cikti_mp4 = os.path.join(VIDEOLAR_DIR, f"{dosya_adi}.mp4")

        # 1. Görselleri geçici klasöre kopyala
        rapor(12, "Görseller hazırlanıyor...")
        tmp_images = []
        for i, gorsel_ad in enumerate(images):
            kaynak = os.path.join(GORSELLER_DIR, gorsel_ad)
            uzanti = os.path.splitext(gorsel_ad)[1].lower()
            hedef = os.path.join(gecici, f"img_{i:03d}{uzanti}")
            if os.path.isfile(kaynak):
                shutil.copy2(kaynak, hedef)
                tmp_images.append(hedef)

        if not tmp_images:
            rapor(0, "Görseller kopyalanamadı.")
            shutil.rmtree(gecici, ignore_errors=True)
            return None

        ses_uzanti = os.path.splitext(ses)[1]
        gecici_ses = os.path.join(gecici, f"audio{ses_uzanti}")
        shutil.copy2(ses_yolu, gecici_ses)

        # 2. Her görselden video klibi oluştur
        rapor(15, "Görsel klipleri oluşturuluyor...")
        klip_dosyalari = []
        fps = 25

        for i, gorsel_yolu in enumerate(tmp_images):
            klip_yolu = os.path.join(gecici, f"klip_{i:03d}.mp4")
            rapor(15 + int((i / gorsel_sayisi) * 55), f"Klip {i+1}/{gorsel_sayisi} oluşturuluyor...")

            fade_suresi = min(0.5, sure_per_gorsel / 4)
            base = (
                f"scale=1920:1080:force_original_aspect_ratio=decrease,"
                f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,"
                f"setsar=1,fps={fps}"
            )

            if efekt == "fade":
                filtre = (
                    f"{base},"
                    f"fade=t=in:st=0:d={fade_suresi},"
                    f"fade=t=out:st={sure_per_gorsel - fade_suresi}:d={fade_suresi},"
                    f"format=yuv420p"
                )
            else:
                filtre = f"{base},format=yuv420p"

            klip_cmd = [
                self.ffmpeg_cmd, "-y",
                "-loop", "1", "-framerate", str(fps), "-t", str(sure_per_gorsel),
                "-i", gorsel_yolu.replace("\\", "/"),
                "-vf", filtre,
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-profile:v", "high", "-preset", "ultrafast", "-crf", "23",
                "-an", klip_yolu,
            ]

            subprocess.run(klip_cmd, capture_output=True, text=True, creationflags=SUBPROCESS_FLAGS)
            if os.path.isfile(klip_yolu) and os.path.getsize(klip_yolu) > 0:
                klip_dosyalari.append(klip_yolu)

        if not klip_dosyalari:
            rapor(0, "Hiç klip oluşturulamadı.")
            shutil.rmtree(gecici, ignore_errors=True)
            return None

        # 3. Klipleri birleştir
        rapor(75, "Klipler birleştiriliyor...")
        concat_list = os.path.join(gecici, "concat.txt")
        with open(concat_list, "w", encoding="utf-8") as f:
            for kp in klip_dosyalari:
                f.write(f"file '{kp.replace(chr(92), '/')}'\n")

        birlesik_video = os.path.join(gecici, "birlesik.mp4")
        subprocess.run(
            [self.ffmpeg_cmd, "-y", "-f", "concat", "-safe", "0",
             "-i", concat_list, "-c", "copy", birlesik_video],
            capture_output=True, text=True, creationflags=SUBPROCESS_FLAGS,
        )

        # 4. Altyazı oluştur
        ass_yolu = None
        srt_yolu = None
        if altyazi_metni:
            rapor(82, "Altyazılar hazırlanıyor...")
            ass_stil = {}
            if altyazi_stil:
                if "font" in altyazi_stil:
                    ass_stil["font"] = altyazi_stil["font"]
                if "boyut" in altyazi_stil:
                    ass_stil["boyut"] = int(altyazi_stil["boyut"])
                if "konum" in altyazi_stil:
                    konum_map = {"alt": 2, "ust": 8, "orta": 5}
                    ass_stil["konum"] = konum_map.get(altyazi_stil["konum"], 2)
                if "kenar" in altyazi_stil:
                    ass_stil["kenar"] = int(altyazi_stil["kenar"])
                if "bold" in altyazi_stil:
                    ass_stil["bold"] = 1 if altyazi_stil["bold"] else 0

            ass_yolu = os.path.join(gecici, "altyazi.ass")
            generate_ass(altyazi_metni, toplam_sure, ass_yolu, ass_stil)

            srt_yolu = os.path.join(gecici, "altyazi.srt")
            generate_srt(altyazi_metni, toplam_sure, srt_yolu)

        # 5. Ses + altyazı → final video
        rapor(88, "Ses ve altyazı ekleniyor...")

        if ass_yolu and os.path.isfile(ass_yolu):
            ass_yolu_safe = ass_yolu.replace("\\", "/").replace(":", "\\:")
            cmd = [
                self.ffmpeg_cmd, "-y",
                "-i", birlesik_video,
                "-i", gecici_ses,
                "-vf", f"ass='{ass_yolu_safe}'",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest",
                "-movflags", "+faststart",
                gecici_mp4,
            ]
        else:
            cmd = [
                self.ffmpeg_cmd, "-y",
                "-i", birlesik_video,
                "-i", gecici_ses,
                "-c:v", "copy",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest",
                "-movflags", "+faststart",
                gecici_mp4,
            ]

        result = subprocess.run(cmd, capture_output=True, text=True, creationflags=SUBPROCESS_FLAGS)

        # 6. Çıktıları taşı
        rapor(95, "Dosyalar kaydediliyor...")

        if os.path.isfile(gecici_mp4) and os.path.getsize(gecici_mp4) > 0:
            shutil.move(gecici_mp4, cikti_mp4)
        else:
            hata_detay = result.stderr[-500:] if result.stderr else "Bilinmiyor"
            rapor(0, f"Video oluşturulamadı. Hata: {hata_detay}")
            shutil.rmtree(gecici, ignore_errors=True)
            return None

        if srt_yolu and os.path.isfile(srt_yolu):
            shutil.copy2(srt_yolu, os.path.join(VIDEOLAR_DIR, f"{dosya_adi}.srt"))

        shutil.rmtree(gecici, ignore_errors=True)

        sure = time.time() - baslangic
        boyut = os.path.getsize(cikti_mp4) / (1024 * 1024)
        rapor(100, f"Tamamlandı! {boyut:.1f} MB, {sure:.1f} sn")
        return cikti_mp4

    def list_videos(self) -> list[dict]:
        dosyalar = []
        for f in sorted(os.listdir(VIDEOLAR_DIR), reverse=True):
            if f.lower().endswith((".mp4", ".mkv", ".avi")):
                yol = os.path.join(VIDEOLAR_DIR, f)
                dosyalar.append({
                    "ad": f,
                    "yol": yol,
                    "boyut_mb": round(os.path.getsize(yol) / (1024 * 1024), 1),
                    "tarih": datetime.fromtimestamp(os.path.getmtime(yol)).strftime("%d.%m.%Y %H:%M"),
                })
        return dosyalar

    def download_video(self, dosya_adi: str) -> str | None:
        yol = os.path.join(VIDEOLAR_DIR, dosya_adi)
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

    def delete_video(self, dosya_adi: str):
        yol = os.path.join(VIDEOLAR_DIR, dosya_adi)
        if os.path.isfile(yol):
            os.remove(yol)
        srt = os.path.join(VIDEOLAR_DIR, dosya_adi.replace(".mp4", ".srt"))
        if os.path.isfile(srt):
            os.remove(srt)

    @staticmethod
    def safe_filename(baslik: str) -> str:
        guvenli = "".join(c if c.isalnum() or c in "-_ " else "" for c in baslik).strip().replace(" ", "_")
        if not guvenli:
            guvenli = f"video_{int(time.time())}"
        return guvenli
