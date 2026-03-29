/* ─── Navigasyon ──────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const page = item.dataset.page;
        if (!page) return;

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + page).classList.add('active');

        // Editör sayfasında full-width layout
        const main = document.querySelector('.main');
        const app = document.querySelector('.app');
        if (page === 'editor') {
            main.classList.add('editor-mode');
            if (typeof editorInit === 'function' && !window._editorInitDone) {
                editorInit();
                window._editorInitDone = true;
            }
            if (typeof EditorTimeline !== 'undefined') EditorTimeline.resize();
            if (typeof EditorPreview !== 'undefined') EditorPreview.render();
        } else {
            main.classList.remove('editor-mode');
            if (app) app.classList.remove('editor-mode-active');
        }

        if (page === 'arsiv') {
            sesKayitlariniYukle('arsiv-ses-listesi');
            arsivVideolariYukle();
        }
    });
});

/* ─── Bildirim (Notify) ──────────────────────── */
const _notifyIcons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

const _notifyTitles = {
    success: 'Tamamland\u0131',
    error: 'Hata',
    warning: 'Uyar\u0131',
    info: 'Bilgi',
};

let _notifyTimer = null;

function _showNotify(overlay) {
    overlay.classList.add('active');
}

function _hideNotify() {
    const overlay = document.getElementById('notify-overlay');
    overlay.classList.remove('active');
    if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
}

function toast(mesaj, tip) {
    tip = tip || 'info';
    const overlay = document.getElementById('notify-overlay');
    const card = document.getElementById('notify-card');

    card.innerHTML = `
        <div class="notify-icon ${tip}">${_notifyIcons[tip] || _notifyIcons.info}</div>
        <div class="notify-title">${_notifyTitles[tip] || 'Bilgi'}</div>
        <div class="notify-message">${mesaj}</div>
        <div class="notify-actions">
            <button class="btn btn-primary btn-sm" onclick="_hideNotify()">Tamam</button>
        </div>
        <div class="notify-brand">Voxtory</div>
    `;

    _showNotify(overlay);
    _notifyTimer = setTimeout(_hideNotify, 3500);
}

/* ─── Sistem Durumu ──────────────────────────── */
async function sistemDurumunuKontrolEt() {
    try {
        const res = await fetch('/api/durum');
        const data = await res.json();
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');

        if (data.hazir) {
            dot.className = 'status-dot green';
            text.textContent = 'Sistem hazır';
        } else {
            dot.className = 'status-dot red';
            text.textContent = 'Eksik bileşen var';
        }

    } catch (e) {
        document.getElementById('status-dot').className = 'status-dot red';
        document.getElementById('status-text').textContent = 'Bağlantı hatası';
    }
}

/* ─── İş Durumu Takibi (ortak) ───────────────── */
function isDurumTakip(isId, callbacks) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch('/api/is-durumu/' + isId);
            const data = await res.json();

            if (callbacks.onProgress) callbacks.onProgress(data);

            if (data.durum === 'tamamlandi') {
                clearInterval(interval);
                if (callbacks.onComplete) callbacks.onComplete(data);
            }
            if (data.durum === 'hata') {
                clearInterval(interval);
                if (callbacks.onError) callbacks.onError(data);
            }
        } catch (e) {
            clearInterval(interval);
            if (callbacks.onError) callbacks.onError({ mesaj: 'Bağlantı hatası' });
        }
    }, callbacks.pollInterval || 800);

    return interval;
}

/* ─── İndirme Bildirimi ─────────────────────── */
function indirmeBildirimi(dosyaAdi, yol) {
    const overlay = document.getElementById('notify-overlay');
    const card = document.getElementById('notify-card');
    const yolEscaped = yol.replace(/\\/g, '\\\\');

    card.innerHTML = `
        <div class="notify-icon success">${_notifyIcons.success}</div>
        <div class="notify-title">\u0130ndirme Tamamland\u0131</div>
        <div class="notify-message">
            Dosya ba\u015far\u0131yla indirildi.<br>
            <span class="confirm-filename">${dosyaAdi}</span>
        </div>
        <div class="notify-actions">
            <button class="btn btn-primary btn-sm" onclick="klasordeGoster('${yolEscaped}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Klas\u00f6rde G\u00f6ster
            </button>
            <button class="btn btn-secondary btn-sm" onclick="_hideNotify()">Kapat</button>
        </div>
        <div class="notify-brand">Voxtory</div>
    `;

    _showNotify(overlay);
}

