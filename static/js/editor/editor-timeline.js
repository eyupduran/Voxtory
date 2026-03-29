/* ═══════════════════════════════════════════════════════════════
   Voxtory Video Editör — Timeline (Canvas Tabanlı Zaman Çizelgesi)
   ═══════════════════════════════════════════════════════════════ */

const EditorTimeline = {
    canvas: null,
    ctx: null,
    wrap: null,

    // Sabitler
    RULER_HEIGHT: 28,
    TRACK_HEIGHT: 56,
    CLIP_RADIUS: 5,
    CLIP_PADDING: 4,
    CLIP_MIN_WIDTH: 8,
    PLAYHEAD_COLOR: '#ef4444',
    SNAP_GUIDE_COLOR: '#f59e0b',

    TRACK_COLORS: {
        'video': '#6366f1',
        'overlay': '#ec4899',
        'text': '#8b5cf6',
        'audio': '#22c55e',
        'subtitle': '#f59e0b',
    },

    TRACK_BG: ['#12121a', '#0f0f17'],

    // Drag state
    _drag: null,       // { type: 'move'|'resize-left'|'resize-right'|'seek', clipId, startMouseX, clipOrigStart, clipOrigDur }
    _hoverClipId: null,
    _hoverEdge: null,  // 'left'|'right'|null
    _snapGuideX: null,

    init() {
        this.canvas = document.getElementById('timeline-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.wrap = document.getElementById('timeline-canvas-wrap');

        this.resize();
        this._bindEvents();

        Editor.on('change', () => this.render());
        Editor.on('trackChange', () => {
            this._renderTrackHeaders();
            this.resize();
        });
    },

    _renderTrackHeaders() {
        const container = document.getElementById('timeline-track-headers');
        if (!container || !Editor.project) return;

        const icons = {
            video: '<rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
            overlay: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" opacity="0.3"/>',
            text: '<path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/>',
            audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
            subtitle: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        };

        container.innerHTML = Editor.project.tracks.map(track => {
            const color = this.TRACK_COLORS[track.type] || '#6366f1';
            const icon = icons[track.type] || icons.video;
            const typeLabels = { video: 'Görsel', overlay: 'Overlay', text: 'Metin', audio: 'Ses', subtitle: 'Altyazı' };
            const label = track.label || typeLabels[track.type] || track.type;
            // Overlay ve ek track'ler silinebilir
            const sameType = Editor.project.tracks.filter(t => t.type === track.type);
            const canDelete = track.type === 'overlay' || sameType.length > 1;

            return `<div class="timeline-track-header" data-track-id="${track.id}">
                <div class="track-color" style="background:${color};"></div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
                <span class="track-header-label">${label}</span>
                ${canDelete ? `<button class="track-delete-btn" data-delete-track="${track.id}" title="Track Sil">&times;</button>` : ''}
            </div>`;
        }).join('');

        // Track sil butonları
        container.querySelectorAll('[data-delete-track]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                Editor.removeTrack(btn.dataset.deleteTrack);
            });
        });
    },

    resize() {
        if (!this.wrap || !this.canvas) return;
        const rect = this.wrap.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.render();
    },

    // ─── Render ─────────────────────────────
    render() {
        if (!this.ctx || !Editor.project) return;
        const ctx = this.ctx;
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);
        const zoom = Editor.zoom;
        const scrollX = Editor.scrollX;

        ctx.clearRect(0, 0, W, H);

        // Cetvel (ruler)
        this._drawRuler(ctx, W, zoom, scrollX);

        // Track arkaplanları
        const tracks = Editor.project.tracks;
        for (let i = 0; i < tracks.length; i++) {
            const y = this.RULER_HEIGHT + i * this.TRACK_HEIGHT;
            ctx.fillStyle = this.TRACK_BG[i % 2];
            ctx.fillRect(0, y, W, this.TRACK_HEIGHT);

            // Track alt çizgisi
            ctx.strokeStyle = '#1e1e2e';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y + this.TRACK_HEIGHT);
            ctx.lineTo(W, y + this.TRACK_HEIGHT);
            ctx.stroke();
        }

        // Klipleri çiz
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const y = this.RULER_HEIGHT + i * this.TRACK_HEIGHT;
            for (const clip of track.clips) {
                this._drawClip(ctx, clip, track, y, zoom, scrollX, W);
            }
        }

        // Snap rehber çizgisi
        if (this._snapGuideX !== null) {
            ctx.strokeStyle = this.SNAP_GUIDE_COLOR;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(this._snapGuideX, 0);
            ctx.lineTo(this._snapGuideX, H);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Playhead
        const phX = (Editor.playheadTime * zoom) - scrollX;
        if (phX >= -2 && phX <= W + 2) {
            ctx.strokeStyle = this.PLAYHEAD_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(phX, 0);
            ctx.lineTo(phX, H);
            ctx.stroke();

            // Playhead üst üçgen
            ctx.fillStyle = this.PLAYHEAD_COLOR;
            ctx.beginPath();
            ctx.moveTo(phX - 7, 0);
            ctx.lineTo(phX + 7, 0);
            ctx.lineTo(phX, 10);
            ctx.closePath();
            ctx.fill();
        }
    },

    _drawRuler(ctx, width, zoom, scrollX) {
        const h = this.RULER_HEIGHT;
        ctx.fillStyle = '#16161f';
        ctx.fillRect(0, 0, width, h);

        ctx.strokeStyle = '#2a2a3a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(width, h);
        ctx.stroke();

        // Zaman işaretleri
        const startTime = Math.max(0, scrollX / zoom);
        const endTime = (scrollX + width) / zoom;

        // Aralık hesaplama
        let interval = 1;
        const pixelsPerSec = zoom;
        if (pixelsPerSec < 15) interval = 10;
        else if (pixelsPerSec < 30) interval = 5;
        else if (pixelsPerSec < 80) interval = 2;
        else if (pixelsPerSec >= 150) interval = 0.5;

        const start = Math.floor(startTime / interval) * interval;

        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.fillStyle = '#8888a0';
        ctx.textAlign = 'center';

        for (let t = start; t <= endTime + interval; t += interval) {
            const x = (t * zoom) - scrollX;
            if (x < -50 || x > width + 50) continue;

            // Ana çizgi
            ctx.strokeStyle = '#2a2a3a';
            ctx.beginPath();
            ctx.moveTo(x, h - 8);
            ctx.lineTo(x, h);
            ctx.stroke();

            // Zaman etiketi
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            const label = t < 60 ? `${s}s` : `${m}:${String(s).padStart(2, '0')}`;
            ctx.fillText(label, x, h - 12);

            // Ara çizgiler
            const subCount = interval >= 5 ? 5 : (interval >= 1 ? 4 : 2);
            const subInterval = interval / subCount;
            for (let si = 1; si < subCount; si++) {
                const sx = ((t + si * subInterval) * zoom) - scrollX;
                if (sx >= 0 && sx <= width) {
                    ctx.strokeStyle = '#1e1e2e';
                    ctx.beginPath();
                    ctx.moveTo(sx, h - 4);
                    ctx.lineTo(sx, h);
                    ctx.stroke();
                }
            }
        }
    },

    _drawClip(ctx, clip, track, trackY, zoom, scrollX, canvasWidth) {
        const x = (clip.startTime * zoom) - scrollX;
        const w = clip.duration * zoom;
        const y = trackY + this.CLIP_PADDING;
        const h = this.TRACK_HEIGHT - this.CLIP_PADDING * 2;
        const r = this.CLIP_RADIUS;
        const color = this.TRACK_COLORS[track.type] || '#6366f1';

        // Viewport dışındaysa çizme
        if (x + w < 0 || x > canvasWidth) return;

        const isSelected = Editor.selectedClipId === clip.id;
        const isHovered = this._hoverClipId === clip.id;

        // Klip arkaplanı
        ctx.fillStyle = isSelected ? color : this._adjustAlpha(color, 0.6);
        this._roundRect(ctx, x, y, Math.max(w, this.CLIP_MIN_WIDTH), h, r);
        ctx.fill();

        // Seçim/hover border
        if (isSelected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            this._roundRect(ctx, x, y, Math.max(w, this.CLIP_MIN_WIDTH), h, r);
            ctx.stroke();
        } else if (isHovered) {
            ctx.strokeStyle = this._adjustAlpha(color, 0.9);
            ctx.lineWidth = 1.5;
            this._roundRect(ctx, x, y, Math.max(w, this.CLIP_MIN_WIDTH), h, r);
            ctx.stroke();
        }

        // Geçiş göstergesi (klip sonunda küçük gradient)
        if (clip.transition && clip.transition.type !== 'none' && clip.transition.duration > 0) {
            const tw = clip.transition.duration * zoom;
            const tx = x + w - tw;
            const grad = ctx.createLinearGradient(tx, 0, x + w, 0);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(1, 'rgba(255,255,255,0.15)');
            ctx.fillStyle = grad;
            this._roundRect(ctx, Math.max(tx, x), y, Math.min(tw, w), h, r);
            ctx.fill();
        }

        // Klip etiketi
        if (w > 30) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 4, y, Math.max(w - 8, 0), h);
            ctx.clip();

            ctx.font = '11px "Segoe UI", sans-serif';
            ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.85)';

            let label = '';
            if (clip.type === 'image') label = clip.source || 'Görsel';
            else if (clip.type === 'overlay') label = clip.source || 'Overlay';
            else if (clip.type === 'text') label = clip.text ? clip.text.substring(0, 30) : 'Metin';
            else if (clip.type === 'audio') label = clip.source || 'Ses';
            else if (clip.type === 'subtitle') label = clip.text ? clip.text.substring(0, 40) : 'Altyazı';

            ctx.fillText(label, x + 8, y + h / 2 + 4);
            ctx.restore();
        }

        // Süre etiketi
        if (w > 60) {
            ctx.font = '10px "Cascadia Code", "Consolas", monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.textAlign = 'right';
            ctx.fillText(clip.duration.toFixed(1) + 's', x + w - 6, y + h - 6);
            ctx.textAlign = 'left';
        }

        // Resize kenar göstergeleri (hover/selected)
        if (isSelected || isHovered) {
            const edgeW = 4;
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            // Sol kenar
            this._roundRect(ctx, x, y + 4, edgeW, h - 8, 2);
            ctx.fill();
            // Sağ kenar
            this._roundRect(ctx, x + w - edgeW, y + 4, edgeW, h - 8, 2);
            ctx.fill();
        }
    },

    // ─── Mouse Events ───────────────────────
    _bindEvents() {
        const c = this.canvas;

        c.addEventListener('mousedown', (e) => this._onMouseDown(e));
        c.addEventListener('mousemove', (e) => this._onMouseMove(e));
        c.addEventListener('mouseup', (e) => this._onMouseUp(e));
        c.addEventListener('mouseleave', () => {
            this._hoverClipId = null;
            this._hoverEdge = null;
            this.canvas.style.cursor = 'default';
            this.render();
        });
        c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        c.addEventListener('contextmenu', (e) => this._onContextMenu(e));

        // Pencere boyut değişimi
        window.addEventListener('resize', () => this.resize());
    },

    _getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },

    _hitTest(mx, my) {
        const tracks = Editor.project.tracks;
        const zoom = Editor.zoom;
        const scrollX = Editor.scrollX;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const trackY = this.RULER_HEIGHT + i * this.TRACK_HEIGHT;

            if (my < trackY || my > trackY + this.TRACK_HEIGHT) continue;

            for (let j = track.clips.length - 1; j >= 0; j--) {
                const clip = track.clips[j];
                const cx = (clip.startTime * zoom) - scrollX;
                const cw = clip.duration * zoom;

                if (mx >= cx && mx <= cx + cw) {
                    let edge = null;
                    const edgeZone = 8;
                    if (mx - cx < edgeZone) edge = 'left';
                    else if (cx + cw - mx < edgeZone) edge = 'right';

                    return { clip, track, trackIndex: i, edge };
                }
            }

            return { clip: null, track, trackIndex: i, edge: null };
        }

        return null;
    },

    _onMouseDown(e) {
        if (e.button === 2) return; // sag tik context menu'de

        const pos = this._getMousePos(e);

        // Cetvel tıklaması — seek
        if (pos.y < this.RULER_HEIGHT) {
            this._drag = { type: 'seek' };
            this._seekToX(pos.x);
            return;
        }

        const hit = this._hitTest(pos.x, pos.y);
        if (!hit) return;

        if (hit.clip) {
            Editor.selectedClipId = hit.clip.id;
            Editor.selectedTrackId = hit.track.id;
            Editor._notify('select', hit.clip);

            // Playhead'i klibin başlangıcına taşı (kenar sürüklemesi değilse)
            if (!hit.edge) {
                if (Editor.isPlaying) EditorPreview.pause();
                EditorPreview.seekTo(hit.clip.startTime);
            }

            if (hit.edge === 'left') {
                this._drag = {
                    type: 'resize-left',
                    clipId: hit.clip.id,
                    startMouseX: pos.x,
                    clipOrigStart: hit.clip.startTime,
                    clipOrigDur: hit.clip.duration,
                };
            } else if (hit.edge === 'right') {
                this._drag = {
                    type: 'resize-right',
                    clipId: hit.clip.id,
                    startMouseX: pos.x,
                    clipOrigDur: hit.clip.duration,
                };
            } else {
                this._drag = {
                    type: 'move',
                    clipId: hit.clip.id,
                    startMouseX: pos.x,
                    clipOrigStart: hit.clip.startTime,
                };
            }
        } else {
            Editor.selectedClipId = null;
            Editor._notify('select', null);
        }

        this.render();
    },

    _onMouseMove(e) {
        const pos = this._getMousePos(e);

        if (this._drag) {
            const zoom = Editor.zoom;
            const scrollX = Editor.scrollX;
            const dx = pos.x - this._drag.startMouseX;

            if (this._drag.type === 'seek') {
                this._seekToX(pos.x);
                return;
            }

            if (this._drag.type === 'move') {
                let newStart = this._drag.clipOrigStart + (dx / zoom);
                newStart = Math.max(0, newStart);
                const snap = Editor.snapTime(newStart, this._drag.clipId);
                if (snap.snapped) {
                    this._snapGuideX = (snap.time * zoom) - scrollX;
                    newStart = snap.time;
                } else {
                    // Snap klip sonu
                    const clip = Editor.getClip(this._drag.clipId);
                    if (clip) {
                        const endSnap = Editor.snapTime(newStart + clip.duration, this._drag.clipId);
                        if (endSnap.snapped) {
                            newStart = endSnap.time - clip.duration;
                            this._snapGuideX = (endSnap.time * zoom) - scrollX;
                        } else {
                            this._snapGuideX = null;
                        }
                    }
                }
                const clip = Editor.getClip(this._drag.clipId);
                if (clip) {
                    // Çakışma kontrolü — sürükleme sırasında
                    const track = Editor.getClipTrack(this._drag.clipId);
                    const overlap = track ? Editor._hasOverlap(track, Math.max(0, newStart), clip.duration, clip.id) : null;
                    if (!overlap) {
                        clip.startTime = Math.max(0, newStart);
                    }
                }
            }

            if (this._drag.type === 'resize-right') {
                let newDur = this._drag.clipOrigDur + (dx / zoom);
                newDur = Math.max(0.5, newDur);
                const clip = Editor.getClip(this._drag.clipId);
                if (clip) {
                    const endTime = clip.startTime + newDur;
                    const snap = Editor.snapTime(endTime, this._drag.clipId);
                    if (snap.snapped) {
                        newDur = snap.time - clip.startTime;
                        this._snapGuideX = (snap.time * zoom) - scrollX;
                    } else {
                        this._snapGuideX = null;
                    }
                    clip.duration = Math.max(0.5, newDur);
                }
            }

            if (this._drag.type === 'resize-left') {
                let newStart = this._drag.clipOrigStart + (dx / zoom);
                const origEnd = this._drag.clipOrigStart + this._drag.clipOrigDur;
                newStart = Math.max(0, Math.min(newStart, origEnd - 0.5));
                const snap = Editor.snapTime(newStart, this._drag.clipId);
                if (snap.snapped) {
                    newStart = snap.time;
                    this._snapGuideX = (snap.time * zoom) - scrollX;
                } else {
                    this._snapGuideX = null;
                }
                const clip = Editor.getClip(this._drag.clipId);
                if (clip) {
                    clip.startTime = newStart;
                    clip.duration = origEnd - newStart;
                }
            }

            this.render();
            EditorPreview.render();
            return;
        }

        // Hover efekti
        if (pos.y < this.RULER_HEIGHT) {
            this.canvas.style.cursor = 'pointer';
            this._hoverClipId = null;
            this._hoverEdge = null;
            this.render();
            return;
        }

        const hit = this._hitTest(pos.x, pos.y);
        if (hit && hit.clip) {
            this._hoverClipId = hit.clip.id;
            this._hoverEdge = hit.edge;
            if (hit.edge === 'left' || hit.edge === 'right') {
                this.canvas.style.cursor = 'ew-resize';
            } else {
                this.canvas.style.cursor = 'grab';
            }
        } else {
            this._hoverClipId = null;
            this._hoverEdge = null;
            this.canvas.style.cursor = 'default';
        }
        this.render();
    },

    _onMouseUp(e) {
        if (this._drag && this._drag.type !== 'seek') {
            // Undo push — sadece gerçek değişiklik olduysa
            const clip = Editor.getClip(this._drag.clipId);
            if (clip) {
                const track = Editor.getClipTrack(this._drag.clipId);
                if (track) Editor._sortClips(track);
            }
            Editor._pushUndo();
            Editor._notify('change');
        }
        this._drag = null;
        this._snapGuideX = null;
        this.render();
    },

    _onWheel(e) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            // Zoom
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const pos = this._getMousePos(e);
            const timeAtMouse = (pos.x + Editor.scrollX) / Editor.zoom;

            Editor.zoom = Math.min(Editor.ZOOM_MAX, Math.max(Editor.ZOOM_MIN, Editor.zoom * zoomFactor));
            Editor.scrollX = (timeAtMouse * Editor.zoom) - pos.x;
            Editor.scrollX = Math.max(0, Editor.scrollX);

            // Zoom slider güncelle
            const slider = document.getElementById('timeline-zoom-slider');
            if (slider) slider.value = Editor.zoom;
            const label = document.getElementById('timeline-zoom-label');
            if (label) label.textContent = `%${Math.round(Editor.zoom / Editor.ZOOM_DEFAULT * 100)}`;
        } else {
            // Yatay kaydırma
            Editor.scrollX += e.deltaY * 0.8;
            Editor.scrollX = Math.max(0, Editor.scrollX);
        }
        this.render();
    },

    _onContextMenu(e) {
        e.preventDefault();
        const pos = this._getMousePos(e);
        const hit = this._hitTest(pos.x, pos.y);

        if (hit && hit.clip) {
            Editor.selectedClipId = hit.clip.id;
            Editor._notify('select', hit.clip);
            this.render();

            const menu = document.getElementById('editor-context-menu');
            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';
            menu.classList.add('active');

            const closeMenu = () => {
                menu.classList.remove('active');
                document.removeEventListener('click', closeMenu);
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 10);
        }
    },

    _seekToX(x) {
        const time = Math.max(0, (x + Editor.scrollX) / Editor.zoom);
        Editor.playheadTime = time;
        this.render();
        EditorPreview.render();
        EditorInit.updateTimeDisplay();
    },

    // ─── Drop Handler (medyadan timeline'a) ─
    handleDrop(type, source, x, y, duration) {
        const pos = { x, y };
        const tracks = Editor.project.tracks;
        let targetTrack = null;

        for (let i = 0; i < tracks.length; i++) {
            const trackY = this.RULER_HEIGHT + i * this.TRACK_HEIGHT;
            if (pos.y >= trackY && pos.y < trackY + this.TRACK_HEIGHT) {
                targetTrack = tracks[i];
                break;
            }
        }

        const startTime = Math.max(0, (pos.x + Editor.scrollX) / Editor.zoom);

        if (type === 'image') {
            // Overlay track'e bırakılırsa overlay klip ekle
            if (targetTrack && targetTrack.type === 'overlay') {
                Editor.addOverlayClip(source, targetTrack.id, startTime, 5);
            } else {
                Editor.addImageClip(source, startTime, 5);
            }
        } else if (type === 'audio') {
            if (!targetTrack || targetTrack.type !== 'audio') {
                targetTrack = Editor.getTrackByType('audio');
            }
            Editor.addAudioClip(source, startTime, duration || 30);
        }

        this.render();
    },

    // ─── Yardımcılar ────────────────────────
    _roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    },

    _adjustAlpha(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    fitToContent() {
        if (!Editor.project) return;
        const totalDur = Editor.getTotalDuration();
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const newZoom = Math.max(Editor.ZOOM_MIN, (W - 20) / (totalDur || 10));
        Editor.zoom = Math.min(Editor.ZOOM_MAX, newZoom);
        Editor.scrollX = 0;

        const slider = document.getElementById('timeline-zoom-slider');
        if (slider) slider.value = Editor.zoom;
        const label = document.getElementById('timeline-zoom-label');
        if (label) label.textContent = `%${Math.round(Editor.zoom / Editor.ZOOM_DEFAULT * 100)}`;

        this.render();
    },
};
