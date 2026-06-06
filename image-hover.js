// iMerch - Universal Image Hover Analysis Button
// Hiển thị nút "🎨 Phân tích" khi hover lên ảnh bất kỳ có chiều rộng >= 300px

(function () {
  'use strict';

  const MIN_WIDTH = 300; // px
  const BTN_ID = 'imerch-img-hover-btn';

  let currentImg = null;
  let hideTimer = null;

  // Tạo nút nếu chưa có
  function getOrCreateBtn() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.innerHTML = '🎨 Phân tích';
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

      const imageUrl = currentImg.src || currentImg.currentSrc;
      if (!imageUrl || imageUrl.startsWith('data:')) {
        return;
      }

      // Gửi message tới background để mở Design Analysis
      try {
        chrome.runtime.sendMessage({
          action: 'copyAIPrompt',
          imageUrl: imageUrl,
          asin: '',
          title: currentImg.alt || document.title || ''
        });
      } catch (err) {
        // Extension context có thể bị invalidate, bỏ qua
      }

      hideBtn();
    });

    document.body.appendChild(btn);
    return btn;
  }

  function showBtn(img) {
    clearTimeout(hideTimer);
    currentImg = img;

    const rect = img.getBoundingClientRect();
    const btn = getOrCreateBtn();

    // Vị trí: góc trên-phải của ảnh, offset vào trong 8px
    const btnWidth = 110;
    const btnHeight = 32;
    let left = rect.right - btnWidth - 8;
    let top  = rect.top + 8;

    // Clamp trong viewport
    left = Math.max(8, Math.min(left, window.innerWidth - btnWidth - 8));
    top  = Math.max(8, Math.min(top,  window.innerHeight - btnHeight - 8));

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
    // Dùng rendered width trước, fallback naturalWidth
    const w = img.offsetWidth || img.getBoundingClientRect().width || img.naturalWidth;
    return w >= MIN_WIDTH;
  }

  // Bỏ qua ảnh là icon/logo nhỏ, tracking pixel, v.v.
  function shouldIgnoreImage(img) {
    const src = img.src || img.currentSrc || '';
    if (!src || src.startsWith('data:')) return true;
    // Bỏ qua ảnh 1x1 hoặc các icon rất nhỏ
    if (img.naturalWidth > 0 && img.naturalWidth < 50) return true;
    if (img.naturalHeight > 0 && img.naturalHeight < 50) return true;
    return false;
  }

  // Event delegation trên document
  document.addEventListener('mouseover', (e) => {
    const img = e.target.closest('img');
    if (!img) return;
    if (shouldIgnoreImage(img)) return;
    if (!isImageWideEnough(img)) return;

    showBtn(img);
  }, true);

  document.addEventListener('mouseout', (e) => {
    const img = e.target.closest('img');
    if (!img || img !== currentImg) return;

    // Kiểm tra nếu chuột chuyển sang nút thì không ẩn
    const relatedTarget = e.relatedTarget;
    const btn = document.getElementById(BTN_ID);
    if (btn && (relatedTarget === btn || btn.contains(relatedTarget))) return;

    scheduleHide(400);
  }, true);

})();
