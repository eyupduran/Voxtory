"""
Voxtory — Proje Renderer
Editör proje JSON'ını FFmpeg komutlarına çevirir ve video render eder.
"""

import os
import shutil
import subprocess
import tempfile
import time
from typing import Callable

from .paths import GORSELLER_DIR, CIKTILAR_DIR, VIDEOLAR_DIR, PIPER_SAFE_DIR
from .ffmpeg_utils import find_ffmpeg, get_audio_duration, get_video_encoder_args, SUBPROCESS_FLAGS
from .subtitle_utils import zaman_fmt_ass


# ─── Filtre Preset Tanımları (FFmpeg filter chain) ─────────
FILTER_PRESETS = {
    "cinematic": [
        "eq=contrast=1.3:saturation=0.8",
        "colorbalance=rs=0.05:gs=-0.03:bs=0.08",
    ],
    "warm": [
        "colortemperature=6800",
        "eq=saturation=1.1",
    ],
    "cool": [
        "colortemperature=4500",
        "eq=saturation=0.9",
    ],
    "vintage": [
        "curves=vintage",
        "eq=saturation=0.7",
    ],
    "bw": [
        "hue=s=0",
    ],
    "vivid": [
        "eq=saturation=1.5:contrast=1.15",
    ],
    "muted": [
        "eq=saturation=0.5:brightness=0.05",
    ],
    "dramatic": [
        "eq=contrast=1.5:brightness=-0.1",
        "unsharp=5:5:1",
    ],
    "dreamy": [
        "gblur=sigma=1.5",
        "eq=brightness=0.08:saturation=0.8",
    ],
}


