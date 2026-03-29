/* ═══════════════════════════════════════════════════════════════
   Voxtory Video Editör — Panels (Medya Kütüphanesi + Özellikler)
   ═══════════════════════════════════════════════════════════════ */

const EditorPanels = {
    _dragSource: null,
    _dragType: null,
    _dragDuration: null,

    init() {
        this._initTabs();
        this._initImageUpload();
        this._initDragDrop();
        this._initSubtitlePanel();
        this._initTextPanel();
        this.loadMedia();

        Editor.on('select', (clip) => this.renderProperties(clip));
        Editor.on('change', () => {
            // Aktif input/textarea düzenleniyorsa paneli yeniden render etme (focus kaybını önle)
            const active = document.activeElement;
            if (active && active.closest('#props-body') && active.matches('input, textarea, select')) return;
            const clip = Editor.getClip(Editor.selectedClipId);
            this.renderProperties(clip);
        });
    },

    // ─── Medya Tabları ──────────────────────
    _initTabs() {
        document.querySelectorAll('.media-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.media-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            });
        });
    },

    // ─── Görsel Yükleme ─────────────────────
    _initImageUpload() {
        const btn = document.getElementById('btn-upload-image');
        const input = document.getElementById('image-upload-input');
        if (!btn || !input) return;

        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
            if (!input.files.length) return;
            const formData = new FormData();
            for (const file of input.files) {
                formData.append('dosyalar', file);
            }
            try {
                const res = await fetch('/api/gorsel-yukle', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.dosyalar) {
                    toast(data.mesaj, 'success');
                    this.loadMedia();
                }
            } catch (e) {
                toast('Yüklenemedi.', 'error');
            }
            input.value = '';
        });
    },

    // ─── Medya Yükle ────────────────────────
    async loadMedia() {
        try {
            const res = await fetch('/api/video-kaynaklar');
            const data = await res.json();
            this._renderImageGrid(data.images || []);
            this._renderAudioList(data.sesler || []);
        } catch (e) {}
    },

    _renderImageGrid(images) {
        const grid = document.getElementById('media-images-grid');
        if (!grid) return;

        if (!images.length) {
            grid.innerHTML = '<div class="props-empty" style="grid-column:1/-1;">Henüz görsel yok</div>';
            return;
        }

        grid.innerHTML = images.map(img => `
            <div class="media-item" draggable="true" data-source="${img}" data-type="image">
                <img src="/images/${encodeURIComponent(img)}" alt="${img}" loading="lazy">
                <div class="media-item-name">${img}</div>
                <button class="media-item-add" data-file="${img}" title="Timeline'a Ekle">+</button>
                <button class="media-item-delete" data-file="${img}" title="Sil">&times;</button>
            </div>
        `).join('');

        // Timeline'a ekle butonları
        grid.querySelectorAll('.media-item-add').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                Editor.addImageClip(btn.dataset.file);
                EditorTimeline.render();
                EditorPreview.render();
            });
        });

        // Delete butonları (onaylı)
        grid.querySelectorAll('.media-item-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const file = btn.dataset.file;
                const onay = await onayla(file);
                if (!onay) return;
                try {
                    await fetch('/api/gorsel-sil/' + encodeURIComponent(file), { method: 'DELETE' });
                    toast('Görsel silindi.', 'success');
                    this.loadMedia();
                } catch (err) {}
            });
        });

        // Çift tıkla timeline'a ekle
        grid.querySelectorAll('.media-item').forEach(item => {
            item.addEventListener('dblclick', () => {
                Editor.addImageClip(item.dataset.source);
                EditorTimeline.render();
            });
        });
    },

    _renderAudioList(audioFiles) {
        const list = document.getElementById('media-audio-list');
        if (!list) return;

        if (!audioFiles.length) {
            list.innerHTML = '<div class="props-empty">Henüz ses dosyası yok</div>';
            return;
        }

        list.innerHTML = audioFiles.map(f => `
            <div class="media-audio-item" data-source="${f}" data-type="audio">
                <button class="media-audio-play-btn" data-src="${f}" title="Dinle">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <div class="media-audio-info">
                    <div class="media-audio-name">${f}</div>
                </div>
                <button class="media-audio-add-btn" data-src="${f}" title="Timeline'a Ekle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
            </div>
        `).join('');

        // Ses dinleme butonları
        list.querySelectorAll('.media-audio-play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const src = btn.dataset.src;
                const playing = Editor.previewAudio(src);
                list.querySelectorAll('.media-audio-play-btn').forEach(b => {
                    b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
                    b.classList.remove('playing');
                });
                if (playing) {
                    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
                    btn.classList.add('playing');
                }
            });
        });

        // Timeline'a ekle butonları
        list.querySelectorAll('.media-audio-add-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                Editor.stopPreviewAudio();
                const source = btn.dataset.src;
                let duration = 30;
                try {
                    const res = await fetch('/api/editor/audio-meta/' + encodeURIComponent(source));
                    const data = await res.json();
                    if (data.duration) duration = data.duration;
                } catch (e2) {}
                Editor.addAudioClip(source, 0, duration);
                EditorTimeline.render();
            });
        });
    },

    // ─── Drag & Drop ────────────────────────
    _initDragDrop() {
        const preview = document.getElementById('drag-preview');

        // Medya itemlarından drag başlat
        document.addEventListener('dragstart', (e) => {
            const item = e.target.closest('[data-source]');
            if (!item) return;

            this._dragSource = item.dataset.source;
            this._dragType = item.dataset.type;

            if (this._dragType === 'image') {
                preview.innerHTML = `<img src="/images/${encodeURIComponent(this._dragSource)}" alt="">`;
                preview.className = 'drag-preview';
            } else {
                preview.innerHTML = this._dragSource;
                preview.className = 'drag-preview audio-drag';
            }
            preview.style.display = 'block';

            e.dataTransfer.setDragImage(preview, 40, 22);
            e.dataTransfer.effectAllowed = 'copy';
        });

        document.addEventListener('drag', (e) => {
            if (preview.style.display === 'block') {
                preview.style.left = e.clientX + 10 + 'px';
                preview.style.top = e.clientY + 10 + 'px';
            }
        });

        document.addEventListener('dragend', () => {
            preview.style.display = 'none';
            this._dragSource = null;
            this._dragType = null;
        });

        // Timeline'a ve editör alanına drop
        document.addEventListener('dragover', (e) => {
            const inTimeline = e.target.closest('.editor-timeline') || e.target.id === 'timeline-canvas';
            if (inTimeline) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        document.addEventListener('drop', async (e) => {
            const inTimeline = e.target.closest('.editor-timeline') || e.target.id === 'timeline-canvas';
            if (!inTimeline) return;
            e.preventDefault();
            if (!this._dragSource) return;

            const canvas = document.getElementById('timeline-canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            let duration = null;
            if (this._dragType === 'audio') {
                try {
                    const res = await fetch('/api/editor/audio-meta/' + encodeURIComponent(this._dragSource));
                    const data = await res.json();
                    duration = data.duration;
                } catch (err) {}
            }

            EditorTimeline.handleDrop(this._dragType, this._dragSource, x, y, duration);
            preview.style.display = 'none';
        });
    },

    // ─── Altyazı Paneli ─────────────────────
    _initSubtitlePanel() {
        const addBtn = document.getElementById('btn-add-subtitle');
        const textInput = document.getElementById('subtitle-text-input');

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const text = textInput ? textInput.value.trim() : '';
                if (!text) { toast('Altyazı metni girin.', 'warning'); return; }
                Editor.addSubtitleClip(text, Editor.playheadTime, 3);
                if (textInput) textInput.value = '';
                EditorTimeline.render();
            });
        }
    },

    // ─── Metin Paneli ──────────────────────
    _initTextPanel() {
        // Şablon butonları
        document.querySelectorAll('.text-template-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tmpl = btn.dataset.template;
                if (tmpl) {
                    const clip = Editor.addTextFromTemplate(tmpl);
                    if (clip) {
                        Editor.selectedClipId = clip.id;
                        Editor._notify('select', clip);
                    }
                    EditorTimeline.render();
                    EditorPreview.render();
                }
            });
        });

        // Boş metin ekle butonu
        const customBtn = document.getElementById('btn-add-custom-text');
        if (customBtn) {
            customBtn.addEventListener('click', () => {
                const clip = Editor.addTextClip('Metin', Editor.playheadTime, 4);
                if (clip) {
                    Editor.selectedClipId = clip.id;
                    Editor._notify('select', clip);
                }
                EditorTimeline.render();
                EditorPreview.render();
            });
        }
    },

    // ─── Özellikler Paneli ──────────────────
    renderProperties(clip) {
        const body = document.getElementById('props-body');
        if (!body) return;

        if (!clip) {
            body.innerHTML = '<div class="props-empty">Düzenlemek için bir klip seçin</div>';
            return;
        }

        if (clip.type === 'image') {
            this._renderImageProps(body, clip);
        } else if (clip.type === 'overlay') {
            this._renderOverlayProps(body, clip);
        } else if (clip.type === 'text') {
            this._renderTextProps(body, clip);
        } else if (clip.type === 'audio') {
            this._renderAudioProps(body, clip);
        } else if (clip.type === 'subtitle') {
            this._renderSubtitleProps(body, clip);
        }
    },

    _renderImageProps(body, clip) {
        const kb = clip.effects.kenBurns;
        body.innerHTML = `
            <div class="props-group">
                <div class="props-group-title">GÖRSEL</div>
                <div class="props-row">
                    <span class="props-label">Kaynak</span>
                    <span class="props-input" style="border:none;background:none;padding:0;font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${clip.source}">${clip.source}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Başlangıç</span>
                    <input type="number" class="props-input" id="prop-start" value="${clip.startTime.toFixed(2)}" step="0.1" min="0">
                    <span class="props-value">sn</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Süre</span>
                    <input type="number" class="props-input" id="prop-duration" value="${clip.duration.toFixed(2)}" step="0.1" min="0.5">
                    <span class="props-value">sn</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">GEÇİŞ EFEKTİ</div>
                <div class="props-row">
                    <span class="props-label">Tür</span>
                    <select class="props-input" id="prop-transition-type">
                        <option value="none" ${clip.transition.type === 'none' ? 'selected' : ''}>Yok</option>
                        <option value="fade" ${clip.transition.type === 'fade' ? 'selected' : ''}>Fade</option>
                        <option value="dissolve" ${clip.transition.type === 'dissolve' ? 'selected' : ''}>Dissolve</option>
                        <option value="slideleft" ${clip.transition.type === 'slideleft' ? 'selected' : ''}>Sola Kaydır</option>
                        <option value="slideright" ${clip.transition.type === 'slideright' ? 'selected' : ''}>Sağa Kaydır</option>
                        <option value="slideup" ${clip.transition.type === 'slideup' ? 'selected' : ''}>Yukarı Kaydır</option>
                        <option value="slidedown" ${clip.transition.type === 'slidedown' ? 'selected' : ''}>Aşağı Kaydır</option>
                        <option value="wipeleft" ${clip.transition.type === 'wipeleft' ? 'selected' : ''}>Soldan Sil</option>
                        <option value="wiperight" ${clip.transition.type === 'wiperight' ? 'selected' : ''}>Sağdan Sil</option>
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Süre</span>
                    <input type="range" class="props-input" id="prop-transition-dur" min="0.1" max="2" step="0.1" value="${clip.transition.duration}">
                    <span class="props-value" id="prop-transition-dur-val">${clip.transition.duration}s</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">KEN BURNS EFEKTİ</div>
                <div class="props-row">
                    <span class="props-label">Aktif</span>
                    <button class="props-toggle ${kb.enabled ? 'active' : ''}" id="prop-kb-toggle"></button>
                </div>
                <div class="props-row">
                    <span class="props-label">Baş. Ölçek</span>
                    <input type="range" class="props-input" id="prop-kb-start-scale" min="1" max="2" step="0.05" value="${kb.startScale}">
                    <span class="props-value" id="prop-kb-start-scale-val">${kb.startScale}x</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Bit. Ölçek</span>
                    <input type="range" class="props-input" id="prop-kb-end-scale" min="1" max="2" step="0.05" value="${kb.endScale}">
                    <span class="props-value" id="prop-kb-end-scale-val">${kb.endScale}x</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">GÖRSEL AYARLARI</div>
                <div class="props-row">
                    <span class="props-label">Sığdırma</span>
                    <select class="props-input" id="prop-fit-mode">
                        <option value="fill" ${(clip.effects.fitMode || 'fill') === 'fill' ? 'selected' : ''}>Doldur — YouTube</option>
                        <option value="fit" ${clip.effects.fitMode === 'fit' ? 'selected' : ''}>Sığdır (Siyah Şerit)</option>
                        <option value="stretch" ${clip.effects.fitMode === 'stretch' ? 'selected' : ''}>Genişlet (Oran Bozulur)</option>
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Parlaklık</span>
                    <input type="range" class="props-input" id="prop-brightness" min="-50" max="50" step="1" value="${clip.effects.brightness}">
                    <span class="props-value" id="prop-brightness-val">${clip.effects.brightness}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Kontrast</span>
                    <input type="range" class="props-input" id="prop-contrast" min="-50" max="50" step="1" value="${clip.effects.contrast}">
                    <span class="props-value" id="prop-contrast-val">${clip.effects.contrast}</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">RENK DÜZELTME</div>
                <div class="props-row">
                    <span class="props-label">Doygunluk</span>
                    <input type="range" class="props-input" id="prop-saturation" min="-50" max="50" step="1" value="${clip.effects.saturation || 0}">
                    <span class="props-value" id="prop-saturation-val">${clip.effects.saturation || 0}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Sıcaklık</span>
                    <input type="range" class="props-input" id="prop-temperature" min="-50" max="50" step="1" value="${clip.effects.temperature || 0}">
                    <span class="props-value" id="prop-temperature-val">${clip.effects.temperature || 0}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Keskinlik</span>
                    <input type="range" class="props-input" id="prop-sharpen" min="0" max="50" step="1" value="${clip.effects.sharpen || 0}">
                    <span class="props-value" id="prop-sharpen-val">${clip.effects.sharpen || 0}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Bulanıklık</span>
                    <input type="range" class="props-input" id="prop-blur" min="0" max="30" step="1" value="${clip.effects.blur || 0}">
                    <span class="props-value" id="prop-blur-val">${clip.effects.blur || 0}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Vinyet</span>
                    <input type="range" class="props-input" id="prop-vignette" min="0" max="50" step="1" value="${clip.effects.vignette || 0}">
                    <span class="props-value" id="prop-vignette-val">${clip.effects.vignette || 0}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Grenaj</span>
                    <input type="range" class="props-input" id="prop-grain" min="0" max="50" step="1" value="${clip.effects.grain || 0}">
                    <span class="props-value" id="prop-grain-val">${clip.effects.grain || 0}</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">FİLTRE PROFİLLERİ</div>
                <div class="filter-grid" id="filter-presets">
                    ${['none','cinematic','warm','cool','vintage','bw','vivid','muted','dramatic','dreamy'].map(f => `
                        <button class="filter-preset-btn ${(clip.effects.filter || 'none') === f ? 'active' : ''}" data-filter="${f}">
                            <span class="filter-preset-label">${{none:'Orijinal',cinematic:'Sinematik',warm:'Sıcak',cool:'Soğuk',vintage:'Vintage',bw:'S/B',vivid:'Canlı',muted:'Pastel',dramatic:'Dramatik',dreamy:'Rüya'}[f]}</span>
                        </button>
                    `).join('')}
                </div>
            </div>

            <button class="props-delete-btn" id="prop-delete-clip">Klibi Sil</button>
        `;

        this._bindImagePropEvents(clip);
    },

    _bindImagePropEvents(clip) {
        const bind = (id, prop, transform) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                const val = transform ? transform(el.value) : el.value;
                if (prop === 'startTime') Editor.moveClip(clip.id, val);
                else if (prop === 'duration') Editor.resizeClip(clip.id, val, false);
                else Editor.updateClip(clip.id, this._buildNestedProp(prop, val));
                EditorTimeline.render();
                EditorPreview.render();
            });
        };

        const bindRange = (id, prop, valId, suffix, transform) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            if (!el) return;
            el.addEventListener('input', () => {
                const val = transform ? transform(el.value) : parseFloat(el.value);
                if (valEl) valEl.textContent = val + (suffix || '');
                Editor.updateClip(clip.id, this._buildNestedProp(prop, val));
                EditorTimeline.render();
                EditorPreview.render();
            });
        };

        bind('prop-start', 'startTime', parseFloat);
        bind('prop-duration', 'duration', parseFloat);
        bind('prop-transition-type', 'transition.type');
        bind('prop-fit-mode', 'effects.fitMode');

        bindRange('prop-transition-dur', 'transition.duration', 'prop-transition-dur-val', 's');
        bindRange('prop-kb-start-scale', 'effects.kenBurns.startScale', 'prop-kb-start-scale-val', 'x');
        bindRange('prop-kb-end-scale', 'effects.kenBurns.endScale', 'prop-kb-end-scale-val', 'x');
        bindRange('prop-brightness', 'effects.brightness', 'prop-brightness-val', '');
        bindRange('prop-contrast', 'effects.contrast', 'prop-contrast-val', '');

        // Renk düzeltme slider'ları
        bindRange('prop-saturation', 'effects.saturation', 'prop-saturation-val', '');
        bindRange('prop-temperature', 'effects.temperature', 'prop-temperature-val', '');
        bindRange('prop-sharpen', 'effects.sharpen', 'prop-sharpen-val', '');
        bindRange('prop-blur', 'effects.blur', 'prop-blur-val', '');
        bindRange('prop-vignette', 'effects.vignette', 'prop-vignette-val', '');
        bindRange('prop-grain', 'effects.grain', 'prop-grain-val', '');

        // Filtre profilleri grid
        const filterGrid = document.getElementById('filter-presets');
        if (filterGrid) {
            filterGrid.querySelectorAll('.filter-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    filterGrid.querySelectorAll('.filter-preset-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    Editor.updateClip(clip.id, { effects: { filter: btn.dataset.filter } });
                    EditorTimeline.render();
                    EditorPreview.render();
                });
            });
        }

        // Ken Burns toggle
        const kbToggle = document.getElementById('prop-kb-toggle');
        if (kbToggle) {
            kbToggle.addEventListener('click', () => {
                const newVal = !clip.effects.kenBurns.enabled;
                kbToggle.classList.toggle('active', newVal);
                Editor.updateClip(clip.id, { effects: { kenBurns: { enabled: newVal } } });
                EditorPreview.render();
            });
        }

        // Sil
        const delBtn = document.getElementById('prop-delete-clip');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                Editor.removeClip(clip.id);
                EditorTimeline.render();
                EditorPreview.render();
            });
        }
    },

    _renderTextProps(body, clip) {
        const st = clip.style || {};
        const anim = clip.animation || {};
        const pos = clip.position || { x: 0.5, y: 0.3 };
        body.innerHTML = `
            <div class="props-group">
                <div class="props-group-title">METİN</div>
                <div class="props-row" style="flex-direction:column;align-items:stretch;">
                    <textarea class="subtitle-input" id="prop-text-content" style="min-height:50px;">${clip.text || ''}</textarea>
                </div>
                <div class="props-row">
                    <span class="props-label">Başlangıç</span>
                    <input type="number" class="props-input" id="prop-start" value="${clip.startTime.toFixed(2)}" step="0.1" min="0">
                    <span class="props-value">sn</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Süre</span>
                    <input type="number" class="props-input" id="prop-duration" value="${clip.duration.toFixed(2)}" step="0.1" min="0.5">
                    <span class="props-value">sn</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">YAZI STİLİ</div>
                <div class="props-row">
                    <span class="props-label">Font</span>
                    <select class="props-input" id="prop-text-font">
                        ${['Segoe UI', 'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Impact', 'Consolas'].map(f =>
                            `<option value="${f}" ${st.font === f ? 'selected' : ''}>${f}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Boyut</span>
                    <input type="range" class="props-input" id="prop-text-size" min="20" max="150" step="2" value="${st.size || 72}">
                    <span class="props-value" id="prop-text-size-val">${st.size || 72}px</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Renk</span>
                    <input type="color" class="props-input" id="prop-text-color" value="${st.color || '#FFFFFF'}">
                </div>
                <div class="props-row">
                    <span class="props-label">Kalın</span>
                    <button class="props-toggle ${st.bold ? 'active' : ''}" id="prop-text-bold"></button>
                </div>
                <div class="props-row">
                    <span class="props-label">İtalik</span>
                    <button class="props-toggle ${st.italic ? 'active' : ''}" id="prop-text-italic"></button>
                </div>
                <div class="props-row">
                    <span class="props-label">Kenar</span>
                    <input type="range" class="props-input" id="prop-text-outline" min="0" max="8" step="1" value="${st.outlineWidth || 0}">
                    <span class="props-value" id="prop-text-outline-val">${st.outlineWidth || 0}px</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">ARKA PLAN</div>
                <div class="props-row">
                    <span class="props-label">Renk</span>
                    <select class="props-input" id="prop-text-bg">
                        <option value="rgba(0,0,0,0.6)" ${st.backgroundColor === 'rgba(0,0,0,0.6)' ? 'selected' : ''}>Siyah</option>
                        <option value="rgba(0,0,0,0.8)" ${st.backgroundColor === 'rgba(0,0,0,0.8)' ? 'selected' : ''}>Koyu Siyah</option>
                        <option value="rgba(239,68,68,0.9)" ${(st.backgroundColor || '').includes('239,68,68') ? 'selected' : ''}>Kırmızı</option>
                        <option value="rgba(99,102,241,0.85)" ${(st.backgroundColor || '').includes('99,102,241') ? 'selected' : ''}>Mor</option>
                        <option value="rgba(34,197,94,0.85)" ${(st.backgroundColor || '').includes('34,197,94') ? 'selected' : ''}>Yeşil</option>
                        <option value="transparent" ${st.backgroundColor === 'transparent' ? 'selected' : ''}>Yok</option>
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Dolgu</span>
                    <input type="range" class="props-input" id="prop-text-padding" min="0" max="40" step="2" value="${st.padding || 0}">
                    <span class="props-value" id="prop-text-padding-val">${st.padding || 0}px</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Yuvarlaklık</span>
                    <input type="range" class="props-input" id="prop-text-radius" min="0" max="30" step="2" value="${st.borderRadius || 0}">
                    <span class="props-value" id="prop-text-radius-val">${st.borderRadius || 0}px</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">KONUM</div>
                <div class="props-row">
                    <span class="props-label">X</span>
                    <input type="range" class="props-input" id="prop-text-x" min="0" max="100" step="1" value="${Math.round(pos.x * 100)}">
                    <span class="props-value" id="prop-text-x-val">${Math.round(pos.x * 100)}%</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Y</span>
                    <input type="range" class="props-input" id="prop-text-y" min="0" max="100" step="1" value="${Math.round(pos.y * 100)}">
                    <span class="props-value" id="prop-text-y-val">${Math.round(pos.y * 100)}%</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">ANİMASYON</div>
                <div class="props-row">
                    <span class="props-label">Giriş</span>
                    <select class="props-input" id="prop-text-anim-enter">
                        ${['none','fadeIn','slideUp','slideDown','slideLeft','slideRight','scaleIn','bounceIn','typewriter','popIn'].map(a =>
                            `<option value="${a}" ${anim.enter === a ? 'selected' : ''}>${{none:'Yok',fadeIn:'Belirme',slideUp:'Alttan',slideDown:'Üstten',slideLeft:'Soldan',slideRight:'Sağdan',scaleIn:'Büyüyerek',bounceIn:'Zıplama',typewriter:'Daktilo',popIn:'Pop'}[a]}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Giriş Süresi</span>
                    <input type="range" class="props-input" id="prop-text-anim-enter-dur" min="0.1" max="2" step="0.1" value="${anim.enterDuration || 0.5}">
                    <span class="props-value" id="prop-text-anim-enter-dur-val">${anim.enterDuration || 0.5}s</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Çıkış</span>
                    <select class="props-input" id="prop-text-anim-exit">
                        ${['none','fadeOut','scaleOut'].map(a =>
                            `<option value="${a}" ${anim.exit === a ? 'selected' : ''}>${{none:'Yok',fadeOut:'Kaybolma',scaleOut:'Küçülerek'}[a]}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Çıkış Süresi</span>
                    <input type="range" class="props-input" id="prop-text-anim-exit-dur" min="0.1" max="2" step="0.1" value="${anim.exitDuration || 0.3}">
                    <span class="props-value" id="prop-text-anim-exit-dur-val">${anim.exitDuration || 0.3}s</span>
                </div>
            </div>

            <button class="props-delete-btn" id="prop-delete-clip">Klibi Sil</button>
        `;

        // Event bindings
        const textEl = document.getElementById('prop-text-content');
        if (textEl) textEl.addEventListener('input', () => {
            Editor.updateClip(clip.id, { text: textEl.value });
            EditorTimeline.render();
            EditorPreview.render();
        });

        const startEl = document.getElementById('prop-start');
        if (startEl) startEl.addEventListener('change', () => { Editor.moveClip(clip.id, parseFloat(startEl.value)); EditorTimeline.render(); });

        const durEl = document.getElementById('prop-duration');
        if (durEl) durEl.addEventListener('change', () => { Editor.resizeClip(clip.id, parseFloat(durEl.value), false); EditorTimeline.render(); });

        // Style slider/select bindings
        const rangeBinds = [
            ['prop-text-size', 'style.size', 'prop-text-size-val', 'px', parseInt],
            ['prop-text-outline', 'style.outlineWidth', 'prop-text-outline-val', 'px', parseInt],
            ['prop-text-padding', 'style.padding', 'prop-text-padding-val', 'px', parseInt],
            ['prop-text-radius', 'style.borderRadius', 'prop-text-radius-val', 'px', parseInt],
            ['prop-text-x', 'position.x', 'prop-text-x-val', '%', v => parseInt(v) / 100],
            ['prop-text-y', 'position.y', 'prop-text-y-val', '%', v => parseInt(v) / 100],
            ['prop-text-anim-enter-dur', 'animation.enterDuration', 'prop-text-anim-enter-dur-val', 's', parseFloat],
            ['prop-text-anim-exit-dur', 'animation.exitDuration', 'prop-text-anim-exit-dur-val', 's', parseFloat],
        ];

        for (const [id, prop, valId, suffix, transform] of rangeBinds) {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            if (!el) continue;
            el.addEventListener('input', () => {
                const val = transform(el.value);
                if (valEl) valEl.textContent = (suffix === '%' ? parseInt(el.value) : val) + suffix;
                Editor.updateClip(clip.id, this._buildNestedProp(prop, val));
                EditorPreview.render();
            });
        }

        const selectBinds = [
            ['prop-text-font', 'style.font'],
            ['prop-text-color', 'style.color'],
            ['prop-text-bg', 'style.backgroundColor'],
            ['prop-text-anim-enter', 'animation.enter'],
            ['prop-text-anim-exit', 'animation.exit'],
        ];

        for (const [id, prop] of selectBinds) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.addEventListener('change', () => {
                Editor.updateClip(clip.id, this._buildNestedProp(prop, el.value));
                EditorPreview.render();
            });
        }

        // Toggle binds
        const toggleBind = (id, prop) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('click', () => {
                const parts = prop.split('.');
                let val = clip;
                for (const p of parts) val = val ? val[p] : undefined;
                const newVal = !val;
                el.classList.toggle('active', newVal);
                Editor.updateClip(clip.id, this._buildNestedProp(prop, newVal));
                EditorPreview.render();
            });
        };
        toggleBind('prop-text-bold', 'style.bold');
        toggleBind('prop-text-italic', 'style.italic');

        const delBtn = document.getElementById('prop-delete-clip');
        if (delBtn) delBtn.addEventListener('click', () => {
            Editor.removeClip(clip.id);
            EditorTimeline.render();
            EditorPreview.render();
        });
    },

    _renderOverlayProps(body, clip) {
        const pos = clip.position || { x: 0.5, y: 0.5 };
        const size = clip.size || { w: 0.2, h: 0 };
        body.innerHTML = `
            <div class="props-group">
                <div class="props-group-title">OVERLAY</div>
                <div class="props-row">
                    <span class="props-label">Kaynak</span>
                    <span class="props-input" style="border:none;background:none;padding:0;font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${clip.source}">${clip.source}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Başlangıç</span>
                    <input type="number" class="props-input" id="prop-start" value="${clip.startTime.toFixed(2)}" step="0.1" min="0">
                    <span class="props-value">sn</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Süre</span>
                    <input type="number" class="props-input" id="prop-duration" value="${clip.duration.toFixed(2)}" step="0.1" min="0.5">
                    <span class="props-value">sn</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">KONUM ve BOYUT</div>
                <div class="props-row">
                    <span class="props-label">X Konum</span>
                    <input type="range" class="props-input" id="prop-overlay-x" min="0" max="100" step="1" value="${Math.round(pos.x * 100)}">
                    <span class="props-value" id="prop-overlay-x-val">${Math.round(pos.x * 100)}%</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Y Konum</span>
                    <input type="range" class="props-input" id="prop-overlay-y" min="0" max="100" step="1" value="${Math.round(pos.y * 100)}">
                    <span class="props-value" id="prop-overlay-y-val">${Math.round(pos.y * 100)}%</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Genişlik</span>
                    <input type="range" class="props-input" id="prop-overlay-w" min="5" max="100" step="1" value="${Math.round(size.w * 100)}">
                    <span class="props-value" id="prop-overlay-w-val">${Math.round(size.w * 100)}%</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Opaklık</span>
                    <input type="range" class="props-input" id="prop-overlay-opacity" min="0" max="100" step="1" value="${Math.round((clip.opacity != null ? clip.opacity : 1) * 100)}">
                    <span class="props-value" id="prop-overlay-opacity-val">${Math.round((clip.opacity != null ? clip.opacity : 1) * 100)}%</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">GÖRSEL AYARLARI</div>
                <div class="props-row">
                    <span class="props-label">Parlaklık</span>
                    <input type="range" class="props-input" id="prop-brightness" min="-50" max="50" step="1" value="${(clip.effects && clip.effects.brightness) || 0}">
                    <span class="props-value" id="prop-brightness-val">${(clip.effects && clip.effects.brightness) || 0}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Kontrast</span>
                    <input type="range" class="props-input" id="prop-contrast" min="-50" max="50" step="1" value="${(clip.effects && clip.effects.contrast) || 0}">
                    <span class="props-value" id="prop-contrast-val">${(clip.effects && clip.effects.contrast) || 0}</span>
                </div>
            </div>

            <button class="props-delete-btn" id="prop-delete-clip">Klibi Sil</button>
        `;

        // Event bindings
        const startEl = document.getElementById('prop-start');
        if (startEl) startEl.addEventListener('change', () => { Editor.moveClip(clip.id, parseFloat(startEl.value)); EditorTimeline.render(); });

        const durEl = document.getElementById('prop-duration');
        if (durEl) durEl.addEventListener('change', () => { Editor.resizeClip(clip.id, parseFloat(durEl.value), false); EditorTimeline.render(); });

        // Overlay konum/boyut slider'ları
        const overlayBindings = [
            ['prop-overlay-x', 'position.x', 'prop-overlay-x-val', '%', v => parseFloat(v) / 100],
            ['prop-overlay-y', 'position.y', 'prop-overlay-y-val', '%', v => parseFloat(v) / 100],
            ['prop-overlay-w', 'size.w', 'prop-overlay-w-val', '%', v => parseFloat(v) / 100],
            ['prop-overlay-opacity', 'opacity', 'prop-overlay-opacity-val', '%', v => parseFloat(v) / 100],
        ];

        for (const [id, prop, valId, suffix, transform] of overlayBindings) {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            if (!el) continue;
            el.addEventListener('input', () => {
                const val = transform(el.value);
                if (valEl) valEl.textContent = el.value + suffix;
                Editor.updateClip(clip.id, this._buildNestedProp(prop, val));
                EditorPreview.render();
            });
        }

        // Parlaklık / kontrast
        const bindRange = (id, prop, valId) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            if (!el) return;
            el.addEventListener('input', () => {
                const val = parseFloat(el.value);
                if (valEl) valEl.textContent = val;
                Editor.updateClip(clip.id, this._buildNestedProp(prop, val));
                EditorPreview.render();
            });
        };
        bindRange('prop-brightness', 'effects.brightness', 'prop-brightness-val');
        bindRange('prop-contrast', 'effects.contrast', 'prop-contrast-val');

        const delBtn = document.getElementById('prop-delete-clip');
        if (delBtn) delBtn.addEventListener('click', () => {
            Editor.removeClip(clip.id);
            EditorTimeline.render();
            EditorPreview.render();
        });
    },

    _renderAudioProps(body, clip) {
        // Mevcut altyazılardan stil oku (ilk klipten)
        const subTrack = Editor.getTrackByType('subtitle');
        const mevcutStil = (subTrack && subTrack.clips.length) ? (subTrack.clips[0].style || {}) : {};
        const _pos = mevcutStil.position || 'bottom';
        const _size = String(mevcutStil.size || 52);
        const _color = mevcutStil.color || '#FFFFFF';
        const _anim = mevcutStil.animation || 'fadeIn';
        const _subCount = subTrack ? subTrack.clips.length : 0;

        body.innerHTML = `
            <div class="props-group" style="border-color:var(--accent);background:rgba(99,102,241,0.05);">
                <div class="props-group-title" style="color:var(--accent);">OTOMATİK ALTYAZI${_subCount > 0 ? ` <span style="font-weight:400;opacity:0.7;">(${_subCount} klip)</span>` : ''}</div>
                <div class="props-row">
                    <span class="props-label">Konum</span>
                    <select class="props-input" id="auto-sub-position">
                        <option value="bottom" ${_pos === 'bottom' ? 'selected' : ''}>Alt</option>
                        <option value="middle" ${_pos === 'middle' ? 'selected' : ''}>Orta</option>
                        <option value="top" ${_pos === 'top' ? 'selected' : ''}>Üst</option>
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Boyut</span>
                    <select class="props-input" id="auto-sub-size">
                        <option value="32" ${_size === '32' ? 'selected' : ''}>32px — Küçük</option>
                        <option value="40" ${_size === '40' ? 'selected' : ''}>40px</option>
                        <option value="52" ${_size === '52' ? 'selected' : ''}>52px — Normal</option>
                        <option value="64" ${_size === '64' ? 'selected' : ''}>64px — Büyük</option>
                        <option value="80" ${_size === '80' ? 'selected' : ''}>80px — Çok Büyük</option>
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Renk</span>
                    <input type="color" class="props-input" id="auto-sub-color" value="${_color}">
                </div>
                <div class="props-row">
                    <span class="props-label">Animasyon</span>
                    <select class="props-input" id="auto-sub-animation">
                        <option value="none" ${_anim === 'none' ? 'selected' : ''}>Yok</option>
                        <option value="fadeIn" ${_anim === 'fadeIn' ? 'selected' : ''}>Belirme</option>
                        <option value="typewriter" ${_anim === 'typewriter' ? 'selected' : ''}>Daktilo</option>
                        <option value="scaleIn" ${_anim === 'scaleIn' ? 'selected' : ''}>Büyüyerek</option>
                        <option value="slideUp" ${_anim === 'slideUp' ? 'selected' : ''}>Aşağıdan Kayma</option>
                    </select>
                </div>
                <button class="btn btn-primary btn-sm" id="btn-auto-subtitle" style="width:100%;margin-top:6px;">
                    Otomatik Altyazı Oluştur
                </button>
                <button class="btn btn-secondary btn-sm" id="btn-apply-sub-style" style="width:100%;margin-top:4px;">
                    Stili Mevcut Altyazılara Uygula
                </button>
                <button class="btn btn-danger btn-sm" id="btn-clear-subtitles" style="width:100%;margin-top:4px;">
                    Tüm Altyazıları Kaldır
                </button>
                <div id="auto-subtitle-status" style="font-size:11px;color:var(--text-muted);margin-top:4px;"></div>
            </div>

            <div class="props-group">
                <div class="props-group-title">SES</div>
                <div class="props-row">
                    <span class="props-label">Kaynak</span>
                    <span class="props-input" style="border:none;background:none;padding:0;font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${clip.source}">${clip.source}</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Başlangıç</span>
                    <input type="number" class="props-input" id="prop-start" value="${clip.startTime.toFixed(2)}" step="0.1" min="0">
                    <span class="props-value">sn</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Süre</span>
                    <input type="number" class="props-input" id="prop-duration" value="${clip.duration.toFixed(2)}" step="0.1" min="0.5">
                    <span class="props-value">sn</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">SES AYARLARI</div>
                <div class="props-row">
                    <span class="props-label">Hacim</span>
                    <input type="range" class="props-input" id="prop-volume" min="0" max="2" step="0.05" value="${clip.volume}">
                    <span class="props-value" id="prop-volume-val">${Math.round(clip.volume * 100)}%</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Yavaş Açılma</span>
                    <input type="range" class="props-input" id="prop-fade-in" min="0" max="5" step="0.1" value="${clip.fadeIn}">
                    <span class="props-value" id="prop-fade-in-val">${clip.fadeIn}s</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Yavaş Kapanma</span>
                    <input type="range" class="props-input" id="prop-fade-out" min="0" max="5" step="0.1" value="${clip.fadeOut}">
                    <span class="props-value" id="prop-fade-out-val">${clip.fadeOut}s</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">SES DEĞİŞTİRME</div>
                <div class="props-row">
                    <span class="props-label">Hız</span>
                    <input type="range" class="props-input" id="prop-speed" min="0.5" max="2" step="0.05" value="${clip.speed || 1}">
                    <span class="props-value" id="prop-speed-val">${clip.speed || 1}x</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Ses Tonu</span>
                    <input type="range" class="props-input" id="prop-pitch" min="-12" max="12" step="1" value="${clip.pitch || 0}">
                    <span class="props-value" id="prop-pitch-val">${clip.pitch || 0}</span>
                </div>
            </div>

            <button class="props-delete-btn" id="prop-delete-clip">Klibi Sil</button>
        `;

        // Event bindings
        const startEl = document.getElementById('prop-start');
        if (startEl) startEl.addEventListener('change', () => { Editor.moveClip(clip.id, parseFloat(startEl.value)); EditorTimeline.render(); });

        const durEl = document.getElementById('prop-duration');
        if (durEl) durEl.addEventListener('change', () => { Editor.resizeClip(clip.id, parseFloat(durEl.value), false); EditorTimeline.render(); });

        const volEl = document.getElementById('prop-volume');
        const volVal = document.getElementById('prop-volume-val');
        if (volEl) volEl.addEventListener('input', () => {
            const v = parseFloat(volEl.value);
            if (volVal) volVal.textContent = Math.round(v * 100) + '%';
            Editor.updateClip(clip.id, { volume: v });
        });

        const fadeInEl = document.getElementById('prop-fade-in');
        const fadeInVal = document.getElementById('prop-fade-in-val');
        if (fadeInEl) fadeInEl.addEventListener('input', () => {
            if (fadeInVal) fadeInVal.textContent = fadeInEl.value + 's';
            Editor.updateClip(clip.id, { fadeIn: parseFloat(fadeInEl.value) });
        });

        const fadeOutEl = document.getElementById('prop-fade-out');
        const fadeOutVal = document.getElementById('prop-fade-out-val');
        if (fadeOutEl) fadeOutEl.addEventListener('input', () => {
            if (fadeOutVal) fadeOutVal.textContent = fadeOutEl.value + 's';
            Editor.updateClip(clip.id, { fadeOut: parseFloat(fadeOutEl.value) });
        });

        const speedEl = document.getElementById('prop-speed');
        const speedVal = document.getElementById('prop-speed-val');
        if (speedEl) speedEl.addEventListener('input', () => {
            const v = parseFloat(speedEl.value);
            if (speedVal) speedVal.textContent = v + 'x';
            Editor.updateClip(clip.id, { speed: v });
        });

        const pitchEl = document.getElementById('prop-pitch');
        const pitchVal = document.getElementById('prop-pitch-val');
        if (pitchEl) pitchEl.addEventListener('input', () => {
            const v = parseInt(pitchEl.value);
            if (pitchVal) pitchVal.textContent = (v > 0 ? '+' : '') + v;
            Editor.updateClip(clip.id, { pitch: v });
        });

        // Otomatik altyazı oluşturma
        const autoSubBtn = document.getElementById('btn-auto-subtitle');
        const autoSubStatus = document.getElementById('auto-subtitle-status');
        if (autoSubBtn) {
            autoSubBtn.addEventListener('click', async () => {
                autoSubBtn.disabled = true;
                autoSubBtn.textContent = 'Metin alınıyor...';

                try {
                    // 1. TTS metin + zamanlama verisini al
                    const metinRes = await fetch('/api/editor/ses-metni/' + encodeURIComponent(clip.source));
                    const metinData = await metinRes.json();

                    if (!metinData.metin) {
                        if (autoSubStatus) autoSubStatus.textContent = 'Bu ses dosyasına ait TTS metni bulunamadı.';
                        autoSubBtn.disabled = false;
                        autoSubBtn.textContent = 'Otomatik Altyazı Oluştur';
                        return;
                    }

                    let parcalar = [];

                    if (metinData.zamanlama && metinData.zamanlama.length > 0) {
                        // Gerçek zamanlama verisi var — birebir senkron
                        autoSubBtn.textContent = 'Zamanlama uygulanıyor...';
                        parcalar = metinData.zamanlama.map(z => ({
                            metin: z.metin,
                            baslangic: z.baslangic,
                            bitis: z.bitis,
                        }));
                        if (autoSubStatus) autoSubStatus.textContent = 'Gerçek TTS zamanlaması kullanıldı.';
                    } else {
                        // Zamanlama verisi yok (eski TTS) — fallback
                        autoSubBtn.textContent = 'Parçalanıyor...';
                        const parcalaRes = await fetch('/api/editor/altyazi-parcala', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ metin: metinData.metin, ses: clip.source }),
                        });
                        const parcalaData = await parcalaRes.json();
                        parcalar = (parcalaData.parcalar || []).map(p => ({
                            metin: p.metin,
                            baslangic: p.baslangic,
                            bitis: p.bitis,
                        }));
                        if (autoSubStatus) autoSubStatus.textContent = 'Tahmini zamanlama kullanıldı.';
                    }

                    if (!parcalar.length) {
                        if (autoSubStatus) autoSubStatus.textContent = 'Metin parçalanamadı.';
                        autoSubBtn.disabled = false;
                        autoSubBtn.textContent = 'Otomatik Altyazı Oluştur';
                        return;
                    }

                    // Uzun cümleleri max ~80 karaktere böl (zamanlama orantılı dağıtılır)
                    const MAX_CHAR = 80;
                    const bolunmus = [];
                    for (const p of parcalar) {
                        if (p.metin.length <= MAX_CHAR) {
                            bolunmus.push(p);
                        } else {
                            // Virgül/noktalı virgülden böl
                            const altParcalar = p.metin.split(/(?<=[,;:])\s+/);
                            let satirlar = [];
                            let mevcut = '';
                            for (const ap of altParcalar) {
                                if (mevcut && (mevcut + ' ' + ap).length > MAX_CHAR) {
                                    satirlar.push(mevcut);
                                    mevcut = ap;
                                } else {
                                    mevcut = mevcut ? mevcut + ' ' + ap : ap;
                                }
                            }
                            if (mevcut) satirlar.push(mevcut);
                            // Süreyi orantılı dağıt
                            const topKar = satirlar.reduce((s, l) => s + l.length, 0);
                            let t = p.baslangic;
                            for (const satir of satirlar) {
                                const oran = satir.length / topKar;
                                const sure = (p.bitis - p.baslangic) * oran;
                                bolunmus.push({ metin: satir, baslangic: t, bitis: t + sure });
                                t += sure;
                            }
                        }
                    }

                    // Seçilen stil
                    const subStyle = {
                        position: document.getElementById('auto-sub-position')?.value || 'bottom',
                        size: parseInt(document.getElementById('auto-sub-size')?.value || '52'),
                        color: document.getElementById('auto-sub-color')?.value || '#FFFFFF',
                        animation: document.getElementById('auto-sub-animation')?.value || 'fadeIn',
                    };

                    // Her parçayı altyazı klibi olarak ekle
                    const offset = clip.startTime;
                    let eklenen = 0;
                    for (const p of bolunmus) {
                        Editor.addSubtitleClip(
                            p.metin,
                            offset + p.baslangic,
                            p.bitis - p.baslangic,
                            subStyle
                        );
                        eklenen++;
                    }

                    EditorTimeline.render();
                    EditorPreview.render();
                    toast(`${eklenen} altyazı klibi oluşturuldu.`, 'success');

                } catch (err) {
                    if (autoSubStatus) autoSubStatus.textContent = 'Hata: ' + err.message;
                }

                autoSubBtn.disabled = false;
                autoSubBtn.textContent = 'Otomatik Altyazı Oluştur';
            });
        }

        // Tüm altyazıları kaldır
        const clearSubBtn = document.getElementById('btn-clear-subtitles');
        if (clearSubBtn) {
            clearSubBtn.addEventListener('click', async () => {
                const subTrack = Editor.getTrackByType('subtitle');
                if (!subTrack || !subTrack.clips.length) {
                    toast('Kaldırılacak altyazı yok.', 'info');
                    return;
                }
                const onay = await onayla(`${subTrack.clips.length} altyazı klibi silinecek`);
                if (!onay) return;
                Editor._pushUndo();
                subTrack.clips = [];
                Editor._notify('change');
                EditorTimeline.render();
                EditorPreview.render();
                toast('Tüm altyazılar kaldırıldı.', 'success');
            });
        }

        // Stili mevcut altyazılara uygula
        const applyStyleBtn = document.getElementById('btn-apply-sub-style');
        if (applyStyleBtn) {
            applyStyleBtn.addEventListener('click', () => {
                const subTrack = Editor.getTrackByType('subtitle');
                if (!subTrack || !subTrack.clips.length) {
                    toast('Uygulanacak altyazı yok.', 'info');
                    return;
                }
                const newStyle = {
                    position: document.getElementById('auto-sub-position')?.value || 'bottom',
                    size: parseInt(document.getElementById('auto-sub-size')?.value || '52'),
                    color: document.getElementById('auto-sub-color')?.value || '#FFFFFF',
                    animation: document.getElementById('auto-sub-animation')?.value || 'fadeIn',
                };
                Editor._pushUndo();
                for (const c of subTrack.clips) {
                    Object.assign(c.style, newStyle);
                }
                Editor._notify('change');
                EditorTimeline.render();
                EditorPreview.render();
                toast(`${subTrack.clips.length} altyazıya stil uygulandı.`, 'success');
            });
        }

        const delBtn = document.getElementById('prop-delete-clip');
        if (delBtn) delBtn.addEventListener('click', () => {
            Editor.removeClip(clip.id);
            EditorTimeline.render();
            EditorPreview.render();
        });
    },

    _renderSubtitleProps(body, clip) {
        const style = clip.style || {};
        body.innerHTML = `
            <div class="props-group">
                <div class="props-group-title">ALTYAZI METNİ</div>
                <div class="props-row" style="flex-direction:column;align-items:stretch;">
                    <span class="props-label">Metin</span>
                    <textarea class="subtitle-input" id="prop-sub-text" style="min-height:60px;">${clip.text}</textarea>
                </div>
                <div class="props-row">
                    <span class="props-label">Başlangıç</span>
                    <input type="number" class="props-input" id="prop-start" value="${clip.startTime.toFixed(2)}" step="0.1" min="0">
                    <span class="props-value">sn</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Süre</span>
                    <input type="number" class="props-input" id="prop-duration" value="${clip.duration.toFixed(2)}" step="0.1" min="0.5">
                    <span class="props-value">sn</span>
                </div>
            </div>

            <div class="props-group">
                <div class="props-group-title">ALTYAZI STİLİ</div>
                <div class="props-row">
                    <span class="props-label">Font</span>
                    <select class="props-input" id="prop-sub-font">
                        ${['Segoe UI', 'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman', 'Consolas'].map(f =>
                            `<option value="${f}" ${style.font === f ? 'selected' : ''}>${f}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Boyut</span>
                    <select class="props-input" id="prop-sub-size">
                        ${[32, 40, 48, 52, 64, 80].map(s =>
                            `<option value="${s}" ${style.size === s ? 'selected' : ''}>${s}px</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Renk</span>
                    <input type="color" class="props-input" id="prop-sub-color" value="${style.color || '#FFFFFF'}">
                </div>
                <div class="props-row">
                    <span class="props-label">Kenar Rengi</span>
                    <input type="color" class="props-input" id="prop-sub-outline-color" value="${style.outlineColor || '#000000'}">
                </div>
                <div class="props-row">
                    <span class="props-label">Kenar</span>
                    <input type="range" class="props-input" id="prop-sub-outline-w" min="0" max="8" step="1" value="${style.outlineWidth || 3}">
                    <span class="props-value" id="prop-sub-outline-w-val">${style.outlineWidth || 3}px</span>
                </div>
                <div class="props-row">
                    <span class="props-label">Konum</span>
                    <select class="props-input" id="prop-sub-position">
                        <option value="bottom" ${style.position === 'bottom' ? 'selected' : ''}>Alt</option>
                        <option value="middle" ${style.position === 'middle' ? 'selected' : ''}>Orta</option>
                        <option value="top" ${style.position === 'top' ? 'selected' : ''}>Üst</option>
                    </select>
                </div>
                <div class="props-row">
                    <span class="props-label">Kalın</span>
                    <button class="props-toggle ${style.bold ? 'active' : ''}" id="prop-sub-bold"></button>
                </div>
                <div class="props-row">
                    <span class="props-label">İtalik</span>
                    <button class="props-toggle ${style.italic ? 'active' : ''}" id="prop-sub-italic"></button>
                </div>
                <div class="props-row">
                    <span class="props-label">Gölge</span>
                    <button class="props-toggle ${style.shadow !== false ? 'active' : ''}" id="prop-sub-shadow"></button>
                </div>
                <div class="props-row">
                    <span class="props-label">Animasyon</span>
                    <select class="props-input" id="prop-sub-animation">
                        <option value="none" ${(style.animation || 'none') === 'none' ? 'selected' : ''}>Yok</option>
                        <option value="fadeIn" ${style.animation === 'fadeIn' ? 'selected' : ''}>Belirme</option>
                        <option value="typewriter" ${style.animation === 'typewriter' ? 'selected' : ''}>Daktilo</option>
                        <option value="scaleIn" ${style.animation === 'scaleIn' ? 'selected' : ''}>Büyüyerek Belirme</option>
                        <option value="slideUp" ${style.animation === 'slideUp' ? 'selected' : ''}>Aşağıdan Kayma</option>
                    </select>
                </div>
            </div>

            <button class="props-delete-btn" id="prop-delete-clip">Klibi Sil</button>
        `;

        // Event bindings
        const textEl = document.getElementById('prop-sub-text');
        if (textEl) textEl.addEventListener('input', () => {
            Editor.updateClip(clip.id, { text: textEl.value });
            EditorPreview.render();
        });

        const startEl = document.getElementById('prop-start');
        if (startEl) startEl.addEventListener('change', () => { Editor.moveClip(clip.id, parseFloat(startEl.value)); EditorTimeline.render(); });

        const durEl = document.getElementById('prop-duration');
        if (durEl) durEl.addEventListener('change', () => { Editor.resizeClip(clip.id, parseFloat(durEl.value), false); EditorTimeline.render(); });

        const styleBindings = [
            ['prop-sub-font', 'font'],
            ['prop-sub-size', 'size', parseInt],
            ['prop-sub-color', 'color'],
            ['prop-sub-outline-color', 'outlineColor'],
            ['prop-sub-position', 'position'],
        ];

        for (const [id, key, transform] of styleBindings) {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    const val = transform ? transform(el.value) : el.value;
                    Editor.updateClip(clip.id, { style: { [key]: val } });
                    EditorPreview.render();
                });
            }
        }

        const outlineWEl = document.getElementById('prop-sub-outline-w');
        const outlineWVal = document.getElementById('prop-sub-outline-w-val');
        if (outlineWEl) outlineWEl.addEventListener('input', () => {
            if (outlineWVal) outlineWVal.textContent = outlineWEl.value + 'px';
            Editor.updateClip(clip.id, { style: { outlineWidth: parseInt(outlineWEl.value) } });
            EditorPreview.render();
        });

        const boldToggle = document.getElementById('prop-sub-bold');
        if (boldToggle) boldToggle.addEventListener('click', () => {
            const newVal = !clip.style.bold;
            boldToggle.classList.toggle('active', newVal);
            Editor.updateClip(clip.id, { style: { bold: newVal } });
            EditorPreview.render();
        });

        const italicToggle = document.getElementById('prop-sub-italic');
        if (italicToggle) italicToggle.addEventListener('click', () => {
            const newVal = !clip.style.italic;
            italicToggle.classList.toggle('active', newVal);
            Editor.updateClip(clip.id, { style: { italic: newVal } });
            EditorPreview.render();
        });

        const shadowToggle = document.getElementById('prop-sub-shadow');
        if (shadowToggle) shadowToggle.addEventListener('click', () => {
            const newVal = clip.style.shadow === false;
            shadowToggle.classList.toggle('active', newVal);
            Editor.updateClip(clip.id, { style: { shadow: newVal } });
            EditorPreview.render();
        });

        const animSelect = document.getElementById('prop-sub-animation');
        if (animSelect) animSelect.addEventListener('change', () => {
            Editor.updateClip(clip.id, { style: { animation: animSelect.value } });
            EditorPreview.render();
        });

        const delBtn = document.getElementById('prop-delete-clip');
        if (delBtn) delBtn.addEventListener('click', () => {
            Editor.removeClip(clip.id);
            EditorTimeline.render();
            EditorPreview.render();
        });
    },

    // Nested prop builder — "effects.kenBurns.startScale" -> {effects: {kenBurns: {startScale: val}}}
    _buildNestedProp(path, value) {
        const parts = path.split('.');
        const result = {};
        let current = result;
        for (let i = 0; i < parts.length - 1; i++) {
            current[parts[i]] = {};
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
        return result;
    },
};
