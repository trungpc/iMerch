// Global state
let currentAnalysisId = null;
let currentImageUrl = null;
let currentAsin = "";
let currentTitle = "";
let extractedPrompts = []; // Stores all extracted prompt objects
let maxFilenameLimit = 60; // Default limit for warning
let currentDesignAnalysis = null; // Parsed JSON từ analysis (schema mới)

// Parse URL parameters to get stored analysis data
document.addEventListener('DOMContentLoaded', () => {
    // Set timestamp
    document.getElementById('timestamp').textContent = new Date().toLocaleString();

    // Get analysis ID from URL
    const params = new URLSearchParams(window.location.search);
    currentAnalysisId = params.get('id');

    // Load settings from sync storage
    chrome.storage.sync.get(["promptVN", "maxFilenameLength"], (result) => {
        maxFilenameLimit = result.maxFilenameLength || 60;
        updateFilenameCount(); // Update once we have the limit

        const defaultPrompt = `1. Phân tích nội dung thiết kế:
- Nếu có phần chữ thì ghi rõ nội dung phần chữ.
- Nếu có phần hình ảnh thì mô tả rõ điểm nhấn tạo cảm xúc.
- Liệt kê rõ các chi tiết quan trọng tạo nên cảm xúc cho người xem.
- Tổng kết trình bày thông điệp chính của thiết kế.

2. Đánh giá khả năng vi phạm bản quyền về nội dung thiết kế này ở thị trường Hoa Kỳ.

3. Phân khúc đối tượng khách hàng chính dành cho thiết kế này ở thị trường Hoa Kỳ theo nhân khẩu học là những ai? Với mỗi đối tượng khách hàng, hãy đưa ra phương án cải tiến về phong cách thiết kế phù hợp hơn mà vẫn giữ nguyên nội dung thiết kế gốc và dựa vào đó để tạo ra 3 prompt sử dụng ideogram để tạo thiết kế mới. Mỗi prompt phải:
- Mô tả chi tiết Layout (ưu tiên sự đơn giản, không sử dụng dạng thiết kế túi áo Small Chest).
- Nếu có chữ thì đặt trong "ngoặc kép", giữ nguyên phần nội dung chữ, không thêm hoặc bớt chữ nào.
- Mô tả chi tiết những điểm nhấn quan trọng tạo nên cảm xúc của thiết kế được phân tích ở bước 1.
- Áp dụng phong cách thiết kế cải tiến theo phân tích ở bước 3.
- Tuyệt đối không dùng tên thương hiệu/nhân vật có bản quyền.

Trả lời theo cấu trúc JSON (không markdown, không giải thích):
{
"content": "nội dung phân tích về nội dung ở bước 1",
"copyright": "nội dung phân tích về bản quyền ở bước 2",
"prompts":
[
  {
    "audience": "Men",
    "note": "mô tả phương án cải tiến",
    "styles": [
      {
        "name": "Vintage Comic Style",
        "prompt": "A vintage comic style t-shirt design featuring..."
      },
      {
        "name": "Minimalist Graphic",
        "prompt": "A minimalist graphic t-shirt design with..."
      }
    ]
  },
  {
    "audience": "Women",
    "note": "...",
    "styles": [...]
  }
]
}`;
        const promptVN = result.promptVN || defaultPrompt;
        document.getElementById('promptTextarea').value = promptVN;
    });

    if (!currentAnalysisId) {
        showError('No analysis ID provided.');
        return;
    }

    // Retrieve data from chrome.storage.local
    chrome.storage.local.get([currentAnalysisId], (result) => {
        const data = result[currentAnalysisId];
        if (!data) {
            showError('Analysis data not found. It may have expired.');
            return;
        }

        currentImageUrl = data.imageUrl;
        currentAsin = data.asin || "";
        currentTitle = data.title || "";

        // Tự động điền Download Filename - Xóa hậu tố "T-Shirt"
        let cleanTitle = currentTitle.replace(/\s*T-Shirt\s*$/i, "").trim();
        document.getElementById('cfgFilename').value = cleanTitle;
        updateFilenameCount();

        // Display metadata
        const asinEl = document.getElementById('asinDisplay');
        if (currentAsin) {
            asinEl.innerHTML = `<a href="https://www.amazon.com/dp/${currentAsin}" target="_blank" style="color: inherit; text-decoration: none; cursor: pointer;" title="Mở trang Amazon">${currentAsin}</a>`;
            const galleryAsinLink = document.getElementById('galleryAsinLink');
            if (galleryAsinLink) {
                galleryAsinLink.href = `https://www.amazon.com/dp/${currentAsin}`;
                galleryAsinLink.textContent = currentAsin;
                galleryAsinLink.style.display = 'inline-block';
            }
        } else {
            asinEl.textContent = "";
        }
        document.getElementById('titleDisplay').textContent = currentTitle || "No title available";

        // Display thumbnail
        const img = document.getElementById('thumbnailImage');
        img.src = data.imageUrl;
        img.alt = 'Product Thumbnail';
        document.getElementById('imageInfo').textContent = data.imageUrl;

        // Display analysis result if available
        if (data.analysis) {
            showAnalysis(data.analysis);
            // Restore generated jobs if they exist
            if (data.jobs && data.jobs.length > 0) {
                restoreGeneratedImages(data.jobs);
            }
        } else if (data.error) {
            showError(data.error);
        }
        // Otherwise: idle state - user will click Re-generate
    });

    // Setup Re-generate button
    setupRegenButton();

    // Setup Select All button
    setupSelectAllButton();

    // Setup Generate Images button
    setupGenerateButton();

    // Setup Download Selected Images button
    setupDownloadSelectedButton();

    // Setup Upload to Drive & Sheet button
    setupUploadDriveButton();

    // Setup Select All Youth button
    setupSelectAllYouthButton();

    // Setup Auto Check button
    setupAutoEvaluateButton();

    // Setup Image Provider Toggle
    setupImageProviderToggle();

    // Setup Filename counter and Title sync
    setupFilenameCounter();

    // Setup Manual Prompt Input
    setupManualPromptInput();
});

