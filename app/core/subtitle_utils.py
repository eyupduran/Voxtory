import os
import re
import subprocess
from .ffmpeg_utils import SUBPROCESS_FLAGS


def zaman_fmt_srt(s: float) -> str:
    """Saniyeyi SRT zaman formatına çevir: 00:01:23,456"""
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sc = int(s % 60)
    ms = int((s % 1) * 1000)
    return f"{h:02d}:{m:02d}:{sc:02d},{ms:03d}"


def zaman_fmt_ass(s: float) -> str:
    """Saniyeyi ASS zaman formatına çevir: 0:01:23.46"""
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sc = int(s % 60)
    cs = int((s % 1) * 100)
    return f"{h}:{m:02d}:{sc:02d}.{cs:02d}"


def altyazi_parcala(metin: str, toplam_sure: float) -> list[dict]:
    """Metni cümlelere böl ve zamanlama bilgisi döndür.

    Her altyazı satırı max ~80 karakter olacak şekilde bölünür.
    """
    cumleler = re.split(r'(?<=[.!?…])\s+', metin)
    cumleler = [c.strip() for c in cumleler if c.strip()]
    if not cumleler:
        return []

    MAX_KARAKTER = 80
    parcalanmis = []
    for cumle in cumleler:
        if len(cumle) <= MAX_KARAKTER:
            parcalanmis.append(cumle)
        else:
            alt_parcalar = re.split(r'(?<=[,;:])\s+', cumle)
            mevcut = ""
            for parca in alt_parcalar:
                if mevcut and len(mevcut) + len(parca) + 1 > MAX_KARAKTER:
                    parcalanmis.append(mevcut.strip())
                    mevcut = parca
                else:
                    mevcut = f"{mevcut} {parca}".strip() if mevcut else parca
            if mevcut:
                parcalanmis.append(mevcut.strip())

    if not parcalanmis:
        return []

    toplam_karakter = sum(len(p) for p in parcalanmis)
    parcalar = []
    simdiki = 0.0
    for p in parcalanmis:
        oran = len(p) / toplam_karakter if toplam_karakter > 0 else 1 / len(parcalanmis)
        sure = toplam_sure * oran
        parcalar.append({
            "metin": p,
            "baslangic": simdiki,
            "bitis": simdiki + sure,
        })
        simdiki += sure

    return parcalar


def generate_srt(metin: str, toplam_sure: float, srt_yolu: str) -> bool:
    """Metinden SRT altyazı dosyası oluştur."""
    parcalar = altyazi_parcala(metin, toplam_sure)
    if not parcalar:
        return False

    with open(srt_yolu, "w", encoding="utf-8") as f:
        for i, p in enumerate(parcalar):
            f.write(f"{i+1}\n")
            f.write(f"{zaman_fmt_srt(p['baslangic'])} --> {zaman_fmt_srt(p['bitis'])}\n")
            f.write(f"{p['metin']}\n\n")
    return True


def generate_ass(metin: str, toplam_sure: float, ass_yolu: str, stil: dict | None = None) -> bool:
    """Metinden ASS altyazı dosyası oluştur.

    ASS formatı Windows'ta sorunsuz çalışır, drawtext hatalarını önler.
    """
    if stil is None:
        stil = {}

    font_adi = stil.get("font", "Segoe UI")
    font_boyut = stil.get("boyut", 52)
    ana_renk = stil.get("renk", "&H00FFFFFF")
    kenar_renk = stil.get("kenar_renk", "&H00000000")
    arka_renk = stil.get("arka_renk", "&H80000000")
    kenar_kalinlik = stil.get("kenar", 3)
    konum = stil.get("konum", 2)
    bold = stil.get("bold", 1)
    golge = stil.get("golge", 0)

    parcalar = altyazi_parcala(metin, toplam_sure)
    if not parcalar:
        return False

    with open(ass_yolu, "w", encoding="utf-8-sig") as f:
        f.write("[Script Info]\n")
        f.write("Title: Voxtory Altyazi\n")
        f.write("ScriptType: v4.00+\n")
        f.write("PlayResX: 1920\n")
        f.write("PlayResY: 1080\n")
        f.write("WrapStyle: 0\n")
        f.write("ScaledBorderAndShadow: yes\n\n")

        f.write("[V4+ Styles]\n")
        f.write("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
                "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
                "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
                "Alignment, MarginL, MarginR, MarginV, Encoding\n")
        f.write(f"Style: Default,{font_adi},{font_boyut},{ana_renk},&H000000FF,"
                f"{kenar_renk},{arka_renk},{bold},0,0,0,100,100,0,0,1,"
                f"{kenar_kalinlik},{golge},{konum},40,40,50,1\n\n")

        f.write("[Events]\n")
        f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

        for p in parcalar:
            baslangic = zaman_fmt_ass(p["baslangic"])
            bitis = zaman_fmt_ass(p["bitis"])
            text = p["metin"].replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
            if len(text) > 45:
                orta = len(text) // 2
                sol = text.rfind(" ", 0, orta + 10)
                sag = text.find(" ", orta - 10)
                if sol == -1:
                    kirilma = sag
                elif sag == -1:
                    kirilma = sol
                else:
                    kirilma = sol if (orta - sol) <= (sag - orta) else sag
                if kirilma > 0:
                    text = text[:kirilma] + "\\N" + text[kirilma + 1:]
            f.write(f"Dialogue: 0,{baslangic},{bitis},Default,,0,0,0,,{text}\n")

    return True


