// Debug flag - set to false for production
const DEBUG = false;

function decodeHtmlEntities(str) {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

// Logger helpers
const logger = {
  log: (...args) => DEBUG && console.log('[iMerch]', ...args),
  warn: (...args) => DEBUG && console.warn('[iMerch]', ...args),
  error: (...args) => console.error('[iMerch]', ...args) // Always show errors
};

// Extract ASIN from URL
function extractASINFromURL(url) {
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})/);
  return match ? match[1] : null;
}

// Random delay
const randomDelay = (min, max) => new Promise(resolve =>
  setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
);

// Cache helpers using chrome.storage.session (clears on browser close)
const CACHE_KEY_PREFIX = 'amasort_';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (if browser stays open)

async function getCachedData(asin) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.id) {
        resolve(null);
        return;
      }
      const key = CACHE_KEY_PREFIX + asin;
      chrome.storage.session.get([key], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const data = result[key];
        if (!data) {
          resolve(null);
          return;
        }
        // Check if cache has expired
        if (Date.now() - data.timestamp > CACHE_TTL) {
          chrome.storage.session.remove(key);
          resolve(null);
          return;
        }
        // Invalidate cache if critical data is N/A or missing
        if (data.rank === "N/A" || data.date === "N/A" || !data.sku) {
          logger.log(`⚠️ Cache invalid for ${asin} (contains N/A), will re-crawl`);
          chrome.storage.session.remove(key);
          resolve(null);
          return;
        }
        resolve(data);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function setCachedData(asin, data) {
  try {
    if (!chrome.runtime?.id) return;
    const key = CACHE_KEY_PREFIX + asin;
    const dataToStore = { ...data, timestamp: Date.now() };
    chrome.storage.session.set({ [key]: dataToStore }, () => {
      if (chrome.runtime.lastError) {
        // Silently handle errors
      }
    });
  } catch (e) {
    // Silently handle exceptions
  }
}

// Global settings
let settings = {
  scrapingMode: 'sequential',
  delayMin: 1500,
  delayMax: 3500,
  highlightDays: 30,
  highlightRank: 10000,
  daysColor: '#abfaaf',
  rankColor: '#ffeb3b',
  bothColor: '#ff9800'
};

logger.log('Content script loaded');

// Load settings from storage and then start processing
chrome.storage.sync.get([
  'scrapingMode', 'delayMin', 'delayMax',
  'highlightDays', 'daysColor', 'highlightRank', 'rankColor', 'bothColor'
], (result) => {
  settings = {
    scrapingMode: result.scrapingMode || 'sequential',
    delayMin: parseInt(result.delayMin) || 1500,
    delayMax: parseInt(result.delayMax) || 3500,
    highlightDays: result.highlightDays || 30,
    highlightRank: result.highlightRank || 10000,
    daysColor: result.daysColor || '#abfaaf',
    rankColor: result.rankColor || '#ffeb3b',
    bothColor: result.bothColor || '#ff9800'
  };
  logger.log('Loaded settings:', settings);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      processProducts();
      addButtonsToProductPage();
      if (window.location.pathname === '/s') trySortBarInject();
    });
  } else {
    processProducts();
    addButtonsToProductPage();
    if (window.location.pathname === '/s') trySortBarInject();
  }
  setupObserver();
});

// Listen for settings updates from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "updateSettings") {
    Object.assign(settings, message.settings);
    logger.log('Settings updated:', settings);
  }
});

