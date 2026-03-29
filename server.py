#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Voxtory — Flask API Sunucusu
Core modülleri kullanan ince API katmanı.
"""

import os
import sys
import time
import uuid
import threading

from flask import Flask, render_template, request, jsonify, send_file, send_from_directory

from app.core.paths import BASE_DIR, CIKTILAR_DIR, GORSELLER_DIR, VIDEOLAR_DIR, METINLER_DIR
from app.core.tts_engine import TTSEngine
from app.core.video_engine import VideoEngine
from app.core.project_renderer import ProjectRenderer
from app.core.transcriber import Transcriber
from app.core.ffmpeg_utils import find_ffmpeg, get_audio_duration, detect_gpu_encoder, SUBPROCESS_FLAGS
from app.core.subtitle_utils import altyazi_parcala, sessizlik_tespit, altyazi_senkronize

# ─── Engine'ler ──────────────────────────────
tts = TTSEngine()
video_engine = VideoEngine()
project_renderer = ProjectRenderer()
transcriber = Transcriber()

# Proje kayıt dizini
PROJELER_DIR = os.path.join(os.path.dirname(VIDEOLAR_DIR), "projects")
os.makedirs(PROJELER_DIR, exist_ok=True)

# ─── İş takibi ──────────────────────────────
isler = {}  # {id: {durum, ilerleme, mesaj, dosya, metin, ...}}

# ─── Flask ───────────────────────────────────
# PyInstaller paketinde --add-data dosyaları _MEIPASS altında
if getattr(sys, 'frozen', False):
    _BUNDLE_DIR = sys._MEIPASS
else:
    _BUNDLE_DIR = BASE_DIR

STATIC_DIR = os.path.join(_BUNDLE_DIR, "static")
TEMPLATES_DIR = os.path.join(_BUNDLE_DIR, "templates")

app = Flask(__name__, static_folder=STATIC_DIR, template_folder=TEMPLATES_DIR)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024


@app.route("/")
def anasayfa():
    return render_template("base.html")


# ═══ SES PROFİLLERİ ═══════════════════════════
@app.route("/api/ses-profilleri")
def ses_profilleri():
    return jsonify(tts.profiller())


@app.route("/api/ses-onizleme/<profil_id>")
def ses_onizleme(profil_id):
    dosya = tts.generate_preview(profil_id)
    if dosya:
        return send_file(dosya, mimetype="audio/wav")
    return jsonify({"hata": "Önizleme üretilemedi."}), 500


# ═══ SES ÜRETİMİ ══════════════════════════════
@app.route("/api/ses-uret", methods=["POST"])
def ses_uret():
    data = request.get_json()
    metin = data.get("metin", "").strip()
    baslik = data.get("baslik", "").strip()
    profil_id = data.get("profil", "anlatici")

    if not metin:
        return jsonify({"hata": "Metin boş olamaz."}), 400

    if not baslik:
        from datetime import datetime
        baslik = f"ses_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    dosya_adi = tts.safe_filename(baslik)
    is_id = str(uuid.uuid4())[:8]
    isler[is_id] = {"durum": "basliyor", "ilerleme": 0, "mesaj": "Hazırlanıyor...", "dosya": None}

    def task():
        def progress_cb(yuzde, mesaj):
            isler[is_id]["ilerleme"] = yuzde
            isler[is_id]["mesaj"] = mesaj
            if yuzde > 0:
                isler[is_id]["durum"] = "calisiyor"

        try:
            result = tts.generate(metin, dosya_adi, profil_id, progress_cb)
            if result:
                isler[is_id]["durum"] = "tamamlandi"
                isler[is_id]["ilerleme"] = 100
                isler[is_id]["dosya"] = os.path.basename(result)
            else:
                isler[is_id]["durum"] = "hata"
        except Exception as e:
            isler[is_id]["durum"] = "hata"
            isler[is_id]["mesaj"] = f"Hata: {str(e)}"

    threading.Thread(target=task, daemon=True).start()
    return jsonify({"is_id": is_id, "mesaj": "Ses üretimi başladı."})


@app.route("/api/is-durumu/<is_id>")
def is_durumu(is_id):
    if is_id not in isler:
        return jsonify({"hata": "İş bulunamadı."}), 404
    return jsonify(isler[is_id])


# ═══ SES DOSYALARI ═════════════════════════════
@app.route("/api/ses-kaydiler")
def ses_kayitlari():
    return jsonify(tts.list_audio())


@app.route("/api/ses-indir/<dosya_adi>")
def ses_indir(dosya_adi):
    hedef = tts.download_audio(dosya_adi)
    if hedef:
        return jsonify({"mesaj": "Dosya indirildi.", "dosya": os.path.basename(hedef), "yol": hedef})
    return jsonify({"hata": "Dosya bulunamadı."}), 404


@app.route("/api/ses-sil/<dosya_adi>", methods=["DELETE"])
def ses_sil(dosya_adi):
    tts.delete_audio(dosya_adi)
    return jsonify({"mesaj": "Silindi."})


# ═══ GÖRSELLER ═════════════════════════════════
@app.route("/api/gorsel-yukle", methods=["POST"])
def gorsel_yukle():
    if "dosyalar" not in request.files:
        return jsonify({"hata": "Dosya seçilmedi."}), 400

    dosyalar = request.files.getlist("dosyalar")
    yuklenen = []
    for dosya in dosyalar:
        if not dosya.filename:
            continue
        ad = dosya.filename
        uzanti = os.path.splitext(ad)[1].lower()
        if uzanti not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        hedef = os.path.join(GORSELLER_DIR, ad)
        if os.path.isfile(hedef):
            base = os.path.splitext(ad)[0]
            sayac = 1
            while os.path.isfile(hedef):
                hedef = os.path.join(GORSELLER_DIR, f"{base}_{sayac}{uzanti}")
                sayac += 1
        dosya.save(hedef)
        yuklenen.append(os.path.basename(hedef))

    return jsonify({"mesaj": f"{len(yuklenen)} görsel yüklendi.", "dosyalar": yuklenen})


@app.route("/api/gorsel-sil/<dosya_adi>", methods=["DELETE"])
def gorsel_sil(dosya_adi):
    yol = os.path.join(GORSELLER_DIR, dosya_adi)
    if os.path.isfile(yol):
        os.remove(yol)
    return jsonify({"mesaj": "Silindi."})


# ═══ TRANSKRİPT ═══════════════════════════════
@app.route("/api/ses-transkript", methods=["POST"])
def ses_transkript():
    data = request.get_json()
    ses_dosya = data.get("ses", "")
    if not ses_dosya:
        return jsonify({"hata": "Ses dosyası seçilmedi."}), 400

    ses_yolu = os.path.join(CIKTILAR_DIR, ses_dosya)
    if not os.path.isfile(ses_yolu):
        return jsonify({"hata": "Ses dosyası bulunamadı."}), 404

    is_id = str(uuid.uuid4())[:8]
    isler[is_id] = {"durum": "calisiyor", "ilerleme": 10, "mesaj": "Whisper yükleniyor...", "metin": None}

    def task():
        def progress_cb(yuzde, mesaj):
            isler[is_id]["ilerleme"] = yuzde
            isler[is_id]["mesaj"] = mesaj

        try:
            metin = transcriber.transcribe(ses_yolu, progress_cb)
            if metin:
                isler[is_id]["durum"] = "tamamlandi"
                isler[is_id]["ilerleme"] = 100
                isler[is_id]["mesaj"] = "Tamamlandı!"
                isler[is_id]["metin"] = metin
            else:
                isler[is_id]["durum"] = "hata"
                isler[is_id]["mesaj"] = "Transkript başarısız."
        except Exception as e:
            isler[is_id]["durum"] = "hata"
            isler[is_id]["mesaj"] = f"Hata: {str(e)}"

    threading.Thread(target=task, daemon=True).start()
    return jsonify({"is_id": is_id, "mesaj": "Transkript başladı."})


# ═══ VİDEO ═════════════════════════════════════
@app.route("/api/video-kaynaklar")
def video_kaynaklar():
    return jsonify(video_engine.list_sources())


@app.route("/api/video-uret", methods=["POST"])
def video_uret():
    data = request.get_json()
    images = data.get("images", [])
    ses = data.get("ses", "")
    baslik = data.get("baslik", "").strip()
    gorsel_suresi = float(data.get("gorsel_suresi", 0))
    efekt = data.get("efekt", "fade")
    altyazi_metni = data.get("altyazi", "").strip()
    altyazi_stil = data.get("altyazi_stil", {})

    if not images:
        return jsonify({"hata": "En az bir görsel seç."}), 400
    if not ses:
        return jsonify({"hata": "Bir ses dosyası seç."}), 400

    if not baslik:
        from datetime import datetime
        baslik = f"video_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    dosya_adi = video_engine.safe_filename(baslik)
    is_id = str(uuid.uuid4())[:8]
    isler[is_id] = {"durum": "basliyor", "ilerleme": 0, "mesaj": "Hazırlanıyor...", "dosya": None}

    def task():
        def progress_cb(yuzde, mesaj):
            isler[is_id]["ilerleme"] = yuzde
            isler[is_id]["mesaj"] = mesaj
            if yuzde > 0:
                isler[is_id]["durum"] = "calisiyor"

        try:
            result = video_engine.generate(
                images, ses, dosya_adi, gorsel_suresi,
                efekt, altyazi_metni, altyazi_stil, progress_cb,
            )
            if result:
                isler[is_id]["durum"] = "tamamlandi"
                isler[is_id]["ilerleme"] = 100
                isler[is_id]["dosya"] = os.path.basename(result)
            else:
                isler[is_id]["durum"] = "hata"
        except Exception as e:
            isler[is_id]["durum"] = "hata"
            isler[is_id]["mesaj"] = f"Hata: {str(e)}"

    threading.Thread(target=task, daemon=True).start()
    return jsonify({"is_id": is_id, "mesaj": "Video üretimi başladı."})


@app.route("/api/video-listele")
def video_listele():
    return jsonify(video_engine.list_videos())


@app.route("/api/video-indir/<dosya_adi>")
def video_indir(dosya_adi):
    hedef = video_engine.download_video(dosya_adi)
    if hedef:
        return jsonify({"mesaj": "Dosya indirildi.", "dosya": os.path.basename(hedef), "yol": hedef})
    return jsonify({"hata": "Dosya bulunamadı."}), 404


@app.route("/api/video-sil/<dosya_adi>", methods=["DELETE"])
def video_sil(dosya_adi):
    video_engine.delete_video(dosya_adi)
    return jsonify({"mesaj": "Silindi."})


# ═══ EDİTÖR API ═══════════════════════════════
@app.route("/api/editor/render", methods=["POST"])
def editor_render():
    """Proje JSON'ından video render et."""
    data = request.get_json()
    proje = data.get("project")
    baslik = data.get("baslik", "").strip()
    kalite = data.get("kalite", "normal")

    if not proje:
        return jsonify({"hata": "Proje verisi eksik."}), 400

    if not baslik:
        from datetime import datetime
        baslik = f"video_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    dosya_adi = project_renderer.safe_filename(baslik)
    is_id = str(uuid.uuid4())[:8]
    isler[is_id] = {"durum": "basliyor", "ilerleme": 0, "mesaj": "Hazırlanıyor...", "dosya": None}

    def task():
        def progress_cb(yuzde, mesaj):
            isler[is_id]["ilerleme"] = yuzde
            isler[is_id]["mesaj"] = mesaj
            if yuzde > 0:
                isler[is_id]["durum"] = "calisiyor"

        try:
            result = project_renderer.render(proje, dosya_adi, kalite, progress_cb)
            if result:
                isler[is_id]["durum"] = "tamamlandi"
                isler[is_id]["ilerleme"] = 100
                isler[is_id]["dosya"] = os.path.basename(result)
            else:
                isler[is_id]["durum"] = "hata"
                if not isler[is_id].get("mesaj"):
                    isler[is_id]["mesaj"] = "Render başarısız."
        except Exception as e:
            isler[is_id]["durum"] = "hata"
            isler[is_id]["mesaj"] = f"Hata: {str(e)}"

    threading.Thread(target=task, daemon=True).start()
    return jsonify({"is_id": is_id, "mesaj": "Render başladı."})