function setupRegenButton() {
    const regenBtn = document.getElementById('regenBtn');
    regenBtn.addEventListener('click', () => {
        const newPrompt = document.getElementById('promptTextarea').value.trim();
        if (!newPrompt) {
            alert('Vui lòng nhập prompt trước khi phân tích lại.');
            return;
        }
        if (!currentImageUrl) {
            alert('Không tìm thấy URL hình ảnh.');
            return;
        }

        // Set loading state on button
        regenBtn.classList.add('loading');
        regenBtn.disabled = true;

        // Show loading in analysis content
        const container = document.getElementById('analysisContent');
        container.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <div class="loading-text">Đang phân tích lại với prompt mới...</div>
            </div>
        `;

        // Hide copy button & extracted prompts during loading
        document.getElementById('copyBtn').style.display = 'none';
        document.getElementById('extractedPrompts').classList.remove('visible');

        // Generate new analysis ID
        const newAnalysisId = 'analysis_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        currentAnalysisId = newAnalysisId;

        // Update URL without reload
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('id', newAnalysisId);
        window.history.replaceState({}, '', newUrl);

        // Send regenerate request to background
        chrome.runtime.sendMessage({
            action: "regenerateAnalysis",
            analysisId: newAnalysisId,
            imageUrl: currentImageUrl,
            promptVN: newPrompt,
            asin: currentAsin,
            title: currentTitle
        }, () => {
            if (chrome.runtime.lastError) {
                showError('Lỗi kết nối: ' + chrome.runtime.lastError.message);
                regenBtn.classList.remove('loading');
                regenBtn.disabled = false;
                return;
            }
            // Poll for the result
            pollForResult(newAnalysisId, () => {
                regenBtn.classList.remove('loading');
                regenBtn.disabled = false;
            });
        });
    });
}

function setupSelectAllButton() {
    const selectAllBtn = document.getElementById('selectAllBtn');
    selectAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#promptList input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);

        checkboxes.forEach(cb => {
            cb.checked = !allChecked;
            const item = cb.closest('.prompt-item');
            if (!allChecked) {
                item.classList.add('checked');
            } else {
                item.classList.remove('checked');
            }
        });

        selectAllBtn.textContent = allChecked ? '☑️ Chọn tất cả' : '☐ Bỏ chọn tất cả';
        updateSelectedCount();
    });
}

function pollForResult(analysisId, onComplete) {
    const interval = setInterval(() => {
        chrome.storage.local.get([analysisId], (result) => {
            const data = result[analysisId];
            if (!data) {
                clearInterval(interval);
                showError('Analysis data lost.');
                if (onComplete) onComplete();
                return;
            }

            if (data.analysis) {
                clearInterval(interval);
                showAnalysis(data.analysis);
                if (onComplete) onComplete();
            } else if (data.error) {
                clearInterval(interval);
                showError(data.error);
                if (onComplete) onComplete();
            }
        });
    }, 1000);

    // Stop polling after 2 minutes
    setTimeout(() => {
        clearInterval(interval);
        if (onComplete) onComplete();
    }, 120000);
}

function showAnalysis(text) {
    const container = document.getElementById('analysisContent');

    // Thử parse JSON schema mới trước
    let parsed = null;
    const tryParseJson = (s) => { try { return JSON.parse(s.trim()); } catch (e) { return null; } };
    // 1. Strip code fence
    const stripped = text.trim().replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
    parsed = tryParseJson(stripped);
    // 2. Fallback: tìm JSON object {...} bất kỳ trong text (AI đôi khi thêm text trước/sau)
    if (!parsed) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end > start) parsed = tryParseJson(text.slice(start, end + 1));
    }

    if (parsed && parsed.content && Array.isArray(parsed.prompts)) {
        const flatStr = v => {
            if (!v) return '';
            if (typeof v === 'string') return v;
            if (Array.isArray(v)) return v.map(flatStr).filter(Boolean).join('\n\n');
            if (typeof v === 'object') return Object.values(v).map(flatStr).filter(Boolean).join('\n\n');
            return String(v);
        };
        parsed.content = flatStr(parsed.content);
        parsed.copyright = flatStr(parsed.copyright);
        parsed.audiences = flatStr(parsed.audiences);
        currentDesignAnalysis = parsed;
        renderAnalysisJSON(parsed, container);
    } else {
        currentDesignAnalysis = null;
        container.innerHTML = `<div class="analysis-content">${formatMarkdown(text)}</div>`;
    }

    // Update timestamp
    document.getElementById('timestamp').textContent = new Date().toLocaleString();

    // Show copy button
    const copyBtn = document.getElementById('copyBtn');
    copyBtn.style.display = 'flex';

    // Remove old listeners by cloning
    const newCopyBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);

    newCopyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
            newCopyBtn.classList.add('copied');
            newCopyBtn.innerHTML = '✅ Copied!';
            setTimeout(() => {
                newCopyBtn.classList.remove('copied');
                newCopyBtn.innerHTML = '📋 Copy';
            }, 2000);
        });
    });

    // Extract prompts from JSON response
    tryExtractPrompts(text);
}

function renderAnalysisJSON(data, container) {
    const toStr = v => {
        if (!v) return '';
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return v.map(toStr).filter(Boolean).join('\n\n');
        if (typeof v === 'object') return Object.values(v).map(toStr).filter(Boolean).join('\n\n');
        return String(v);
    };
    const section = (icon, title, text) => {
        const str = toStr(text);
        return str
            ? `<h3 style="margin:16px 0 8px; font-size:14px; color:#a78bfa;">${icon} ${title}</h3><div class="analysis-content">${formatMarkdown(str)}</div>`
            : '';
    };
    const audiencesText = Array.isArray(data.prompts)
        ? data.prompts.map(g => g.note ? `**${g.audience}**: ${g.note}` : '').filter(Boolean).join('\n\n')
        : '';
    container.innerHTML =
        section('🎨', 'Design Content Analysis', data.content) +
        section('⚖️', 'Copyright Evaluation', data.copyright) +
        section('👥', 'Audience Segmentation & Design Improvements', audiencesText);
}

function showError(message) {
    const container = document.getElementById('analysisContent');
    container.innerHTML = `
        <div class="error-state">
            <div class="error-icon">⚠️</div>
            <strong>${message}</strong>
            <p>Thử lại hoặc kiểm tra API key trong cài đặt.</p>
        </div>
    `;
}

// ==========================================
// Prompt Extraction
// ==========================================

function tryExtractPrompts(text) {
    extractedPrompts = [];

    let jsonData = null;

    const tryParse = (s) => {
        try { return JSON.parse(s.trim()); } catch (e) { return null; }
    };

    // 0. Schema mới: JSON object với field "prompts" (lowercase)
    const stripped0 = text.trim().replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
    let fullParsed = tryParse(stripped0);
    // Fallback: tìm JSON object {...} bất kỳ trong text
    if (!fullParsed) {
        const s = text.indexOf('{'), e = text.lastIndexOf('}');
        if (s !== -1 && e > s) fullParsed = tryParse(text.slice(s, e + 1));
    }
    if (fullParsed && fullParsed.content && Array.isArray(fullParsed.prompts)) {
        jsonData = fullParsed.prompts;
    }

    // 1. Direct parse (AI returned pure JSON array)
    if (!jsonData) jsonData = tryParse(text);

    // 2. Strip markdown code fences: ```json ... ```
    if (!jsonData) {
        const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
        jsonData = tryParse(stripped);
    }

    // 3. Tìm từ '[{' cuối cùng — JSON array luôn ở cuối response
    if (!jsonData) {
        let idx = text.lastIndexOf('[{');
        while (idx !== -1) {
            jsonData = tryParse(text.substring(idx));
            if (jsonData) break;
            idx = text.lastIndexOf('[{', idx - 1);
        }
    }

    // 4. Fallback: bracket-matching để tìm JSON array hợp lệ đầu tiên từ cuối
    if (!jsonData) {
        for (let i = text.length - 1; i >= 0; i--) {
            if (text[i] !== ']') continue;
            // Tìm [ mở tương ứng
            let depth = 0, inStr = false;
            for (let j = i; j >= 0; j--) {
                const c = text[j];
                if (!inStr) {
                    if (c === ']') depth++;
                    else if (c === '[') { depth--; if (depth === 0) { jsonData = tryParse(text.substring(j, i + 1)); break; } }
                }
                if (c === '"' && (j === 0 || text[j-1] !== '\\')) inStr = !inStr;
            }
            if (jsonData) break;
        }
    }

    if (Array.isArray(jsonData)) {
        // Parse structured JSON: [{audience, styles: [{name, prompt}]}]
        jsonData.forEach(group => {
            const audience = group.audience || 'General';
            if (Array.isArray(group.styles)) {
                group.styles.forEach(style => {
                    if (style.prompt) {
                        extractedPrompts.push({
                            audience: audience,
                            styleName: style.name || 'Unknown Style',
                            prompt: style.prompt
                        });
                    }
                });
            }
        });
    }

    if (extractedPrompts.length > 0) {
        renderExtractedPrompts();
    } else {
        document.getElementById('extractedPrompts').classList.remove('visible');
    }
}

function renderExtractedPrompts() {
    const section = document.getElementById('extractedPrompts');
    const list = document.getElementById('promptList');
    const countBadge = document.getElementById('extractedCount');

    // Clear previous
    list.innerHTML = '';
    countBadge.textContent = extractedPrompts.length;

    extractedPrompts.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'prompt-item';
        li.innerHTML = `
            <input type="checkbox" id="prompt-cb-${index}" data-index="${index}">
            <div class="prompt-item-content">
                <div class="prompt-item-meta">
                    <span class="prompt-item-audience">${escapeHtml(item.audience)}</span>
                    <span class="prompt-item-style">${escapeHtml(item.styleName)}</span>
                </div>
                <div class="prompt-item-text">${escapeHtml(item.prompt)}</div>
            </div>
        `;

        // Click on entire row toggles checkbox
        li.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return; // let checkbox handle itself
            const cb = li.querySelector('input[type="checkbox"]');
            cb.checked = !cb.checked;
            li.classList.toggle('checked', cb.checked);
            updateSelectedCount();
        });

        // Checkbox change
        const cb = li.querySelector('input[type="checkbox"]');
        cb.addEventListener('change', () => {
            li.classList.toggle('checked', cb.checked);
            updateSelectedCount();
        });

        list.appendChild(li);
    });

    // Reset select all button
    document.getElementById('selectAllBtn').textContent = '☑️ Chọn tất cả';
    updateSelectedCount();

    // Show section + config panel
    section.classList.add('visible');
    document.getElementById('ideogramConfig').classList.add('visible');
}

// ==========================================
// Manual Prompt Addition
// ==========================================

function setupManualPromptInput() {
    const input = document.getElementById('manualPromptInput');
    const addBtn = document.getElementById('addManualPromptBtn');

    if (!input || !addBtn) return;

    const handleAdd = () => {
        const text = input.value.trim();
        if (!text) return;

        // Add to global array
        extractedPrompts.push({
            audience: 'Manual',
            styleName: 'User choice',
            prompt: text,
            isManual: true // flag to distinguish if needed
        });

        // Clear input
        input.value = '';
        input.focus();

        // Render everything
        renderExtractedPrompts();

        // Automatically check the newly added prompt
        // Since it's the last one in the list
        const lastIndex = extractedPrompts.length - 1;
        const lastCheckbox = document.getElementById(`prompt-cb-${lastIndex}`);
        if (lastCheckbox) {
            lastCheckbox.checked = true;
            const li = lastCheckbox.closest('.prompt-item');
            if (li) li.classList.add('checked');
            updateSelectedCount();
        }
    };

    addBtn.addEventListener('click', handleAdd);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    });
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('#promptList input[type="checkbox"]');
    const checked = document.querySelectorAll('#promptList input[type="checkbox"]:checked');
    document.getElementById('selectedInfo').textContent = `${checked.length} / ${checkboxes.length} đã chọn`;

    // Update select all button text
    const selectAllBtn = document.getElementById('selectAllBtn');
    if (checkboxes.length > 0 && checked.length === checkboxes.length) {
        selectAllBtn.textContent = '☐ Bỏ chọn tất cả';
    } else {
        selectAllBtn.textContent = '☑️ Chọn tất cả';
    }
}

function getSelectedPrompts() {
    const selected = [];
    const checkboxes = document.querySelectorAll('#promptList input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
        const index = parseInt(cb.dataset.index);
        if (extractedPrompts[index]) {
            selected.push(extractedPrompts[index]);
        }
    });
    return selected;
}

// ==========================================
// Ideogram Image Generation
// ==========================================

function setupGenerateButton() {
    const generateBtn = document.getElementById('generateBtn');
    generateBtn.addEventListener('click', () => {
        const selected = getSelectedPrompts();
        if (selected.length === 0) {
            alert('Vui lòng chọn ít nhất 1 prompt để tạo ảnh.');
            return;
        }
        const config = getImageGenConfig();
        startImageGeneration(selected, config);
    });
}

let currentImageProvider = 'ideogram';
let currentGptApiType = 'image_api';

function setupImageProviderToggle() {
    const toggle = document.getElementById('imageProviderToggle');
    if (!toggle) return;
    toggle.querySelectorAll('.provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            toggle.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentImageProvider = btn.dataset.provider;
            document.getElementById('ideogramConfigFields').style.display = currentImageProvider === 'ideogram' ? 'grid' : 'none';
            document.getElementById('gptImageConfigFields').style.display = currentImageProvider === 'gpt-image-2' ? 'block' : 'none';
        });
    });

    const apiTypeSelect = document.getElementById('cfgGptApiType');
    if (!apiTypeSelect) return;
    apiTypeSelect.addEventListener('change', () => {
        currentGptApiType = apiTypeSelect.value;
        document.getElementById('gptImageApiFields').style.display = currentGptApiType === 'image_api' ? 'grid' : 'none';
        document.getElementById('gptResponsesApiFields').style.display = currentGptApiType === 'responses_api' ? 'grid' : 'none';
    });
}

function getImageGenConfig() {
    if (currentImageProvider === 'gpt-image-2') {
        currentGptApiType = document.getElementById('cfgGptApiType').value;
        if (currentGptApiType === 'responses_api') {
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

async function startImageGeneration(prompts, config) {
    const generateBtn = document.getElementById('generateBtn');
    generateBtn.classList.add('loading');
    generateBtn.disabled = true;

    const gallery = document.getElementById('generatedGallery');
    const grid = document.getElementById('galleryGrid');
    const progress = document.getElementById('galleryProgress');

    // Hide bulk buttons
    document.getElementById('downloadSelectedBtn').style.display = 'none';
    document.getElementById('selectAllImagesBtn').style.display = 'none';
    document.getElementById('selectAllImagesBtn').textContent = '☑️ Chọn tất cả';
    const _youthAllBtn = document.getElementById('selectAllYouthBtn');
    if (_youthAllBtn) { _youthAllBtn.style.display = 'none'; _youthAllBtn.textContent = '☑️ Chọn tất cả Youth'; }
    const _autoEvalBtn = document.getElementById('autoEvaluateBtn');
    if (_autoEvalBtn) _autoEvalBtn.style.display = 'none';

    // Clear previous results
    grid.innerHTML = '';
    gallery.classList.add('visible');

    // Create gallery items with loading state
    const jobs = prompts.map((item, index) => {
        const jobId = 'ideogram_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substring(2, 6);
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
                    <span class="prompt-item-audience">${escapeHtml(item.audience)}</span>
                    <span class="prompt-item-style">${escapeHtml(item.styleName)}</span>
                </div>
                <div class="gallery-item-prompt">${escapeHtml(item.prompt)}</div>
            </div>
        `;
        grid.appendChild(div);
        return { jobId, prompt: item.prompt, audience: item.audience, styleName: item.styleName, element: div, index };
    });

    // Save job IDs to current analysis data for state recovery
    chrome.storage.local.get([currentAnalysisId], (res) => {
        let data = res[currentAnalysisId];
        if (data) {
            data.jobs = data.jobs || [];
            const newJobIds = jobs.map(j => j.jobId);
            data.jobs = [...new Set([...data.jobs, ...newJobIds])];
            chrome.storage.local.set({ [currentAnalysisId]: data });
        }
    });

    // Scroll to gallery
    gallery.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // GPT Image API rate limit: 5 images/min — chunk = 5 để dùng tối đa giới hạn
    const chunkSize = config.provider === 'gpt-image-2' ? 5 : 10;
    let completed = 0;
    progress.textContent = `0 / ${jobs.length} hoàn thành — đang xử lý tối đa ${chunkSize} yêu cầu cùng lúc...`;
    for (let i = 0; i < jobs.length; i += chunkSize) {
        const chunk = jobs.slice(i, i + chunkSize);

        const promises = chunk.map(async (job) => {
            // Update this item's loading text
            const loadingText = job.element.querySelector('.item-loading-text');
            if (loadingText) loadingText.textContent = 'Đang tạo ảnh...';

            // Store initial state
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

            // Send to background
            const action = config.provider === 'gpt-image-2' ? 'generateGptImage2' : 'generateIdeogramImage';
            chrome.runtime.sendMessage({
                action,
                jobId: job.jobId,
                prompt: job.prompt,
                audience: job.audience,
                styleName: job.styleName,
                config
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error("Message error:", chrome.runtime.lastError.message);
                }
            });

            // Poll for this job's result
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

        // 12 phút — đủ cho GPT Image với retry 429 (mỗi lần chờ 65s)
        timeoutId = setTimeout(() => {
            clearInterval(interval);
            updateGalleryItem(element, null, 'Timeout — quá 12 phút (Chưa nhận được phản hồi từ server)');
            resolve();
        }, 720000);
    });
}

