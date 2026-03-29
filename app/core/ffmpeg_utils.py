import os
import sys
import subprocess

# Windows'ta subprocess konsol penceresi açmasın
SUBPROCESS_FLAGS = 0
if sys.platform == "win32":
    SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW


def find_ffmpeg() -> str:
    """FFmpeg yolunu bul. Bulunamazsa 'ffmpeg' döndürür (PATH'te arar)."""
    # 0. Uygulama dizininde (PyInstaller paketinde)
    if getattr(sys, 'frozen', False):
        app_ffmpeg = os.path.join(os.path.dirname(sys.executable), "ffmpeg.exe")
        if os.path.isfile(app_ffmpeg):
            return app_ffmpeg

    # 1. Sistem PATH
    try:
        subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=SUBPROCESS_FLAGS,
        )
        return "ffmpeg"
    except FileNotFoundError:
        pass

    # 2. WinGet paketleri
    winget_base = os.path.join(
        os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages"
    )
    if os.path.isdir(winget_base):
        for klasor in os.listdir(winget_base):
            if "FFmpeg" in klasor:
                for kok, _, dosyalar in os.walk(os.path.join(winget_base, klasor)):
                    if "ffmpeg.exe" in dosyalar:
                        return os.path.join(kok, "ffmpeg.exe")

    # 3. WinGet Links
    links = os.path.join(
        os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links", "ffmpeg.exe"
    )
    if os.path.isfile(links):
        return links

    return "ffmpeg"


def get_audio_duration(ffmpeg_cmd: str, audio_path: str) -> float:
    """FFmpeg ile ses dosyasının süresini saniye olarak al."""
    result = subprocess.run(
        [ffmpeg_cmd, "-i", audio_path],
        capture_output=True, text=True,
        creationflags=SUBPROCESS_FLAGS,
    )
    for line in result.stderr.split("\n"):
        if "Duration" in line:
            zaman = line.split("Duration:")[1].split(",")[0].strip()
            parcalar = zaman.split(":")
            return float(parcalar[0]) * 3600 + float(parcalar[1]) * 60 + float(parcalar[2])
    return 0


# ─── GPU Hızlandırma ────────────────────────────

_gpu_cache = None  # None=henüz test edilmedi, False=yok, str=encoder adı


def detect_gpu_encoder(ffmpeg_cmd: str = None) -> str | None:
    """
    NVIDIA NVENC, AMD AMF veya Intel QSV desteğini tespit et.
    Destekleniyorsa encoder adını döndürür (ör: 'h264_nvenc'),
    yoksa None döndürür (CPU libx264 kullanılacak).
    """
    global _gpu_cache
    if _gpu_cache is not None:
        return _gpu_cache if _gpu_cache else None

    if not ffmpeg_cmd:
        ffmpeg_cmd = find_ffmpeg()

    # Sırayla dene: NVIDIA > AMD > Intel
    encoders = [
        ("h264_nvenc", "NVIDIA NVENC"),
        ("h264_amf", "AMD AMF"),
        ("h264_qsv", "Intel QSV"),
    ]

    for encoder, label in encoders:
        try:
            result = subprocess.run(
                [ffmpeg_cmd, "-hide_banner", "-f", "lavfi", "-i", "nullsrc=s=256x256:d=0.1",
                 "-c:v", encoder, "-f", "null", "-"],
                capture_output=True, text=True,
                creationflags=SUBPROCESS_FLAGS,
                timeout=10,
            )
            if result.returncode == 0:
                _gpu_cache = encoder
                print(f"[Voxtory] GPU encoder bulundu: {label} ({encoder})")
                return encoder
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            continue

    _gpu_cache = False
    print("[Voxtory] GPU encoder bulunamadı, CPU (libx264) kullanılacak.")
    return None


def get_video_encoder_args(ffmpeg_cmd: str, kalite: str = "normal") -> list[str]:
    """
    Kalite ayarına göre video encoder argümanlarını döndür.
    GPU varsa NVENC, yoksa libx264.
    """
    gpu = detect_gpu_encoder(ffmpeg_cmd)

    if gpu == "h264_nvenc":
        # NVIDIA NVENC — CQ (constant quality) mode
        if kalite == "hizli":
            return ["-c:v", "h264_nvenc", "-preset", "p1", "-rc", "constqp", "-qp", "28",
                    "-pix_fmt", "yuv420p"]
        elif kalite == "yuksek":
            return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "18",
                    "-pix_fmt", "yuv420p", "-profile:v", "high"]
        else:
            return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "constqp", "-qp", "22",
                    "-pix_fmt", "yuv420p", "-profile:v", "high"]

    elif gpu == "h264_amf":
        # AMD AMF
        if kalite == "hizli":
            return ["-c:v", "h264_amf", "-quality", "speed", "-qp_i", "28", "-qp_p", "28",
                    "-pix_fmt", "yuv420p"]
        elif kalite == "yuksek":
            return ["-c:v", "h264_amf", "-quality", "quality", "-qp_i", "18", "-qp_p", "18",
                    "-pix_fmt", "yuv420p"]
        else:
            return ["-c:v", "h264_amf", "-quality", "balanced", "-qp_i", "22", "-qp_p", "22",
                    "-pix_fmt", "yuv420p"]

    elif gpu == "h264_qsv":
        # Intel QSV
        if kalite == "hizli":
            return ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "28",
                    "-pix_fmt", "yuv420p"]
        elif kalite == "yuksek":
            return ["-c:v", "h264_qsv", "-preset", "veryslow", "-global_quality", "18",
                    "-pix_fmt", "yuv420p"]
        else:
            return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", "22",
                    "-pix_fmt", "yuv420p"]

    else:
        # CPU fallback — libx264
        if kalite == "hizli":
            return ["-c:v", "libx264", "-preset", "fast", "-crf", "25",
                    "-pix_fmt", "yuv420p"]
        elif kalite == "yuksek":
            return ["-c:v", "libx264", "-preset", "slow", "-crf", "17",
                    "-pix_fmt", "yuv420p", "-profile:v", "high"]
        else:
            return ["-c:v", "libx264", "-preset", "medium", "-crf", "21",
                    "-pix_fmt", "yuv420p", "-profile:v", "high"]
