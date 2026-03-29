from typing import Callable

_whisper_model = None
_whisper_available = None  # None=kontrol edilmedi


def _whisper_kontrol():
    """faster_whisper kurulu mu kontrol et."""
    global _whisper_available
    if _whisper_available is not None:
        return _whisper_available
    try:
        import faster_whisper  # noqa: F401
        _whisper_available = True
    except ImportError:
        _whisper_available = False
    return _whisper_available


def _whisper_yukle():
    """Whisper modelini yükle (ilk seferde ~150MB indirir)."""
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    try:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        return _whisper_model
    except Exception as e:
        print(f"Whisper yükleme hatası: {e}")
        return None


class Transcriber:
    def is_available(self) -> bool:
        """Whisper kullanılabilir mi?"""
        return _whisper_kontrol()

    def transcribe(
        self,
        ses_yolu: str,
        progress_cb: Callable[[int, str], None] | None = None,
    ) -> str | None:
        """Ses dosyasından metin çıkar. Başarılıysa metni döndürür."""
        def rapor(yuzde, mesaj):
            if progress_cb:
                progress_cb(yuzde, mesaj)

        if not _whisper_kontrol():
            rapor(0, "faster-whisper kurulu değil. Kurmak için: pip install faster-whisper")
            return None

        rapor(10, "Whisper modeli yükleniyor (ilk sefer ~150MB indirir)...")

        model = _whisper_yukle()
        if model is None:
            rapor(0, "Whisper modeli yüklenemedi. İnternet bağlantısını kontrol edin.")
            return None

        rapor(30, "Ses analiz ediliyor...")
        try:
            segments, info = model.transcribe(ses_yolu, language="tr")
            rapor(70, "Metin oluşturuluyor...")
            metin = " ".join([seg.text.strip() for seg in segments])
        except Exception as e:
            rapor(0, f"Transkript hatası: {str(e)}")
            return None

        if not metin or not metin.strip():
            rapor(0, "Ses dosyasında konuşma tespit edilemedi.")
            return None

        rapor(100, "Transkript tamamlandı!")
        return metin

    def transcribe_segments(
        self,
        ses_yolu: str,
        progress_cb: Callable[[int, str], None] | None = None,
    ) -> list[dict] | None:
        """Ses dosyasından zamanlı segment listesi çıkar.
        Her segment: { "text": str, "start": float, "end": float }
        """
        def rapor(yuzde, mesaj):
            if progress_cb:
                progress_cb(yuzde, mesaj)

        if not _whisper_kontrol():
            rapor(0, "faster-whisper kurulu değil.")
            return None

        rapor(10, "Whisper modeli yükleniyor...")
        model = _whisper_yukle()
        if model is None:
            rapor(0, "Whisper modeli yüklenemedi.")
            return None

        rapor(30, "Ses analiz ediliyor...")
        try:
            segments, info = model.transcribe(
                ses_yolu,
                language="tr",
                word_timestamps=True,
            )

            rapor(60, "Segmentler oluşturuluyor...")
            result = []
            for seg in segments:
                text = seg.text.strip()
                if not text:
                    continue
                result.append({
                    "text": text,
                    "start": round(seg.start, 3),
                    "end": round(seg.end, 3),
                })

        except Exception as e:
            rapor(0, f"Transkript hatası: {str(e)}")
            return None

        if not result:
            rapor(0, "Ses dosyasında konuşma tespit edilemedi.")
            return None

        rapor(100, f"{len(result)} segment bulundu.")
        return result
