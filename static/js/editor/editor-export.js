/* ═══════════════════════════════════════════════════════════════
   Voxtory Video Editör — Export (Dışa Aktarma)
   ═══════════════════════════════════════════════════════════════ */

const EditorExport = {
    _isExporting: false,
    _currentJobId: null,
    _backgroundMode: false,

    init() {
        document.getElementById('btn-export')?.addEventListener('click', () => this.showDialog());
        document.getElementById('btn-export-start')?.addEventListener('click', () => this.startExport());
        document.getElementById('btn-export-cancel')?.addEventListener('click', () => {
            if (this._isExporting) {
                // Render devam ediyor — arka plana al
                this._goBackground();
            } else {
                this.hideDialog();
            }
        });

        // Toolbar render status tıklanınca dialogu tekrar aç
        document.getElementById('toolbar-render-status')?.addEventListener('click', () => {
            if (this._isExporting) this.showDialog();
        });
    },

    showDialog() {
        if (!Editor.project) return;

        // Render devam ediyorsa dialogu progress ile göster
        if (this._isExporting) {
            const overlay = document.getElementById('export-overlay');
            if (overlay) overlay.classList.add('active');
            this._backgroundMode = false;
            return;
        }

        const videoTrack = Editor.getTrackByType('video');
        if (!videoTrack || !videoTrack.clips.length) {
            toast('Dışa aktarmak için en az bir görsel klibi ekleyin.', 'warning');
            return;
        }

        // Proje bilgisi
        const infoEl = document.getElementById('export-project-info');
        if (infoEl) {
            const meta = Editor.project.meta;
            const klipSayisi = Editor.project.tracks.reduce((n, t) => n + t.clips.length, 0);
            const sure = Editor.formatTime(Editor.getTotalDuration());
            const durum = Editor._isExistingProject ? 'Mevcut proje güncelleniyor' : 'Yeni proje';
            infoEl.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                <div>
                    <strong>${meta.baslik}</strong> — ${klipSayisi} klip, ${sure}<br>
                    <span style="font-size:11px;color:var(--text-muted);">${durum}</span>
                </div>
            `;
        }

        document.getElementById('export-filename').value = Editor.project.meta.baslik || 'video';

        const resSelect = document.getElementById('export-resolution');
        if (resSelect) {
            const coz = Editor.project.meta.cozunurluk;
            resSelect.value = `${coz.w}x${coz.h}`;
        }

        // UI sıfırla
        const progress = document.getElementById('export-progress');
        if (progress) progress.classList.remove('active');
        const startBtn = document.getElementById('btn-export-start');
        if (startBtn) { startBtn.disabled = false; startBtn.style.display = ''; }
        const cancelBtn = document.getElementById('btn-export-cancel');
        if (cancelBtn) cancelBtn.textContent = 'Vazgeç';

        document.getElementById('export-overlay')?.classList.add('active');
        this._isExporting = false;
        this._backgroundMode = false;
    },

    hideDialog() {
        document.getElementById('export-overlay')?.classList.remove('active');
    },

    _goBackground() {
        this._backgroundMode = true;
        this.hideDialog();
        this._updateToolbarStatus('Render devam ediyor...');
    },

    _updateToolbarStatus(text) {
        const el = document.getElementById('toolbar-render-status');
        if (!el) return;
        if (text) {
            el.innerHTML = `<span class="render-spinner"></span> ${text}`;
        } else {
            el.innerHTML = '';
        }
    },

    async startExport() {
        if (this._isExporting) return;
        this._isExporting = true;

        const filenameInput = document.getElementById('export-filename');
        const resSelect = document.getElementById('export-resolution');
        const qualSelect = document.getElementById('export-quality');
        const startBtn = document.getElementById('btn-export-start');
        const cancelBtn = document.getElementById('btn-export-cancel');
        const progress = document.getElementById('export-progress');
        const progressBar = document.getElementById('export-progress-bar');
        const progressMsg = document.getElementById('export-progress-msg');
        const progressPct = document.getElementById('export-progress-pct');

        if (startBtn) { startBtn.disabled = true; startBtn.style.display = 'none'; }
        if (cancelBtn) cancelBtn.textContent = 'Arka Plana Al';
        if (progress) progress.classList.add('active');

        const resParts = (resSelect ? resSelect.value : '1920x1080').split('x');
        const projCopy = JSON.parse(JSON.stringify(Editor.project));
        projCopy.meta.cozunurluk = { w: parseInt(resParts[0]), h: parseInt(resParts[1]) };

        const baslik = filenameInput ? filenameInput.value.trim() : 'video';
        const kalite = qualSelect ? qualSelect.value : 'normal';

        try {
            const res = await fetch('/api/editor/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project: projCopy, baslik, kalite }),
            });

            const data = await res.json();
            if (data.hata) {
                toast(data.hata, 'error');
                this._finishExport();
                return;
            }

            if (data.is_id) {
                this._currentJobId = data.is_id;
                isDurumTakip(data.is_id, {
                    onProgress: (d) => {
                        const pct = d.ilerleme || 0;
                        const msg = d.mesaj || 'İşleniyor...';

                        // Dialog açıksa dialog güncelle
                        if (progressBar) progressBar.style.width = pct + '%';
                        if (progressMsg) progressMsg.textContent = msg;
                        if (progressPct) progressPct.textContent = `%${pct}`;

                        // Arka plandaysa toolbar güncelle
                        if (this._backgroundMode) {
                            this._updateToolbarStatus(`%${pct} — ${msg}`);
                        }
                    },
                    onComplete: (d) => {
                        toast('Video başarıyla oluşturuldu!', 'success');
                        this._finishExport();
                        EditorInit._saveProject();
                    },
                    onError: (d) => {
                        toast(d.mesaj || 'Render hatası.', 'error');
                        this._finishExport();
                    },
                });
            }
        } catch (e) {
            toast('Bağlantı hatası.', 'error');
            this._finishExport();
        }
    },

    _finishExport() {
        this._isExporting = false;
        this._currentJobId = null;
        this._backgroundMode = false;
        this._updateToolbarStatus(null);
        this.hideDialog();

        // Dialog UI sıfırla
        const startBtn = document.getElementById('btn-export-start');
        const cancelBtn = document.getElementById('btn-export-cancel');
        if (startBtn) { startBtn.disabled = false; startBtn.style.display = ''; }
        if (cancelBtn) cancelBtn.textContent = 'Vazgeç';
    },
};
