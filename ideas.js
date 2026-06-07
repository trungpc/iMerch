let products = [];
let excludedIndexes = new Set();
let extractedPrompts = []; // { audience, styleName, prompt }

const DEFAULT_SYSTEM_PROMPT = `You are a creative t-shirt design strategist. I will show you thumbnails of top-selling t-shirt products. Analyze their visual styles, themes, color palettes, typography, and niches. Then generate 5 original new design ideas that could succeed in this market.`;

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

    // Pre-fill system prompt textarea
    document.getElementById('customPrompt').value = DEFAULT_SYSTEM_PROMPT;

    // Reset prompt button
    document.getElementById('resetPromptBtn').addEventListener('click', () => {
        document.getElementById('customPrompt').value = DEFAULT_SYSTEM_PROMPT;
    });

    document.getElementById('generateIdeasBtn').addEventListener('click', generateIdeas);
    setupImageSettingsPanel();
    setupGenerateImagesButton();
    setupDownloadButton();

    // Nếu đã có analysis từ lần trước
    if (data.analysis) renderIdeas(data.analysis);
});

// ===== THUMBNAILS =====

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

// ===== GENERATE IDEAS =====

async function generateIdeas() {
    const activeProducts = products.filter((_, i) => !excludedIndexes.has(i));
    if (activeProducts.length === 0) { alert('Chưa có sản phẩm nào được chọn.'); return; }

    const btn = document.getElementById('generateIdeasBtn');
    btn.classList.add('loading');
    btn.disabled = true;

    const output = document.getElementById('ideasOutput');
    output.innerHTML = `<div class="loading-state">AI đang phân tích ${activeProducts.length} thiết kế<span class="loading-dots"></span></div>`;

    // Hide prompts/settings/gallery while generating new ideas
    document.getElementById('extractedPrompts').classList.remove('visible');
    document.getElementById('ideogramConfig').classList.remove('visible');
    document.getElementById('generatedGallery').classList.remove('visible');

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

// ===== RENDER IDEAS =====

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
            <div class="idea-card-left">
                <div class="idea-title">${i + 1}. ${escHtml(idea.title || '')}</div>
                <div class="idea-meta">
                    ${idea.audience ? `<span class="idea-tag tag-audience">👥 ${escHtml(idea.audience)}</span>` : ''}
                    ${idea.style ? `<span class="idea-tag tag-style">🎨 ${escHtml(idea.style)}</span>` : ''}
                </div>
                ${idea.description ? `<div class="idea-description">${escHtml(idea.description)}</div>` : ''}
            </div>
            <div class="idea-card-right">
                ${idea.prompt ? `<div class="idea-prompt">
                    <div class="idea-prompt-label">Image Prompt</div>
                    ${escHtml(idea.prompt)}
                </div>` : ''}
                ${idea.prompt ? `<button class="copy-prompt-btn" data-prompt="${escAttr(idea.prompt)}">📋 Copy Prompt</button>` : ''}
            </div>
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

    // Populate extracted prompts for image generation
    const promptItems = data.ideas
        .filter(idea => idea.prompt)
        .map(idea => ({
            audience: idea.title || 'Idea',
            styleName: idea.style || '',
            prompt: idea.prompt
        }));

    if (promptItems.length > 0) {
        populatePromptList(promptItems);
        document.getElementById('extractedPrompts').classList.add('visible');
        document.getElementById('ideogramConfig').classList.add('visible');
    }
}

// ===== PROMPT LIST =====

function populatePromptList(items) {
    extractedPrompts = items;
    const list = document.getElementById('promptList');
    list.innerHTML = '';

    items.forEach((item, i) => {
        const li = document.createElement('li');
        li.className = 'prompt-item checked';
        li.innerHTML = `
            <input type="checkbox" checked data-index="${i}">
            <div class="prompt-item-content">
                <div class="prompt-item-meta">
                    <span class="prompt-item-audience">${escHtml(item.audience)}</span>
                    ${item.styleName ? `<span class="prompt-item-style">${escHtml(item.styleName)}</span>` : ''}
                </div>
                <div class="prompt-item-text">${escHtml(item.prompt)}</div>
            </div>
        `;
        const cb = li.querySelector('input[type="checkbox"]');
        cb.addEventListener('change', () => {
            li.classList.toggle('checked', cb.checked);
            updateSelectedInfo();
        });
        li.addEventListener('click', (e) => {
            if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        });
        list.appendChild(li);
    });

    document.getElementById('extractedCount').textContent = items.length;
    updateSelectedInfo();
}