// Show Keepa price history modal
function showKeepaModal(asin) {
  // Remove existing modal if any
  const existingModal = document.querySelector('.amasort-keepa-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'amasort-keepa-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 999999;
    animation: fadeIn 0.2s ease;
  `;

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: white;
    border-radius: 8px;
    padding: 20px;
    max-width: 90%;
    max-height: 90%;
    position: relative;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
  `;

  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 50%;
    width: 30px;
    height: 30px;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    z-index: 1;
  `;
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = '#cc0000';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = '#ff4444';
  });

  // Create title
  const title = document.createElement('h3');
  title.textContent = `Price History - ASIN: ${asin}`;
  title.style.cssText = `
    margin: 0 0 15px 0;
    font-size: 16px;
    color: #333;
  `;

  // Create Keepa graph image
  const keepaImg = document.createElement('img');
  keepaImg.src = `https://graph.keepa.com/pricehistory.png?asin=${asin}&domain=com&width=800&height=400&range=365`;
  keepaImg.alt = 'Keepa Price History';
  keepaImg.style.cssText = `
    width: 100%;
    max-width: 800px;
    height: auto;
    border-radius: 4px;
    display: block;
  `;

  // Add loading indicator
  const loading = document.createElement('div');
  loading.textContent = 'Loading price history...';
  loading.style.cssText = `
    text-align: center;
    padding: 40px;
    color: #666;
  `;

  keepaImg.addEventListener('load', () => {
    loading.style.display = 'none';
  });

  keepaImg.addEventListener('error', () => {
    loading.textContent = 'Failed to load price history. Please try again.';
    loading.style.color = '#ff4444';
  });

  // Assemble modal
  modalContent.appendChild(closeBtn);
  modalContent.appendChild(title);
  modalContent.appendChild(loading);
  modalContent.appendChild(keepaImg);
  modal.appendChild(modalContent);

  // Close modal handlers
  const closeModal = () => {
    modal.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => modal.remove(), 200);
  };

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Add CSS animations
  if (!document.querySelector('#amasort-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'amasort-modal-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      @keyframes slideIn {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(modal);
  logger.log(`Keepa modal opened for ASIN: ${asin}`);
}

// Extract product info from HTML
function extractProductInfo(html, knownAsin) {
  const asinMatch = html.match(/<span[^>]*>ASIN[\s\S]*?<\/span>\s*<span[^>]*>(\w{10})<\/span>/);
  const rankMatch = html.match(/Best Sellers Rank[^#]+#([\d,]+)/i);

  // Try multiple patterns for Date First Available
  // Pattern 1: Table format (e.g., floating shelves) - <th>Date First Available</th><td>date</td>
  // Pattern 2: Span format (e.g., Merch products) - <span>Date First Available</span><span>date</span>
  let dateMatch = html.match(/Date First Available[\s\S]*?<td[^>]*>([\w\s,]+)<\/td>/i);
  if (!dateMatch) {
    dateMatch = html.match(/Date First Available[\s\S]*?<span[^>]*>([\w\s,]+)<\/span>/i);
  }

  const imageMatch = html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/([^"}]+))"/);
  const titleMatch = html.match(/<span id="productTitle"[^>]*>([\s\S]*?)<\/span>/);
  const brandMatch = html.match(/id="bylineInfo"[^>]*>([\s\S]*?)<\/a>/);
  const JUNK_BULLET = 'Lightweight, Classic fit, Double-needle sleeve and bottom hem';

  let sku = "";
  if (imageMatch) {
    const imageUrl = imageMatch[1];
    const imageParts = imageUrl.split(".png")[0].split("%7C");
    sku = imageParts.length > 1 ? imageParts[imageParts.length - 1] : "";
  }

  let brand = "";
  if (brandMatch) {
    brand = brandMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // Lấy bullets: tìm section bằng indexOf rồi slice, tránh regex backtracking
  const bullets = [];
  const BULLET_SECTIONS = ['id="productFactsDesktopExpander"', 'id="feature-bullets"'];
  for (const sectionId of BULLET_SECTIONS) {
    const sectionStart = html.indexOf(sectionId);
    if (sectionStart === -1) continue;
    const ulStart = html.indexOf('<ul', sectionStart);
    if (ulStart === -1) continue;
    const ulEnd = html.indexOf('</ul>', ulStart);
    if (ulEnd === -1) continue;
    const ulHtml = html.slice(ulStart, ulEnd + 5);
    const spanMatches = [...ulHtml.matchAll(/<span[^>]*a-list-item[^>]*>([\s\S]*?)<\/span>/g)];
    const extracted = spanMatches
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(JUNK_BULLET, '').trim())
      .filter(b => b.length > 10 && b.length < 300);
    if (extracted.length > 0) {
      bullets.push(...extracted.slice(0, 2));
      break;
    }
  }

  return {
    asin: knownAsin || (asinMatch ? asinMatch[1] : "N/A"),
    rank: rankMatch ? rankMatch[1] : "N/A",
    date: dateMatch ? dateMatch[1].trim() : "N/A",
    sku: sku,
    title: titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : "N/A",
    brand: brand,
    bullet1: bullets[0] || "",
    bullet2: bullets[1] || "",
  };
}

// Create info box
function createInfoBox(data) {
  const { asin, rank, date, sku } = data;
  const box = document.createElement("div");
  box.className = "amasort-info";
  box.style.cssText = `
    font-size: 13px;
    color: #333;
    background-color: #f8f8f8;
    padding: 8px;
    margin: 5px 0;
    border: 1px solid #ddd;
    border-radius: 5px;
    transition: background-color 0.3s ease;
  `;

  const dateObj = new Date(date);
  const daysDiff = (Date.now() - dateObj) / (1000 * 60 * 60 * 24);
  const rankNum = rank !== "N/A" ? parseInt(rank.replace(/,/g, "")) : Infinity;
  const isRecent = !isNaN(dateObj) && daysDiff <= settings.highlightDays;
  const isLowRank = rankNum <= settings.highlightRank;

  if (isRecent && isLowRank) {
    box.style.backgroundColor = settings.bothColor;
  } else if (isRecent) {
    box.style.backgroundColor = settings.daysColor;
  } else if (isLowRank) {
    box.style.backgroundColor = settings.rankColor;
  }

  const downloadBtn = sku ?
    `<button class="amasort-download" style="margin-left: 5px; padding: 2px 6px; font-size: 12px; cursor: pointer; border: 1px solid #ddd; background: #fff; border-radius: 3px;">Download</button>` : "";

  box.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <strong>ASIN:</strong>
        <span class="amasort-asin" style="cursor: pointer;" title="Click to copy">${asin}</span>
      </div>
      <div>${downloadBtn}</div>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 12px;">
      <span><strong>Rank:</strong> ${rank}</span>
      <span>${date}</span>
    </div>
    <div style="margin-top: 5px; display: flex; justify-content: space-between; align-items: center;">
      <button class="amasort-price-history" style="padding: 2px 6px; font-size: 12px; cursor: pointer; border: 1px solid #ddd; background: transparent; border-radius: 3px;">
        📊 Price History
      </button>
      <button class="amasort-design-analysis" style="padding: 2px 6px; font-size: 12px; cursor: pointer; border: 1px solid #a78bfa; background: transparent; border-radius: 3px; color: #6d28d9;">
        🎨 Design Analysis
      </button>
    </div>
  `;

  const asinSpan = box.querySelector(".amasort-asin");
  asinSpan.addEventListener("click", () => {
    navigator.clipboard.writeText(asin).then(() => {
      const originalColor = asinSpan.style.color;
      asinSpan.style.color = "#aaa";
      setTimeout(() => asinSpan.style.color = originalColor, 1000);
    });
  });

  const downloadButton = box.querySelector(".amasort-download");
  if (downloadButton) {
    downloadButton.addEventListener("click", () => {
      logger.log(`Download clicked - ASIN: ${asin}, SKU: ${sku}`);
      downloadButton.disabled = true;
      downloadButton.textContent = "Downloading...";

      chrome.runtime.sendMessage({
        action: "processImage",
        asin: asin,
        sku: sku,
        title: data.title
      }, (response) => {
        logger.log('Download response:', response);
        downloadButton.disabled = false;
        downloadButton.textContent = "Download";

        if (response && response.success) {
          logger.log(`✓ Download successful! ID: ${response.downloadId}`);
        } else if (response && response.error) {
          logger.error(`✗ Download failed:`, response.error);
          alert(`Download failed: ${response.error}`);
        }
      });
    });
  }

  const priceHistoryButton = box.querySelector(".amasort-price-history");
  if (priceHistoryButton) {
    priceHistoryButton.addEventListener("click", () => {
      logger.log(`Price History clicked - ASIN: ${asin}`);
      showKeepaModal(asin);
    });
  }

  const designAnalysisButton = box.querySelector(".amasort-design-analysis");
  if (designAnalysisButton) {
    designAnalysisButton.addEventListener("click", () => {
      const imageUrl = sku
        ? `https://m.media-amazon.com/images/I/${sku}.png`
        : "";
      if (!imageUrl) {
        alert("Hi-res image not found. Please try another product.");
        return;
      }
      logger.log(`Design Analysis clicked - ASIN: ${asin}`);
      chrome.runtime.sendMessage({
        action: "copyAIPrompt",
        imageUrl,
        asin,
        title: data.title || ""
      });
    });
  }

  return box;
}

// Fetch and process single product
async function processProduct(product) {
  let asin = product.getAttribute('data-asin');
  if (!asin) {
    const link = product.querySelector("a[href*='/dp/'], a[href*='/gp/product/']");
    if (link) asin = extractASINFromURL(link.href);
  }
  if (!asin) return { success: false };
  if (product.querySelector('.amasort-info')) return { success: false };

  const cached = await getCachedData(asin);
  if (cached) {
    logger.log(`⚡ Using cached data for ${asin}`);
    const infoBox = createInfoBox(cached);
    const priceSection = product.querySelector(".a-spacing-top-small");
    if (priceSection) {
      priceSection.parentNode.insertBefore(infoBox, priceSection);
    } else {
      product.insertBefore(infoBox, product.firstChild);
    }
    tagProductForSort(product, cached);
    return { success: true, cached: true };
  }

  logger.log(`🔄 Fetching new data for ${asin}...`);

  try {
    const productURL = `https://www.amazon.com/dp/${asin}`;
    const response = await fetch(productURL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });

    if (!response.ok) {
      logger.warn(`HTTP ${response.status} for ${asin}`);
      return { success: false };
    }

    const html = await response.text();
    const data = extractProductInfo(html, asin);
    logger.log(`Extracted data for ${asin}:`, data);

    setCachedData(asin, data);

    const infoBox = createInfoBox(data);
    const priceSection = product.querySelector(".a-spacing-top-small");
    if (priceSection) {
      priceSection.parentNode.insertBefore(infoBox, priceSection);
    } else {
      product.insertBefore(infoBox, product.firstChild);
    }
    tagProductForSort(product, data);

    logger.log(`✓ Added info box for ${asin}`);
    return { success: true, cached: false };
  } catch (error) {
    logger.error(`Error processing ${asin}:`, error);
    return { success: false };
  }
}

// Global state for processing lock
let isProcessing = false;
let hasPendingUpdates = false;

// Sort / load-more state
let originalOrder = null;
let currentSort = null;
let loadedExtraPages = 0;
let isLoadingPages = false;

// Process all products - Sequential mode
async function processProductsSequential(products) {
  logger.log(`Processing ${products.length} products in SEQUENTIAL mode`);
  logger.log(`Delay settings: ${settings.delayMin}ms - ${settings.delayMax}ms`);

  let processed = 0;
  for (const product of products) {
    const result = await processProduct(product);
    if (result.success && !result.cached) {
      processed++;
      const delay = Math.floor(Math.random() * (settings.delayMax - settings.delayMin + 1)) + settings.delayMin;
      logger.log(`⏳ Waiting ${delay}ms before next request...`);
      await randomDelay(settings.delayMin, settings.delayMax);
    }
  }
  logger.log(`Finished processing ${processed} new products`);
}

// Process all products - Concurrent mode
async function processProductsConcurrent(products) {
  logger.log(`Processing ${products.length} products in CONCURRENT mode (Fast)`);
  const promises = products.map(async (product) => processProduct(product));
  await Promise.all(promises);
  logger.log('Finished processing products');
}

// Process all products
async function processProducts() {
  if (isProcessing) {
    logger.log('🔒 Processing already in progress, queuing update...');
    hasPendingUpdates = true;
    return;
  }

  isProcessing = true;
  hasPendingUpdates = false;

  try {
    logger.log('Starting product processing batch');
    const products = Array.from(document.querySelectorAll(".s-result-item:not(.amasort-processed)"));

    if (products.length > 0) {
      logger.log(`Found ${products.length} new products`);
      products.forEach(p => p.classList.add('amasort-processed'));
      logger.log(`Mode: ${settings.scrapingMode}`);

      if (settings.scrapingMode === 'concurrent') {
        await processProductsConcurrent(products);
      } else {
        await processProductsSequential(products);
      }
    } else {
      logger.log('No new products found in this batch');
    }
  } catch (err) {
    logger.error('Error in processProducts:', err);
  } finally {
    isProcessing = false;
    logger.log('🔓 Batch processing finished');
    updateAsinCount();
    if (hasPendingUpdates) {
      logger.log('↻ Found pending updates, restarting processing...');
      processProducts();
    }
  }
}

// Setup MutationObserver to detect new products
function setupObserver() {
  let debounceTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Re-inject sort bar if it disappeared (e.g. after Amazon "Sort by" AJAX replace)
      if (window.location.pathname === '/s' && !document.querySelector('#imerch-sort-bar')) {
        trySortBarInject();
      }
      const newProducts = document.querySelectorAll(".s-result-item:not(.amasort-processed)");
      if (newProducts.length > 0) {
        logger.log(`Detected ${newProducts.length} new products, triggering processing...`);
        processProducts();
      }
    }, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  logger.log('MutationObserver started - will auto-detect new products');
}

logger.log('Script initialized');

// ====== Sort & Load-more feature ======

function tagProductForSort(product, data) {
  const rankNum = data.rank !== "N/A" ? parseInt(data.rank.replace(/,/g, "")) : 999999999;
  const dateTs  = data.date !== "N/A" ? (new Date(data.date).getTime() || 0) : 0;
  product.dataset.imerchRank = rankNum;
  product.dataset.imerchDate = dateTs;
  if (data.title) product.dataset.imerchTitle = data.title;
  if (data.brand) product.dataset.imerchBrand = data.brand;
  if (data.bullet1) product.dataset.imerchBullet1 = data.bullet1;
  if (data.bullet2) product.dataset.imerchBullet2 = data.bullet2;
}

function saveOriginalOrder() {
  if (originalOrder) return;
  const slot = document.querySelector('.s-main-slot');
  if (slot) originalOrder = Array.from(slot.children);
}

function sortProducts(by) {
  saveOriginalOrder();
  const slot = document.querySelector('.s-main-slot');
  if (!slot) return;

  const processed   = Array.from(slot.querySelectorAll('.s-result-item[data-asin][data-imerch-rank]'));
  const unprocessed = Array.from(slot.querySelectorAll('.s-result-item[data-asin]:not([data-imerch-rank])'));

  processed.sort((a, b) => {
    if (by === 'rank') {
      return (parseInt(a.dataset.imerchRank) || 999999999) - (parseInt(b.dataset.imerchRank) || 999999999);
    }
    return (parseInt(b.dataset.imerchDate) || 0) - (parseInt(a.dataset.imerchDate) || 0);
  });

  [...processed, ...unprocessed].forEach(el => slot.appendChild(el));
  currentSort = by;
  updateSortButtonState();
}

function resetSort() {
  if (!originalOrder) return;
  const slot = document.querySelector('.s-main-slot');
  if (!slot) return;
  originalOrder.forEach(el => slot.appendChild(el));
  currentSort = null;
  updateSortButtonState();
}

function openIdeasPage() {
  const slot = document.querySelector('.s-main-slot');
  if (!slot) return;

  // Lấy theo thứ tự hiển thị thực tế trên trang (DOM order)
  const items = Array.from(slot.querySelectorAll('.s-result-item[data-asin][data-imerch-rank]'));

  if (items.length === 0) {
    alert('Chưa có dữ liệu rank. Hãy đợi extension load xong hoặc bấm +1/+3 để load thêm.');
    return;
  }

  chrome.storage.sync.get(['ideasTrademarks', 'ideasMaxProducts'], result => {
    const keywordList = (result.ideasTrademarks || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    const maxProducts = parseInt(result.ideasMaxProducts) || 12;

    const products = [];
    const skipped = [];

    for (const el of items) {
      const asin    = el.dataset.asin || '';
      const rank    = parseInt(el.dataset.imerchRank) || 0;
      const title   = el.dataset.imerchTitle || el.querySelector('h2')?.textContent?.trim() || '';
      const brand   = el.dataset.imerchBrand || '';
      const bullet1 = el.dataset.imerchBullet1 || '';
      const bullet2 = el.dataset.imerchBullet2 || '';
      const img     = el.querySelector('img[src*="amazon.com"], img[src*="media-amazon"]');
      const thumbnail = img ? img.src : '';

      if (!thumbnail) continue;

      if (keywordList.length > 0) {
        const combined = `${brand} ${title} ${bullet1} ${bullet2}`;
        const matched = keywordList.some(kw => new RegExp(kw, 'i').test(combined));
        if (matched) { skipped.push(asin); continue; }
      }

      products.push({ asin, rank, title, brand, bullet1, bullet2, thumbnail, date: el.dataset.imerchDate || '' });
      if (products.length >= maxProducts) break;
    }

    if (skipped.length > 0) logger.log(`Ideas filter: skipped ${skipped.length} — ${skipped.join(', ')}`);

    if (products.length === 0) {
      alert('Không có sản phẩm nào hợp lệ sau khi lọc keyword.');
      return;
    }

    chrome.runtime.sendMessage({ action: 'openIdeasPage', products, pageTitle: document.title });
  });
}

function updateSortButtonState() {
  const rankBtn = document.getElementById('imerch-btn-rank');
  const dateBtn = document.getElementById('imerch-btn-date');
  const active  = 'background:#ff9900; color:#fff; border-color:#e68900;';
  const normal  = 'background:#fff; color:inherit; border-color:#ccc;';
  if (rankBtn) rankBtn.style.cssText = rankBtn.style.cssText.replace(/background:[^;]+;.*?color:[^;]+;.*?border-color:[^;]+;/, currentSort === 'rank' ? active : normal);
  if (dateBtn) dateBtn.style.cssText = dateBtn.style.cssText.replace(/background:[^;]+;.*?color:[^;]+;.*?border-color:[^;]+;/, currentSort === 'date' ? active : normal);
}

async function loadMorePages(count) {
  if (isLoadingPages) return;
  isLoadingPages = true;

  const statusEl = document.getElementById('imerch-load-status');
  const slot = document.querySelector('.s-main-slot');
  if (!slot) { isLoadingPages = false; return; }

  const url = new URL(window.location.href);
  const basePage = parseInt(url.searchParams.get('page') || '1');

  for (let i = 1; i <= count; i++) {
    const targetPage = basePage + loadedExtraPages + i;
    if (statusEl) statusEl.textContent = `Loading page ${targetPage}...`;

    try {
      url.searchParams.set('page', targetPage);
      const response = await fetch(url.href, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      });
      if (!response.ok) break;

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const items = doc.querySelectorAll('.s-result-item[data-asin]:not(.AdHolder)');

      let injected = 0;
      items.forEach(item => {
        if (!item.dataset.asin) return;
        if (document.querySelector(`.s-result-item[data-asin="${item.dataset.asin}"]`)) return;
        slot.appendChild(document.adoptNode(item));
        injected++;
      });

      if (statusEl) statusEl.textContent = `Page ${targetPage}: +${injected} products`;
      logger.log(`Loaded page ${targetPage}: +${injected} items`);

      if (i < count) await randomDelay(settings.delayMin, settings.delayMax);
    } catch (err) {
      logger.error('Error loading page:', err);
      break;
    }
  }

  loadedExtraPages += count;
  isLoadingPages = false;
  if (statusEl) setTimeout(() => {
    statusEl.textContent = `+${loadedExtraPages} pages loaded`;
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
  }, 2000);
  updateAsinCount();

  // Re-apply sort if active
  if (currentSort) sortProducts(currentSort);
}

function injectSortBar() {
  if (document.querySelector('#imerch-sort-bar')) return true;
  const sortSelect = document.querySelector('#s-result-sort-select');
  if (!sortSelect) return false;

  // Tìm cột breadcrumb với nhiều fallback selectors
  const sgRow = sortSelect.closest('.sg-row') || document.querySelector('.sg-row');
  const breadcrumbCol =
    sgRow?.querySelector('.s-breadcrumb') ||
    sgRow?.querySelector('[class*="breadcrumb"]') ||
    document.querySelector('.s-breadcrumb') ||
    document.querySelector('[class*="breadcrumb"]');
  const colInner = breadcrumbCol?.querySelector('.sg-col-inner') || breadcrumbCol;

  // Fallback: nếu không tìm được breadcrumb, inject vào trước form Sort by
  const insertTarget = colInner || sortSelect.closest('form')?.parentElement;
  if (!insertTarget) return false;

  // Bar gọn ~150px để vừa cùng hàng với "Sort by:~130px" trong cột ~300px
  const btn     = 'padding:2px 5px; font-size:11px; cursor:pointer; border:1px solid #ccc; background:#fff; border-radius:3px; line-height:1.4; vertical-align:middle;';
  const loadBtn = 'padding:2px 5px; font-size:11px; cursor:pointer; border:1px solid #a78bfa; background:#fff; border-radius:3px; color:#6d28d9; line-height:1.4; vertical-align:middle;';

  const bar = document.createElement('span');
  bar.id = 'imerch-sort-bar';
  bar.style.cssText = 'display:flex; align-items:center; gap:3px; white-space:nowrap;';
  bar.innerHTML = `
    <button id="imerch-btn-ideas" style="${btn}" title="Generate design ideas from top products">💡 Ideas</button>
    <button id="imerch-btn-rank" style="${btn}" title="Sort by BSR (low → high)">📊 Rank</button>
    <button id="imerch-btn-date" style="${btn}" title="Sort by Date (newest first)">📅 Date</button>
    <button id="imerch-btn-reset" style="${btn}" title="Reset to Amazon order">↺</button>
    <span style="color:#ddd;margin:0 2px;">|</span>
    <button id="imerch-btn-load1" style="${loadBtn}" title="Load 1 more page">+1</button>
    <button id="imerch-btn-load3" style="${loadBtn}" title="Load 3 more pages">+3</button>
    <button id="imerch-btn-load5" style="${loadBtn}" title="Load 5 more pages">+5</button>
    <button id="imerch-btn-load10" style="${loadBtn}" title="Load 10 more pages">+10</button>
    <span id="imerch-load-status" style="font-size:10px;color:#888;"></span>
    <span id="imerch-asin-count" style="font-size:10px;color:#6d28d9;font-weight:600;margin-left:2px;"></span>
  `;

  if (colInner && breadcrumbCol) {
    // Breadcrumb mode: absolute, không đụng layout
    breadcrumbCol.style.position = 'relative';
    bar.style.position = 'absolute';
    bar.style.right = '0';
    bar.style.top = '50%';
    bar.style.transform = 'translateY(-50%)';
    colInner.appendChild(bar);
  } else {
    // Fallback: inline trước form Sort by
    bar.style.cssText += '; display:inline-flex; vertical-align:middle; margin-right:8px;';
    insertTarget.insertBefore(bar, sortSelect.closest('form'));
  }

  document.getElementById('imerch-btn-ideas').addEventListener('click', openIdeasPage);
  document.getElementById('imerch-btn-rank').addEventListener('click', () => sortProducts('rank'));
  document.getElementById('imerch-btn-date').addEventListener('click', () => sortProducts('date'));
  document.getElementById('imerch-btn-reset').addEventListener('click', resetSort);
  document.getElementById('imerch-btn-load1').addEventListener('click', () => loadMorePages(1));
  document.getElementById('imerch-btn-load3').addEventListener('click', () => loadMorePages(3));
  document.getElementById('imerch-btn-load5').addEventListener('click', () => loadMorePages(5));
  document.getElementById('imerch-btn-load10').addEventListener('click', () => loadMorePages(10));

  setTimeout(updateAsinCount, 500);
  logger.log('iMerch sort bar injected');
  return true;
}

function trySortBarInject(attempts = 0) {
  if (injectSortBar()) return;
  if (attempts < 10) setTimeout(() => trySortBarInject(attempts + 1), 800);
}

function updateAsinCount() {
  const el = document.getElementById('imerch-asin-count');
  if (!el) return;
  const total = document.querySelectorAll('.s-result-item[data-asin]').length;
  const done  = document.querySelectorAll('.s-result-item[data-asin][data-imerch-rank]').length;
  el.textContent = `${done}/${total} products`;
}

// Trích SKU từ inline scripts của product page (giống cách search results làm)
function extractSkuFromPageScripts() {
  for (const script of document.querySelectorAll('script')) {
    const match = script.textContent.match(/"hiRes":"https:\/\/m\.media-amazon\.com\/images\/I\/([^"]+)"/);
    if (match) {
      const parts = match[1].split(".png")[0].split("%7C");
      if (parts.length > 1) return parts[parts.length - 1];
    }
  }
  return null;
}

