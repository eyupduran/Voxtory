/* ═══════════════════════════════════════════════════════════════
   Voxtory Video Editör — Core (Proje Modeli + State Yönetimi)
   ═══════════════════════════════════════════════════════════════ */

const Editor = {
    // ─── State ──────────────────────────────
    project: null,
    selectedClipId: null,
    selectedTrackId: null,
    playheadTime: 0,
    isPlaying: false,
    zoom: 50,
    scrollX: 0,
    scrollY: 0,
    undoStack: [],
    redoStack: [],
    isDirty: false,
    dragState: null,
    clipCounter: 0,
    imageCache: new Map(),
    audioElement: null,
    animFrameId: null,
    _previewAudio: null,     // medya panelinde ses dinleme

    // ─── Sabitler ───────────────────────────
    ZOOM_MIN: 10,
    ZOOM_MAX: 300,
    ZOOM_DEFAULT: 50,
    MAX_UNDO: 60,
    SNAP_THRESHOLD: 8,

    // ─── Proje Oluştur ─────────────────────
    createProject(baslik) {
        this.clipCounter = 0;
        this.project = {
            version: 1,
            meta: {
                baslik: baslik || 'Yeni Proje',
                cozunurluk: { w: 1920, h: 1080 },
                fps: 25,
                olusturma: new Date().toISOString(),
                guncelleme: new Date().toISOString(),
            },
            tracks: [
                { id: 'video-track', type: 'video', label: 'Görsel', clips: [] },
                { id: 'audio-track', type: 'audio', label: 'Ses', clips: [] },
                { id: 'subtitle-track', type: 'subtitle', label: 'Altyazı', clips: [] },
            ],
        };
        this.selectedClipId = null;
        this.selectedTrackId = null;
        this.playheadTime = 0;
        this.isPlaying = false;
        this.zoom = this.ZOOM_DEFAULT;
        this.scrollX = 0;
        this.undoStack = [];
        this.redoStack = [];
        this.isDirty = false;
        return this.project;
    },

    loadProject(json) {
        this.project = typeof json === 'string' ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
        this.clipCounter = 0;
        this.project.tracks.forEach(t => {
            t.clips.forEach(c => {
                const num = parseInt((c.id || '').split('-').pop()) || 0;
                if (num > this.clipCounter) this.clipCounter = num;
            });
        });
        this.selectedClipId = null;
        this.playheadTime = 0;
        this.undoStack = [];
        this.redoStack = [];
        this.isDirty = false;
    },

    // ─── Yardımcılar ───────────────────────
    _nextClipId() {
        this.clipCounter++;
        return 'clip-' + String(this.clipCounter).padStart(4, '0');
    },

    _pushUndo() {
        this.undoStack.push(JSON.stringify(this.project));
        if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
        this.redoStack = [];
        this.isDirty = true;
        this.project.meta.guncelleme = new Date().toISOString();
    },

    undo() {
        if (!this.undoStack.length) return;
        this.redoStack.push(JSON.stringify(this.project));
        this.project = JSON.parse(this.undoStack.pop());
        this.selectedClipId = null;
        this._notify('change');
    },

    redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push(JSON.stringify(this.project));
        this.project = JSON.parse(this.redoStack.pop());
        this.selectedClipId = null;
        this._notify('change');
    },

    // ─── Track İşlemleri ────────────────────
    getTrack(trackId) {
        return this.project.tracks.find(t => t.id === trackId);
    },

    getTrackByType(type) {
        return this.project.tracks.find(t => t.type === type);
    },

    getTracksByType(type) {
        return this.project.tracks.filter(t => t.type === type);
    },

    addTrack(type) {
        this._pushUndo();
        const count = this.project.tracks.filter(t => t.type === type).length + 1;
        const labels = { video: 'Görsel', overlay: 'Overlay', audio: 'Ses', subtitle: 'Altyazı' };
        const track = {
            id: `${type}-${count}-${Date.now()}`,
            type: type,
            label: `${labels[type] || type} ${count}`,
            clips: [],
        };
        // Track sıralama: video > overlay > text > audio > subtitle
        const order = { video: 0, overlay: 1, text: 2, audio: 3, subtitle: 4 };
        const insertIdx = this.project.tracks.findIndex(t => (order[t.type] || 99) > (order[type] || 99));
        if (insertIdx === -1) {
            this.project.tracks.push(track);
        } else {
            this.project.tracks.splice(insertIdx, 0, track);
        }
        this._notify('trackChange');
        this._notify('change');
        return track;
    },

    removeTrack(trackId) {
        const idx = this.project.tracks.findIndex(t => t.id === trackId);
        if (idx === -1) return;
        // Varsayılan track'ler silinemez
        const track = this.project.tracks[idx];
        const sameType = this.project.tracks.filter(t => t.type === track.type);
        if (sameType.length <= 1 && ['video', 'audio', 'subtitle'].includes(track.type)) return;
        this._pushUndo();
        this.project.tracks.splice(idx, 1);
        this._notify('trackChange');
        this._notify('change');
    },

    // ─── Klip İşlemleri ─────────────────────
    getClip(clipId) {
        for (const track of this.project.tracks) {
            const clip = track.clips.find(c => c.id === clipId);
            if (clip) return clip;
        }
        return null;
    },

    getClipTrack(clipId) {
        for (const track of this.project.tracks) {
            if (track.clips.find(c => c.id === clipId)) return track;
        }
        return null;
    },

    // ─── Çakışma Kontrolü ───────────────────
    _hasOverlap(track, startTime, duration, excludeClipId) {
        const endTime = startTime + duration;
        for (const clip of track.clips) {
            if (clip.id === excludeClipId) continue;
            const clipEnd = clip.startTime + clip.duration;
            if (startTime < clipEnd && endTime > clip.startTime) {
                return clip;
            }
        }
        return null;
    },

    _resolveOverlap(track, startTime, duration, excludeClipId) {
        // Çakışma varsa en yakın boş alanı bul
        let candidate = startTime;
        for (let attempt = 0; attempt < 100; attempt++) {
            const overlap = this._hasOverlap(track, candidate, duration, excludeClipId);
            if (!overlap) return candidate;
            // Çakışan klibin sonuna kaydır
            candidate = overlap.startTime + overlap.duration;
        }
        return candidate;
    },

    addImageClip(source, startTime, duration) {
        this._pushUndo();
        const track = this.getTrackByType('video');
        const dur = duration || 5.0;
        let start = startTime != null ? startTime : this._findNextAvailableTime(track);
        start = this._resolveOverlap(track, start, dur, null);

        const clip = {
            id: this._nextClipId(),
            type: 'image',
            source: source,
            startTime: start,
            duration: dur,
            effects: {
                kenBurns: { enabled: true, startScale: 1.0, endScale: 1.3, startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 },
                brightness: 0,
                contrast: 0,
                saturation: 0,
                temperature: 0,
                tint: 0,
                sharpen: 0,
                blur: 0,
                vignette: 0,
                grain: 0,
                filter: 'none',
                fitMode: 'fill',   // 'fill' | 'fit' | 'stretch'
            },
            transition: { type: 'none', duration: 0.5 },
        };
        track.clips.push(clip);
        this._sortClips(track);
        this._notify('change');
        return clip;
    },

    addTextClip(text, startTime, duration, style) {
        this._pushUndo();
        // Text track yoksa oluştur
        let track = this.getTracksByType('text')[0];
        if (!track) track = this.addTrack('text');
        const dur = duration || 4.0;
        let start = startTime != null ? startTime : this._findNextAvailableTime(track);
        start = this._resolveOverlap(track, start, dur, null);

        const clip = {
            id: this._nextClipId(),
            type: 'text',
            text: text || 'Metin',
            startTime: start,
            duration: dur,
            position: { x: 0.5, y: 0.3 },
            style: Object.assign({
                font: 'Segoe UI',
                size: 72,
                color: '#FFFFFF',
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: 20,
                borderRadius: 12,
                outlineColor: '#000000',
                outlineWidth: 0,
                bold: true,
                italic: false,
                align: 'center',
                letterSpacing: 2,
                lineHeight: 1.4,
                maxWidth: 0.8,
            }, style || {}),
            animation: {
                enter: 'fadeIn',
                exit: 'fadeOut',
                enterDuration: 0.5,
                exitDuration: 0.3,
            },
        };
        track.clips.push(clip);
        this._sortClips(track);
        this._notify('change');
        return clip;
    },

    // Metin şablonları
    TEXT_TEMPLATES: {
        baslik:    { text: 'BAŞLIK',         position: { x: 0.5, y: 0.4 }, style: { size: 80, bold: true, backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 }, animation: { enter: 'scaleIn', exit: 'fadeOut', enterDuration: 0.5, exitDuration: 0.3 } },
        altbaslik: { text: 'Alt Başlık',     position: { x: 0.5, y: 0.85 }, style: { size: 40, bold: false, backgroundColor: 'rgba(0,0,0,0.5)', padding: 12 }, animation: { enter: 'slideUp', exit: 'fadeOut', enterDuration: 0.4, exitDuration: 0.3 } },
        cta:       { text: 'ABONE OL',       position: { x: 0.5, y: 0.5 }, style: { size: 56, bold: true, color: '#FFFFFF', backgroundColor: 'rgba(239,68,68,0.9)', padding: 20, borderRadius: 16 }, animation: { enter: 'bounceIn', exit: 'fadeOut', enterDuration: 0.6, exitDuration: 0.3 } },
        alinti:    { text: '"Buraya alıntı yazın"', position: { x: 0.5, y: 0.45 }, style: { size: 48, italic: true, bold: false, backgroundColor: 'transparent', padding: 0, outlineWidth: 2, outlineColor: '#FFFFFF' }, animation: { enter: 'fadeIn', exit: 'fadeOut', enterDuration: 0.5, exitDuration: 0.3 } },
        bolum:     { text: 'Bölüm 1',        position: { x: 0.12, y: 0.08 }, style: { size: 36, bold: true, align: 'left', backgroundColor: 'rgba(99,102,241,0.85)', padding: 14, borderRadius: 8 }, animation: { enter: 'slideRight', exit: 'fadeOut', enterDuration: 0.4, exitDuration: 0.3 } },
        sayac:     { text: '01',              position: { x: 0.5, y: 0.4 }, style: { size: 120, bold: true, backgroundColor: 'transparent', padding: 0, outlineWidth: 3 }, animation: { enter: 'popIn', exit: 'fadeOut', enterDuration: 0.5, exitDuration: 0.3 } },
        lokasyon:  { text: 'İstanbul, Türkiye', position: { x: 0.15, y: 0.9 }, style: { size: 28, bold: false, align: 'left', backgroundColor: 'rgba(0,0,0,0.5)', padding: 10, borderRadius: 6 }, animation: { enter: 'slideUp', exit: 'fadeOut', enterDuration: 0.3, exitDuration: 0.3 } },
    },

    addTextFromTemplate(templateName) {
        const tmpl = this.TEXT_TEMPLATES[templateName];
        if (!tmpl) return null;
        const clip = this.addTextClip(tmpl.text, this.playheadTime, 4, tmpl.style);
        if (clip) {
            clip.position = { ...tmpl.position };
            clip.animation = { ...tmpl.animation };
        }
        return clip;
    },

    addOverlayClip(source, trackId, startTime, duration) {
        this._pushUndo();
        let track = trackId ? this.getTrack(trackId) : null;
        if (!track || track.type !== 'overlay') {
            track = this.getTracksByType('overlay')[0];
            if (!track) track = this.addTrack('overlay');
        }
        const dur = duration || 5.0;
        let start = startTime != null ? startTime : this._findNextAvailableTime(track);
        start = this._resolveOverlap(track, start, dur, null);

        const clip = {
            id: this._nextClipId(),
            type: 'overlay',
            source: source,
            startTime: start,
            duration: dur,
            position: { x: 0.7, y: 0.05 },   // sağ üst köşe varsayılan
            size: { w: 0.2, h: 0 },            // h=0 → aspect ratio korunur
            opacity: 1.0,
            effects: {
                brightness: 0,
                contrast: 0,
                saturation: 0,
                blur: 0,
                filter: 'none',
            },
        };
        track.clips.push(clip);
        this._sortClips(track);
        this._notify('change');
        return clip;
    },

    addAudioClip(source, startTime, duration) {
        this._pushUndo();
        const track = this.getTrackByType('audio');
        const dur = duration || 30;
        let start = startTime != null ? startTime : 0;
        start = this._resolveOverlap(track, start, dur, null);

        const clip = {
            id: this._nextClipId(),
            type: 'audio',
            source: source,
            startTime: start,
            duration: dur,
            trimStart: 0,
            trimEnd: dur,
            volume: 1.0,
            fadeIn: 0,
            fadeOut: 0.5,
            speed: 1.0,         // ses hızı (0.5-2.0)
            pitch: 0,           // pitch shift (-12 ile +12 arası yarım ton)
        };
        track.clips.push(clip);
        this._sortClips(track);
        this._notify('change');
        return clip;
    },

    addSubtitleClip(text, startTime, duration, style) {
        this._pushUndo();
        const track = this.getTrackByType('subtitle');
        const dur = duration || 3.0;
        let start = startTime != null ? startTime : this._findNextAvailableTime(track);
        start = this._resolveOverlap(track, start, dur, null);

        const clip = {
            id: this._nextClipId(),
            type: 'subtitle',
            text: text || '',
            startTime: start,
            duration: dur,
            style: Object.assign({
                font: 'Segoe UI',
                size: 52,
                color: '#FFFFFF',
                outlineColor: '#000000',
                outlineWidth: 3,
                bold: true,
                italic: false,
                position: 'bottom',
                shadow: true,
                shadowColor: '#000000',
                animation: 'none',     // 'none' | 'fadeIn' | 'typewriter' | 'slideUp'
            }, style || {}),
        };
        track.clips.push(clip);
        this._sortClips(track);
        this._notify('change');
        return clip;
    },

    removeClip(clipId) {
        this._pushUndo();
        for (const track of this.project.tracks) {
            const idx = track.clips.findIndex(c => c.id === clipId);
            if (idx !== -1) {
                track.clips.splice(idx, 1);
                break;
            }
        }
        if (this.selectedClipId === clipId) this.selectedClipId = null;
        this._notify('change');
    },

    moveClip(clipId, newStartTime) {
        this._pushUndo();
        const clip = this.getClip(clipId);
        if (!clip) return;
        const track = this.getClipTrack(clipId);
        if (!track) return;

        let start = Math.max(0, newStartTime);
        // Çakışma kontrolü
        const overlap = this._hasOverlap(track, start, clip.duration, clipId);
        if (overlap) {
            // Çakışıyorsa en yakın boş alana yerleştir
            const afterOverlap = overlap.startTime + overlap.duration;
            const beforeOverlap = overlap.startTime - clip.duration;
            // Hangisi daha yakınsa oraya koy
            if (beforeOverlap >= 0 && Math.abs(start - beforeOverlap) < Math.abs(start - afterOverlap)) {
                start = beforeOverlap;
            } else {
                start = afterOverlap;
            }
        }
        clip.startTime = Math.max(0, start);
        this._sortClips(track);
        this._notify('change');
    },

    resizeClip(clipId, newDuration, fromLeft) {
        this._pushUndo();
        const clip = this.getClip(clipId);
        if (!clip) return;
        const minDur = 0.5;
        if (fromLeft) {
            const endTime = clip.startTime + clip.duration;
            const newStart = endTime - Math.max(minDur, newDuration);
            clip.startTime = Math.max(0, newStart);
            clip.duration = endTime - clip.startTime;
        } else {
            clip.duration = Math.max(minDur, newDuration);
        }
        this._notify('change');
    },

    updateClip(clipId, props) {
        this._pushUndo();
        const clip = this.getClip(clipId);
        if (!clip) return;
        this._deepMerge(clip, props);
        this._notify('change');
    },

    _deepMerge(target, source) {
        for (const [key, value] of Object.entries(source)) {
            if (value !== null && typeof value === 'object' && !Array.isArray(value)
                && target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                this._deepMerge(target[key], value);
            } else {
                target[key] = value;
            }
        }
    },

    duplicateClip(clipId) {
        const clip = this.getClip(clipId);
        const track = this.getClipTrack(clipId);
        if (!clip || !track) return;
        this._pushUndo();
        const newClip = JSON.parse(JSON.stringify(clip));
        newClip.id = this._nextClipId();
        newClip.startTime = this._resolveOverlap(track, clip.startTime + clip.duration, clip.duration, null);
        track.clips.push(newClip);
        this._sortClips(track);
        this._notify('change');
        return newClip;
    },

    // ─── Sorgular ───────────────────────────
    getClipAtTime(trackId, time) {
        const track = this.getTrack(trackId);
        if (!track) return null;
        return track.clips.find(c => time >= c.startTime && time < c.startTime + c.duration) || null;
    },

    getVisibleClips(trackId, timeStart, timeEnd) {
        const track = this.getTrack(trackId);
        if (!track) return [];
        return track.clips.filter(c =>
            (c.startTime + c.duration > timeStart) && (c.startTime < timeEnd)
        );
    },

    getTotalDuration() {
        let max = 0;
        for (const track of this.project.tracks) {
            for (const clip of track.clips) {
                const end = clip.startTime + clip.duration;
                if (end > max) max = end;
            }
        }
        return max || 10;
    },

    _findNextAvailableTime(track) {
        if (!track.clips.length) return 0;
        let maxEnd = 0;
        for (const clip of track.clips) {
            const end = clip.startTime + clip.duration;
            if (end > maxEnd) maxEnd = end;
        }
        return maxEnd;
    },

    _sortClips(track) {
        track.clips.sort((a, b) => a.startTime - b.startTime);
    },

    // ─── Snap ───────────────────────────────
    snapTime(time, excludeClipId) {
        const threshold = this.SNAP_THRESHOLD / this.zoom;
        let best = time;
        let snapped = false;
        let bestDist = threshold;

        const targets = [0, this.playheadTime];
        for (const track of this.project.tracks) {
            for (const clip of track.clips) {
                if (clip.id === excludeClipId) continue;
                targets.push(clip.startTime);
                targets.push(clip.startTime + clip.duration);
            }
        }

        for (const t of targets) {
            const dist = Math.abs(time - t);
            if (dist < bestDist) {
                best = t;
                bestDist = dist;
                snapped = true;
            }
        }

        return { time: best, snapped };
    },

    // ─── Zaman Formatı ──────────────────────
    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    },

    // ─── Görsel Cache ───────────────────────
    loadImage(source) {
        if (this.imageCache.has(source)) {
            return Promise.resolve(this.imageCache.get(source));
        }
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.imageCache.set(source, img);
                if (this.imageCache.size > 60) {
                    const first = this.imageCache.keys().next().value;
                    this.imageCache.delete(first);
                }
                resolve(img);
            };
            img.onerror = reject;
            img.src = '/images/' + encodeURIComponent(source);
        });
    },

    // ─── Ses Önizleme ──────────────────────
    previewAudio(source) {
        if (!this._previewAudio) this._previewAudio = new Audio();
        const audio = this._previewAudio;
        const src = '/outputs/' + encodeURIComponent(source);
        if (!audio.paused && audio.src.includes(encodeURIComponent(source))) {
            audio.pause();
            return false;
        }
        audio.src = src;
        audio.play().catch(() => {});
        return true;
    },

    stopPreviewAudio() {
        if (this._previewAudio && !this._previewAudio.paused) {
            this._previewAudio.pause();
        }
    },

    // ─── Event Sistemi ──────────────────────
    _listeners: {},

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    },

    off(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    },

    _notify(event, data) {
        if (this._listeners[event]) {
            this._listeners[event].forEach(cb => cb(data));
        }
    },

    toJSON() {
        return JSON.stringify(this.project, null, 2);
    },
};