class ProjectRenderer:
    def __init__(self):
        self.ffmpeg_cmd = find_ffmpeg()
        self._encoder_cache = {}  # kalite -> encoder args

    def render(
        self,
        project: dict,
        dosya_adi: str,
        kalite: str = "normal",
        progress_cb: Callable[[int, str], None] | None = None,
    ) -> str | None:

        def rapor(yuzde, mesaj):
            if progress_cb:
                progress_cb(yuzde, mesaj)

        rapor(2, "Proje analiz ediliyor...")
        t0 = time.time()

        meta = project.get("meta", {})
        tracks = project.get("tracks", [])
        coz = meta.get("cozunurluk", {"w": 1920, "h": 1080})
        W, H = coz["w"], coz["h"]
        FPS = meta.get("fps", 25)

        video_track = next((t for t in tracks if t["type"] == "video"), None)
        audio_track = next((t for t in tracks if t["type"] == "audio"), None)
        sub_track = next((t for t in tracks if t["type"] == "subtitle"), None)
        overlay_tracks = [t for t in tracks if t["type"] == "overlay"]
        text_tracks = [t for t in tracks if t["type"] == "text"]

        v_clips = sorted(video_track["clips"], key=lambda c: c["startTime"]) if video_track else []
        a_clips = sorted(audio_track["clips"], key=lambda c: c["startTime"]) if audio_track else []
        o_clips = []
        for ot in overlay_tracks:
            o_clips.extend(sorted(ot.get("clips", []), key=lambda c: c["startTime"]))
        t_clips = []
        for tt in text_tracks:
            t_clips.extend(sorted(tt.get("clips", []), key=lambda c: c["startTime"]))
        s_clips = sorted(sub_track["clips"], key=lambda c: c["startTime"]) if sub_track else []

        if not v_clips:
            rapor(0, "Görsel klibi yok.")
            return None

        self._kalite = kalite  # GPU encoder seçimi için

        gecici = tempfile.mkdtemp(prefix="vr_", dir=PIPER_SAFE_DIR)
        cikti = os.path.join(VIDEOLAR_DIR, f"{dosya_adi}.mp4")

        try:
            # ─── 1. Görselleri kopyala ───────────
            rapor(5, "Görseller hazırlanıyor...")
            img_paths = {}
            for i, c in enumerate(v_clips):
                src = os.path.join(GORSELLER_DIR, c["source"])
                if not os.path.isfile(src):
                    rapor(0, f"Görsel bulunamadı: {c['source']}")
                    return None
                ext = os.path.splitext(c["source"])[1].lower()
                dst = os.path.join(gecici, f"img_{i:03d}{ext}")
                shutil.copy2(src, dst)
                img_paths[c["id"]] = dst

            # ─── 1b. Overlay görsellerini kopyala ──
            overlay_paths = {}
            if o_clips:
                for i, oc in enumerate(o_clips):
                    src = os.path.join(GORSELLER_DIR, oc["source"])
                    if os.path.isfile(src):
                        ext = os.path.splitext(oc["source"])[1].lower()
                        dst = os.path.join(gecici, f"ovr_{i:03d}{ext}")
                        shutil.copy2(src, dst)
                        overlay_paths[oc["id"]] = dst

            # ─── 2. Sesleri kopyala ──────────────
            audio_files = []
            if a_clips:
                rapor(8, "Ses dosyaları hazırlanıyor...")
                for i, ac in enumerate(a_clips):
                    src = os.path.join(CIKTILAR_DIR, ac["source"])
                    if os.path.isfile(src):
                        ext = os.path.splitext(ac["source"])[1]
                        dst = os.path.join(gecici, f"aud_{i}{ext}")
                        shutil.copy2(src, dst)
                        audio_files.append((dst, ac))

            # ─── 3. Her görsel klip → MP4 ────────
            rapor(10, "Video klipleri oluşturuluyor...")
            clip_files = []

            toplam_klip = len(v_clips)
            for i, vc in enumerate(v_clips):
                pct = 10 + int((i / toplam_klip) * 45)
                rapor(pct, f"Klip {i+1}/{toplam_klip} render ediliyor...")

                out_path = os.path.join(gecici, f"clip_{i:03d}.mp4")
                img = img_paths[vc["id"]]
                dur = vc["duration"]
                fx = vc.get("effects", {})
                kb = fx.get("kenBurns", {})

                ok = False
                if kb.get("enabled"):
                    ok = self._render_ken_burns_clip(img, out_path, dur, W, H, FPS, kb, fx)
                else:
                    ok = self._render_static_clip(img, out_path, dur, W, H, FPS, fx)

                if ok and os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                    # Süre doğrulaması
                    actual_dur = get_audio_duration(self.ffmpeg_cmd, out_path)
                    if actual_dur > dur + 1:
                        # Süre fazla — trim et
                        trimmed = os.path.join(gecici, f"trim_{i:03d}.mp4")
                        self._run([
                            self.ffmpeg_cmd, "-y", "-i", out_path,
                            "-t", str(dur), "-c", "copy", trimmed
                        ])
                        if os.path.isfile(trimmed) and os.path.getsize(trimmed) > 0:
                            os.replace(trimmed, out_path)
                    clip_files.append(out_path)
                else:
                    rapor(0, f"Klip {i+1} oluşturulamadı. Kaynak: {vc.get('source', '?')}")
                    print(f"[Voxtory] Klip {i+1} başarısız — img: {img}, out: {out_path}, ok: {ok}")
                    return None

            # ─── 4. Klipleri birleştir (geçiş efektleriyle) ─
            rapor(58, "Klipler birleştiriliyor...")
            merged = self._merge_clips_with_transitions(clip_files, v_clips, gecici, W, H, FPS)

            if not merged or not os.path.isfile(merged) or os.path.getsize(merged) == 0:
                rapor(0, "Birleştirme başarısız.")
                return None

            # ─── 4b. Overlay uygula ─────────────
            if o_clips and overlay_paths:
                rapor(62, "Overlay'ler uygulanıyor...")
                merged = self._apply_overlays(merged, o_clips, overlay_paths, gecici, W, H, FPS)
                if not merged or not os.path.isfile(merged):
                    rapor(0, "Overlay uygulama başarısız.")
                    return None

            # ─── 4c. Metin overlay uygula ────────
            if t_clips:
                rapor(65, "Metin overlay'leri uygulanıyor...")
                merged = self._apply_text_overlays(merged, t_clips, gecici)
                if not merged or not os.path.isfile(merged):
                    rapor(0, "Metin overlay uygulama başarısız.")
                    return None

            # ─── 5. Altyazı ──────────────────────
            ass_path = None
            srt_path = None
            if s_clips:
                rapor(68, "Altyazılar hazırlanıyor...")
                ass_path = os.path.join(gecici, "sub.ass")
                srt_path = os.path.join(gecici, "sub.srt")
                self._make_ass(s_clips, ass_path, W, H)
                self._make_srt(s_clips, srt_path)

            # ─── 6. Ses hazırla ──────────────────
            audio_out = None
            if audio_files:
                rapor(73, "Ses işleniyor...")
                audio_out = self._prepare_audio(audio_files, gecici)

            # ─── 7. Final ────────────────────────
            rapor(85, "Final video oluşturuluyor...")
            final = os.path.join(gecici, "final.mp4")

            cmd = [self.ffmpeg_cmd, "-y", "-i", merged]
            if audio_out:
                cmd += ["-i", audio_out]

            if ass_path and os.path.isfile(ass_path):
                safe = ass_path.replace("\\", "/").replace(":", "\\:")
                cmd += ["-vf", f"ass='{safe}'"] + self._enc_args(self._kalite)
            else:
                cmd += ["-c:v", "copy"]

            if audio_out:
                cmd += ["-c:a", "aac", "-b:a", "320k", "-ar", "44100"]

            # YouTube-optimize ayarlar
            cmd += [
                "-color_primaries", "bt709",
                "-color_trc", "bt709",
                "-colorspace", "bt709",
                "-bf", "2",
                "-g", str(FPS * 2),
                "-movflags", "+faststart",
                final,
            ]
            self._run(cmd)

            if not os.path.isfile(final) or os.path.getsize(final) == 0:
                rapor(0, "Final video oluşturulamadı.")
                return None

            # ─── 8. Taşı ─────────────────────────
            rapor(95, "Kaydediliyor...")
            shutil.move(final, cikti)
            if srt_path and os.path.isfile(srt_path):
                shutil.copy2(srt_path, os.path.join(VIDEOLAR_DIR, f"{dosya_adi}.srt"))

            elapsed = time.time() - t0
            mb = os.path.getsize(cikti) / (1024 * 1024)
            rapor(100, f"Tamamlandı! {mb:.1f} MB, {elapsed:.0f} sn")
            return cikti

        except Exception as e:
            rapor(0, f"Render hatası: {e}")
            return None
        finally:
            shutil.rmtree(gecici, ignore_errors=True)

    def _run(self, cmd):
        r = subprocess.run(cmd, capture_output=True, text=True, creationflags=SUBPROCESS_FLAGS)
        if r.returncode != 0 and r.stderr:
            print(f"[FFmpeg HATA] {r.stderr[-500:]}")
        return r

    def _enc_args(self, kalite):
        """GPU destekli encoder argümanlarını döndür (cache'li)."""
        if kalite not in self._encoder_cache:
            self._encoder_cache[kalite] = get_video_encoder_args(self.ffmpeg_cmd, kalite)
        return list(self._encoder_cache[kalite])

    # ─── Ken Burns Klip ──────────────────────────

    def _get_image_size(self, img_path):
        """Görsel boyutunu oku. FFprobe dener, başarısız olursa Pillow dener."""
        # 1. FFprobe ile dene
        ffprobe = self.ffmpeg_cmd.replace("ffmpeg", "ffprobe")
        try:
            r = self._run([
                ffprobe, "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0",
                img_path.replace("\\", "/"),
            ])
            if r.returncode == 0 and r.stdout.strip():
                parts = r.stdout.strip().split(",")
                return int(parts[0]), int(parts[1])
        except Exception:
            pass

        # 2. Pillow ile fallback
        try:
            from PIL import Image
            with Image.open(img_path) as im:
                return im.size  # (width, height)
        except Exception:
            pass

        return None, None

    def _render_ken_burns_clip(self, img_path, out_path, dur, W, H, FPS, kb, fx):
        """Ken Burns efekti — fill-mode buffer + zoompan filtresi ile.

        Preview mantığı (editor-preview.js _drawImageWithKenBurns):
          1. Fill mode: baseW/baseH hesapla (canvas'ı tamamen kaplayacak boyut)
          2. drawW = baseW * scale, drawH = baseH * scale
          3. offsetX = -(drawW - W) * centerX
          4. ctx.drawImage(img, offsetX, offsetY, drawW, drawH)

        FFmpeg karşılığı:
          1. Görseli fill mode ile 16:9 buffer'a yerleştir (scale+crop)
             Buffer boyutu = W*max_s x H*max_s (max zoom için yeterli piksel)
          2. zoompan z = scale, x/y = center tabanlı offset
             zoompan z=1 → viewport = buffer boyutu → fill-mode görsel tamamen görünür
             zoompan z=scale → viewport küçülür → zoom in

        Kritik nokta:
          zoompan z=1'de iw x ih viewport gösterir ve bunu s=WxH'ye sığdırır.
          Buffer 16:9 oranında ve s=WxH de 16:9 → aspect ratio korunur.
          z=scale olduğunda viewport = iw/scale x ih/scale → daha küçük alan → zoom in.
          Bu, preview'deki drawW = baseW*scale ile aynı etki:
            preview'de scale arttıkça görsel büyür ama canvas sabit → daha az görünür → zoom in.
        """
        frames = max(2, int(dur * FPS))
        s_s = max(1.0, kb.get("startScale", 1.0))
        s_e = max(1.0, kb.get("endScale", 1.3))
        cx_s = kb.get("startX", 0.5)
        cx_e = kb.get("endX", 0.5)
        cy_s = kb.get("startY", 0.5)
        cy_e = kb.get("endY", 0.5)

        max_s = max(s_s, s_e)

        # Görsel boyutunu oku
        imgW, imgH = self._get_image_size(img_path)
        if not imgW or not imgH:
            return self._render_static_clip(img_path, out_path, dur, W, H, FPS, fx)

        # ─── Buffer boyutu ───────────────────────
        # Buffer = 16:9 oranında, max_s * W genişliğinde, 8000px+ hedef
        # Neden max_s katı? z=max_s (maximum zoom) anında viewport = bufW/max_s x bufH/max_s
        # Bu viewport W x H ile aynı orana sahip olmalı → buffer W:H oranında olmalı
        bufW_raw = W * max_s
        upscale = max(1.0, 8000.0 / bufW_raw)
        bufW = int(bufW_raw * upscale / 2) * 2
        bufH = int(H * max_s * upscale / 2) * 2

        last = max(1, frames - 1)

        # ─── zoompan z = preview scale ───────────
        # z=1 → tüm buffer görünür = preview scale=1.0 (fill mode, hic zoom yok)
        # z=1.3 → buffer'ın 1/1.3'ü görünür = preview scale=1.3 (zoom in)
        # Yani z = preview scale, doğrudan!
        t_expr = f"(on/{last})"
        z_expr = f"({s_s}+({s_e}-{s_s})*{t_expr})"
        cx_expr = f"({cx_s}+({cx_e}-{cx_s})*{t_expr})"
        cy_expr = f"({cy_s}+({cy_e}-{cy_s})*{t_expr})"

        # zoompan x/y: viewport offset
        # Preview: offsetX = -(drawW - W) * centerX = -(baseW*scale - W) * cx
        # zoompan: x = (iw - iw/z) * cx = iw * (1 - 1/z) * cx
        # z=scale olduğunda: iw * (1 - 1/scale) * cx
        # Preview karşılığı: (baseW*scale - W) * cx / (baseW*scale) * iw
        #                   = (1 - W/(baseW*scale)) * iw * cx
        #                   = (1 - 1/scale * W/baseW) * iw * cx
        # Eğer baseW = W ise (kare görsel): = (1 - 1/scale) * iw * cx ✓ AYNI!
        # Ama baseW ≠ W olabilir (geniş görsel: baseW = H*imgR > W)
        # Bu durumda preview ve zoompan formülleri farklı olur.
        # Çözüm: buffer'ı tam olarak fill-mode baseW*max_s boyutuna ölçekle,
        # sonra 16:9'a kırp. Böylece zoompan'a giren görsel zaten fill-mode
        # kirpilmis durumdadır ve x/y formülleri birebir uyar.
        x_expr = f"(iw-iw/{z_expr})*{cx_expr}"
        y_expr = f"(ih-ih/{z_expr})*{cy_expr}"

        # Görsel efektler (filtreler + renk düzeltme)
        ef = self._build_effect_filters(fx)
        ef_suffix = ("," + ef) if ef else ""

        # ─── Filter chain ────────────────────────
        # 1. Görseli fill mode ile 16:9 buffer'a yerleştir:
        #    scale → force_original_aspect_ratio=increase (aspect ratio koru, kısa kenarı doldur)
        #    crop → bufW:bufH (16:9'a kırp, merkeze hizala)
        # 2. zoompan: z=scale, x/y=center tabanlı, s=WxH
        vf = (
            f"scale={bufW}:{bufH}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={bufW}:{bufH},"
            f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}'"
            f":d={frames}:s={W}x{H}:fps={FPS},"
            f"format=yuv420p"
            f"{ef_suffix}"
        )

        cmd = [
            self.ffmpeg_cmd, "-y",
            "-loop", "1",
            "-i", img_path.replace("\\", "/"),
            "-vf", vf,
            "-t", str(dur),
        ] + self._enc_args(self._kalite) + [
            "-an", out_path,
        ]
        r = self._run(cmd)
        return r.returncode == 0

    # ─── Klip Birleştirme (Geçiş Efektleriyle) ────

    def _merge_clips_with_transitions(self, clip_files, clips_data, gecici, W, H, FPS):
        """Klipleri geçiş efektleriyle birleştir. xfade filtresi kullanır."""
        if len(clip_files) == 0:
            return None
        if len(clip_files) == 1:
            return clip_files[0]

        current = clip_files[0]

        for i in range(1, len(clip_files)):
            next_clip = clip_files[i]
            # Geçiş bilgisi önceki klipten alınır
            prev_data = clips_data[i - 1] if i - 1 < len(clips_data) else {}
            trans = prev_data.get("transition", {})
            trans_type = trans.get("type", "none")
            trans_dur = trans.get("duration", 0.5)

            temp_out = os.path.join(gecici, f"xfade_{i:03d}.mp4")

            if trans_type == "none" or trans_dur <= 0:
                # Geçiş yok — basit concat
                concat_file = os.path.join(gecici, f"concat_{i:03d}.txt")
                with open(concat_file, "w", encoding="utf-8") as f:
                    f.write(f"file '{current.replace(chr(92), '/')}'\n")
                    f.write(f"file '{next_clip.replace(chr(92), '/')}'\n")
                self._run([
                    self.ffmpeg_cmd, "-y", "-f", "concat", "-safe", "0",
                    "-i", concat_file, "-c", "copy", temp_out
                ])
            else:
                # xfade geçiş türü eşleştirmesi
                xfade_type = {
                    "fade": "fade",
                    "dissolve": "dissolve",
                    "slideleft": "slideleft",
                    "slideright": "slideright",
                    "slideup": "slideup",
                    "slidedown": "slidedown",
                    "wipeleft": "wipeleft",
                    "wiperight": "wiperight",
                }.get(trans_type, "fade")

                # Önceki klibin süresini al
                prev_dur = get_audio_duration(self.ffmpeg_cmd, current)
                offset = max(0, prev_dur - trans_dur)

                self._run([
                    self.ffmpeg_cmd, "-y",
                    "-i", current,
                    "-i", next_clip,
                    "-filter_complex",
                    f"[0:v][1:v]xfade=transition={xfade_type}:duration={trans_dur}:offset={offset},format=yuv420p[v]",
                    "-map", "[v]",
                ] + self._enc_args(self._kalite) + [
                    "-an", temp_out,
                ])

            if os.path.isfile(temp_out) and os.path.getsize(temp_out) > 0:
                current = temp_out
            else:
                # xfade başarısız olduysa basit concat dene
                concat_file = os.path.join(gecici, f"fallback_{i:03d}.txt")
                with open(concat_file, "w", encoding="utf-8") as f:
                    f.write(f"file '{current.replace(chr(92), '/')}'\n")
                    f.write(f"file '{next_clip.replace(chr(92), '/')}'\n")
                self._run([
                    self.ffmpeg_cmd, "-y", "-f", "concat", "-safe", "0",
                    "-i", concat_file, "-c", "copy", temp_out
                ])
                if os.path.isfile(temp_out) and os.path.getsize(temp_out) > 0:
                    current = temp_out

        return current

    # ─── Efekt Filtre Zinciri ────────────────────────

    def _build_effect_filters(self, fx):
        """Görsel efektlerden FFmpeg filter chain oluştur."""
        parts = []

        b = fx.get("brightness", 0)
        c = fx.get("contrast", 0)
        sat = fx.get("saturation", 0)

        if b != 0 or c != 0 or sat != 0:
            eq_parts = []
            if b != 0:
                eq_parts.append(f"brightness={b / 100.0}")
            if c != 0:
                eq_parts.append(f"contrast={1.0 + c / 50.0}")
            if sat != 0:
                eq_parts.append(f"saturation={1.0 + sat / 50.0}")
            parts.append(f"eq={':'.join(eq_parts)}")

        temp = fx.get("temperature", 0)
        if temp != 0:
            if temp > 0:
                r = temp / 200.0
                parts.append(f"colorbalance=rs={r:.3f}:gs={-r / 3:.3f}:bs={-r:.3f}")
            else:
                b_val = -temp / 200.0
                parts.append(f"colorbalance=rs={-b_val:.3f}:gs={b_val / 3:.3f}:bs={b_val:.3f}")

        blur = fx.get("blur", 0)
        if blur > 0:
            sigma = blur / 10.0
            parts.append(f"gblur=sigma={sigma:.1f}")

        sharpen = fx.get("sharpen", 0)
        if sharpen > 0:
            parts.append(f"unsharp=5:5:{sharpen / 25.0:.2f}")

        vignette = fx.get("vignette", 0)
        if vignette > 0:
            parts.append(f"vignette=a={vignette / 50.0:.2f}")

        grain = fx.get("grain", 0)
        if grain > 0:
            parts.append(f"noise=c0s={grain}:c0f=t+u")

        # Preset filtre
        preset = fx.get("filter", "none")
        if preset != "none":
            parts.extend(FILTER_PRESETS.get(preset, []))

        return ",".join(parts)

    # ─── Statik Klip ─────────────────────────────

    def _render_static_clip(self, img_path, out_path, dur, W, H, FPS, fx):
        """Sabit görsel klip. -loop 1 -t ile kesin süre."""
        fit = fx.get("fitMode", "fit")
        scale_flags = "lanczos+accurate_rnd+full_chroma_int"

        if fit == "fill":
            vf = f"scale={W}:{H}:force_original_aspect_ratio=increase:flags={scale_flags},crop={W}:{H},setsar=1,fps={FPS},format=yuv420p"
        elif fit == "stretch":
            vf = f"scale={W}:{H}:flags={scale_flags},setsar=1,fps={FPS},format=yuv420p"
        else:
            vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags={scale_flags},pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={FPS},format=yuv420p"

        # Görsel efektler (filtreler + renk düzeltme)
        ef = self._build_effect_filters(fx)
        if ef:
            vf += "," + ef

        enc = self._enc_args(self._kalite)
        # Statik görsel için tune stillimage (sadece libx264 ise)
        if "-c:v" in " ".join(enc) and "libx264" in " ".join(enc):
            enc += ["-tune", "stillimage"]

        frames = max(1, int(dur * FPS))
        cmd = [
            self.ffmpeg_cmd, "-y",
            "-loop", "1", "-framerate", str(FPS),
            "-i", img_path.replace("\\", "/"),
            "-vf", vf,
            "-frames:v", str(frames),
        ] + enc + [
            "-an", out_path,
        ]
        r = self._run(cmd)
        return r.returncode == 0

    # ─── Overlay Uygulama ────────────────────────

    def _apply_overlays(self, base_video, o_clips, overlay_paths, gecici, W, H, FPS):
        """Overlay klipleri base video üzerine uygular.

        Her overlay klip ayrı bir FFmpeg overlay geçişi ile uygulanır.
        Overlay'lar sırayla eklenir (birden fazla overlay varsa chain).
        """
        current = base_video

        for i, oc in enumerate(o_clips):
            img_path = overlay_paths.get(oc["id"])
            if not img_path or not os.path.isfile(img_path):
                continue

            out_path = os.path.join(gecici, f"overlay_{i:03d}.mp4")

            # Konum ve boyut
            pos = oc.get("position", {"x": 0.5, "y": 0.5})
            size = oc.get("size", {"w": 0.2, "h": 0})
            opacity = oc.get("opacity", 1.0)
            start_t = oc.get("startTime", 0)
            dur = oc.get("duration", 5)

            # Overlay boyutu
            ow = max(1, int(W * size.get("w", 0.2)))
            # h=0 → aspect ratio korunur, scale=-1 ile
            if size.get("h", 0) > 0:
                oh = max(1, int(H * size["h"]))
            else:
                oh = -1  # FFmpeg scale ile otomatik

            # Konum (center-based → top-left)
            ox_expr = f"{int(pos.get('x', 0.5) * W)}-overlay_w/2"
            oy_expr = f"{int(pos.get('y', 0.5) * H)}-overlay_h/2"

            # Overlay efektleri
            ovr_filters = f"scale={ow}:{oh}:flags=lanczos"
            ef = self._build_effect_filters(oc.get("effects", {}))
            if ef:
                ovr_filters += "," + ef
            if opacity < 1.0:
                ovr_filters += f",format=rgba,colorchannelmixer=aa={opacity:.2f}"

            # enable parametresi — sadece belirli sürede görünsün
            enable = f"between(t,{start_t},{start_t + dur})"

            fc = (
                f"[1:v]{ovr_filters}[ovr];"
                f"[0:v][ovr]overlay=x='{ox_expr}':y='{oy_expr}':enable='{enable}':format=auto[out]"
            )

            cmd = [
                self.ffmpeg_cmd, "-y",
                "-i", current,
                "-i", img_path.replace("\\", "/"),
                "-filter_complex", fc,
                "-map", "[out]",
            ] + self._enc_args(self._kalite) + [
                "-an", out_path,
            ]

            self._run(cmd)

            if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                current = out_path
            # Overlay başarısız olursa devam et (base video korunur)

        return current

    # ─── Metin Overlay Uygulama ────────────────────

    def _apply_text_overlays(self, base_video, t_clips, gecici):
        """Metin kliplerini FFmpeg drawtext filtresi ile base video'ya uygular.

        Tüm metin kliplerini tek bir filter chain'de birleştirir (her biri enable ile zamanlanır).
        """
        if not t_clips:
            return base_video

        # Drawtext filtreleri oluştur
        drawtext_parts = []
        for tc in t_clips:
            # FFmpeg drawtext özel karakter escape
            text = tc.get("text", "Metin")
            text = text.replace("\\", "\\\\")
            text = text.replace("'", "\u2019")  # Tek tırnak → Unicode right quote
            text = text.replace(":", "\\:")
            text = text.replace("%", "%%")

            st = tc.get("style", {})
            pos = tc.get("position", {"x": 0.5, "y": 0.3})
            anim = tc.get("animation", {})

            size = st.get("size", 72)
            color = st.get("color", "#FFFFFF").replace("#", "0x")
            bold = st.get("bold", True)

            # Font dosyası — bold ise bold variant
            if bold:
                fontfile = "C\\\\:/Windows/Fonts/segoeuib.ttf"
            else:
                fontfile = "C\\\\:/Windows/Fonts/segoeui.ttf"

            # Konum hesaplama
            px = pos.get("x", 0.5)
            py = pos.get("y", 0.3)

            # Hizalama bazlı x hesabı
            align = st.get("align", "center")
            if align == "center":
                x_expr = f"(w*{px}-text_w/2)"
            elif align == "left":
                x_expr = f"(w*{px})"
            else:
                x_expr = f"(w*{px}-text_w)"
            y_expr = f"(h*{py}-text_h/2)"

            # Arka plan kutusu
            bg_color = st.get("backgroundColor", "transparent")
            box = 0
            box_color = "black@0.6"
            box_border = st.get("padding", 20)
            if bg_color and bg_color != "transparent":
                box = 1
                # rgba(r,g,b,a) parse
                if bg_color.startswith("rgba("):
                    rgba_str = bg_color.replace("rgba(", "").replace(")", "").split(",")
                    if len(rgba_str) >= 4:
                        r, g, b = int(rgba_str[0].strip()), int(rgba_str[1].strip()), int(rgba_str[2].strip())
                        a = float(rgba_str[3].strip())
                        hex_c = f"{r:02x}{g:02x}{b:02x}"
                        box_color = f"0x{hex_c}@{a:.1f}"

            # Zaman aralığı
            start_t = tc.get("startTime", 0)
            dur = tc.get("duration", 4)
            enable = f"between(t\\,{start_t}\\,{start_t + dur})"

            # Fade animasyonu
            enter_type = anim.get("enter", "none")
            enter_dur = anim.get("enterDuration", 0.5)
            exit_type = anim.get("exit", "none")
            exit_dur = anim.get("exitDuration", 0.3)

            # Alpha expression (fade in/out)
            alpha_parts = []
            if enter_type == "fadeIn":
                alpha_parts.append(f"if(lt(t-{start_t}\\,{enter_dur})\\,(t-{start_t})/{enter_dur}\\,1)")
            if exit_type == "fadeOut":
                end_t = start_t + dur
                fade_start = end_t - exit_dur
                alpha_parts.append(f"if(gt(t\\,{fade_start})\\,({end_t}-t)/{exit_dur}\\,1)")

            alpha_expr = ""
            if alpha_parts:
                if len(alpha_parts) == 1:
                    alpha_expr = f":alpha={alpha_parts[0]}"
                else:
                    alpha_expr = f":alpha=min({alpha_parts[0]}\\,{alpha_parts[1]})"

            # Outline
            outline_w = st.get("outlineWidth", 0)
            outline_color = st.get("outlineColor", "#000000").replace("#", "0x")

            # drawtext filter
            dt = (
                f"drawtext=text='{text}'"
                f":fontfile={fontfile}"
                f":fontsize={size}"
                f":fontcolor={color}"
                f":x={x_expr}:y={y_expr}"
            )
            if box:
                dt += f":box=1:boxcolor={box_color}:boxborderw={box_border}"
            if outline_w > 0:
                dt += f":borderw={outline_w}:bordercolor={outline_color}"
            dt += f":enable='{enable}'"
            if alpha_expr:
                dt += alpha_expr

            drawtext_parts.append(dt)

        if not drawtext_parts:
            return base_video

        # Tüm drawtext'leri virgülle birleştir
        vf = ",".join(drawtext_parts)

        out_path = os.path.join(gecici, "text_overlay.mp4")
        cmd = [
            self.ffmpeg_cmd, "-y",
            "-i", base_video,
            "-vf", vf,
        ] + self._enc_args(self._kalite) + [
            "-an", out_path,
        ]
        print(f"[Voxtory] Metin overlay VF: {vf[:500]}")
        r = self._run(cmd)
        if r.returncode != 0:
            print(f"[Voxtory] Metin overlay HATA: {r.stderr[-500:] if r.stderr else 'stderr yok'}")

        if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
            return out_path
        return base_video  # Başarısız olursa orijinali koru

    # ─── Ses Hazırlama ───────────────────────────

    def _prepare_audio(self, audio_files, gecici):
        """Ses kliplerini timeline pozisyonlarına göre hazırla ve birleştir."""
        processed = []

        for i, (path, ac) in enumerate(audio_files):
            parts = []
            dur = ac.get("duration", 30)

            # 1. Trim — kaynak dosyadan gerekli kısmı al
            parts.append(f"atrim=0:{dur}")
            parts.append("asetpts=PTS-STARTPTS")

            # 2. Hız
            spd = ac.get("speed", 1.0)
            if spd != 1.0:
                parts.append(f"atempo={max(0.5, min(2.0, spd))}")

            # 3. Pitch
            pitch = ac.get("pitch", 0)
            if pitch != 0:
                ratio = 2 ** (pitch / 12.0)
                parts.append(f"asetrate=44100*{ratio:.6f},aresample=44100")

            # 4. Volume
            vol = ac.get("volume", 1.0)
            if vol != 1.0:
                parts.append(f"volume={vol}")

            # 5. Fade
            fi = ac.get("fadeIn", 0)
            fo = ac.get("fadeOut", 0)
            if fi > 0:
                parts.append(f"afade=t=in:st=0:d={fi}")
            if fo > 0:
                parts.append(f"afade=t=out:st={max(0, dur - fo)}:d={fo}")

            # 6. Timeline delay — en son (diğer efektlerden sonra)
            delay_ms = int(ac.get("startTime", 0) * 1000)
            if delay_ms > 0:
                parts.append(f"adelay={delay_ms}|{delay_ms}")

            af = ",".join(parts) if parts else "anull"
            out = os.path.join(gecici, f"ap_{i}.wav")
            self._run([
                self.ffmpeg_cmd, "-y", "-i", path,
                "-af", af, "-ar", "44100", out
            ])
            if os.path.isfile(out):
                processed.append(out)

        if not processed:
            return None
        if len(processed) == 1:
            return processed[0]

        # Mix
        out = os.path.join(gecici, "amix.wav")
        inputs = []
        for p in processed:
            inputs += ["-i", p]
        self._run([
            self.ffmpeg_cmd, "-y"] + inputs + [
            "-filter_complex", f"amix=inputs={len(processed)}:duration=longest:normalize=0",
            "-ar", "44100", out
        ])
        return out if os.path.isfile(out) else processed[0]

    # ─── Altyazı ─────────────────────────────────

    def _make_ass(self, clips, path, W, H):
        with open(path, "w", encoding="utf-8-sig") as f:
            f.write("[Script Info]\nTitle: Voxtory\nScriptType: v4.00+\n")
            f.write(f"PlayResX: {W}\nPlayResY: {H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n")

            f.write("[V4+ Styles]\n")
            f.write("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
                    "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
                    "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
                    "Alignment, MarginL, MarginR, MarginV, Encoding\n")

            st = clips[0].get("style", {})
            font = st.get("font", "Segoe UI")
            size = st.get("size", 52)
            pc = self._hex_to_ass(st.get("color", "#FFFFFF"))
            oc = self._hex_to_ass(st.get("outlineColor", "#000000"))
            ow = st.get("outlineWidth", 3)
            bold = 1 if st.get("bold", True) else 0
            ital = 1 if st.get("italic", False) else 0
            shad = 2 if st.get("shadow", True) else 0
            align = {"bottom": 2, "top": 8, "middle": 5}.get(st.get("position", "bottom"), 2)

            f.write(f"Style: Default,{font},{size},{pc},&H000000FF,{oc},&H80000000,"
                    f"{bold},{ital},0,0,100,100,0,0,1,{ow},{shad},{align},40,40,50,1\n\n")

            f.write("[Events]\n")
            f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

            for c in clips:
                b = zaman_fmt_ass(c["startTime"])
                e = zaman_fmt_ass(c["startTime"] + c["duration"])
                txt = c.get("text", "").replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
                if len(txt) > 45:
                    mid = len(txt) // 2
                    sp = txt.rfind(" ", 0, mid + 10)
                    if sp > 0:
                        txt = txt[:sp] + "\\N" + txt[sp + 1:]

                # Animasyon efektleri (preview ile uyumlu)
                anim = c.get("style", {}).get("animation", "none")
                dur_ms = int(c["duration"] * 1000)

                if anim == "typewriter":
                    # ASS \k karaoke + \2a&HFF& ile karakter bazlı daktilo
                    # \2a&HFF& → secondary alpha şeffaf (henüz yazılmamış = görünmez)
                    # \k{cs} → her karakter centisaniye sonra görünür olur
                    # Tek Dialogue, hızlı render, preview ile birebir uyumlu
                    saf = txt.replace("\\N", "\n")
                    toplam_karakter = len(saf)
                    if toplam_karakter > 0:
                        yazma_suresi = c["duration"] / 1.2
                        k_cs = max(1, round(yazma_suresi / toplam_karakter * 100))
                        tagged = "{\\2a&HFF&}"
                        for ch in saf:
                            if ch == "\n":
                                tagged += "\\N"
                            else:
                                tagged += "{\\k" + str(k_cs) + "}" + ch
                        f.write(f"Dialogue: 0,{b},{e},Default,,0,0,0,,{tagged}\n")
                        continue

                if anim == "fadeIn":
                    fade_dur = min(dur_ms // 4, 500)
                    txt = "{\\fad(" + str(fade_dur) + ",0)}" + txt
                elif anim == "scaleIn":
                    fade_ms = min(int(c["duration"] * 333), 500)
                    txt = "{\\fscx50\\fscy50\\t(0," + str(fade_ms) + ",\\fscx100\\fscy100)\\fad(" + str(fade_ms) + ",0)}" + txt
                elif anim == "slideUp":
                    fade_ms = min(int(c["duration"] * 250), 400)
                    pos_y_end = {"bottom": int(H * 0.87), "middle": int(H * 0.5), "top": int(H * 0.12)}.get(
                        c.get("style", {}).get("position", "bottom"), int(H * 0.87))
                    pos_y_start = pos_y_end + int(H * 0.1)
                    txt = "{\\move(" + str(W // 2) + "," + str(pos_y_start) + "," + str(W // 2) + "," + str(pos_y_end) + ",0," + str(fade_ms) + ")\\fad(" + str(fade_ms) + ",0)}" + txt

                f.write(f"Dialogue: 0,{b},{e},Default,,0,0,0,,{txt}\n")

    def _make_srt(self, clips, path):
        from .subtitle_utils import zaman_fmt_srt
        with open(path, "w", encoding="utf-8") as f:
            for i, c in enumerate(clips):
                f.write(f"{i+1}\n")
                f.write(f"{zaman_fmt_srt(c['startTime'])} --> {zaman_fmt_srt(c['startTime'] + c['duration'])}\n")
                f.write(f"{c.get('text', '')}\n\n")

    @staticmethod
    def _hex_to_ass(h):
        h = h.lstrip("#")
        if len(h) == 6:
            return f"&H00{h[4:6].upper()}{h[2:4].upper()}{h[0:2].upper()}"
        return "&H00FFFFFF"

    @staticmethod
    def safe_filename(s):
        g = "".join(c if c.isalnum() or c in "-_ " else "" for c in s).strip().replace(" ", "_")
        return g or f"video_{int(time.time())}"
