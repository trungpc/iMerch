// iMerch - Universal Image Hover Analysis Button + Ideas Queue
// Hiển thị nút "🎨 Analyze" và "➕ Ideas" khi hover lên ảnh bất kỳ theo cấu hình

(function () {
  'use strict';

  const PANEL_ID   = 'imerch-img-hover-panel';
  const COUNTER_ID = 'imerch-ideas-counter';

  // Config mặc định — sẽ được ghi đè bởi chrome.storage
  let config = {
    enabled: true,
    minWidth: 300,
    btnPosition: 'top-right',
    blacklist: []
  };

  let currentImg = null;
  let hideTimer  = null;

  // Ideas queue: array of { thumbnail, title, asin, rank, brand }
  let ideasQueue = [];

  // ===== CONFIG =====

  function loadConfig(cb) {
    try {
      chrome.storage.sync.get(
        ['hoverEnabled', 'hoverMinWidth', 'hoverBtnPosition', 'hoverBlacklist'],
        (result) => {
          config.enabled     = result.hoverEnabled !== false;
          config.minWidth    = parseInt(result.hoverMinWidth) || 300;
          config.btnPosition = result.hoverBtnPosition || 'top-right';
          config.blacklist   = (result.hoverBlacklist || '')
            .split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
          if (cb) cb();
        }
      );
    } catch (e) { if (cb) cb(); }
  }

  function isBlacklisted() {
    const host = location.hostname.toLowerCase().replace(/^www\./, '');
    return config.blacklist.some(d => host === d || host.endsWith('.' + d));
  }

  // ===== HOVER PANEL (Analyze + Ideas buttons) =====

  function getOrCreatePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    const btnStyle = `
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      border-radius: 20px;
      border: 1.5px solid #a78bfa;
      white-space: nowrap;
      user-select: none;
      transition: background 0.15s, transform 0.1s;
      pointer-events: auto;
    `;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      display: none;
      flex-direction: row;
      gap: 6px;
      align-items: center;
      pointer-events: auto;
    `;

    // Analyze button
    const analyzeBtn = document.createElement('button');
    analyzeBtn.id = 'imerch-img-hover-btn';
    analyzeBtn.innerHTML = '🎨 Analyze';
    analyzeBtn.style.cssText = btnStyle + `
      color: #6d28d9;
      background: rgba(255,255,255,0.96);
      box-shadow: 0 2px 8px rgba(109,40,217,0.18);
    `;
    analyzeBtn.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      analyzeBtn.style.background = '#ede9fe';
      analyzeBtn.style.transform = 'scale(1.05)';
    });
    analyzeBtn.addEventListener('mouseleave', () => {
      analyzeBtn.style.background = 'rgba(255,255,255,0.96)';
      analyzeBtn.style.transform = 'scale(1)';
      scheduleHide();
    });
    analyzeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      if (!currentImg) return;
      const imageUrl = currentImg.currentSrc || currentImg.src || '';
      if (!imageUrl || imageUrl.startsWith('data:')) return;
      try {
        chrome.runtime.sendMessage({
          action: 'copyAIPrompt',
          imageUrl,
          asin: '',
          title: currentImg.alt || document.title || ''
        });
      } catch (err) {}
      hidePanel();
    });

    // Ideas button
    const ideasBtn = document.createElement('button');
    ideasBtn.id = 'imerch-img-ideas-btn';
    ideasBtn.innerHTML = '➕ Ideas';
    ideasBtn.style.cssText = btnStyle + `
      color: #0e7490;
      background: rgba(255,255,255,0.96);
      border-color: #67e8f9;
      box-shadow: 0 2px 8px rgba(14,116,144,0.15);
    `;
    ideasBtn.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      ideasBtn.style.background = '#ecfeff';
      ideasBtn.style.transform = 'scale(1.05)';
    });
    ideasBtn.addEventListener('mouseleave', () => {
      ideasBtn.style.background = 'rgba(255,255,255,0.96)';
      ideasBtn.style.transform = 'scale(1)';
      scheduleHide();
    });
    ideasBtn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      if (!currentImg) return;
      const imageUrl = currentImg.currentSrc || currentImg.src || '';
      if (!imageUrl || imageUrl.startsWith('data:')) return;
      addToIdeasQueue(imageUrl, currentImg.alt || '');
      hidePanel();
    });

    panel.appendChild(analyzeBtn);
    panel.appendChild(ideasBtn);
    document.body.appendChild(panel);
    return panel;
  }

  // ===== IDEAS QUEUE =====

  function addToIdeasQueue(thumbnail, title) {
    // Avoid duplicates
    if (ideasQueue.some(p => p.thumbnail === thumbnail)) {
      flashCounter('Already added!');
      return;
    }
    ideasQueue.push({ thumbnail, title: title || location.hostname, asin: '', rank: 0, brand: '' });
    updateCounter();
    flashCounter(`Added! (${ideasQueue.length})`);
  }

  function getOrCreateCounter() {
    let counter = document.getElementById(COUNTER_ID);
    if (counter) return counter;

    counter = document.createElement('div');
    counter.id = COUNTER_ID;
    counter.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483646;
      display: none;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      pointer-events: auto;
    `;

    const openBtn = document.createElement('button');
    openBtn.id = 'imerch-ideas-open-btn';
    openBtn.style.cssText = `
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(135deg, #0e7490, #0284c7);
      border: none;
      border-radius: 20px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(14,116,144,0.35);
      white-space: nowrap;
      user-select: none;
      transition: transform 0.15s, box-shadow 0.15s;
    `;
    openBtn.addEventListener('mouseenter', () => {
      openBtn.style.transform = 'scale(1.05)';
      openBtn.style.boxShadow = '0 6px 18px rgba(14,116,144,0.45)';
    });
    openBtn.addEventListener('mouseleave', () => {
      openBtn.style.transform = 'scale(1)';
      openBtn.style.boxShadow = '0 4px 14px rgba(14,116,144,0.35)';
    });
    openBtn.addEventListener('click', openIdeasPage);

    const clearBtn = document.createElement('button');
    clearBtn.style.cssText = `
      padding: 4px 10px;
      font-size: 11px;
      color: rgba(255,255,255,0.7);
      background: rgba(0,0,0,0.35);
      border: none;
      border-radius: 12px;
      cursor: pointer;
      white-space: nowrap;
      align-self: flex-end;
      user-select: none;
    `;
    clearBtn.textContent = '✕ Clear';
    clearBtn.addEventListener('click', () => {
      ideasQueue = [];
      updateCounter();
    });

    counter.appendChild(openBtn);
    counter.appendChild(clearBtn);
    document.body.appendChild(counter);
    return counter;
  }

  function updateCounter() {
    const counter = getOrCreateCounter();
    const openBtn = document.getElementById('imerch-ideas-open-btn');
    if (ideasQueue.length === 0) {
      counter.style.display = 'none';
    } else {
      counter.style.display = 'flex';
      if (openBtn) openBtn.textContent = `💡 Open Ideas (${ideasQueue.length})`;
    }
  }

  function flashCounter(msg) {
    const counter = getOrCreateCounter();
    const openBtn = document.getElementById('imerch-ideas-open-btn');
    if (!openBtn) return;
    const prev = openBtn.textContent;
    counter.style.display = 'flex';
    openBtn.textContent = msg;
    setTimeout(() => {
      openBtn.textContent = ideasQueue.length > 0 ? `💡 Open Ideas (${ideasQueue.length})` : prev;
      if (ideasQueue.length === 0) counter.style.display = 'none';
    }, 1500);
  }

  function openIdeasPage() {
    if (ideasQueue.length === 0) return;
    try {
      chrome.runtime.sendMessage({
        action: 'openIdeasPage',
        products: ideasQueue,
        pageTitle: document.title || location.hostname
      });
      ideasQueue = [];
      updateCounter();
    } catch (err) {}
  }

  // ===== PANEL SHOW/HIDE =====

  function calcPanelPos(rect) {
    const panelW = 220, panelH = 36, margin = 8;
    let left, top;
    switch (config.btnPosition) {
      case 'top-left':
        left = rect.left + margin; top = rect.top + margin; break;
      case 'bottom-right':
        left = rect.right - panelW - margin; top = rect.bottom - panelH - margin; break;
      case 'bottom-left':
        left = rect.left + margin; top = rect.bottom - panelH - margin; break;
      case 'center':
        left = rect.left + (rect.width - panelW) / 2;
        top  = rect.top  + (rect.height - panelH) / 2; break;
      case 'top-right':
      default:
        left = rect.right - panelW - margin; top = rect.top + margin; break;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth  - panelW - margin));
    top  = Math.max(margin, Math.min(top,  window.innerHeight - panelH - margin));
    return { left, top };
  }

  function showPanel(img) {
    clearTimeout(hideTimer);
    currentImg = img;
    const rect  = img.getBoundingClientRect();
    const panel = getOrCreatePanel();
    const { left, top } = calcPanelPos(rect);
    panel.style.left    = left + 'px';
    panel.style.top     = top  + 'px';
    panel.style.display = 'flex';
  }

  function hidePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = 'none';
    currentImg = null;
  }

  function scheduleHide(delay = 300) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePanel, delay);
  }

  // ===== IMAGE CHECKS =====

  function isImageWideEnough(img) {
    const w = img.offsetWidth || img.getBoundingClientRect().width || img.naturalWidth;
    return w >= config.minWidth;
  }

  function shouldIgnoreImage(img) {
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('data:')) return true;
    if (img.naturalWidth  > 0 && img.naturalWidth  < 50) return true;
    if (img.naturalHeight > 0 && img.naturalHeight < 50) return true;
    return false;
  }

  function inRect(rect, x, y, pad = 18) {
    return x >= rect.left - pad && x <= rect.right  + pad
        && y >= rect.top  - pad && y <= rect.bottom + pad;
  }

  // ===== LISTENERS =====

  function attachListeners() {
    document.addEventListener('mouseover', (e) => {
      if (!config.enabled || isBlacklisted()) return;
      const img = e.target.closest('img');
      if (!img || shouldIgnoreImage(img) || !isImageWideEnough(img)) return;
      showPanel(img);
    }, true);

    document.addEventListener('mousemove', (e) => {
      if (!currentImg) return;
      const panel = document.getElementById(PANEL_ID);
      if (!panel || panel.style.display === 'none') return;
      const imgRect   = currentImg.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const x = e.clientX, y = e.clientY;
      if (!inRect(imgRect, x, y) && !inRect(panelRect, x, y)) {
        scheduleHide(150);
      } else {
        clearTimeout(hideTimer);
      }
    }, true);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const hoverKeys = ['hoverEnabled', 'hoverMinWidth', 'hoverBtnPosition', 'hoverBlacklist'];
      if (hoverKeys.some(k => k in changes)) loadConfig();
    });
  }

  loadConfig(attachListeners);

})();