function updateSelectedInfo() {
    const checkboxes = document.querySelectorAll('#promptList input[type="checkbox"]');
    const total = checkboxes.length;
    const selected = Array.from(checkboxes).filter(cb => cb.checked).length;
    document.getElementById('selectedInfo').textContent = `${selected} / ${total} đã chọn`;
}

function setupSelectAllButton() {
    const btn = document.getElementById('selectAllBtn');
    btn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#promptList input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => {
            cb.checked = !allChecked;
            cb.closest('.prompt-item').classList.toggle('checked', !allChecked);
        });
        btn.textContent = allChecked ? '☑️ Chọn tất cả' : '☐ Bỏ chọn tất cả';
        updateSelectedInfo();
    });
}

// ===== IMAGE SETTINGS PANEL =====

function setupImageSettingsPanel() {
    setupSelectAllButton();

    // Provider toggle
    document.querySelectorAll('#imageProviderToggle .provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#imageProviderToggle .provider-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const provider = btn.dataset.provider;
            document.getElementById('ideogramConfigFields').style.display = provider === 'ideogram' ? '' : 'none';
            document.getElementById('gptImageConfigFields').style.display = provider === 'gpt-image-2' ? '' : 'none';
        });
    });

    // GPT API type toggle
    document.getElementById('cfgGptApiType').addEventListener('change', function() {
        const isResponses = this.value === 'responses_api';
        document.getElementById('gptImageApiFields').style.display = isResponses ? 'none' : '';
        document.getElementById('gptResponsesApiFields').style.display = isResponses ? '' : 'none';
    });
}

function getImageConfig() {
    const activeProvider = document.querySelector('#imageProviderToggle .provider-btn.active')?.dataset.provider || 'ideogram';
    if (activeProvider === 'gpt-image-2') {
        const apiType = document.getElementById('cfgGptApiType').value;
        if (apiType === 'responses_api') {
            return {
                provider: 'gpt-image-2',
                apiType: 'responses_api',
                model: document.getElementById('cfgRespModel').value,
                quality: document.getElementById('cfgRespQuality').value,
                size: document.getElementById('cfgRespSize').value,
                background: document.getElementById('cfgRespBackground').value
            };
        }
        return {
            provider: 'gpt-image-2',
            apiType: 'image_api',
            model: document.getElementById('cfgGptModel').value,
            quality: document.getElementById('cfgGptQuality').value,
            size: document.getElementById('cfgGptSize').value,
            moderation: document.getElementById('cfgGptModeration').value,
            n: parseInt(document.getElementById('cfgGptNum').value) || 1,
            background: document.getElementById('cfgGptBackground').value,
            removeBg: document.getElementById('cfgGptRemoveBg').value
        };
    }
    return {
        provider: 'ideogram',
        rendering_speed: document.getElementById('cfgSpeed').value,
        aspect_ratio: document.getElementById('cfgAspect').value,
        magic_prompt: document.getElementById('cfgMagic').value,
        num_images: parseInt(document.getElementById('cfgNum').value) || 1,
        negative_prompt: document.getElementById('cfgNegative').value.trim()
    };
}

// ===== GENERATE IMAGES =====

function setupGenerateImagesButton() {
    document.getElementById('generateImagesBtn').addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#promptList input[type="checkbox"]:checked');
        const selectedPrompts = Array.from(checkboxes).map(cb => {
            const idx = parseInt(cb.dataset.index);
            return extractedPrompts[idx];
        }).filter(Boolean);

        if (selectedPrompts.length === 0) {
            alert('Vui lòng chọn ít nhất 1 prompt để generate ảnh.');
            return;
        }

        const config = getImageConfig();
        startImageGeneration(selectedPrompts, config);
    });
}