@app.route("/api/editor/audio-meta/<dosya_adi>")
def editor_audio_meta(dosya_adi):
    """Ses dosyasının süresini döndür."""
    yol = os.path.join(CIKTILAR_DIR, dosya_adi)
    if not os.path.isfile(yol):
        return jsonify({"hata": "Dosya bulunamadı."}), 404

    ffmpeg = find_ffmpeg()
    sure = get_audio_duration(ffmpeg, yol)
    return jsonify({"duration": sure})


@app.route("/api/editor/altyazi-parcala", methods=["POST"])
def editor_altyazi_parcala():
    """Metni zamanlı altyazı segmentlerine böl.

    Ses dosyası verilmişse FFmpeg sessizlik tespiti ile senkronize eder.
    Verilmemişse karakter oranıyla fallback yapar.
    """
    data = request.get_json()
    metin = data.get("metin", "").strip()
    ses = data.get("ses", "")

    if not metin:
        return jsonify({"hata": "Metin boş."}), 400

    toplam_sure = 30
    ffmpeg = find_ffmpeg()
    sessizlik = []

    if ses:
        ses_yolu = os.path.join(CIKTILAR_DIR, ses)
        if os.path.isfile(ses_yolu):
            toplam_sure = get_audio_duration(ffmpeg, ses_yolu) or 30
            # Sessizlik noktalarını tespit et
            sessizlik = sessizlik_tespit(ffmpeg, ses_yolu)

    if sessizlik:
        parcalar = altyazi_senkronize(metin, toplam_sure, sessizlik)
    else:
        parcalar = altyazi_parcala(metin, toplam_sure)

    return jsonify({"parcalar": parcalar, "senkron": bool(sessizlik)})



