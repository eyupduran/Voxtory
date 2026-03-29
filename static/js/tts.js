/* ─── Ses Profilleri ──────────────────────────── */
let sesProfilData = {};

async function profilleriYukle() {
    try {
        const res = await fetch('/api/ses-profilleri');
        sesProfilData = await res.json();
        const select = document.getElementById('ses-profil');
        select.innerHTML = '';
        for (const [id, profil] of Object.entries(sesProfilData)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = profil.ad;
            select.appendChild(opt);
        }
        profilAciklamaGuncelle();
    } catch (e) {}
}

document.getElementById('ses-profil').addEventListener('change', profilAciklamaGuncelle);

function profilAciklamaGuncelle() {
    const id = document.getElementById('ses-profil').value;
    const profil = sesProfilData[id];
    if (profil) {
        document.getElementById('profil-aciklama').textContent = profil.aciklama;
    }
}

async function sesOnizleme() {
    const id = document.getElementById('ses-profil').value;
    const btn = document.getElementById('btn-onizleme');
    btn.disabled = true;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;animation:spin 0.8s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Yükleniyor';

    try {
        const audio = document.getElementById('onizleme-audio');
        audio.src = '/api/ses-onizleme/' + id + '?t=' + Date.now();
        audio.style.display = 'block';
        audio.style.width = '100%';
        audio.style.height = '36px';
        audio.style.marginTop = '8px';
        await audio.play();
    } catch (e) {
        toast('Önizleme yüklenemedi.', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg> Önizle';
}

profilleriYukle();

/* ─── Karakter Sayacı ─────────────────────────── */
const metinInput = document.getElementById('ses-metin');
const charCount = document.getElementById('char-count');
metinInput.addEventListener('input', () => {
    charCount.textContent = metinInput.value.length.toLocaleString('tr-TR');
});

/* ─── Ses Üret ───────────────────────────────── */
async function sesUret() {
    const metin = document.getElementById('ses-metin').value.trim();
    const baslik = document.getElementById('ses-baslik').value.trim();
    const profil = document.getElementById('ses-profil').value;

    if (!metin) { toast('Lütfen bir metin gir.', 'error'); return; }

    const btn = document.getElementById('btn-ses-uret');
    btn.disabled = true;
    document.getElementById('ses-progress').classList.add('active');

    try {
        const res = await fetch('/api/ses-uret', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metin, baslik, profil }),
        });
        const data = await res.json();

        if (data.hata) {
            toast(data.hata, 'error');
            btn.disabled = false;
            document.getElementById('ses-progress').classList.remove('active');
            return;
        }

        isDurumTakip(data.is_id, {
            onProgress(d) {
                document.getElementById('progress-bar').style.width = d.ilerleme + '%';
                document.getElementById('progress-mesaj').textContent = d.mesaj;
                document.getElementById('progress-yuzde').textContent = d.ilerleme + '%';
            },
            onComplete(d) {
                btn.disabled = false;
                toast('Ses üretimi tamamlandı!', 'success');
                if (d.dosya) {
                    const player = document.getElementById('audio-player');
                    const audio = document.getElementById('audio-element');
                    const label = document.getElementById('audio-label');
                    audio.src = '/outputs/' + d.dosya;
                    label.textContent = d.dosya;
                    player.classList.add('active');
                }
                sesKayitlariniYukle();
                setTimeout(() => document.getElementById('ses-progress').classList.remove('active'), 2000);
            },
            onError(d) {
                btn.disabled = false;
                toast(d.mesaj, 'error');
                setTimeout(() => document.getElementById('ses-progress').classList.remove('active'), 2000);
            },
        });
    } catch (e) {
        toast('Sunucu hatası.', 'error');
        btn.disabled = false;
        document.getElementById('ses-progress').classList.remove('active');
    }
}

/* ─── Ses Kayıtları ──────────────────────────── */
async function sesKayitlariniYukle(hedefId) {
    hedefId = hedefId || 'ses-listesi';
    try {
        const res = await fetch('/api/ses-kaydiler');
        const dosyalar = await res.json();
        const container = document.getElementById(hedefId);

        if (dosyalar.length === 0) {
            container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><p>Henüz ses dosyası üretilmedi.</p></div>`;
            return;
        }

        container.innerHTML = '<ul class="file-list">' + dosyalar.map(d => `
            <li class="file-item">
                <div class="file-icon audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
                <div class="file-info"><div class="file-name">${d.ad}</div><div class="file-meta">${d.boyut_mb} MB &middot; ${d.tarih}</div></div>
                <div class="file-actions">
                    <button class="btn-icon" title="Dinle" onclick="sesCal('${d.ad}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
                    <button class="btn-icon" title="İndir" onclick="sesIndir('${d.ad}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                    <button class="btn-icon" title="Sil" onclick="sesSil('${d.ad}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
            </li>`).join('') + '</ul>';
    } catch (e) {}
}

function sesCal(dosya) {
    const player = document.getElementById('audio-player');
    const audio = document.getElementById('audio-element');
    const label = document.getElementById('audio-label');
    audio.src = '/outputs/' + dosya;
    label.textContent = dosya;
    player.classList.add('active');
    audio.play();
}

async function sesIndir(dosya) {
    try {
        const res = await fetch('/api/ses-indir/' + dosya);
        const data = await res.json();
        if (data.yol) {
            indirmeBildirimi(data.dosya, data.yol);
        } else {
            toast(data.hata || 'Hata', 'error');
        }
    } catch (e) { toast('İndirme hatası.', 'error'); }
}

async function sesSil(dosya) {
    const evet = await onayla(dosya);
    if (!evet) return;
    await fetch('/api/ses-sil/' + dosya, { method: 'DELETE' });
    sesKayitlariniYukle();
    toast('Dosya silindi!', 'success');
}

function metniTemizle() {
    document.getElementById('ses-metin').value = '';
    document.getElementById('ses-baslik').value = '';
    document.getElementById('char-count').textContent = '0';
}
