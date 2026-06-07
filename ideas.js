let products = [];
let excludedIndexes = new Set();

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);
    const ideasId = params.get('id');
    if (!ideasId) { showError('Missing session ID.'); return; }

    const data = await new Promise(resolve => chrome.storage.local.get(ideasId, r => resolve(r[ideasId])));
    if (!data) { showError('Session data not found.'); return; }

    products = data.products || [];
    document.getElementById('pageSubtitle').textContent = data.pageTitle || 'Amazon Listing';
    document.getElementById('thumbCount').textContent = `${products.length} sản phẩm`;

    renderThumbnails();

    document.getElementById('generateBtn').addEventListener('click', generateIdeas);

    // Nếu đã có analysis từ lần trước
    if (data.analysis) renderIdeas(data.analysis);
});

function renderThumbnails() {
    const grid = document.getElementById('thumbnailGrid');
    grid.innerHTML = '';
    products.forEach((p, i) => {
        const item = document.createElement('div');
        item.className = 'thumb-item';
        item.title = `${p.title}\nRank: #${p.rank.toLocaleString()}`;
        item.innerHTML = `
            <img src="${p.thumbnail}" alt="" loading="lazy" onerror="this.closest('.thumb-item').style.display='none'">
            <div class="rank-badge">#${p.rank.toLocaleString()}</div>
            <div class="exclude-overlay">🚫</div>
        `;
        item.addEventListener('click', () => {
            if (excludedIndexes.has(i)) {
                excludedIndexes.delete(i);
                item.classList.remove('excluded');
            } else {
                excludedIndexes.add(i);
                item.classList.add('excluded');
            }
            updateThumbCount();
        });
        grid.appendChild(item);
    });
}

function updateThumbCount() {
    const active = products.length - excludedIndexes.size;
    document.getElementById('thumbCount').textContent = `${active} / ${products.length} sản phẩm`;
}

async function generateIdeas() {
    const activeProducts = products.filter((_, i) => !excludedIndexes.has(i));
    if (activeProducts.length === 0) { alert('Chưa có sản phẩm nào được chọn.'); return; }

    const btn = document.getElementById('generateBtn');
    btn.classList.add('loading');
    btn.disabled = true;

    const output = document.getElementById('ideasOutput');
    output.innerHTML = `<div class="loading-state">AI đang phân tích ${activeProducts.length} thiết kế<span class="loading-dots"></span></div>`;

    const params = new URLSearchParams(location.search);
    const ideasId = params.get('id');
    const customPrompt = document.getElementById('customPrompt').value.trim();

    try {
        const response = await new Promise(resolve =>
            chrome.runtime.sendMessage({ action: 'generateIdeas', ideasId, products: activeProducts, customPrompt }, resolve)
        );
        if (!response?.success) throw new Error(response?.message || 'Unknown error');
        renderIdeas(response.analysis);
    } catch (err) {
        output.innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><div>${err.message}</div></div>`;
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function renderIdeas(text) {
    const output = document.getElementById('ideasOutput');

    // Parse JSON
    let data = null;
    const tryParse = s => { try { return JSON.parse(s.trim()); } catch { return null; } };
    const stripped = text.trim().replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
    data = tryParse(stripped);
    if (!data) {
        const s = text.indexOf('{'), e = text.lastIndexOf('}');
        if (s !== -1 && e > s) data = tryParse(text.slice(s, e + 1));
    }

    if (!data || !Array.isArray(data.ideas)) {
        output.innerHTML = `<pre style="font-size:12px;color:#9ca3af;white-space:pre-wrap;">${text}</pre>`;
        return;
    }

    const badge = document.getElementById('ideasCount');
    badge.textContent = `${data.ideas.length} ý tưởng`;
    badge.style.display = '';

    let html = '';
    if (data.niche_analysis) {
        html += `<div class="niche-analysis">
            <div class="niche-label">🔍 Niche Analysis</div>
            ${escHtml(data.niche_analysis)}
        </div>`;
    }

    html += `<div class="ideas-grid">`;
    data.ideas.forEach((idea, i) => {
        html += `<div class="idea-card">
            <div class="idea-title">${i + 1}. ${escHtml(idea.title || '')}</div>
            <div class="idea-meta">
                ${idea.audience ? `<span class="idea-tag tag-audience">👥 ${escHtml(idea.audience)}</span>` : ''}
                ${idea.style ? `<span class="idea-tag tag-style">🎨 ${escHtml(idea.style)}</span>` : ''}
            </div>
            ${idea.description ? `<div class="idea-description">${escHtml(idea.description)}</div>` : ''}
            ${idea.prompt ? `<div class="idea-prompt">
                <div class="idea-prompt-label">Image Prompt</div>
                ${escHtml(idea.prompt)}
            </div>` : ''}
            ${idea.prompt ? `<button class="copy-prompt-btn" data-prompt="${escAttr(idea.prompt)}">📋 Copy Prompt</button>` : ''}
        </div>`;
    });
    html += '</div>';

    output.innerHTML = html;

    output.querySelectorAll('.copy-prompt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(btn.dataset.prompt).then(() => {
                btn.textContent = '✅ Copied!';
                setTimeout(() => { btn.textContent = '📋 Copy Prompt'; }, 2000);
            });
        });
    });
}

function showError(msg) {
    document.getElementById('ideasOutput').innerHTML =
        `<div class="empty-state"><div class="emoji">⚠️</div><div>${msg}</div></div>`;
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escAttr(str) {
    return String(str).replace(/"/g, '&quot;');
}