@app.route("/api/editor/ses-metni/<dosya_adi>")
def editor_ses_metni(dosya_adi):
    """Ses dosyasının TTS metnini ve varsa cümle bazlı zamanlama verisini döndür."""
    import json as _json
    adsiz = os.path.splitext(dosya_adi)[0]

    metin = ""
    metin_yolu = os.path.join(METINLER_DIR, f"{adsiz}.txt")
    if os.path.isfile(metin_yolu):
        with open(metin_yolu, "r", encoding="utf-8") as f:
            metin = f.read().strip()

    # Zamanlama verisi (.timing.json)
    zamanlama = []
    zamanlama_yolu = os.path.join(METINLER_DIR, f"{adsiz}.timing.json")
    if os.path.isfile(zamanlama_yolu):
        with open(zamanlama_yolu, "r", encoding="utf-8") as f:
            zamanlama = _json.load(f)

    return jsonify({"metin": metin, "zamanlama": zamanlama, "dosya": dosya_adi})


@app.route("/api/editor/project/save", methods=["POST"])
def editor_project_save():
    """Projeyi dosyaya kaydet."""
    import json
    data = request.get_json()
    ad = data.get("ad", "proje").strip()
    proje = data.get("project")

    if not proje:
        return jsonify({"hata": "Proje verisi eksik."}), 400

    guvenli_ad = "".join(c if c.isalnum() or c in "-_ " else "" for c in ad).strip().replace(" ", "_")
    if not guvenli_ad:
        guvenli_ad = "proje"

    yol = os.path.join(PROJELER_DIR, f"{guvenli_ad}.json")
    with open(yol, "w", encoding="utf-8") as f:
        json.dump(proje, f, ensure_ascii=False, indent=2)

    return jsonify({"mesaj": "Proje kaydedildi.", "dosya": f"{guvenli_ad}.json"})


