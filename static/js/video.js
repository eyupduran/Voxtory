/* ─── Video Üretimi ──────────────────────────── */
let videoSeciliGorseller = [];
let videoTumGorseller = [];

async function sestenAltyazi() {
    const ses = document.getElementById('video-ses').value;
    if (!ses) { toast('Önce bir ses dosyası seç.', 'error'); return; }

    const btn = document.getElementById('btn-transkript');
    btn.disabled = true;
    btn.textContent = 'Analiz ediliyor...';

    try {
        const res = await fetch('/api/ses-transkript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ses }),
        });
        const data = await res.json();

        if (data.hata) {
            toast(data.hata, 'error');
            btn.disabled = false;
            btn.textContent = 'Sesten Otomatik Oluştur';
            return;
        }

        isDurumTakip(data.is_id, {
            pollInterval: 1500,
            onProgress(d) { btn.textContent = d.mesaj; },
            onComplete(d) {
                document.getElementById('video-altyazi').value = d.metin || '';
                toast('Altyazı oluşturuldu!', 'success');
                btn.disabled = false;
                btn.textContent = 'Sesten Otomatik Oluştur';
            },
            onError(d) {
                toast(d.mesaj, 'error');
                btn.disabled = false;
                btn.textContent = 'Sesten Otomatik Oluştur';
            },
        });
    } catch (e) {
        toast('Sunucu hatası.', 'error');
        btn.disabled = false;
        btn.textContent = 'Sesten Otomatik Oluştur';
    }
}

async function gorselSilVideo(dosya) {
    await fetch('/api/gorsel-sil/' + dosya, { method: 'DELETE' });
    videoSeciliGorseller = videoSeciliGorseller.filter(g => g !== dosya);
    videoKaynaklariYukle();
}

async function gorselYukle(input) {
    if (!input.files.length) return;
    const formData = new FormData();
    for (const f of input.files) formData.append('dosyalar', f);

    try {
        const res = await fetch('/api/gorsel-yukle', { method: 'POST', body: formData });
        const data = await res.json();
        toast(data.mesaj, 'success');
        videoKaynaklariYukle();
    } catch (e) { toast('Yükleme hatası.', 'error'); }
    input.value = '';
}

async function videoKaynaklariYukle() {
    try {
        const res = await fetch('/api/video-kaynaklar');
        const data = await res.json();

        const sesSelect = document.getElementById('video-ses');
        sesSelect.innerHTML = '<option value="">-- Ses dosyası seç --</option>';
        data.sesler.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            sesSelect.appendChild(opt);
        });

        videoTumGorseller = data.images;
        videoSeciliGorseller = [];
        const grid = document.getElementById('video-gorsel-grid');

        if (data.images.length === 0) {
            grid.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Henüz görsel yok.</div>';
            return;
        }

        grid.innerHTML = data.images.map(g => `
            <div class="video-thumb-wrap" title="${g}">
                <img src="/images/${g}" alt="${g}" onclick="videoGorselSec(this.parentElement, '${g}')">
                <span class="thumb-order"></span>
                <span class="thumb-delete" onclick="event.stopPropagation();gorselSilVideo('${g}')" title="Sil">x</span>
            </div>
        `).join('');

        videoSayacGuncelle();
    } catch (e) {}
}

function videoGorselSec(el, dosya) {
    if (el.classList.contains('selected')) {
        el.classList.remove('selected');
        videoSeciliGorseller = videoSeciliGorseller.filter(g => g !== dosya);
    } else {
        el.classList.add('selected');
        videoSeciliGorseller.push(dosya);
    }
    document.querySelectorAll('.video-thumb-wrap.selected').forEach((wrap, i) => {
        wrap.querySelector('.thumb-order').textContent = i + 1;
    });
    videoSayacGuncelle();
}

function videoTumunuSec() {
    videoSeciliGorseller = [...videoTumGorseller];
    document.querySelectorAll('.video-thumb-wrap').forEach((wrap, i) => {
        wrap.classList.add('selected');
        wrap.querySelector('.thumb-order').textContent = i + 1;
    });
    videoSayacGuncelle();
}