// Xử lý trang chi tiết sản phẩm — thêm nút Price History + Design Analysis dưới ảnh
function addButtonsToProductPage() {
  if (document.querySelector(".imerch-product-tools")) return;

  const leftCol = document.querySelector("#leftCol") || document.querySelector(".leftCol") || document.querySelector("#imageBlock");
  if (!leftCol) return;

  const imageEl = document.querySelector("#landingImage") || document.querySelector("#imgBlkFront") || leftCol.querySelector("img");
  if (!imageEl) return;

  // Ưu tiên hi-res design image (không có áo), fallback về thumbnail
  const sku = extractSkuFromPageScripts();
  const imageUrl = sku
    ? `https://m.media-amazon.com/images/I/${sku}.png`
    : imageEl.src;

  const getAsin = () => {
    const selectors = ['#asin', '#ASIN', 'input[name="ASIN"]', 'input[name="asin"]', '[data-asin]'];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const val = el?.value || el?.getAttribute('data-asin');
      if (val && val.length === 10) return val;
    }
    const urlMatch = window.location.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (urlMatch) return urlMatch[1];
    return "";
  };

  const asin = getAsin();
  const title = document.querySelector("#productTitle")?.innerText.trim() || "";

  const container = document.createElement("div");
  container.className = "imerch-product-tools";
  container.style.cssText = "margin-top: 15px; margin-bottom: 15px; display: flex; gap: 8px; flex-wrap: wrap;";

  const priceHistoryBtn = document.createElement("button");
  priceHistoryBtn.innerText = "📊 Price History";
  priceHistoryBtn.style.cssText = "padding: 8px 14px; font-size: 13px; cursor: pointer; border: 1px solid #ddd; background: transparent; border-radius: 5px;";
  priceHistoryBtn.onclick = () => {
    if (asin) showKeepaModal(asin);
  };

  const analysisBtn = document.createElement("button");
  analysisBtn.innerText = "🎨 Design Analysis";
  analysisBtn.style.cssText = "padding: 8px 14px; font-size: 13px; cursor: pointer; border: 1px solid #a78bfa; background: transparent; border-radius: 5px; color: #6d28d9; font-weight: 500;";
  analysisBtn.onclick = () => {
    if (!imageUrl) {
      alert("Product image not found for analysis.");
      return;
    }
    chrome.runtime.sendMessage({
      action: "copyAIPrompt",
      imageUrl,
      asin,
      title
    });
  };

  container.appendChild(priceHistoryBtn);
  container.appendChild(analysisBtn);

  if (sku) {
    const downloadBtn = document.createElement("button");
    downloadBtn.innerText = "⬇ Download";
    downloadBtn.style.cssText = "padding: 8px 14px; font-size: 13px; cursor: pointer; border: 1px solid #ddd; background: #fff; border-radius: 5px;";
    downloadBtn.onclick = () => {
      downloadBtn.disabled = true;
      downloadBtn.innerText = "Downloading...";
      chrome.runtime.sendMessage({ action: "processImage", asin, sku, title }, (response) => {
        downloadBtn.disabled = false;
        downloadBtn.innerText = "⬇ Download";
        if (response?.error) alert(`Download failed: ${response.error}`);
      });
    };
    container.appendChild(downloadBtn);
  }

  leftCol.appendChild(container);
  logger.log(`Product page buttons added for ASIN: ${asin}`);
}