@app.route("/api/editor/project/load/<ad>")
def editor_project_load(ad):
    """Kaydedilmiş projeyi yükle."""
    import json
    yol = os.path.join(PROJELER_DIR, f"{ad}.json")
    if not os.path.isfile(yol):
        return jsonify({"hata": "Proje bulunamadı."}), 404

    with open(yol, "r", encoding="utf-8") as f:
        proje = json.load(f)

    return jsonify({"project": proje})


@app.route("/api/editor/project/list")
def editor_project_list():
    """Kaydedilmiş projeleri listele."""
    from datetime import datetime
    projeler = []
    for f in sorted(os.listdir(PROJELER_DIR), reverse=True):
        if f.endswith(".json"):
            yol = os.path.join(PROJELER_DIR, f)
            projeler.append({
                "ad": os.path.splitext(f)[0],
                "tarih": datetime.fromtimestamp(os.path.getmtime(yol)).strftime("%d.%m.%Y %H:%M"),
            })
    return jsonify(projeler)


@app.route("/api/editor/project/delete/<ad>", methods=["DELETE"])
def editor_project_delete(ad):
    """Kaydedilmiş projeyi sil."""
    yol = os.path.join(PROJELER_DIR, f"{ad}.json")
    if not os.path.isfile(yol):
        return jsonify({"hata": "Proje bulunamadı."}), 404
    os.remove(yol)
    return jsonify({"mesaj": "Proje silindi."})


