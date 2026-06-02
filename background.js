// Debug flag - set to false for production
const DEBUG = false;

// Logger helpers
const logger = {
  log: (...args) => DEBUG && console.log('[iMerch]', ...args),
  warn: (...args) => DEBUG && console.warn('[iMerch]', ...args),
  error: (...args) => console.error('[iMerch]', ...args)
};

// Helper functions
function sendErrorResponse(sendResponse, errorMsg) {
  sendResponse({ asin: "error", rank: "error", date: "error", imageUrl: "", sku: "", error: errorMsg });
}

function decodeHtmlEntities(str) {
  const entities = {
    "\u0026amp;": "\u0026",
    "\u0026lt;": "\u003c",
    "\u0026gt;": "\u003e",
    "\u0026quot;": '"',
    "\u0026#39;": "'",
    "\u0026amp;#39;": "'"
  };
  return str.replace(/\u0026amp;|\u0026#39;|\u0026lt;|\u0026gt;|\u0026quot;|\u0026amp;#39;/g, (m) => entities[m] || m);
}

function extractProductInfo(html) {
  const asinMatch = html.match(/<span[^>]*>ASIN[\s\S]*?<\/span>\s*<span[^>]*>(\w{10})<\/span>/);
  const rankMatch = html.match(/Best Sellers Rank[^#]+#([\d,]+)/i);
  const dateMatch = html.match(/Date First Available[\s\S]*?<span[^>]*>([\w\s,]+)<\/span>/i);
  const imageMatch = html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/([^"}]+))"/);
  const titleMatch = html.match(/<span id="productTitle"[^>]*>([\s\S]*?)<\/span>/);

  let sku = "";
  if (imageMatch) {
    const imageUrl = imageMatch[1];
    const parts = imageUrl.split('.png')[0].split('%7C');
    sku = parts.length > 1 ? parts[parts.length - 1] : "";
  }

  return {
    asin: asinMatch ? asinMatch[1] : "N/A",
    rank: rankMatch ? rankMatch[1] : "N/A",
    date: dateMatch ? dateMatch[1].trim() : "N/A",
    imageUrl: sku ? `https://m.media-amazon.com/images/I/${sku}.png` : "",
    sku: sku,
    title: titleMatch ? titleMatch[1].trim() : "N/A"
  };
}

async function processImage(asin, sku, title, sendResponse) {
  if (!sku || typeof sku !== "string" || !asin || !title) {
    logger.error("Invalid input parameters:", { asin, sku, title });
    sendErrorResponse(sendResponse, "Invalid input parameters: asin, sku, or title missing");
    return;
  }

  const imageUrl = `https://m.media-amazon.com/images/I/${sku}.png`;
  try {
    const res = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    let cropBox;
    if (bitmap.width === 2138 && bitmap.height === 2000) {
      cropBox = { x: 640, y: 468, width: 858, height: 1029 };
    } else if (bitmap.width === 2000 && bitmap.height === 1871) {
      cropBox = { x: 599, y: 438, width: 803, height: 963 };
    } else {
      cropBox = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    }
    const canvas = new OffscreenCanvas(cropBox.width, cropBox.height);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Failed to get 2D context from OffscreenCanvas");
    ctx.drawImage(bitmap, cropBox.x, cropBox.y, cropBox.width, cropBox.height, 0, 0, cropBox.width, cropBox.height);
    const imageData = ctx.getImageData(0, 0, cropBox.width, cropBox.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i] / 4) * 4; // R
      data[i + 1] = Math.round(data[i + 1] / 4) * 4; // G
      data[i + 2] = Math.round(data[i + 2] / 4) * 4; // B
    }
    ctx.putImageData(imageData, 0, 0);
    const processedBlob = await canvas.convertToBlob({ type: "image/png" });
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      let decodedTitle = decodeHtmlEntities(title);
      let cleanedTitle = decodedTitle.replace(/T-Shirt/gi, "").trim();
      const invalidChars = /[\/\\:*?"<>|]/g;
      let safeTitle = cleanedTitle.replace(invalidChars, "_").trim();
      const maxLength = 255 - `(${asin}) `.length - ".png".length;
      if (safeTitle.length > maxLength) safeTitle = safeTitle.substring(0, maxLength);
      const filename = `(${asin}) ${safeTitle}.png`;
      logger.log(`Attempting to download file: ${filename}`);
      chrome.downloads.download({ url: dataUrl, filename, conflictAction: "uniquify" }, (downloadId) => {
        if (chrome.runtime.lastError) {
          logger.error(`Download failed: ${chrome.runtime.lastError.message}, Filename: ${filename}`);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          logger.log(`Download successful, ID: ${downloadId}`);
          sendResponse({ success: true, downloadId });
        }
      });
    };
    reader.readAsDataURL(processedBlob);
  } catch (err) {
    logger.error(`Error in processImage: ${err.message}`);
    sendErrorResponse(sendResponse, `Image processing failed: ${err.message}`);
  }
}

// Enable session storage for content scripts
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchProductInfo") {
    fetch(request.url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        return resp.text();
      })
      .then((html) => sendResponse(extractProductInfo(html)))
      .catch((err) => sendErrorResponse(sendResponse, `Fetch failed: ${err.message}`));
    return true;
  }

  if (request.action === "processImage") {
    processImage(request.asin, request.sku, request.title, sendResponse);
    return true;
  }

  if (request.action === "configureProxy") {
    const settings = request.settings;
    if (settings.proxyEnabled) {
      chrome.storage.local.set({ proxyCredentials: { username: settings.proxyUsername, password: settings.proxyPassword, host: settings.proxyHost, port: settings.proxyPort } });
      let config;
      if (settings.proxyScope === "amazon") {
        const pacScript = `function FindProxyForURL(url, host) {
          if (shExpMatch(host, "*.amazon.*") || shExpMatch(host, "amazon.*") || shExpMatch(host, "*.media-amazon.com") || shExpMatch(host, "*.ssl-images-amazon.com")) {
            return "PROXY ${settings.proxyHost}:${settings.proxyPort}";
          }
          return "DIRECT";
        }`;
        config = { mode: "pac_script", pacScript: { data: pacScript } };
      } else {
        config = { mode: "fixed_servers", rules: { singleProxy: { scheme: "http", host: settings.proxyHost, port: parseInt(settings.proxyPort) }, bypassList: ["localhost", "127.0.0.1"] } };
      }
      chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {
        if (chrome.runtime.lastError) {
          logger.error("Proxy setup failed:", chrome.runtime.lastError);
          sendResponse({ success: false, error: "Proxy setup failed: " + chrome.runtime.lastError.message });
        } else {
          logger.log("Proxy configured successfully:", config);
          if (chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy) {
            chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: "disable_non_proxied_udp" }, () => {
              if (chrome.runtime.lastError) logger.warn("Failed to set WebRTC policy:", chrome.runtime.lastError);
              else logger.log("WebRTC IP handling policy set to disable_non_proxied_udp");
            });
          }
          sendResponse({ success: true });
        }
      });
    } else {
      chrome.storage.local.remove('proxyCredentials');
      chrome.proxy.settings.clear({ scope: "regular" }, () => {
        logger.log("Proxy settings cleared");
        if (chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy) {
          chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: "default" }, () => {
            if (chrome.runtime.lastError) logger.warn("Failed to reset WebRTC policy:", chrome.runtime.lastError);
            else logger.log("WebRTC IP handling policy reset to default");
          });
        }
        sendResponse({ success: true });
      });
    }
    return true;
  }

  return false;
});

chrome.webRequest.onAuthRequired.addListener(
  (details) => new Promise((resolve) => {
    chrome.storage.local.get(['proxyCredentials'], (result) => {
      if (result.proxyCredentials && result.proxyCredentials.username) {
        logger.log("Providing proxy credentials for:", details.url);
        resolve({ authCredentials: { username: result.proxyCredentials.username, password: result.proxyCredentials.password } });
      } else {
        logger.log("No proxy credentials found");
        resolve({});
      }
    });
  }),
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);