async function startImageGeneration(prompts, config) {
    const generateBtn = document.getElementById('generateImagesBtn');
    generateBtn.classList.add('loading');
    generateBtn.disabled = true;

    const gallery = document.getElementById('generatedGallery');
    const grid = document.getElementById('galleryGrid');
    const progress = document.getElementById('galleryProgress');

    document.getElementById('downloadSelectedBtn').style.display = 'none';
    const selectAllImagesBtn = document.getElementById('selectAllImagesBtn');
    selectAllImagesBtn.style.display = 'none';
    selectAllImagesBtn.textContent = '☑️ Chọn tất cả';

    grid.innerHTML = '';
    gallery.classList.add('visible');

    const jobs = prompts.map((item, index) => {
        const jobId = 'ideas_img_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substring(2, 6);
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.id = `gallery-item-${jobId}`;
        div.innerHTML = `
            <div class="gallery-item-image">
                <div class="item-loading">
                    <div class="item-spinner"></div>
                    <div class="item-loading-text">Đang chờ...</div>
                </div>
            </div>
            <div class="gallery-item-info">
                <div class="gallery-item-meta">
                    <span class="prompt-item-audience">${escHtml(item.audience)}</span>
                    ${item.styleName ? `<span class="prompt-item-style">${escHtml(item.styleName)}</span>` : ''}
                </div>
                <div class="gallery-item-prompt">${escHtml(item.prompt)}</div>
            </div>
        `;
        grid.appendChild(div);
        return { jobId, prompt: item.prompt, audience: item.audience, styleName: item.styleName, element: div, index };
    });

    gallery.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const chunkSize = config.provider === 'gpt-image-2' ? 5 : 10;
    let completed = 0;
    progress.textContent = `0 / ${jobs.length} hoàn thành — đang xử lý tối đa ${chunkSize} yêu cầu cùng lúc...`;

    for (let i = 0; i < jobs.length; i += chunkSize) {
        const chunk = jobs.slice(i, i + chunkSize);
        const promises = chunk.map(async (job) => {
            const loadingText = job.element.querySelector('.item-loading-text');
            if (loadingText) loadingText.textContent = 'Đang tạo ảnh...';

            await chrome.storage.local.set({
                [job.jobId]: {
                    status: 'pending',
                    imageUrl: null,
                    prompt: job.prompt,
                    audience: job.audience,
                    styleName: job.styleName,
                    error: null
                }
            });

            const action = config.provider === 'gpt-image-2' ? 'generateGptImage2' : 'generateIdeogramImage';
            chrome.runtime.sendMessage({
                action,
                jobId: job.jobId,
                prompt: job.prompt,
                audience: job.audience,
                styleName: job.styleName,
                config
            }, () => {
                if (chrome.runtime.lastError) console.error('Message error:', chrome.runtime.lastError.message);
            });

            await waitForJob(job.jobId, job.element);
            completed++;
            progress.textContent = `${completed} / ${jobs.length} hoàn thành...`;
        });
        await Promise.all(promises);
    }

    progress.textContent = `${completed} / ${jobs.length} hoàn thành ✅`;
    generateBtn.classList.remove('loading');
    generateBtn.disabled = false;
}

function waitForJob(jobId, element) {
    return new Promise((resolve) => {
        let timeoutId;
        const interval = setInterval(() => {
            chrome.storage.local.get([jobId], (result) => {
                const data = result[jobId];
                if (!data) {
                    clearInterval(interval);
                    clearTimeout(timeoutId);
                    updateGalleryItem(element, null, 'Dữ liệu bị mất');
                    resolve();
                    return;
                }
                if (data.status === 'done') {
                    clearInterval(interval);
                    clearTimeout(timeoutId);
                    updateGalleryItem(element, data, null);
                    resolve();
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    clearTimeout(timeoutId);
                    updateGalleryItem(element, data, data.error);
                    resolve();
                } else if (data.status === 'removing_bg') {
                    const loadingText = element.querySelector('.item-loading-text');
                    if (loadingText) loadingText.textContent = 'Đang xóa nền...';
                }
            });
        }, 1500);

        timeoutId = setTimeout(() => {
            clearInterval(interval);
            updateGalleryItem(element, null, 'Timeout — quá 12 phút');
            resolve();
        }, 720000);
    });
}

