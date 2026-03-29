/* ═══════════════════════════════════════════════════════════════
   Voxtory Video Editör — Preview (Canvas Önizleme + Oynatma)
   ═══════════════════════════════════════════════════════════════ */

const EditorPreview = {
    canvas: null,
    ctx: null,
    _rendering: false,

    // Canvas üzerinde sürükleme/boyutlandırma state
    _canvasDrag: null,   // { clipId, mode, startMx, startMy, origX, origY, origW, origH, handle }
    _clipBounds: {},     // clipId -> { x, y, w, h } (pixel, render sırasında güncellenir)
    _hoverHandle: null,  // 'move' | 'nw' | 'ne' | 'sw' | 'se' | null

    init() {
        this.canvas = document.getElementById('preview-canvas');
        this.ctx = this.canvas.getContext('2d');

        Editor.on('change', () => this.render());
        Editor.on('select', () => this.render());

        this._initAudio();
        this._initCanvasDrag();
        this.render();
    },

    _initAudio() {
        // Ses elementini oluştur
        if (!Editor.audioElement) {
            Editor.audioElement = new Audio();
            Editor.audioElement.preload = 'auto';
        }
    },

    // ─── Canvas Sürükleme + Boyutlandırma ─────
    HANDLE_SIZE: 8,  // piksel (canvas display)
    HANDLE_CURSORS: { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' },

    _initCanvasDrag() {
        const c = this.canvas;

        c.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const px = this._canvasPixelPos(e);

            // Önce seçili klibin handle'ını kontrol et
            const handle = this._hitTestHandle(px.x, px.y);
            if (handle) {
                const clip = Editor.getClip(Editor.selectedClipId);
                if (clip) {
                    this._canvasDrag = {
                        clipId: clip.id,
                        mode: 'resize',
                        handle: handle,
                        startMx: px.x,
                        startMy: px.y,
                        origX: clip.position.x,
                        origY: clip.position.y,
                        origSizeW: clip.type === 'text' ? (clip.style.size || 72) : ((clip.size && clip.size.w) || 0.2),
                    };
                    c.style.cursor = this.HANDLE_CURSORS[handle] || 'nwse-resize';
                    e.preventDefault();
                    return;
                }
            }

            // Sonra klip body'sine tıklama (taşıma)
            const hit = this._hitTestBody(px.x, px.y);
            if (hit) {
                Editor.selectedClipId = hit.id;
                Editor._notify('select', hit);
                this._canvasDrag = {
                    clipId: hit.id,
                    mode: 'move',
                    startMx: px.x,
                    startMy: px.y,
                    origX: hit.position.x,
                    origY: hit.position.y,
                };
                c.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        c.addEventListener('mousemove', (e) => {
            const px = this._canvasPixelPos(e);
            const rect = c.getBoundingClientRect();
            const W = rect.width;
            const H = rect.height;

            if (this._canvasDrag) {
                const drag = this._canvasDrag;
                const clip = Editor.getClip(drag.clipId);
                if (!clip) return;

                if (drag.mode === 'move') {
                    const dx = (px.x - drag.startMx) / W;
                    const dy = (px.y - drag.startMy) / H;
                    clip.position.x = Math.max(0, Math.min(1, drag.origX + dx));
                    clip.position.y = Math.max(0, Math.min(1, drag.origY + dy));
                    this.render();
                    this._syncPanelSliders(clip);
                } else if (drag.mode === 'resize') {
                    this._handleResize(clip, drag, px, W, H);
                    this.render();
                    this._syncPanelSliders(clip);
                }
                return;
            }

            // Hover — handle mi, body mi?
            const handle = this._hitTestHandle(px.x, px.y);
            if (handle) {
                c.style.cursor = this.HANDLE_CURSORS[handle] || 'nwse-resize';
                return;
            }
            const hit = this._hitTestBody(px.x, px.y);
            c.style.cursor = hit ? 'grab' : 'default';
        });

        const endDrag = () => {
            if (this._canvasDrag) {
                Editor._pushUndo();
                Editor._notify('change');
                this._canvasDrag = null;
                this.canvas.style.cursor = 'default';
            }
        };
        c.addEventListener('mouseup', endDrag);
        c.addEventListener('mouseleave', endDrag);
    },

    _canvasPixelPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },

    // ─── Hit Test: bounding box (render sırasında _clipBounds'a kaydedilir) ─
    _hitTestBody(px, py) {
        const time = Editor.playheadTime;
        // Ters sıra — üstte çizilen önce yakalanır
        const types = ['text', 'overlay'];
        for (const type of types) {
            const tracks = Editor.getTracksByType(type);
            for (let ti = tracks.length - 1; ti >= 0; ti--) {
                for (let ci = tracks[ti].clips.length - 1; ci >= 0; ci--) {
                    const clip = tracks[ti].clips[ci];
                    if (time >= clip.startTime && time < clip.startTime + clip.duration) {
                        const b = this._clipBounds[clip.id];
                        if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
                            return clip;
                        }
                    }
                }
            }
        }
        return null;
    },

    // ─── Hit Test: resize handle'ları (seçili klibin 4 köşesi) ─
    _hitTestHandle(px, py) {
        const selId = Editor.selectedClipId;
        if (!selId) return null;
        const b = this._clipBounds[selId];
        if (!b) return null;

        const hs = this.HANDLE_SIZE;
        const corners = {
            nw: { x: b.x, y: b.y },
            ne: { x: b.x + b.w, y: b.y },
            sw: { x: b.x, y: b.y + b.h },
            se: { x: b.x + b.w, y: b.y + b.h },
        };
        for (const [name, c] of Object.entries(corners)) {
            if (Math.abs(px - c.x) <= hs && Math.abs(py - c.y) <= hs) {
                return name;
            }
        }
        return null;
    },

    // ─── Resize hesaplama ─
    _handleResize(clip, drag, px, W, H) {
        const dxPx = px.x - drag.startMx;
        const dyPx = px.y - drag.startMy;
        // Köşeye göre boyut değişimi yönü (se: sağ-alt → büyütme pozitif)
        const signX = drag.handle.includes('e') ? 1 : -1;
        const signY = drag.handle.includes('s') ? 1 : -1;
        // Uniform scale — dx ve dy'nin ortalamasını al
        const delta = (dxPx * signX + dyPx * signY) / 2;

        if (clip.type === 'text') {
            // Font boyutunu ölçekle
            const sizeScale = delta / H;  // normalize
            const newSize = Math.round(Math.max(16, Math.min(200, drag.origSizeW + sizeScale * 500)));
            clip.style.size = newSize;
        } else if (clip.type === 'overlay') {
            // Genişlik oranını ölçekle
            const wDelta = delta / W;
            const newW = Math.max(0.03, Math.min(1, drag.origSizeW + wDelta));
            clip.size.w = newW;
        }

        // Handle karşı köşedeyse pozisyonu da ayarla
        if (drag.handle.includes('n')) {
            clip.position.y = Math.max(0, Math.min(1, drag.origY + (dyPx / H) * 0.5));
        }
        if (drag.handle.includes('w')) {
            clip.position.x = Math.max(0, Math.min(1, drag.origX + (dxPx / W) * 0.5));
        }
    },

    // ─── Panel slider senkronizasyonu ─
    _syncPanelSliders(clip) {
        const x = clip.position.x;
        const y = clip.position.y;

        // Konum
        const ids = [
            ['prop-text-x', 'prop-text-x-val'],
            ['prop-overlay-x', 'prop-overlay-x-val'],
        ];
        for (const [id, vid] of ids) {
            const el = document.getElementById(id);
            const vl = document.getElementById(vid);
            if (el) el.value = Math.round(x * 100);
            if (vl) vl.textContent = Math.round(x * 100) + '%';
        }
        const idy = [
            ['prop-text-y', 'prop-text-y-val'],
            ['prop-overlay-y', 'prop-overlay-y-val'],
        ];
        for (const [id, vid] of idy) {
            const el = document.getElementById(id);
            const vl = document.getElementById(vid);
            if (el) el.value = Math.round(y * 100);
            if (vl) vl.textContent = Math.round(y * 100) + '%';
        }

        // Boyut
        if (clip.type === 'text') {
            const sEl = document.getElementById('prop-text-size');
            const sVal = document.getElementById('prop-text-size-val');
            if (sEl) sEl.value = clip.style.size;
            if (sVal) sVal.textContent = clip.style.size + 'px';
        } else if (clip.type === 'overlay') {
            const wEl = document.getElementById('prop-overlay-w');
            const wVal = document.getElementById('prop-overlay-w-val');
            if (wEl) wEl.value = Math.round(clip.size.w * 100);
            if (wVal) wVal.textContent = Math.round(clip.size.w * 100) + '%';
        }
    },

    // ─── Render ─────────────────────────────
    render() {
        if (!this.ctx || !Editor.project) return;
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        const time = Editor.playheadTime;

        // Her render'da bounds sıfırla
        this._clipBounds = {};

        // Siyah arka plan
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, W, H);

        // Video track'ten mevcut klibi bul
        const videoTrack = Editor.getTrackByType('video');
        if (!videoTrack) return;

        const currentClip = this._getClipAtTime(videoTrack, time);
        const prevClip = this._getPrevClip(videoTrack, currentClip);

        if (!currentClip && !prevClip) {
            this._drawEmptyState(ctx, W, H);
            return;
        }

        // Mevcut klip çiz
        if (currentClip) {
            this._drawImageClip(ctx, currentClip, time, W, H, 1.0);
        }

        // Geçiş efekti — önceki klip ile blend
        if (currentClip && prevClip && prevClip.transition && prevClip.transition.type !== 'none') {
            const transEnd = prevClip.startTime + prevClip.duration;
            const transDur = prevClip.transition.duration;
            const transStart = transEnd - transDur;
            if (time >= transStart && time <= transEnd) {
                const progress = (time - transStart) / transDur;
                this._renderTransition(ctx, prevClip, currentClip, progress, W, H, time);
            }
        }

        // Overlay klipleri çiz (video track'in üstüne)
        this._drawOverlays(ctx, time, W, H);

        // Metin overlay çiz
        this._drawTextOverlays(ctx, time, W, H);

        // Altyazı çiz
        this._drawSubtitles(ctx, time, W, H);
    },

    _getClipAtTime(track, time) {
        for (const clip of track.clips) {
            if (time >= clip.startTime && time < clip.startTime + clip.duration) {
                return clip;
            }
        }
        return null;
    },

    _getPrevClip(track, currentClip) {
        if (!currentClip) return null;
        let prevClip = null;
        for (const clip of track.clips) {
            if (clip.id === currentClip.id) break;
            prevClip = clip;
        }
        return prevClip;
    },

    _drawImageClip(ctx, clip, time, W, H, alpha) {
        const img = Editor.imageCache.get(clip.source);
        if (!img) {
            Editor.loadImage(clip.source).then(() => this.render());
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#55556a';
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Yükleniyor: ' + clip.source, W / 2, H / 2);
            ctx.textAlign = 'left';
            return;
        }

        ctx.save();
        if (alpha < 1) ctx.globalAlpha = alpha;

        const clipProgress = Math.max(0, Math.min(1, (time - clip.startTime) / clip.duration));
        const fitMode = (clip.effects && clip.effects.fitMode) || 'fit';

        // Görsel efektler — ctx.filter ile (FFmpeg filtre chain ile uyumlu)
        if (clip.effects) {
            const filterStr = this._buildFilterString(clip.effects);
            if (filterStr !== 'none') {
                ctx.filter = filterStr;
            }
        }

        // Ken Burns efekti
        if (clip.effects && clip.effects.kenBurns && clip.effects.kenBurns.enabled) {
            const kb = clip.effects.kenBurns;
            const scale = kb.startScale + (kb.endScale - kb.startScale) * clipProgress;
            const cx = kb.startX + (kb.endX - kb.startX) * clipProgress;
            const cy = kb.startY + (kb.endY - kb.startY) * clipProgress;
            this._drawImageWithKenBurns(ctx, img, W, H, scale, cx, cy);
        } else {
            this._drawImageScaled(ctx, img, W, H, fitMode);
        }

        ctx.restore();
    },

    _drawImageScaled(ctx, img, W, H, fitMode) {
        const imgR = img.width / img.height;
        const canR = W / H;
        let dx, dy, dw, dh;

        if (fitMode === 'fill') {
            // Ekranı tamamen doldur (kırp)
            if (imgR > canR) {
                dh = H;
                dw = H * imgR;
                dx = (W - dw) / 2;
                dy = 0;
            } else {
                dw = W;
                dh = W / imgR;
                dx = 0;
                dy = (H - dh) / 2;
            }
        } else if (fitMode === 'stretch') {
            dx = 0; dy = 0; dw = W; dh = H;
        } else {
            // fit — siyah şerit ile sığdır
            if (imgR > canR) {
                dw = W; dh = W / imgR; dx = 0; dy = (H - dh) / 2;
            } else {
                dh = H; dw = H * imgR; dx = (W - dw) / 2; dy = 0;
            }
        }

        ctx.drawImage(img, dx, dy, dw, dh);
    },

    _drawImageWithKenBurns(ctx, img, W, H, scale, centerX, centerY) {
        // FFmpeg zoompan ile aynı mantık:
        // Görsel büyük çizilir, sonra viewport (W x H) kırpılır
        // zoompan: x = (iw - iw/zoom) * centerX, y = (ih - ih/zoom) * centerY
        ctx.save();

        // Görseli canvas'a sığdırmak için temel boyut (fill mode)
        const imgR = img.width / img.height;
        const canR = W / H;
        let baseW, baseH;
        if (imgR > canR) {
            baseH = H; baseW = H * imgR;
        } else {
            baseW = W; baseH = W / imgR;
        }

        // Scale uygula — görsel büyür
        const drawW = baseW * scale;
        const drawH = baseH * scale;

        // FFmpeg zoompan formülü: x = (totalW - viewportW) * centerX
        // totalW = drawW, viewportW = W
        const offsetX = -(drawW - W) * centerX;
        const offsetY = -(drawH - H) * centerY;

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
        ctx.restore();
    },

    // ─── Overlay Render ───────────────────────
    _drawOverlays(ctx, time, W, H) {
        const overlayTracks = Editor.getTracksByType('overlay');
        for (const track of overlayTracks) {
            for (const clip of track.clips) {
                if (time >= clip.startTime && time < clip.startTime + clip.duration) {
                    this._drawOverlayClip(ctx, clip, time, W, H);
                }
            }
        }
    },

    _drawOverlayClip(ctx, clip, time, W, H) {
        const img = Editor.imageCache.get(clip.source);
        if (!img) {
            Editor.loadImage(clip.source).then(() => this.render());
            return;
        }

        ctx.save();

        // Opaklık
        ctx.globalAlpha = clip.opacity != null ? clip.opacity : 1.0;

        // Filtre efektleri
        if (clip.effects) {
            const filterStr = this._buildFilterString(clip.effects);
            if (filterStr !== 'none') {
                ctx.filter = filterStr;
            }
        }

        // Boyut hesaplama
        const sizeW = (clip.size && clip.size.w) || 0.2;
        const drawW = W * sizeW;
        // Aspect ratio koru (h=0 ise otomatik)
        const sizeH = (clip.size && clip.size.h) || 0;
        const drawH = sizeH > 0 ? H * sizeH : drawW * (img.height / img.width);

        // Konum (0-1 normalize)
        const posX = ((clip.position && clip.position.x) || 0.5) * W - drawW / 2;
        const posY = ((clip.position && clip.position.y) || 0.5) * H - drawH / 2;

        ctx.drawImage(img, posX, posY, drawW, drawH);

        // Bounding box kaydet (hit-test ve resize için)
        const dpr = window.devicePixelRatio || 1;
        const cW = this.canvas.width / dpr;
        const cH = this.canvas.height / dpr;
        this._clipBounds[clip.id] = {
            x: posX * (cW / W),
            y: posY * (cH / H),
            w: drawW * (cW / W),
            h: drawH * (cH / H),
        };

        // Seçili göstergesi + handle'lar
        if (Editor.selectedClipId === clip.id) {
            ctx.strokeStyle = 'rgba(236, 72, 153, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(posX - 2, posY - 2, drawW + 4, drawH + 4);
            ctx.setLineDash([]);

            const hs = this.HANDLE_SIZE * dpr;
            ctx.fillStyle = 'rgba(236, 72, 153, 0.9)';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            for (const [cx, cy] of [[posX, posY], [posX + drawW, posY], [posX, posY + drawH], [posX + drawW, posY + drawH]]) {
                ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
                ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
            }
        }

        ctx.restore();
    },

    // ─── Metin Overlay Render ─────────────────
    _drawTextOverlays(ctx, time, W, H) {
        const textTracks = Editor.getTracksByType('text');
        for (const track of textTracks) {
            for (const clip of track.clips) {
                if (time >= clip.startTime && time < clip.startTime + clip.duration) {
                    this._drawTextClip(ctx, clip, time, W, H);
                }
            }
        }
    },

    _drawTextClip(ctx, clip, time, W, H) {
        const st = clip.style || {};
        const anim = clip.animation || {};
        const elapsed = time - clip.startTime;
        const remaining = clip.duration - elapsed;

        // Animasyon hesaplama
        let alpha = 1;
        let scaleVal = 1;
        let offsetX = 0, offsetY = 0;

        const enterDur = anim.enterDuration || 0.5;
        const exitDur = anim.exitDuration || 0.3;
        const enterType = anim.enter || 'none';
        const exitType = anim.exit || 'none';

        // Giriş animasyonu
        if (elapsed < enterDur) {
            const t = elapsed / enterDur;
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOut
            switch (enterType) {
                case 'fadeIn': alpha = eased; break;
                case 'slideUp': offsetY = (1 - eased) * 80; alpha = eased; break;
                case 'slideDown': offsetY = -(1 - eased) * 80; alpha = eased; break;
                case 'slideLeft': offsetX = (1 - eased) * 120; alpha = eased; break;
                case 'slideRight': offsetX = -(1 - eased) * 120; alpha = eased; break;
                case 'scaleIn': scaleVal = 0.3 + 0.7 * eased; alpha = eased; break;
                case 'bounceIn': {
                    const b = t < 0.36 ? 7.5625 * t * t
                        : t < 0.73 ? 7.5625 * (t - 0.545) * (t - 0.545) + 0.75
                        : 7.5625 * (t - 0.9) * (t - 0.9) + 0.94;
                    scaleVal = Math.min(1, b);
                    alpha = Math.min(1, t * 2);
                    break;
                }
                case 'popIn': {
                    const elastic = Math.pow(2, -8 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
                    scaleVal = elastic;
                    alpha = Math.min(1, t * 3);
                    break;
                }
                case 'typewriter': alpha = 1; break; // metin harfi harfi eklenir
            }
        }

        // Çıkış animasyonu
        if (remaining < exitDur) {
            const t = remaining / exitDur;
            if (exitType === 'fadeOut') alpha *= t;
            else if (exitType === 'scaleOut') { scaleVal *= t; alpha *= t; }
        }

        // Font
        const fontSize = Math.round((st.size || 72) * (H / 1080));
        const fontStyle = st.italic ? 'italic ' : '';
        const fontWeight = st.bold ? 'bold ' : '';
        const fontName = st.font || 'Segoe UI';

        ctx.save();
        ctx.globalAlpha = alpha;

        // Konum
        const posX = (clip.position ? clip.position.x : 0.5) * W + offsetX;
        const posY = (clip.position ? clip.position.y : 0.3) * H + offsetY;

        // Scale dönüşümü
        if (scaleVal !== 1) {
            ctx.translate(posX, posY);
            ctx.scale(scaleVal, scaleVal);
            ctx.translate(-posX, -posY);
        }

        ctx.font = `${fontStyle}${fontWeight}${fontSize}px "${fontName}", sans-serif`;
        ctx.textAlign = st.align || 'center';
        ctx.textBaseline = 'middle';

        // Metin hesaplama
        const maxW = (st.maxWidth || 0.8) * W;
        let displayText = clip.text || '';

        // Typewriter animasyonu
        if (enterType === 'typewriter' && elapsed < enterDur) {
            const charCount = Math.floor((elapsed / enterDur) * displayText.length * 1.2);
            displayText = displayText.substring(0, Math.min(charCount, displayText.length));
        }

        const lines = this._wrapText(ctx, displayText, maxW);
        const lineH = fontSize * (st.lineHeight || 1.4);
        const totalH = lines.length * lineH;
        const pad = st.padding || 0;

        // Arka plan kutusu
        const bgColor = st.backgroundColor || 'transparent';
        if (bgColor && bgColor !== 'transparent') {
            const maxLineW = Math.max(...lines.map(l => ctx.measureText(l).width));
            const boxW = maxLineW + pad * 2;
            const boxH = totalH + pad * 2;
            let boxX;
            if (st.align === 'left') boxX = posX - pad;
            else if (st.align === 'right') boxX = posX - boxW + pad;
            else boxX = posX - boxW / 2;
            const boxY = posY - totalH / 2 - pad;
            const radius = st.borderRadius || 0;

            ctx.fillStyle = bgColor;
            if (radius > 0) {
                this._roundRectPath(ctx, boxX, boxY, boxW, boxH, radius * (H / 1080));
                ctx.fill();
            } else {
                ctx.fillRect(boxX, boxY, boxW, boxH);
            }
        }

        // Metin çiz
        const startY = posY - totalH / 2 + lineH / 2;

        // Outline
        const olw = (st.outlineWidth || 0) * (H / 1080);
        if (olw > 0) {
            ctx.strokeStyle = st.outlineColor || '#000000';
            ctx.lineWidth = olw;
            ctx.lineJoin = 'round';
            for (let i = 0; i < lines.length; i++) {
                ctx.strokeText(lines[i], posX, startY + i * lineH);
            }
        }

        // Ana metin
        ctx.fillStyle = st.color || '#FFFFFF';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], posX, startY + i * lineH);
        }

        // Bounding box hesapla ve kaydet (hit-test için)
        const maxLineW = Math.max(...lines.map(l => ctx.measureText(l).width));
        const bbW = maxLineW + pad * 2 + 8;
        const bbH = totalH + pad * 2 + 8;
        let bbX;
        if (st.align === 'left') bbX = posX - pad - 4;
        else if (st.align === 'right') bbX = posX - bbW + pad + 4;
        else bbX = posX - bbW / 2;
        const bbY = posY - totalH / 2 - pad - 4;

        // Canvas pixel → display pixel dönüşümü
        const dpr = window.devicePixelRatio || 1;
        const cW = this.canvas.width / dpr;
        const cH = this.canvas.height / dpr;
        this._clipBounds[clip.id] = {
            x: bbX * (cW / W),
            y: bbY * (cH / H),
            w: bbW * (cW / W),
            h: bbH * (cH / H),
        };

        // Seçili göstergesi + handle'lar
        if (Editor.selectedClipId === clip.id) {
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(bbX, bbY, bbW, bbH);
            ctx.setLineDash([]);

            // 4 köşe handle
            const hs = this.HANDLE_SIZE * dpr;
            ctx.fillStyle = 'rgba(99, 102, 241, 0.9)';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            for (const [cx, cy] of [[bbX, bbY], [bbX + bbW, bbY], [bbX, bbY + bbH], [bbX + bbW, bbY + bbH]]) {
                ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
                ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
            }
        }

        ctx.restore();
    },

    _roundRectPath(ctx, x, y, w, h, r) {
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

    _drawSubtitles(ctx, time, W, H) {
        const subTrack = Editor.getTrackByType('subtitle');
        if (!subTrack) return;

        for (const clip of subTrack.clips) {
            if (time >= clip.startTime && time < clip.startTime + clip.duration) {
                const style = clip.style || {};
                const fontSize = Math.round((style.size || 52) * (H / 1080));
                const fontStyle = style.italic ? 'italic ' : '';
                const fontWeight = style.bold ? 'bold ' : '';
                const fontName = style.font || 'Segoe UI';

                ctx.font = `${fontStyle}${fontWeight}${fontSize}px "${fontName}", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Konum
                let textY;
                const pos = style.position || 'bottom';
                if (pos === 'top') textY = H * 0.12;
                else if (pos === 'middle') textY = H * 0.5;
                else textY = H * 0.87;

                const text = clip.text || '';
                const lines = this._wrapText(ctx, text, W * 0.85);
                const lineHeight = fontSize * 1.3;
                const totalH = lines.length * lineHeight;
                const startY = textY - totalH / 2 + lineHeight / 2;

                // Animasyon
                let textAlpha = 1;
                const anim = style.animation || 'none';
                const clipT = (time - clip.startTime) / clip.duration;
                let scaleVal = 1;
                let slideOffset = 0;

                if (anim === 'fadeIn') {
                    textAlpha = Math.min(1, clipT * 4); // ilk %25'te fade in
                } else if (anim === 'scaleIn') {
                    const scaleProgress = Math.min(1, clipT * 3); // ilk %33'te büyür
                    scaleVal = 0.5 + 0.5 * scaleProgress;
                    textAlpha = Math.min(1, clipT * 4);
                } else if (anim === 'slideUp') {
                    const slideProgress = Math.min(1, clipT * 4); // ilk %25
                    slideOffset = (1 - slideProgress) * fontSize * 2;
                    textAlpha = slideProgress;
                }

                ctx.save();
                ctx.globalAlpha = (ctx.globalAlpha || 1) * textAlpha;

                // scaleIn animasyonu — merkez etrafında ölçekle
                if (anim === 'scaleIn' && scaleVal < 1) {
                    const centerX = W / 2;
                    const centerY = startY + totalH / 2 - lineHeight / 2;
                    ctx.translate(centerX, centerY);
                    ctx.scale(scaleVal, scaleVal);
                    ctx.translate(-centerX, -centerY);
                }

                // Gölge
                if (style.shadow !== false) {
                    ctx.shadowColor = style.shadowColor || 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = fontSize * 0.15;
                    ctx.shadowOffsetX = fontSize * 0.04;
                    ctx.shadowOffsetY = fontSize * 0.06;
                }

                // Outline
                const outlineW = (style.outlineWidth || 3) * (H / 1080);
                ctx.strokeStyle = style.outlineColor || '#000000';
                ctx.lineWidth = outlineW;
                ctx.lineJoin = 'round';
                ctx.miterLimit = 2;

                for (let i = 0; i < lines.length; i++) {
                    const ly = startY + slideOffset + i * lineHeight;
                    let lineText = lines[i];

                    // Typewriter animasyonu
                    if (anim === 'typewriter') {
                        const totalChars = lines.reduce((s, l) => s + l.length, 0);
                        const charsSoFar = lines.slice(0, i).reduce((s, l) => s + l.length, 0);
                        const visibleChars = Math.floor(clipT * totalChars * 1.2);
                        const lineVisible = Math.max(0, visibleChars - charsSoFar);
                        lineText = lineText.substring(0, lineVisible);
                    }

                    ctx.strokeText(lineText, W / 2, ly);
                }

                // Gölgeyi kapat ana metin için (çift gölge olmasın)
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                // Ana metin
                ctx.fillStyle = style.color || '#FFFFFF';
                for (let i = 0; i < lines.length; i++) {
                    const ly = startY + slideOffset + i * lineHeight;
                    let lineText = lines[i];
                    if (anim === 'typewriter') {
                        const totalChars = lines.reduce((s, l) => s + l.length, 0);
                        const charsSoFar = lines.slice(0, i).reduce((s, l) => s + l.length, 0);
                        const visibleChars = Math.floor(clipT * totalChars * 1.2);
                        lineText = lineText.substring(0, Math.max(0, visibleChars - charsSoFar));
                    }
                    ctx.fillText(lineText, W / 2, ly);
                }

                ctx.restore();
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                break;
            }
        }
    },

    _wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines.length ? lines : [''];
    },

    _renderTransition(ctx, prevClip, currentClip, progress, W, H, time) {
        // progress: 0.0 (geçiş başı) -> 1.0 (geçiş sonu)
        const type = prevClip.transition?.type || 'fade';

        switch (type) {
            case 'fade':
            case 'dissolve':
                ctx.globalAlpha = 1 - progress;
                this._drawImageClip(ctx, prevClip, time, W, H, 1 - progress);
                ctx.globalAlpha = 1;
                break;

            case 'slideleft':
                // Mevcut klip üzerine önce önceki + yeni çiz
                ctx.save();
                ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
                // Önceki klip sola kayar
                ctx.save();
                ctx.translate(-W * progress, 0);
                this._drawImageClip(ctx, prevClip, time, W, H, 1);
                ctx.restore();
                // Yeni klip sağdan girer
                ctx.save();
                ctx.translate(W * (1 - progress), 0);
                this._drawImageClip(ctx, currentClip, time, W, H, 1);
                ctx.restore();
                ctx.restore();
                break;

            case 'slideright':
                ctx.save();
                ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
                ctx.save();
                ctx.translate(W * progress, 0);
                this._drawImageClip(ctx, prevClip, time, W, H, 1);
                ctx.restore();
                ctx.save();
                ctx.translate(-W * (1 - progress), 0);
                this._drawImageClip(ctx, currentClip, time, W, H, 1);
                ctx.restore();
                ctx.restore();
                break;

            case 'slideup':
                ctx.save();
                ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
                ctx.save();
                ctx.translate(0, -H * progress);
                this._drawImageClip(ctx, prevClip, time, W, H, 1);
                ctx.restore();
                ctx.save();
                ctx.translate(0, H * (1 - progress));
                this._drawImageClip(ctx, currentClip, time, W, H, 1);
                ctx.restore();
                ctx.restore();
                break;

            case 'slidedown':
                ctx.save();
                ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
                ctx.save();
                ctx.translate(0, H * progress);
                this._drawImageClip(ctx, prevClip, time, W, H, 1);
                ctx.restore();
                ctx.save();
                ctx.translate(0, -H * (1 - progress));
                this._drawImageClip(ctx, currentClip, time, W, H, 1);
                ctx.restore();
                ctx.restore();
                break;

            case 'wipeleft':
                // Yeni klip soldan açılır (reveal)
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, W * progress, H);
                ctx.clip();
                this._drawImageClip(ctx, currentClip, time, W, H, 1);
                ctx.restore();
                // Kalan kısımda önceki klip
                ctx.save();
                ctx.beginPath();
                ctx.rect(W * progress, 0, W * (1 - progress), H);
                ctx.clip();
                this._drawImageClip(ctx, prevClip, time, W, H, 1);
                ctx.restore();
                break;

            case 'wiperight':
                ctx.save();
                ctx.beginPath();
                ctx.rect(W * (1 - progress), 0, W * progress, H);
                ctx.clip();
                this._drawImageClip(ctx, currentClip, time, W, H, 1);
                ctx.restore();
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, W * (1 - progress), H);
                ctx.clip();
                this._drawImageClip(ctx, prevClip, time, W, H, 1);
                ctx.restore();
                break;

            default:
                ctx.globalAlpha = 1 - progress;
                this._drawImageClip(ctx, prevClip, time, W, H, 1 - progress);
                ctx.globalAlpha = 1;
        }
    },

    // ─── Preset Filtre Tanımları ──────────────
    FILTER_PRESETS: {
        cinematic:  { brightness: -5, contrast: 15, saturation: -10, temperature: 8 },
        warm:       { brightness: 3, saturation: 5, temperature: 20 },
        cool:       { brightness: 0, saturation: -5, temperature: -20 },
        vintage:    { brightness: 5, contrast: -5, saturation: -25, temperature: 5 },
        bw:         { saturation: -50 },
        vivid:      { contrast: 8, saturation: 25 },
        muted:      { brightness: 5, saturation: -25 },
        dramatic:   { brightness: -10, contrast: 25, sharpen: 25 },
        dreamy:     { brightness: 8, saturation: -10, blur: 8 },
    },

    _buildFilterString(effects) {
        // Preset filtre uygula — önce preset değerleri al, sonra kullanıcı ayarlarıyla birleştir
        let preset = {};
        const filterName = effects.filter || 'none';
        if (filterName !== 'none' && this.FILTER_PRESETS[filterName]) {
            preset = this.FILTER_PRESETS[filterName];
        }

        const b = (effects.brightness || 0) + (preset.brightness || 0);
        const c = (effects.contrast || 0) + (preset.contrast || 0);
        const sat = (effects.saturation || 0) + (preset.saturation || 0);
        const temp = (effects.temperature || 0) + (preset.temperature || 0);
        const blur = (effects.blur || 0) + (preset.blur || 0);

        let filters = [];

        if (b !== 0) filters.push(`brightness(${1 + b / 100})`);
        if (c !== 0) filters.push(`contrast(${1 + c / 50})`);
        if (sat !== 0) filters.push(`saturate(${1 + sat / 50})`);
        if (temp !== 0) {
            // Sıcaklık: sepia + hue-rotate kombinasyonu
            if (temp > 0) {
                filters.push(`sepia(${temp / 200}) saturate(${1 + temp / 100})`);
            } else {
                filters.push(`saturate(${1 + temp / 200}) hue-rotate(${temp / 2}deg)`);
            }
        }
        if (blur > 0) filters.push(`blur(${blur / 10}px)`);
        // Not: sharpen, vignette, grain Canvas'ta desteklenmiyor — export'ta FFmpeg ile uygulanır

        return filters.length ? filters.join(' ') : 'none';
    },

    _drawEmptyState(ctx, W, H) {
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = '#2a2a3a';
        ctx.font = '14px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Görselleri zaman çizelgesine sürükleyin', W / 2, H / 2);
        ctx.textAlign = 'left';
    },

    // ─── Çoklu Ses Yönetimi ─────────────────
    _audioPlayers: {},  // clipId -> Audio

    _getAudioPlayer(clipId, source) {
        if (!this._audioPlayers[clipId]) {
            const audio = new Audio('/outputs/' + encodeURIComponent(source));
            audio.preload = 'auto';
            this._audioPlayers[clipId] = audio;
        }
        return this._audioPlayers[clipId];
    },

    // Ses kliplerini önceden yükle (play'e basmadan önce hazır olsun)
    preloadAudio() {
        const audioTrack = Editor.getTrackByType('audio');
        if (!audioTrack) return;
        for (const clip of audioTrack.clips) {
            this._getAudioPlayer(clip.id, clip.source);
        }
    },

    _syncAudioPlayback(time) {
        const audioTrack = Editor.getTrackByType('audio');
        if (!audioTrack) return;

        const activeIds = new Set();

        for (const clip of audioTrack.clips) {
            const clipEnd = clip.startTime + clip.duration;
            const isActive = time >= clip.startTime && time < clipEnd;

            if (isActive) {
                activeIds.add(clip.id);
                const player = this._getAudioPlayer(clip.id, clip.source);

                // Volume — fade dahil
                let vol = clip.volume || 1;
                const elapsed = time - clip.startTime;
                const remaining = clip.duration - elapsed;
                if (clip.fadeIn > 0 && elapsed < clip.fadeIn) {
                    vol *= elapsed / clip.fadeIn;
                }
                if (clip.fadeOut > 0 && remaining < clip.fadeOut) {
                    vol *= remaining / clip.fadeOut;
                }
                player.volume = Math.max(0, Math.min(1, vol));

                // Speed
                const spd = clip.speed || 1;
                if (player.playbackRate !== spd) {
                    player.playbackRate = spd;
                }

                const targetTime = elapsed * spd;
                if (player.paused) {
                    player.currentTime = targetTime;
                    player.play().catch(() => {});
                } else if (Math.abs(player.currentTime - targetTime) > 0.5) {
                    player.currentTime = targetTime;
                }
            }
        }

        // Aktif olmayan sesleri durdur
        for (const [id, player] of Object.entries(this._audioPlayers)) {
            if (!activeIds.has(id) && !player.paused) {
                player.pause();
            }
        }
    },

    _stopAllAudio() {
        for (const player of Object.values(this._audioPlayers)) {
            player.pause();
        }
    },

    // ─── Oynatma ─────────────────────────────
    play() {
        if (Editor.isPlaying) {
            this.pause();
            return;
        }

        const totalDur = Editor.getTotalDuration();
        if (Editor.playheadTime >= totalDur) {
            Editor.playheadTime = 0;
        }

        // Tüm ses kliplerini başlat
        this._syncAudioPlayback(Editor.playheadTime);

        Editor.isPlaying = true;
        this._playStartTime = performance.now();
        this._playStartPlayhead = Editor.playheadTime;
        this._tick();

        this._updatePlayButton();
    },

    pause() {
        Editor.isPlaying = false;
        this._stopAllAudio();
        if (Editor.animFrameId) {
            cancelAnimationFrame(Editor.animFrameId);
            Editor.animFrameId = null;
        }
        this._updatePlayButton();
    },

    stop() {
        this.pause();
        Editor.playheadTime = 0;
        this.render();
        EditorTimeline.render();
        EditorInit.updateTimeDisplay();
    },

    _tick() {
        if (!Editor.isPlaying) return;

        const elapsed = (performance.now() - this._playStartTime) / 1000;
        Editor.playheadTime = this._playStartPlayhead + elapsed;

        // Sesleri senkronize et
        this._syncAudioPlayback(Editor.playheadTime);

        const totalDur = Editor.getTotalDuration();
        if (Editor.playheadTime >= totalDur) {
            Editor.playheadTime = totalDur;
            this.pause();
            this.render();
            EditorTimeline.render();
            EditorInit.updateTimeDisplay();
            return;
        }

        this.render();
        EditorTimeline.render();
        EditorInit.updateTimeDisplay();

        Editor.animFrameId = requestAnimationFrame(() => this._tick());
    },

    _updatePlayButton() {
        const btn = document.getElementById('btn-play-pause');
        if (!btn) return;
        const icon = btn.querySelector('svg');
        if (Editor.isPlaying) {
            icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
        } else {
            icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
        }
    },

    seekTo(time) {
        const wasPlaying = Editor.isPlaying;
        if (wasPlaying) this.pause();
        Editor.playheadTime = Math.max(0, Math.min(time, Editor.getTotalDuration()));
        this.render();
        EditorTimeline.render();
        EditorInit.updateTimeDisplay();
        if (wasPlaying) this.play();
    },

    // Kare ileri/geri
    stepFrame(direction) {
        const fps = Editor.project.meta.fps || 25;
        const step = direction / fps;
        Editor.playheadTime = Math.max(0, Editor.playheadTime + step);
        this.render();
        EditorTimeline.render();
        EditorInit.updateTimeDisplay();
    },
};
