// iMerch - Universal Image Hover Analysis Button
// Hiển thị nút "🎨 Phân tích" khi hover lên ảnh bất kỳ theo cấu hình

(function () {
  'use strict';

  const BTN_ID = 'imerch-img-hover-btn';

  // Config mặc định — sẽ được ghi đè bởi chrome.storage
  let config = {
    enabled: true,
    minWidth: 300,
    btnPosition: 'top-right', // top-right | top-left | bottom-right | bottom-left | center
    blacklist: []             // danh sách domain bỏ qua
  };

  let currentImg = null;
  let hideTimer = null;

  // Load config từ storage
  function loadConfig(cb) {
    try {
      chrome.storage.sync.get(
        ['hoverEnabled', 'hoverMinWidth', 'hoverBtnPosition', 'hoverBlacklist'],
        (result) => {
          config.enabled     = result.hoverEnabled !== false;
          config.minWidth    = parseInt(result.hoverMinWidth) || 300;
          config.btnPosition = result.hoverBtnPosition || 'top-right';
          config.blacklist   = (result.hoverBlacklist || '')
            .split('\n')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
          if (cb) cb();
        }
      );
    } catch (e) {
      if (cb) cb();
    }
  }

  // Kiểm tra domain hiện tại có bị blacklist không
  function isBlacklisted() {
    const host = location.hostname.toLowerCase().replace(/^www\./, '');
    return config.blacklist.some(d => host === d || host.endsWith('.' + d));
  }

  // Tạo nút nếu chưa có
  function getOrCreateBtn() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.innerHTML = '🎨 Analyze';
    btn.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #6d28d9;
      background: rgba(255,255,255,0.96);
      border: 1.5px solid #a78bfa;
      border-radius: 20px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(109,40,217,0.18);
      pointer-events: auto;
      transition: background 0.15s, transform 0.1s;
      white-space: nowrap;
      user-select: none;
      display: none;
    `;

    btn.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      btn.style.background = '#ede9fe';
      btn.style.transform = 'scale(1.05)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(255,255,255,0.96)';
      btn.style.transform = 'scale(1)';
      scheduleHide();
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!currentImg) return;

      const imageUrl = currentImg.currentSrc || currentImg.src || '';
      if (!imageUrl || imageUrl.startsWith('data:')) return;

      try {
        chrome.runtime.sendMessage({
          action: 'copyAIPrompt',
          imageUrl: imageUrl,
          asin: '',
          title: currentImg.alt || document.title || ''
        });
      } catch (err) {
        // Extension context có thể bị invalidate
      }

      hideBtn();
    });

    document.body.appendChild(btn);
    return btn;
  }

  // Tính vị trí nút theo config.btnPosition
  function calcBtnPos(rect) {
    const btnW = 110, btnH = 32, margin = 8;
    let left, top;

    switch (config.btnPosition) {
      case 'top-left':
        left = rect.left + margin;
        top  = rect.top  + margin;
        break;
      case 'bottom-right':
        left = rect.right  - btnW - margin;
        top  = rect.bottom - btnH - margin;
        break;
      case 'bottom-left':
        left = rect.left + margin;
        top  = rect.bottom - btnH - margin;
        break;
      case 'center':
        left = rect.left + (rect.width  - btnW) / 2;
        top  = rect.top  + (rect.height - btnH) / 2;
        break;
      case 'top-right':
      default:
        left = rect.right - btnW - margin;
        top  = rect.top   + margin;
        break;
    }

    // Clamp trong viewport
    left = Math.max(margin, Math.min(left, window.innerWidth  - btnW - margin));
    top  = Math.max(margin, Math.min(top,  window.innerHeight - btnH - margin));
    return { left, top };
  }

  function showBtn(img) {
    clearTimeout(hideTimer);
    currentImg = img;

    const rect = img.getBoundingClientRect();
    const btn  = getOrCreateBtn();
    const { left, top } = calcBtnPos(rect);

    btn.style.left    = left + 'px';
    btn.style.top     = top  + 'px';
    btn.style.display = 'block';
  }

  function hideBtn() {
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.style.display = 'none';
    currentImg = null;
  }

  function scheduleHide(delay = 300) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideBtn, delay);
  }

  // Kiểm tra ảnh có đủ rộng không
  function isImageWideEnough(img) {
    const w = img.offsetWidth || img.getBoundingClientRect().width || img.naturalWidth;
    return w >= config.minWidth;
  }

  // Bỏ qua ảnh là icon/tracking pixel
  function shouldIgnoreImage(img) {
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('data:')) return true;
    if (img.naturalWidth  > 0 && img.naturalWidth  < 50) return true;
    if (img.naturalHeight > 0 && img.naturalHeight < 50) return true;
    return false;
  }

  // Kiểm tra điểm (x,y) có nằm trong rect (có padding) không
  function inRect(rect, x, y, pad = 18) {
    return x >= rect.left - pad && x <= rect.right  + pad
        && y >= rect.top  - pad && y <= rect.bottom + pad;
  }

  function attachListeners() {
    // Hiện nút khi chuột vào ảnh
    document.addEventListener('mouseover', (e) => {
      if (!config.enabled || isBlacklisted()) return;
      const img = e.target.closest('img');
      if (!img || shouldIgnoreImage(img) || !isImageWideEnough(img)) return;
      showBtn(img);
    }, true);

    // Dùng mousemove toàn trang để ẩn nút khi chuột rời khỏi vùng ảnh VÀ vùng nút
    // (tránh bị overlay của Pinterest/Etsy làm bắn mouseout sớm)
    document.addEventListener('mousemove', (e) => {
      if (!currentImg) return;
      const btn = document.getElementById(BTN_ID);
      if (!btn || btn.style.display === 'none') return;

      const imgRect = currentImg.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const x = e.clientX, y = e.clientY;

      if (!inRect(imgRect, x, y) && !inRect(btnRect, x, y)) {
        scheduleHide(150);
      } else {
        clearTimeout(hideTimer);
      }
    }, true);

    // Reload config khi settings thay đổi
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const hoverKeys = ['hoverEnabled', 'hoverMinWidth', 'hoverBtnPosition', 'hoverBlacklist'];
      if (hoverKeys.some(k => k in changes)) loadConfig();
    });
  }

  // Khởi động: load config rồi gắn listeners
  loadConfig(attachListeners);

})();