function updateGalleryItem(element, data, error) {
    if (error) {
        const imageDiv = element.querySelector('.gallery-item-image');
        if (imageDiv) imageDiv.innerHTML = `<div class="gallery-item-error">⚠️ ${escHtml(error)}</div>`;
    } else if (data && data.imageUrls && data.imageUrls.length > 0) {
        element.style.display = 'none';

        data.imageUrls.forEach((url, index) => {
            const subId = (data.jobId || `img_${Date.now()}`) + '_' + index;
            if (document.getElementById(`gallery-item-${subId}`)) return;

            const newDiv = document.createElement('div');
            newDiv.className = 'gallery-item';
            newDiv.id = `gallery-item-${subId}`;
            newDiv.innerHTML = `
                <div class="gallery-item-image preview-black">
                    <input type="checkbox" class="gallery-checkbox" data-url="${url}" data-color="" checked style="position: absolute; top: 10px; left: 10px; z-index: 10; width: 20px; height: 20px; cursor: pointer; accent-color: #a78bfa;">
                    <a href="${url}" target="_blank"><img src="${url}" alt="Generated design" loading="lazy"></a>
                </div>
                <div class="gallery-item-info">
                    <div class="gallery-item-meta">
                        <span class="prompt-item-audience">${escHtml(data.audience || 'General')}</span>
                        ${data.styleName ? `<span class="prompt-item-style">${escHtml(data.styleName)}</span>` : ''}
                    </div>
                    <div class="gallery-item-prompt">${escHtml(data.prompt || '')}</div>
                    <div class="gallery-item-actions">
                        <a href="${url}" target="_blank">🔗 Mở ảnh</a>
                        <button class="individual-download-btn" data-url="${url}" style="margin-left: auto; background: none; border: 1px solid rgba(167,139,250,0.3); color: #a78bfa; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">💾 Tải về</button>
                    </div>
                    <div class="color-selector">
                        <span class="color-label">Nền:</span>
                        <div class="color-dot dot-black active" data-color="" data-class="preview-black" title="Đen"></div>
                        <div class="color-dot dot-grey" data-color="(grey)" data-class="preview-grey" title="Xám"></div>
                        <div class="color-dot dot-white" data-color="(light)" data-class="preview-white" title="Trắng"></div>
                        <label class="youth-toggle">
                            <input type="checkbox" class="youth-checkbox" style="width: 14px; height: 14px; accent-color: #a78bfa; cursor: pointer;">
                            <span>Youth</span>
                        </label>
                    </div>
                </div>
            `;

            const previewContainer = newDiv.querySelector('.gallery-item-image');
            const checkbox = newDiv.querySelector('.gallery-checkbox');
            const dots = newDiv.querySelectorAll('.color-dot');
            dots.forEach(dot => {
                dot.addEventListener('click', () => {
                    dots.forEach(d => d.classList.remove('active'));
                    dot.classList.add('active');
                    previewContainer.className = 'gallery-item-image ' + dot.dataset.class;
                    checkbox.dataset.color = dot.dataset.color;
                });
            });

            newDiv.querySelector('.individual-download-btn').addEventListener('click', (e) => {
                const btn = e.currentTarget;
                const imgUrl = btn.dataset.url;
                const activeColor = newDiv.querySelector('.color-dot.active').dataset.color;
                const colorSuffix = activeColor ? ` ${activeColor}` : '';
                const isYouth = newDiv.querySelector('.youth-checkbox')?.checked || false;
                downloadImages([{ url: imgUrl, colorSuffix, isYouth }]);
            });

            element.parentNode.insertBefore(newDiv, element);
        });

        // Show bulk buttons
        document.getElementById('downloadSelectedBtn').style.display = 'flex';
        const selectAllImagesBtn = document.getElementById('selectAllImagesBtn');
        selectAllImagesBtn.style.display = 'inline-block';
        const allChecked = Array.from(document.querySelectorAll('.gallery-checkbox')).every(cb => cb.checked);
        selectAllImagesBtn.textContent = allChecked ? '☐ Bỏ chọn tất cả' : '☑️ Chọn tất cả';
    }
}

// ===== DOWNLOAD =====

function setupDownloadButton() {
    const downloadBtn = document.getElementById('downloadSelectedBtn');
    const selectAllImagesBtn = document.getElementById('selectAllImagesBtn');

    downloadBtn.addEventListener('click', () => {
        const checked = document.querySelectorAll('.gallery-checkbox:checked');
        if (checked.length === 0) { alert('Vui lòng chọn ít nhất 1 ảnh để tải.'); return; }
        const selectedItems = Array.from(checked).map(cb => ({
            url: cb.dataset.url,
            colorSuffix: cb.dataset.color || '',
            isYouth: cb.closest('.gallery-item')?.querySelector('.youth-checkbox')?.checked || false
        }));
        downloadImages(selectedItems);
    });

    selectAllImagesBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.gallery-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => { cb.checked = !allChecked; });
        selectAllImagesBtn.textContent = allChecked ? '☑️ Chọn tất cả' : '☐ Bỏ chọn tất cả';
    });
}

async function downloadImages(items) {
    const prefix = document.getElementById('cfgFilename').value.trim();
    for (let i = 0; i < items.length; i++) {
        const { url, colorSuffix, isYouth } = items[i];
        try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const ext = blob.type.includes('png') ? 'png' : 'jpg';
            const youthTag = isYouth ? ' Youth' : '';
            const filename = prefix
                ? `${prefix}${youthTag}${colorSuffix} ${i + 1}.${ext}`
                : `design${youthTag}${colorSuffix} ${i + 1}.${ext}`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
            if (i < items.length - 1) await new Promise(r => setTimeout(r, 300));
        } catch (e) {
            console.error('Download error:', e);
        }
    }
}

// ===== UTILS =====

function showError(msg) {
    document.getElementById('ideasOutput').innerHTML =
        `<div class="empty-state"><div class="emoji">⚠️</div><div>${msg}</div></div>`;
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
    return String(str).replace(/"/g, '&quot;');
}