# ═══ KLASÖRDE GÖSTER ═══════════════════════════
@app.route("/api/klasorde-goster", methods=["POST"])
def klasorde_goster():
    """Windows Explorer'da dosyayı seçili olarak göster."""
    import subprocess as sp
    data = request.get_json()
    yol = data.get("yol", "")
    if not yol or not os.path.isfile(yol):
        return jsonify({"hata": "Dosya bulunamadı."}), 404
    sp.Popen(["explorer", "/select,", os.path.normpath(yol)], creationflags=SUBPROCESS_FLAGS)
    return jsonify({"mesaj": "Tamam."})


# ═══ SİSTEM DURUMU ═════════════════════════════
@app.route("/api/durum")
def sistem_durumu():
    from app.core.paths import PIPER_EXE, MODEL_PATH, ESPEAK_DATA
    from app.core.ffmpeg_utils import find_ffmpeg
    import subprocess

    durum = {
        "piper": os.path.isfile(PIPER_EXE),
        "model": os.path.isfile(MODEL_PATH),
        "espeak": os.path.isdir(ESPEAK_DATA),
        "ffmpeg": False,
    }
    try:
        subprocess.run([find_ffmpeg(), "-version"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=SUBPROCESS_FLAGS)
        durum["ffmpeg"] = True
    except FileNotFoundError:
        pass

    durum["hazir"] = all(durum.values())

    # GPU encoder bilgisi
    gpu = detect_gpu_encoder(find_ffmpeg())
    durum["gpu_encoder"] = gpu or "cpu"

    return jsonify(durum)


# ═══ DOSYA SUNMA ═══════════════════════════════
@app.route("/outputs/<path:dosya>")
def outputs_dosya(dosya):
    return send_from_directory(CIKTILAR_DIR, dosya)


@app.route("/images/<path:dosya>")
def images_dosya(dosya):
    return send_from_directory(GORSELLER_DIR, dosya)


@app.route("/videos/<path:dosya>")
def videos_dosya(dosya):
    return send_from_directory(VIDEOLAR_DIR, dosya)


if __name__ == "__main__":
    import signal
    signal.signal(signal.SIGINT, lambda *_: os._exit(0))

    print("\n" + "=" * 55)
    print("   Voxtory")
    print("   http://localhost:5000")
    print("=" * 55 + "\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
