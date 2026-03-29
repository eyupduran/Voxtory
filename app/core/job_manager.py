import threading
import uuid
import time
from typing import Callable, Any


class Job:
    def __init__(self, job_id: str):
        self.id = job_id
        self.status = "basliyor"  # basliyor, calisiyor, tamamlandi, hata
        self.progress = 0
        self.message = "Hazırlanıyor..."
        self.result: Any = None
        self.start_time = time.time()

    def update(self, progress: int, message: str):
        self.progress = progress
        self.message = message
        if progress > 0 and self.status == "basliyor":
            self.status = "calisiyor"

    def complete(self, result: Any = None):
        self.status = "tamamlandi"
        self.progress = 100
        self.result = result

    def fail(self, message: str):
        self.status = "hata"
        self.message = message


class JobManager:
    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def start_job(self, target: Callable, *args, **kwargs) -> Job:
        """Arka plan işi başlat. Target fonksiyonunun ilk parametresi progress_cb olmalı."""
        job_id = str(uuid.uuid4())[:8]
        job = Job(job_id)

        with self._lock:
            self._jobs[job_id] = job

        def progress_cb(yuzde: int, mesaj: str):
            job.update(yuzde, mesaj)

        def wrapper():
            try:
                result = target(progress_cb, *args, **kwargs)
                if job.status != "hata":
                    job.complete(result)
            except Exception as e:
                job.fail(f"Beklenmeyen hata: {str(e)}")

        t = threading.Thread(target=wrapper, daemon=True)
        t.start()
        return job

    def get_job(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)