function updateGalleryItem(element, data, error) {
    if (error) {
        const imageDiv = element.querySelector('.gallery-item-image');
        if (imageDiv) imageDiv.innerHTML = `<div class="gallery-item-error">⚠️ ${escapeHtml(error)}</div>`;
    } else if (data && data.imageUrls && data.imageUrls.length > 0) {
        element.style.display = 'none'; // Hide the original placeholder element
        
        data.imageUrls.forEach((url, index) => {
            const subId = (data.jobId || `img_${Date.now()}`) + '_' + index;
            // Prevent duplicates
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
                        <span class="prompt-item-audience">${escapeHtml(data.audience || 'General')}</span>
                        <span class="prompt-item-style">${escapeHtml(data.styleName || 'Unknown')}</span>
                    </div>
                    <div class="gallery-item-prompt">${escapeHtml(data.prompt || '')}</div>
                    <div class="gallery-item-actions">
                        <a href="${url}" target="_blank">🔗 Mở ảnh</a>
                        <button class="individual-download-btn" data-url="${url}" style="margin-left: auto; background: none; border: 1px solid rgba(167, 139, 250, 0.3); color: #a78bfa; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">💾 Tải về</button>
                    </div>
                    <div class="color-selector">
                        <span class="color-label">Nền:</span>
                        <div class="color-dot dot-black active" data-color="" data-class="preview-black" title="Đen (mặc định)"></div>
                        <div class="color-dot dot-grey" data-color="(grey)" data-class="preview-grey" title="Xám (+grey)"></div>
                        <div class="color-dot dot-white" data-color="(light)" data-class="preview-white" title="Trắng (+light)"></div>
                        
                        <label class="youth-toggle" style="margin-left: auto; display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 11px; color: rgba(255,255,255,0.7);">
                            <input type="checkbox" class="youth-checkbox" style="width: 14px; height: 14px; accent-color: #a78bfa; cursor: pointer;">
                            <span>Youth</span>
                        </label>
                    </div>
                </div>
            `;
            
            // Add listeners for color dots
            const previewContainer = newDiv.querySelector('.gallery-item-image');
            const checkbox = newDiv.querySelector('.gallery-checkbox');
            const dots = newDiv.querySelectorAll('.color-dot');
            
            dots.forEach(dot => {
                dot.addEventListener('click', () => {
                    // Update dots
                    dots.forEach(d => d.classList.remove('active'));
                    dot.classList.add('active');
                    
                    // Update preview background
                    previewContainer.className = 'gallery-item-image ' + dot.dataset.class;
                    
                    // Update checkbox data for bulk download
                    checkbox.dataset.color = dot.dataset.color;
                });
            });

            // Add listener for individual download
            newDiv.querySelector('.individual-download-btn').addEventListener('click', (e) => {
                const btn = e.currentTarget;
                const imgUrl = btn.dataset.url;
                // Find currently active color for this item
                const activeColor = newDiv.querySelector('.color-dot.active').dataset.color;
                // Add space for filename if color is present
                const colorSuffix = activeColor ? ` ${activeColor}` : "";
                const isYouth = newDiv.querySelector('.youth-checkbox')?.checked || false;
                downloadImages([{url: imgUrl, colorSuffix: colorSuffix, isYouth: isYouth}]);
            });
            
            // Insert it right before the hidden element
            element.parentNode.insertBefore(newDiv, element);
        });

        // Show bulk buttons
        const downloadBtn = document.getElementById('downloadSelectedBtn');
        const uploadBtn = document.getElementById('uploadDriveBtn');
        const selectAllBtn = document.getElementById('selectAllImagesBtn');
        const youthAllBtn = document.getElementById('selectAllYouthBtn');
        if (downloadBtn) downloadBtn.style.display = 'flex';
        if (uploadBtn) uploadBtn.style.display = 'flex';
        if (selectAllBtn) {
            selectAllBtn.style.display = 'inline-block';
            // All images are checked by default, so show "Bỏ chọn tất cả"
            const allChecked = Array.from(document.querySelectorAll('.gallery-checkbox')).every(cb => cb.checked);
            selectAllBtn.textContent = allChecked ? '☐ Bỏ chọn tất cả' : '☑️ Chọn tất cả';
        }
        if (youthAllBtn) youthAllBtn.style.display = 'inline-block';
        const autoEvalBtn = document.getElementById('autoEvaluateBtn');
        if (autoEvalBtn) autoEvalBtn.style.display = 'inline-flex';
    }
}

function restoreGeneratedImages(jobIds) {
    const gallery = document.getElementById('generatedGallery');
    const grid = document.getElementById('galleryGrid');
    gallery.classList.add('visible');

    jobIds.forEach(jobId => {
        chrome.storage.local.get([jobId], (result) => {
            const data = result[jobId];
            if (!data) return;

            if (document.getElementById(`gallery-item-${jobId}`)) return;

            const div = document.createElement('div');
            div.className = 'gallery-item';
            div.id = `gallery-item-${jobId}`;
            
            div.innerHTML = `
                <div class="gallery-item-image">
                    <div class="item-loading">
                        <div class="item-spinner"></div>
                        <div class="item-loading-text">Đang tải lại...</div>
                    </div>
                </div>
                <div class="gallery-item-info">
                    <div class="gallery-item-meta">
                        <span class="prompt-item-audience">${escapeHtml(data.audience || 'General')}</span>
                        <span class="prompt-item-style">${escapeHtml(data.styleName || 'Unknown')}</span>
                    </div>
                    <div class="gallery-item-prompt">${escapeHtml(data.prompt)}</div>
                </div>
            `;
            grid.appendChild(div);

            if (data.status === 'pending') {
                waitForJob(jobId, div);
            } else if (data.status === 'done') {
                updateGalleryItem(div, data, null);
            } else if (data.status === 'error') {
                updateGalleryItem(div, data, data.error);
            }
        });
    });
}

function setupDownloadSelectedButton() {
    const downloadBtn = document.getElementById('downloadSelectedBtn');
    const selectAllBtn = document.getElementById('selectAllImagesBtn');
 
    downloadBtn.addEventListener('click', () => {
        const checked = document.querySelectorAll('.gallery-checkbox:checked');
        if (checked.length === 0) {
            alert('Vui lòng chọn ít nhất 1 ảnh để tải.');
            return;
        }
 
        downloadBtn.classList.add('loading');
        
        const selectedItems = Array.from(checked).map(cb => ({
            url: cb.dataset.url,
            colorSuffix: cb.dataset.color || "",
            isYouth: cb.closest('.gallery-item')?.querySelector('.youth-checkbox')?.checked || false
        }));

        downloadImages(selectedItems).finally(() => {
            setTimeout(() => downloadBtn.classList.remove('loading'), 1000);
        });
    });
 
    selectAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.gallery-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(cb => {
            cb.checked = !allChecked;
        });
 
        selectAllBtn.textContent = allChecked ? '☑️ Chọn tất cả' : '☐ Bỏ chọn tất cả';
    });
}

function setupUploadDriveButton() {
    const uploadBtn = document.getElementById('uploadDriveBtn');
    const statusEl = document.getElementById('uploadStatus');

    uploadBtn.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.gallery-checkbox:checked');
        if (checked.length === 0) {
            alert('Vui lòng chọn ít nhất 1 ảnh để tải lên Drive.');
            return;
        }

        if (!confirm(`Bạn có chắc chắn muốn tải ${checked.length} ảnh lên Google Drive và ghi vào Sheet?`)) {
            return;
        }

        uploadBtn.disabled = true;
        uploadBtn.querySelector('.btn-spinner').style.display = 'inline-block';
        statusEl.style.display = 'inline-block';
        statusEl.textContent = `⏳ Đang tải lên ${checked.length} ảnh...`;

        const customTitle = document.getElementById('cfgFilename').value.trim() || currentTitle || "Design";
        const sanitizedTitle = sanitizeFilename(customTitle);
        const asinStr = currentAsin ? `(${currentAsin}) ` : "";
        const sheetTitle = customTitle.replace(/\([^)]*\)/g, "").replace(/\s\s+/g, ' ').trim();

        // Build items array (keep elements locally for UI update after)
        const checkedArr = Array.from(checked);
        const galleryElements = checkedArr.map(cb => cb.closest('.gallery-item'));
        const items = checkedArr.map((cb, i) => {
            const colorValue = cb.dataset.color || "";
            const colorSuffix = colorValue ? ` ${colorValue}` : "";
            const numSuffix = checkedArr.length > 1 ? ` (${i + 1})` : "";
            const ext = getFileExtension(cb.dataset.url) || "png";
            const galleryItem = galleryElements[i];
            const youthCb = galleryItem ? galleryItem.querySelector('.youth-checkbox') : null;
            const isYouth = youthCb ? youthCb.checked : false;
            const youthSuffix = isYouth ? "" : " (adult)";
            return {
                imageUrl: cb.dataset.url,
                filename: `${asinStr}${sanitizedTitle}${colorSuffix}${youthSuffix}${numSuffix}.${ext}`,
                asin: currentAsin,
                title: sheetTitle,
                youth: isYouth ? "Youth" : "",
                color: colorValue
            };
        });

        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "uploadAndLogToDriveBatch", items }, resolve);
        });

        if (response && response.success) {
            response.results.forEach((result, i) => {
                if (result.success && galleryElements[i]) {
                    galleryElements[i].style.borderColor = "#34d399";
                }
            });
            statusEl.textContent = `✅ Hoàn thành: ${response.successCount} thành công, ${response.errorCount} lỗi.`;
        } else {
            statusEl.textContent = `❌ Lỗi: ${response ? response.message : 'Unknown error'}`;
        }

        uploadBtn.disabled = false;
        uploadBtn.querySelector('.btn-spinner').style.display = 'none';
    });
}

function setupSelectAllYouthButton() {
    const youthBtn = document.getElementById('selectAllYouthBtn');
    if (!youthBtn) return;
    youthBtn.addEventListener('click', () => {
        const youthCheckboxes = document.querySelectorAll('.youth-checkbox');
        const allChecked = Array.from(youthCheckboxes).every(cb => cb.checked);
        youthCheckboxes.forEach(cb => { cb.checked = !allChecked; });
        youthBtn.textContent = allChecked ? '☑️ Chọn tất cả Youth' : '☐ Bỏ chọn Youth';
    });
}

function setupAutoEvaluateButton() {
    const btn = document.getElementById('autoEvaluateBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const galleryItems = Array.from(document.querySelectorAll('.gallery-item'));
        const completedItems = galleryItems.filter(item =>
            item.querySelector('.gallery-checkbox[data-url]') !== null
        );
        if (completedItems.length === 0) {
            alert('No images in gallery to evaluate.');
            return;
        }

        // Xóa feedback cũ trước khi đọc prompt text
        completedItems.forEach(item =>
            item.querySelectorAll('.imerch-ai-feedback').forEach(el => el.remove())
        );

        const items = completedItems.map((item, index) => ({
            index,
            url: item.querySelector('.gallery-checkbox[data-url]').dataset.url
        }));

        // Lấy design context từ analysis
        let designContext = '';
        if (currentDesignAnalysis) {
            // Schema mới: chỉ dùng section 1 (content)
            designContext = (currentDesignAnalysis.content || '').slice(0, 3000);
        } else if (currentAnalysisId) {
            const stored = await new Promise(resolve =>
                chrome.storage.local.get([currentAnalysisId], resolve)
            );
            const fullText = stored[currentAnalysisId]?.analysis || '';
            if (fullText) {
                // Thử parse JSON (schema mới nhưng currentDesignAnalysis chưa được set)
                try {
                    const stripped = fullText.trim().replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
                    const parsed = JSON.parse(stripped);
                    if (parsed && parsed.content) {
                        designContext = parsed.content.slice(0, 3000);
                    }
                } catch (e) {
                    // Format cũ: tìm điểm bắt đầu JSON array (hỗ trợ cả [{ và [\n{)
                    const jsonArrayMatch = fullText.search(/\[\s*\n?\s*\{/);
                    designContext = (jsonArrayMatch > 0 ? fullText.slice(0, jsonArrayMatch) : fullText)
                        .trim().slice(0, 3000);
                }
            }
        }

        const btnText = btn.querySelector('.btn-text');
        const btnSpinner = btn.querySelector('.btn-spinner');
        btn.classList.add('loading');
        btn.disabled = true;
        if (btnSpinner) btnSpinner.style.display = 'inline-block';

        try {
            const response = await new Promise(resolve =>
                chrome.runtime.sendMessage({ action: 'autoEvaluateDesigns', items, designContext }, resolve)
            );
            if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
            if (!response?.success) throw new Error(response?.message || 'Unknown error from AI.');

            const colorClassMap = { black: 'preview-black', grey: 'preview-grey', white: 'preview-white' };

            response.results.forEach(({ index, background, hasError, feedback }) => {
                const item = completedItems[index];
                if (!item) return;

                // Reset trạng thái cũ
                item.style.border = '';
                item.style.borderRadius = '';

                // Áp dụng màu nền qua color-dot click
                const targetClass = colorClassMap[background] || 'preview-black';
                item.querySelectorAll('.color-dot').forEach(dot => {
                    if (dot.dataset.class === targetClass) dot.click();
                });

                if (hasError && feedback) {
                    // Lỗi: viền đỏ + feedback text + bỏ check
                    item.style.border = '2px solid #ef4444';
                    item.style.borderRadius = '8px';
                    const cb = item.querySelector('input[type="checkbox"]');
                    if (cb && cb.checked) cb.click();
                    const promptEl = item.querySelector('.gallery-item-prompt');
                    if (promptEl) {
                        promptEl.innerHTML = '';
                        const feedbackEl = document.createElement('div');
                        feedbackEl.className = 'imerch-ai-feedback';
                        feedbackEl.style.cssText = 'color:#ef4444;font-size:11px;line-height:1.5;';
                        feedbackEl.textContent = '⚠️ ' + feedback;
                        promptEl.appendChild(feedbackEl);
                    }
                }
            });

            if (btnText) btnText.textContent = '✅ Done';
            setTimeout(() => { if (btnText) btnText.textContent = '🔍 Auto Check'; }, 2500);

        } catch (err) {
            alert(`Auto Check error: ${err.message}`);
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
            if (btnSpinner) btnSpinner.style.display = 'none';
        }
    });
}

/**
 * Downloads multiple images with formatted names
 * @param {Object[]} items - Array of {url, colorSuffix}
 */
async function downloadImages(items) {
    if (!chrome.downloads) {
        alert("Tính năng tải về không khả dụng.");
        return;
    }

    const customTitle = document.getElementById('cfgFilename').value.trim() || currentTitle || "Design";
    const sanitizedTitle = sanitizeFilename(customTitle);
    const asinStr = currentAsin ? `(${currentAsin}) ` : "";
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const url = item.url;
        const colorSuffix = item.colorSuffix || "";
        const youthSuffix = item.isYouth ? "" : " (adult)";
        const ext = getFileExtension(url);

        // Add suffix if more than one image
        const numSuffix = items.length > 1 ? ` (${i + 1})` : "";
        const filename = `${asinStr}${sanitizedTitle}${colorSuffix}${youthSuffix}${numSuffix}.${ext}`;

        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: false
        });

        // Small delay between downloads to prevent congestion
        if (items.length > 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
}

function sanitizeFilename(name) {
    // Truncate name to 100 chars to prevent overly long path issues
    let sanitized = name.substring(0, 100);
    // Replace characters that are invalid in Windows/POSIX filenames
    return sanitized.replace(/[\\\/:*?"<>|]/g, '_');
}

function getFileExtension(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const parts = pathname.split('.');
        if (parts.length > 1) {
            const ext = parts.pop().toLowerCase();
            // Basic check if it looks like a valid image extension
            if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
                return ext;
            }
        }
    } catch (e) {}
    return 'png'; // Default
}

// ==========================================
// Utilities
// ==========================================

function setupFilenameCounter() {
    const filenameInput = document.getElementById('cfgFilename');
    const titleDisplay = document.getElementById('titleDisplay');

    if (filenameInput) {
        filenameInput.addEventListener('input', updateFilenameCount);
    }

    if (titleDisplay) {
        titleDisplay.addEventListener('input', () => {
            const newTitle = titleDisplay.textContent.trim();
            const cleanTitle = newTitle.replace(/\s*T-Shirt\s*$/i, "").trim();
            if (filenameInput) {
                filenameInput.value = cleanTitle;
                updateFilenameCount();
            }
        });

        // Highlight effect on focus
        titleDisplay.addEventListener('focus', () => {
            titleDisplay.style.borderColor = 'rgba(167, 139, 250, 0.5)';
            titleDisplay.style.boxShadow = '0 2px 8px rgba(167, 139, 250, 0.1)';
        });

        titleDisplay.addEventListener('blur', () => {
            titleDisplay.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            titleDisplay.style.boxShadow = 'none';
        });
    }
}

function updateFilenameCount() {
    const filenameInput = document.getElementById('cfgFilename');
    const countDisplay = document.getElementById('filenameCount');
    if (filenameInput && countDisplay) {
        const count = filenameInput.value.length;
        countDisplay.textContent = `(${count} characters)`;
        
        if (count > maxFilenameLimit) {
            countDisplay.style.color = '#f87171';
        } else {
            countDisplay.style.color = '#a78bfa';
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    // Simple markdown-to-HTML converter
    let html = text;

    // Escape HTML
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Unordered list items
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Line breaks for remaining lines  
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[123]>)/g, '$1');
    html = html.replace(/(<\/h[123]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');

    return html;
}