# ─── FFmpeg Sessizlik Tespiti ile Senkronize Altyazı ─────────

def sessizlik_tespit(ffmpeg_cmd: str, ses_yolu: str, esik_db: float = -35, min_sure: float = 0.15) -> list[float]:
    """FFmpeg silencedetect ile sessizlik noktalarını bul.

    Döndürür: Sessizlik ortası zamanlarının listesi (saniye).
    Piper TTS sentence_silence ile cümle aralarına koyduğu boşlukları yakalar.
    """
    cmd = [
        ffmpeg_cmd, "-i", ses_yolu,
        "-af", f"silencedetect=noise={esik_db}dB:d={min_sure}",
        "-f", "null", "-"
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, creationflags=SUBPROCESS_FLAGS)
    stderr = r.stderr or ""

    silence_starts = []
    silence_ends = []
    for line in stderr.split("\n"):
        if "silence_start:" in line:
            try:
                val = float(line.split("silence_start:")[1].strip().split()[0])
                silence_starts.append(val)
            except (ValueError, IndexError):
                pass
        elif "silence_end:" in line:
            try:
                val = float(line.split("silence_end:")[1].strip().split()[0])
                silence_ends.append(val)
            except (ValueError, IndexError):
                pass

    # Her sessizliğin ortasını bölme noktası olarak kullan
    bolme_noktalari = []
    for i in range(min(len(silence_starts), len(silence_ends))):
        orta = (silence_starts[i] + silence_ends[i]) / 2
        bolme_noktalari.append(round(orta, 3))

    return bolme_noktalari


def altyazi_senkronize(metin: str, toplam_sure: float, sessizlik_noktalari: list[float]) -> list[dict]:
    """Metni cümlelere böl ve sessizlik noktalarına göre zamanla.

    Cümle sayısı ile sessizlik noktası sayısını eşleştirir:
    - N cümle varsa N-1 bölme noktası gerekir
    - Sessizlik noktalarından en uygun N-1 tanesini seçer
    """
    cumleler = re.split(r'(?<=[.!?…])\s+', metin)
    cumleler = [c.strip() for c in cumleler if c.strip()]
    if not cumleler:
        return []

    MAX_KARAKTER = 80
    parcalanmis = []
    for cumle in cumleler:
        if len(cumle) <= MAX_KARAKTER:
            parcalanmis.append(cumle)
        else:
            alt_parcalar = re.split(r'(?<=[,;:])\s+', cumle)
            mevcut = ""
            for parca in alt_parcalar:
                if mevcut and len(mevcut) + len(parca) + 1 > MAX_KARAKTER:
                    parcalanmis.append(mevcut.strip())
                    mevcut = parca
                else:
                    mevcut = f"{mevcut} {parca}".strip() if mevcut else parca
            if mevcut:
                parcalanmis.append(mevcut.strip())

    if not parcalanmis:
        return []

    n = len(parcalanmis)

    if not sessizlik_noktalari or len(sessizlik_noktalari) < 1:
        return altyazi_parcala(metin, toplam_sure)

    noktalar = sorted(sessizlik_noktalari)

    if n - 1 <= len(noktalar):
        # Yeterli veya fazla sessizlik noktası — eşit aralıklı N-1 tane seç
        adim = len(noktalar) / (n - 1) if n > 1 else 1
        secilen = [0.0]
        for i in range(1, n):
            idx = min(int((i - 0.5) * adim), len(noktalar) - 1)
            secilen.append(noktalar[idx])
        secilen.append(toplam_sure)
    else:
        # Sessizlik noktası cümle sayısından az — mevcut noktaları kullan, kalanları böl
        secilen = [0.0] + noktalar + [toplam_sure]
        while len(secilen) - 1 < n:
            max_aralik = 0
            max_idx = 0
            for i in range(len(secilen) - 1):
                aralik = secilen[i + 1] - secilen[i]
                if aralik > max_aralik:
                    max_aralik = aralik
                    max_idx = i
            yeni = (secilen[max_idx] + secilen[max_idx + 1]) / 2
            secilen.insert(max_idx + 1, yeni)

    parcalar = []
    for i in range(n):
        baslangic = secilen[i] if i < len(secilen) else (parcalar[-1]["bitis"] if parcalar else 0)
        bitis = secilen[i + 1] if i + 1 < len(secilen) else toplam_sure
        if bitis - baslangic < 0.3:
            bitis = baslangic + 0.3
        parcalar.append({
            "metin": parcalanmis[i],
            "baslangic": round(baslangic, 3),
            "bitis": round(min(bitis, toplam_sure), 3),
        })

    return parcalar