function videoSecimTemizle() {
    videoSeciliGorseller = [];
    document.querySelectorAll('.video-thumb-wrap').forEach(wrap => wrap.classList.remove('selected'));
    videoSayacGuncelle();
}

function videoSayacGuncelle() {
    document.getElementById('video-gorsel-sayac').textContent = videoSeciliGorseller.length + ' görsel seçildi';
}

async function videoUret() {
    const ses = document.getElementById('video-ses').value;
    const baslik = document.getElementById('video-baslik').value.trim();
    const gorsel_suresi = document.getElementById('video-sure-modu').value;
    const efekt = document.getElementById('video-efekt').value;
    const altyazi = document.getElementById('video-altyazi').value.trim();

    const altyazi_stil = {
        font: document.getElementById('altyazi-font').value,
        boyut: document.getElementById('altyazi-boyut').value,
        konum: document.getElementById('altyazi-konum').value,
        kenar: document.getElementById('altyazi-kenar').value,
        bold: document.getElementById('altyazi-bold').checked,
    };

    if (videoSeciliGorseller.length === 0) { toast('En az bir görsel seç.', 'error'); return; }
    if (!ses) { toast('Bir ses dosyası seç.', 'error'); return; }

    const btn = document.getElementById('btn-video-uret');
    btn.disabled = true;
    document.getElementById('video-progress').classList.add('active');

    try {
        const res = await fetch('/api/video-uret', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: videoSeciliGorseller, ses, baslik, gorsel_suresi, efekt, altyazi, altyazi_stil }),
        });
        const data = await res.json();

        if (data.hata) {
            toast(data.hata, 'error');
            btn.disabled = false;
            document.getElementById('video-progress').classList.remove('active');
            return;
        }

        isDurumTakip(data.is_id, {
            pollInterval: 1500,
            onProgress(d) {
                document.getElementById('video-progress-bar').style.width = d.ilerleme + '%';
                document.getElementById('video-progress-mesaj').textContent = d.mesaj;
                document.getElementById('video-progress-yuzde').textContent = d.ilerleme + '%';
            },
            onComplete(d) {
                btn.disabled = false;
                toast('Video oluşturuldu!', 'success');
                videoListeYukle();
                setTimeout(() => document.getElementById('video-progress').classList.remove('active'), 2000);
            },
            onError(d) {
                btn.disabled = false;
                toast(d.mesaj, 'error');
                setTimeout(() => document.getElementById('video-progress').classList.remove('active'), 2000);
            },
        });
    } catch (e) {
        toast('Sunucu hatası.', 'error');
        btn.disabled = false;
        document.getElementById('video-progress').classList.remove('active');
    }
}

async function videoListeYukle() {
    try {
        const res = await fetch('/api/video-listele');
        const dosyalar = await res.json();
        const container = document.getElementById('video-listesi');

        if (dosyalar.length === 0) {
            container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg><p>Henüz video üretilmedi.</p></div>`;
            return;
        }

        container.innerHTML = '<ul class="file-list">' + dosyalar.map(d => `
            <li class="file-item">
                <div class="file-icon video"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></div>
                <div class="file-info"><div class="file-name">${d.ad}</div><div class="file-meta">${d.boyut_mb} MB · ${d.tarih}</div></div>
                <div class="file-actions">
                    <button class="btn-icon" title="İndir" onclick="videoIndir('${d.ad}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                    <button class="btn-icon" title="Sil" onclick="videoSil('${d.ad}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
            </li>`).join('') + '</ul>';
    } catch (e) {}
}

async function videoIndir(dosya) {
    try {
        const res = await fetch('/api/video-indir/' + dosya);
        const data = await res.json();
        if (data.yol) {
            indirmeBildirimi(data.dosya, data.yol);
        } else {
            toast(data.hata || 'Hata', 'error');
        }
    } catch (e) { toast('İndirme hatası.', 'error'); }
}

async function videoSil(dosya) {
    const evet = await onayla(dosya);
    if (!evet) return;
    await fetch('/api/video-sil/' + dosya, { method: 'DELETE' });
    videoListeYukle();
    toast('Video silindi!', 'success');
}

videoKaynaklariYukle();
videoListeYukle();
