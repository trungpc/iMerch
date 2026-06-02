// Debug flag - set to false for production
const DEBUG = false;

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
    document.addEventListener('DOMContentLoaded', processProducts);
  } else {
    processProducts();
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

  let sku = "";
  if (imageMatch) {
    const imageUrl = imageMatch[1];
    const imageParts = imageUrl.split(".png")[0].split("%7C");
    sku = imageParts.length > 1 ? imageParts[imageParts.length - 1] : "";
  }

  return {
    asin: knownAsin || (asinMatch ? asinMatch[1] : "N/A"),
    rank: rankMatch ? rankMatch[1] : "N/A",
    date: dateMatch ? dateMatch[1].trim() : "N/A",
    sku: sku,
    title: titleMatch ? titleMatch[1].trim() : "N/A"
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
    <div style="margin-top: 5px;">
      <button class="amasort-price-history" style="padding: 2px 6px; font-size: 12px; cursor: pointer; border: 1px solid #ddd; background: transparent; border-radius: 3px;">
        📊 Price History
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