async function klasordeGoster(yol) {
    try {
        await fetch('/api/klasorde-goster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yol }),
        });
        _hideNotify();
    } catch (e) {
        toast('Klas\u00f6r a\u00e7\u0131lamad\u0131.', 'error');
    }
}

/* ─── Onay Dialogu ────────────────────────── */
function onayla(dosyaAdi) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('notify-overlay');
        const card = document.getElementById('notify-card');

        card.innerHTML = `
            <div class="confirm-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
            </div>
            <div class="notify-title">Dosya Silinecek</div>
            <div class="notify-message">
                Bu dosyay\u0131 silmek istedi\u011finize emin misiniz?<br>
                <span class="confirm-filename">${dosyaAdi}</span>
            </div>
            <div class="notify-actions">
                <button class="btn btn-danger btn-sm" id="confirm-yes">Evet, Sil</button>
                <button class="btn btn-secondary btn-sm" id="confirm-no">Vazge\u00e7</button>
            </div>
            <div class="notify-brand">Voxtory</div>
        `;

        document.getElementById('confirm-yes').onclick = () => { _hideNotify(); resolve(true); };
        document.getElementById('confirm-no').onclick = () => { _hideNotify(); resolve(false); };
        _showNotify(overlay);
    });
}

/* ─── Video Player ──────────────────────────── */
function videoOynat(dosyaAdi) {
    const overlay = document.getElementById('video-player-overlay');
    const video = document.getElementById('video-player');
    const title = document.getElementById('video-player-title');
    if (!overlay || !video) return;

    title.textContent = dosyaAdi;
    video.src = '/videos/' + encodeURIComponent(dosyaAdi);
    overlay.classList.add('active');
    video.play().catch(() => {});
}

function videoPlayerKapat() {
    const overlay = document.getElementById('video-player-overlay');
    const video = document.getElementById('video-player');
    if (video) { video.pause(); video.src = ''; }
    if (overlay) overlay.classList.remove('active');
}

// Player kapama butonları
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('video-player-close')?.addEventListener('click', videoPlayerKapat);
    document.getElementById('video-player-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) videoPlayerKapat();
    });
});

/* ─── Arşiv Video Listesi ───────────────────── */
async function arsivVideolariYukle() {
    const container = document.getElementById('arsiv-video-listesi');
    if (!container) return;
    try {
        const res = await fetch('/api/video-listele');
        const videolar = await res.json();
        if (!videolar.length) {
            container.innerHTML = '<div class="empty-state"><p>Henüz video yok.</p></div>';
            return;
        }
        container.innerHTML = '<ul class="file-list">' + videolar.map(v => `
            <li class="file-item">
                <div class="file-icon video">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                </div>
                <div class="file-info">
                    <div class="file-name">${v.ad}</div>
                    <div class="file-meta">${v.boyut_mb} MB — ${v.tarih}</div>
                </div>
                <div class="file-actions">
                    <button class="btn-icon" title="İzle" onclick="videoOynat('${v.ad}')" style="color:var(--accent);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="btn-icon" title="İndir" onclick="arsivVideoIndir('${v.ad}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button class="btn-icon" title="Sil" onclick="arsivVideoSil('${v.ad}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </li>
        `).join('') + '</ul>';
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><p>Videolar yüklenemedi.</p></div>';
    }
}

async function arsivVideoIndir(dosyaAdi) {
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

async function arsivVideoSil(dosyaAdi) {
    const onay = await onayla(dosyaAdi);
    if (!onay) return;
    try {
        await fetch('/api/video-sil/' + encodeURIComponent(dosyaAdi), { method: 'DELETE' });
        toast('Video silindi.', 'success');
        arsivVideolariYukle();
    } catch (e) {
        toast('Silme hatası.', 'error');
    }
}

/* ─── Splash Screen ──────────────────────────── */
async function splashKapat() {
    try {
        await sistemDurumunuKontrolEt();
        await sesKayitlariniYukle();
    } catch (e) {}
    const splash = document.getElementById('splash');
    if (splash) splash.classList.add('hidden');
}

splashKapat();
