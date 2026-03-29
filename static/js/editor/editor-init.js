/* ═══════════════════════════════════════════════════════════════
   Voxtory Video Editör — Init (Başlatma + Klavye Kısayolları)
   ═══════════════════════════════════════════════════════════════ */

const EditorInit = {
    _editorReady: false,

    init() {
        // Welcome ekranını göster
        this._bindWelcome();
        this._loadWelcomeData();
    },

    // ─── Welcome Ekranı ─────────────────────
    _bindWelcome() {
        // Yeni proje butonu
        const newBtn = document.getElementById('btn-new-project');
        if (newBtn) {
            newBtn.addEventListener('click', () => {
                const overlay = document.getElementById('new-project-overlay');
                const input = document.getElementById('new-project-name');
                if (input) input.value = '';
                if (overlay) overlay.classList.add('active');
                if (input) setTimeout(() => input.focus(), 100);
            });
        }

        // Yeni proje dialog
        const createBtn = document.getElementById('btn-new-project-create');
        const cancelBtn = document.getElementById('btn-new-project-cancel');
        const nameInput = document.getElementById('new-project-name');

        if (createBtn) {
            createBtn.addEventListener('click', () => {
                const ad = nameInput ? nameInput.value.trim() : '';
                if (!ad) { toast('Proje adı girin.', 'warning'); return; }
                this._startEditor(ad);
                document.getElementById('new-project-overlay').classList.remove('active');
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                document.getElementById('new-project-overlay').classList.remove('active');
            });
        }
        if (nameInput) {
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    createBtn.click();
                }
            });
        }
    },

    async _loadWelcomeData() {
        // Projeleri yükle
        try {
            const res = await fetch('/api/editor/project/list');
            const projeler = await res.json();
            const list = document.getElementById('welcome-projects-list');
            if (list) {
                if (!projeler.length) {
                    list.innerHTML = '<div class="props-empty">Henüz kaydedilmiş proje yok</div>';
                } else {
                    list.innerHTML = projeler.map(p => `
                        <div class="welcome-project-item" data-ad="${p.ad}">
                            <div class="welcome-project-icon" style="background:var(--accent-glow);color:var(--accent);">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                            </div>
                            <div class="welcome-project-info">
                                <div class="welcome-project-name">${p.ad}</div>
                                <div class="welcome-project-meta">${p.tarih}</div>
                            </div>
                            <div class="welcome-project-actions">
                                <button class="btn-icon" title="Projeyi Sil" data-sil="${p.ad}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        </div>
                    `).join('');

                    // Proje aç
                    list.querySelectorAll('.welcome-project-item').forEach(item => {
                        item.addEventListener('click', (e) => {
                            if (e.target.closest('[data-sil]')) return;
                            this._loadAndStartProject(item.dataset.ad);
                        });
                    });

                    // Proje sil
                    list.querySelectorAll('[data-sil]').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._deleteProject(btn.dataset.sil);
                        });
                    });
                }
            }
        } catch (e) {}

        // Videoları yükle
        try {
            const res = await fetch('/api/video-listele');
            const videolar = await res.json();
            const list = document.getElementById('welcome-videos-list');
            if (list) {
                if (!videolar.length) {
                    list.innerHTML = '<div class="props-empty">Henüz tamamlanmış video yok</div>';
                } else {
                    list.innerHTML = videolar.map(v => `
                        <div class="welcome-video-item">
                            <div class="welcome-video-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                            </div>
                            <div class="welcome-video-info">
                                <div class="welcome-video-name">${v.ad}</div>
                                <div class="welcome-video-meta">${v.boyut_mb} MB — ${v.tarih}</div>
                            </div>
                            <div class="welcome-project-actions">
                                <button class="btn-icon" title="İzle" onclick="event.stopPropagation(); videoOynat('${v.ad}')" style="color:var(--accent);">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                </button>
                                <button class="btn-icon" title="İndir" onclick="event.stopPropagation(); editorVideoIndir('${v.ad}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                </button>
                                <button class="btn-icon" title="Sil" onclick="event.stopPropagation(); editorVideoSil('${v.ad}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        </div>
                    `).join('');
                }
            }
        } catch (e) {}
    },

    async _deleteProject(ad) {
        const onay = await onayla(ad + '.json');
        if (!onay) return;
        try {
            await fetch('/api/editor/project/delete/' + encodeURIComponent(ad), { method: 'DELETE' });
            toast('Proje silindi.', 'success');
            this._loadWelcomeData();
        } catch (e) {
            toast('Silme hatası.', 'error');
        }
    },

    async _loadAndStartProject(ad) {
        try {
            const res = await fetch('/api/editor/project/load/' + encodeURIComponent(ad));
            const data = await res.json();
            if (data.project) {
                this._startEditor(null, data.project);
            }
        } catch (e) {
            toast('Proje yüklenemedi.', 'error');
        }
    },

    _startEditor(baslik, existingProject) {
        if (existingProject) {
            Editor.loadProject(existingProject);
        } else {
            Editor.createProject(baslik || 'Yeni Proje');
        }

        document.getElementById('editor-proje-adi').textContent = Editor.project.meta.baslik;
        Editor._isExistingProject = !!existingProject;
        Editor._lastSaveTime = existingProject ? new Date() : null;

        // Welcome gizle, editör göster, sidebar kapat
        document.getElementById('editor-welcome').style.display = 'none';
        document.getElementById('editor-layout').style.display = '';
        const app = document.querySelector('.app');
        if (app) app.classList.add('editor-mode-active');

        if (!this._editorReady) {
            EditorTimeline.init();
            EditorPreview.init();
            EditorPanels.init();
            EditorExport.init();
            this._bindToolbar();
            this._bindKeyboard();
            this._bindContextMenu();
            this._bindZoomSlider();
            this._bindSeekSlider();
            this._bindProjectIO();
            this._bindTrackAdd();
            this._editorReady = true;
        }

        this.updateTimeDisplay();
        this._updateSaveStatus();
        EditorTimeline._renderTrackHeaders();
        // Sidebar kapandıktan sonra layout stabilize olunca resize
        setTimeout(() => { EditorTimeline.resize(); EditorPreview.render(); }, 50);
        EditorTimeline.render();
        EditorPreview.render();
        EditorPreview.preloadAudio();
        EditorPanels.loadMedia();
    },

    async showWelcome() {
        // Kaydedilmemiş değişiklik varsa uyar
        if (Editor.isDirty) {
            const cevap = await this._unsavedChangesDialog();
            if (cevap === 'save') {
                await this._saveProject();
            } else if (cevap === 'cancel') {
                return; // Editörde kal
            }
            // 'discard' ise devam et
        }

        // Editör gizle, welcome göster, sidebar aç
        document.getElementById('editor-welcome').style.display = '';
        document.getElementById('editor-layout').style.display = 'none';
        const app = document.querySelector('.app');
        if (app) app.classList.remove('editor-mode-active');
        if (Editor.isPlaying) EditorPreview.pause();
        this._loadWelcomeData();
    },

    _unsavedChangesDialog() {
        return new Promise((resolve) => {
            const overlay = document.getElementById('notify-overlay');
            const card = document.getElementById('notify-card');

            card.innerHTML = `
                <div class="confirm-icon" style="background:var(--warning-bg);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" style="width:28px;height:28px;">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                        <polyline points="17 21 17 13 7 13 7 21"/>
                        <polyline points="7 3 7 8 15 8"/>
                    </svg>
                </div>
                <div class="notify-title">Kaydedilmemiş Değişiklikler</div>
                <div class="notify-message">
                    <strong>${Editor.project.meta.baslik}</strong> projesinde kaydedilmemiş değişiklikler var.<br>
                    Çıkmadan önce kaydetmek ister misiniz?
                </div>
                <div class="notify-actions" style="flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" id="unsaved-save" style="min-width:100px;">Kaydet</button>
                    <button class="btn btn-danger btn-sm" id="unsaved-discard" style="min-width:100px;">Kaydetme</button>
                    <button class="btn btn-secondary btn-sm" id="unsaved-cancel" style="min-width:100px;">Vazgeç</button>
                </div>
                <div class="notify-brand">Voxtory</div>
            `;

            document.getElementById('unsaved-save').onclick = () => { _hideNotify(); resolve('save'); };
            document.getElementById('unsaved-discard').onclick = () => { _hideNotify(); resolve('discard'); };
            document.getElementById('unsaved-cancel').onclick = () => { _hideNotify(); resolve('cancel'); };
            overlay.classList.add('active');
        });
    },

    // ─── Toolbar ────────────────────────────
    _bindToolbar() {
        const btn = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };

        btn('btn-back-welcome', () => this.showWelcome());
        btn('btn-undo', () => { Editor.undo(); this._updateUndoRedoButtons(); });
        btn('btn-redo', () => { Editor.redo(); this._updateUndoRedoButtons(); });
        btn('btn-delete-clip', () => {
            if (Editor.selectedClipId) {
                Editor.removeClip(Editor.selectedClipId);
                EditorTimeline.render();
                EditorPreview.render();
            }
        });
        btn('btn-duplicate-clip', () => {
            if (Editor.selectedClipId) {
                Editor.duplicateClip(Editor.selectedClipId);
                EditorTimeline.render();
            }
        });
        btn('btn-play-pause', () => EditorPreview.play());

        // Undo/redo durumunu dinle + save status + audio preload
        Editor.on('change', () => {
            this._updateUndoRedoButtons();
            this._updateSaveStatus();
            EditorPreview.preloadAudio();
        });
    },

    _updateSaveStatus() {
        const el = document.getElementById('toolbar-save-status');
        if (!el) return;

        if (Editor.isDirty) {
            el.innerHTML = '<span class="dirty-dot"></span> Kaydedilmemiş değişiklikler';
        } else if (Editor._lastSaveTime) {
            const saat = Editor._lastSaveTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            el.innerHTML = '<span class="saved-dot"></span> Son kayıt: ' + saat;
        } else {
            el.innerHTML = '';
        }
    },

    _updateUndoRedoButtons() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.disabled = !Editor.undoStack.length;
        if (redoBtn) redoBtn.disabled = !Editor.redoStack.length;
    },

    // ─── Klavye Kısayolları ──────────────────
    _bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            // Editör sayfası aktif mi kontrol et
            const editorPage = document.getElementById('page-editor');
            if (!editorPage || !editorPage.classList.contains('active')) return;

            // Input/textarea içindeyken kısayolları engelle
            if (e.target.matches('input, textarea, select')) {
                if (e.key === 'Escape') e.target.blur();
                return;
            }

            const ctrl = e.ctrlKey || e.metaKey;

            switch (e.key) {
                case ' ':  // Boşluk — oynat/duraklat
                    e.preventDefault();
                    EditorPreview.play();
                    break;

                case 'Delete':
                case 'Backspace':
                    if (Editor.selectedClipId) {
                        e.preventDefault();
                        Editor.removeClip(Editor.selectedClipId);
                        EditorTimeline.render();
                        EditorPreview.render();
                    }
                    break;

                case 'z':
                    if (ctrl) {
                        e.preventDefault();
                        Editor.undo();
                        this._updateUndoRedoButtons();
                    }
                    break;

                case 'y':
                    if (ctrl) {
                        e.preventDefault();
                        Editor.redo();
                        this._updateUndoRedoButtons();
                    }
                    break;

                case 'd':
                    if (ctrl && Editor.selectedClipId) {
                        e.preventDefault();
                        Editor.duplicateClip(Editor.selectedClipId);
                        EditorTimeline.render();
                    }
                    break;

                case 's':
                    if (ctrl) {
                        e.preventDefault();
                        this._saveProject();
                    }
                    break;

                case 'ArrowLeft':
                    e.preventDefault();
                    EditorPreview.stepFrame(-1);
                    break;

                case 'ArrowRight':
                    e.preventDefault();
                    EditorPreview.stepFrame(1);
                    break;

                case 'Home':
                    e.preventDefault();
                    EditorPreview.seekTo(0);
                    break;

                case 'End':
                    e.preventDefault();
                    EditorPreview.seekTo(Editor.getTotalDuration());
                    break;
            }
        });

        // Pencere kapatılırken kaydedilmemiş değişiklik uyarısı
        window.addEventListener('beforeunload', (e) => {
            if (Editor.project && Editor.isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    },

    // ─── Context Menü ───────────────────────
    _bindContextMenu() {
        document.querySelectorAll('#editor-context-menu .context-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                if (!Editor.selectedClipId) return;

                switch (action) {
                    case 'duplicate':
                        Editor.duplicateClip(Editor.selectedClipId);
                        break;
                    case 'split':
                        this._splitClipAtPlayhead();
                        break;
                    case 'delete':
                        Editor.removeClip(Editor.selectedClipId);
                        break;
                }
                EditorTimeline.render();
                EditorPreview.render();
            });
        });
    },

    _splitClipAtPlayhead() {
        const clip = Editor.getClip(Editor.selectedClipId);
        if (!clip) return;

        const splitTime = Editor.playheadTime;
        if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) {
            toast('Playhead klibin içinde olmalı.', 'warning');
            return;
        }

        const track = Editor.getClipTrack(Editor.selectedClipId);
        if (!track) return;

        Editor._pushUndo();

        const firstDuration = splitTime - clip.startTime;
        const secondDuration = clip.duration - firstDuration;

        // İlk parça — mevcut klip
        clip.duration = firstDuration;

        // İkinci parça — yeni klip
        const newClip = JSON.parse(JSON.stringify(clip));
        newClip.id = Editor._nextClipId();
        newClip.startTime = splitTime;
        newClip.duration = secondDuration;

        track.clips.push(newClip);
        Editor._sortClips(track);
        Editor._notify('change');
    },

    // ─── Zoom Slider ────────────────────────
    _bindZoomSlider() {
        const slider = document.getElementById('timeline-zoom-slider');
        const label = document.getElementById('timeline-zoom-label');
        const zoomIn = document.getElementById('btn-zoom-in');
        const zoomOut = document.getElementById('btn-zoom-out');
        const fitBtn = document.getElementById('btn-fit-timeline');

        if (slider) {
            slider.addEventListener('input', () => {
                Editor.zoom = parseInt(slider.value);
                if (label) label.textContent = `%${Math.round(Editor.zoom / Editor.ZOOM_DEFAULT * 100)}`;
                EditorTimeline.render();
            });
        }

        if (zoomIn) {
            zoomIn.addEventListener('click', () => {
                Editor.zoom = Math.min(Editor.ZOOM_MAX, Editor.zoom * 1.25);
                if (slider) slider.value = Editor.zoom;
                if (label) label.textContent = `%${Math.round(Editor.zoom / Editor.ZOOM_DEFAULT * 100)}`;
                EditorTimeline.render();
            });
        }

        if (zoomOut) {
            zoomOut.addEventListener('click', () => {
                Editor.zoom = Math.max(Editor.ZOOM_MIN, Editor.zoom * 0.8);
                if (slider) slider.value = Editor.zoom;
                if (label) label.textContent = `%${Math.round(Editor.zoom / Editor.ZOOM_DEFAULT * 100)}`;
                EditorTimeline.render();
            });
        }

        if (fitBtn) {
            fitBtn.addEventListener('click', () => EditorTimeline.fitToContent());
        }
    },

    // ─── Preview Seek ───────────────────────
    _bindSeekSlider() {
        const seek = document.getElementById('preview-seek');
        if (seek) {
            seek.addEventListener('input', () => {
                const pct = parseFloat(seek.value) / 100;
                const time = pct * Editor.getTotalDuration();
                EditorPreview.seekTo(time);
            });
        }
    },

    // ─── Zaman Göstergesi ───────────────────
    updateTimeDisplay() {
        const timeEl = document.getElementById('editor-time-display');
        const durEl = document.getElementById('editor-duration-display');
        const seekEl = document.getElementById('preview-seek');
        const previewTimeEl = document.getElementById('preview-time-label');

        if (timeEl) timeEl.textContent = Editor.formatTime(Editor.playheadTime);

        const totalDur = Editor.getTotalDuration();
        if (durEl) {
            const m = Math.floor(totalDur / 60);
            const s = Math.floor(totalDur % 60);
            durEl.textContent = `/ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        if (seekEl && totalDur > 0) {
            seekEl.value = (Editor.playheadTime / totalDur) * 100;
        }

        if (previewTimeEl) {
            const cur = Editor.formatTime(Editor.playheadTime);
            const tot = Editor.formatTime(totalDur);
            previewTimeEl.textContent = `${cur} / ${tot}`;
        }
    },

    // ─── Proje Kaydet/Yükle ─────────────────
    _bindProjectIO() {
        const saveBtn = document.getElementById('btn-save-project');
        const loadBtn = document.getElementById('btn-load-project');

        if (saveBtn) saveBtn.addEventListener('click', () => this._saveProject());
        if (loadBtn) loadBtn.addEventListener('click', () => this._showLoadDialog());
    },

    _bindTrackAdd() {
        const btn = document.getElementById('btn-add-track');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Track tipi seçimi — basit dropdown menü
            const menu = document.createElement('div');
            menu.className = 'context-menu active';
            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';
            menu.innerHTML = `
                <button class="context-item" data-track-type="overlay">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>
                    Overlay Track
                </button>
                <button class="context-item" data-track-type="video">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    Görsel Track
                </button>
                <button class="context-item" data-track-type="audio">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    Ses Track
                </button>
                <button class="context-item" data-track-type="subtitle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Altyazı Track
                </button>
            `;
            document.body.appendChild(menu);

            menu.querySelectorAll('[data-track-type]').forEach(item => {
                item.addEventListener('click', () => {
                    Editor.addTrack(item.dataset.trackType);
                    menu.remove();
                });
            });

            const close = () => { menu.remove(); document.removeEventListener('click', close); };
            setTimeout(() => document.addEventListener('click', close), 10);
        });
    },

    async _saveProject() {
        if (!Editor.project) return;

        try {
            const res = await fetch('/api/editor/project/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad: Editor.project.meta.baslik,
                    project: Editor.project,
                }),
            });
            const data = await res.json();
            toast(data.mesaj || 'Proje kaydedildi.', 'success');
            Editor.isDirty = false;
            Editor._lastSaveTime = new Date();
            this._updateSaveStatus();
        } catch (e) {
            toast('Kaydetme hatası.', 'error');
        }
    },

    async _showLoadDialog() {
        try {
            const res = await fetch('/api/editor/project/list');
            const projeler = await res.json();

            if (!projeler.length) {
                toast('Kaydedilmiş proje yok.', 'info');
                return;
            }

            const overlay = document.getElementById('notify-overlay');
            const card = document.getElementById('notify-card');

            const listHtml = projeler.map(p => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-input);border-radius:8px;margin-bottom:6px;cursor:pointer;"
                     class="proje-sec-item" data-ad="${p.ad}">
                    <div>
                        <div style="font-size:13px;font-weight:600;">${p.ad}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${p.tarih}</div>
                    </div>
                </div>
            `).join('');

            card.innerHTML = `
                <div class="notify-title">Proje Yükle</div>
                <div style="max-height:300px;overflow-y:auto;margin:16px 0;">${listHtml}</div>
                <div class="notify-actions">
                    <button class="btn btn-secondary btn-sm" onclick="_hideNotify()">Vazgeç</button>
                </div>
                <div class="notify-brand">Voxtory</div>
            `;

            overlay.classList.add('active');

            // Seçim handler
            card.querySelectorAll('.proje-sec-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const ad = item.dataset.ad;
                    try {
                        const res = await fetch('/api/editor/project/load/' + encodeURIComponent(ad));
                        const data = await res.json();
                        if (data.project) {
                            Editor.loadProject(data.project);
                            document.getElementById('editor-proje-adi').textContent = Editor.project.meta.baslik;
                            EditorTimeline.render();
                            EditorPreview.render();
                            EditorPanels.loadMedia();
                            this.updateTimeDisplay();
                            toast('Proje yüklendi.', 'success');
                        }
                    } catch (e) {
                        toast('Yükleme hatası.', 'error');
                    }
                    _hideNotify();
                });
            });

        } catch (e) {
            toast('Proje listesi alınamadı.', 'error');
        }
    },
};

// Global init fonksiyonu — app.js tarafından çağrılır
function editorInit() {
    EditorInit.init();
}

// Global yardımcılar — welcome ekranından çağrılır
async function editorVideoIndir(dosyaAdi) {
    try {
        const res = await fetch('/api/video-indir/' + encodeURIComponent(dosyaAdi));
        const data = await res.json();
        if (data.yol) {
            indirmeBildirimi(data.dosya, data.yol);
        } else {
            toast(data.hata || 'İndirme hatası.', 'error');
        }
    } catch (e) {
        toast('İndirme hatası.', 'error');
    }
}

async function editorVideoSil(dosyaAdi) {
    const onay = await onayla(dosyaAdi);
    if (!onay) return;
    try {
        await fetch('/api/video-sil/' + encodeURIComponent(dosyaAdi), { method: 'DELETE' });
        toast('Video silindi.', 'success');
        EditorInit._loadWelcomeData();
    } catch (e) {
        toast('Silme hatası.', 'error');
    }
}
