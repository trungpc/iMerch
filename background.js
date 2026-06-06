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

function decodeHtmlEntities(str) {
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><body>${str}`, 'text/html');
  return doc.body.textContent;
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
    title: titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : "N/A"
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

// ====== Design Analysis Feature (ported from iDesign) ======

const DEFAULT_CLIENT_ID = "269611885645-2le7a3p3eprvvssr2rv49ggebm65v0do.apps.googleusercontent.com";
let analysisLogs = [];

function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const displayMessage = message.length > 500 ? message.substring(0, 497) + "..." : message;
  analysisLogs.push(`[${timestamp}] ${displayMessage}`);
  console.log(`[${timestamp}] ${message}`);
  if (analysisLogs.length > 50) analysisLogs.shift();
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < maxRetries - 1) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '65');
      addLog(`Rate limit (429) — chờ ${retryAfter}s rồi thử lại (lần ${attempt + 1}/${maxRetries - 1})...`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    return res;
  }
}

async function getAuthToken() {
  const cached = await new Promise(resolve => {
    chrome.storage.local.get(["google_access_token", "google_token_expiry"], resolve);
  });
  if (cached.google_access_token && cached.google_token_expiry > Date.now()) {
    return cached.google_access_token;
  }
  const { googleClientId } = await new Promise(resolve => {
    chrome.storage.sync.get(["googleClientId"], resolve);
  });
  const clientId = googleClientId || DEFAULT_CLIENT_ID;
  if (!clientId) throw new Error("Vui lòng cấu hình 'Google Client ID' trong phần cài đặt Extension.");
  const redirectUri = chrome.identity.getRedirectURL();
  const scopes = encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets");
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`;
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!redirectUrl) { reject(new Error("Không nhận được phản hồi từ Google.")); return; }
      const params = new URLSearchParams(redirectUrl.split('#')[1]);
      const accessToken = params.get('access_token');
      const expiresIn = parseInt(params.get('expires_in')) || 3600;
      if (accessToken) {
        chrome.storage.local.set({ google_access_token: accessToken, google_token_expiry: Date.now() + (expiresIn * 1000) - 60000 });
        resolve(accessToken);
      } else {
        reject(new Error("Không tìm thấy Access Token trong phản hồi từ Google."));
      }
    });
  });
}

async function uploadToDrive(blob, filename, folderId, token) {
  const metadata = { name: filename, parents: folderId ? [folderId] : [] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: new Headers({ 'Authorization': 'Bearer ' + token }), body: form
  });
  if (!response.ok) { const error = await response.text(); throw new Error(`Drive Upload Error: ${response.status} ${error}`); }
  const data = await response.json();
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: new Headers({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return { id: data.id, directLink: `https://drive.google.com/uc?export=download&id=${data.id}` };
}

async function appendToSheet(spreadsheetId, sheetName, mappingInfo, data, token) {
  const getResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!1:1`, {
    method: 'GET', headers: new Headers({ 'Authorization': 'Bearer ' + token })
  });
  if (!getResponse.ok) throw new Error(`Sheets Header Fetch Error: ${getResponse.status}`);
  const getResult = await getResponse.json();
  const headers = getResult.values ? getResult.values[0] : [];
  if (headers.length === 0) throw new Error("Bảng tính chưa có dòng tiêu đề (Header) ở dòng 1.");
  const normalizedHeaders = headers.map(h => String(h).trim().toLowerCase());
  const findIndex = (headerName) => headerName ? normalizedHeaders.indexOf(headerName.trim().toLowerCase()) : -1;
  const indices = {
    asin: findIndex(mappingInfo.colAsinHeader || "asin"),
    title: findIndex(mappingInfo.colTitleHeader || "title"),
    url: findIndex(mappingInfo.colUrlHeader || "url"),
    youth: findIndex(mappingInfo.colYouthHeader || "youth"),
    colors: findIndex(mappingInfo.colColorsHeader || "colors")
  };
  const missing = [];
  if (indices.asin === -1) missing.push(mappingInfo.colAsinHeader || "asin");
  if (indices.title === -1) missing.push(mappingInfo.colTitleHeader || "title");
  if (indices.url === -1) missing.push(mappingInfo.colUrlHeader || "url");
  if (missing.length > 0) throw new Error(`Không tìm thấy các cột tiêu đề: ${missing.join(", ")}`);
  const maxIndex = Math.max(indices.asin, indices.title, indices.url, indices.youth, indices.colors);
  const rowValues = new Array(maxIndex + 1).fill("");
  if (indices.asin !== -1) rowValues[indices.asin] = data.asin || "";
  if (indices.title !== -1) rowValues[indices.title] = data.title || "";
  if (indices.url !== -1) rowValues[indices.url] = data.driveUrl || "";
  if (indices.youth !== -1) rowValues[indices.youth] = data.youth || "";
  if (indices.colors !== -1) rowValues[indices.colors] = data.color || "";
  const appendResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: new Headers({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ values: [rowValues] })
  });
  if (!appendResponse.ok) { const error = await appendResponse.text(); throw new Error(`Sheets Append Error: ${appendResponse.status} ${error}`); }
  return await appendResponse.json();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getLogs") {
    sendResponse({ logs: analysisLogs });
    return false;
  }

  if (request.action === "uploadAndLogToDriveBatch") {
    (async () => {
      try {
        const items = request.items;
        addLog(`Batch upload: ${items.length} images`);
        const token = await getAuthToken();
        const { driveFolderId, sheetId, sheetName, colAsinHeader, colTitleHeader, colUrlHeader, colYouthHeader, colColorsHeader } = await new Promise(resolve => {
          chrome.storage.sync.get(["driveFolderId", "sheetId", "sheetName", "colAsinHeader", "colTitleHeader", "colUrlHeader", "colYouthHeader", "colColorsHeader"], resolve);
        });
        if (!driveFolderId || !sheetId || !sheetName) throw new Error("Vui lòng cấu hình đầy đủ Drive Folder ID và Sheet ID trong phần cài đặt.");
        const getResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!1:1`, { headers: new Headers({ 'Authorization': 'Bearer ' + token }) });
        if (!getResponse.ok) throw new Error(`Sheets Header Fetch Error: ${getResponse.status}`);
        const getResult = await getResponse.json();
        const headers = getResult.values ? getResult.values[0] : [];
        if (headers.length === 0) throw new Error("Bảng tính chưa có dòng tiêu đề (Header) ở dòng 1.");
        const normalizedHeaders = headers.map(h => String(h).trim().toLowerCase());
        const findIndex = (name) => name ? normalizedHeaders.indexOf(name.trim().toLowerCase()) : -1;
        const indices = {
          asin: findIndex(colAsinHeader || "asin"), title: findIndex(colTitleHeader || "title"),
          url: findIndex(colUrlHeader || "url"), youth: findIndex(colYouthHeader || "youth"),
          colors: findIndex(colColorsHeader || "colors")
        };
        const missing = [];
        if (indices.asin === -1) missing.push(colAsinHeader || "asin");
        if (indices.title === -1) missing.push(colTitleHeader || "title");
        if (indices.url === -1) missing.push(colUrlHeader || "url");
        if (missing.length > 0) throw new Error(`Không tìm thấy các cột tiêu đề: ${missing.join(", ")}`);
        const CHUNK = 5;
        const results = new Array(items.length);
        for (let i = 0; i < items.length; i += CHUNK) {
          const chunk = items.slice(i, i + CHUNK);
          const chunkResults = await Promise.all(chunk.map(async (item, j) => {
            const idx = i + j;
            try {
              const fetchRes = await fetch(item.imageUrl);
              if (!fetchRes.ok) throw new Error("Failed to fetch image");
              const blob = await fetchRes.blob();
              const driveResult = await uploadToDrive(blob, item.filename, driveFolderId, token);
              addLog(`Uploaded [${idx + 1}/${items.length}]: ${item.filename}`);
              return { success: true, item, driveUrl: driveResult.directLink };
            } catch (err) {
              addLog(`Error [${idx + 1}]: ${err.message}`);
              return { success: false, item, error: err.message };
            }
          }));
          chunkResults.forEach((r, j) => { results[i + j] = r; });
        }
        const maxIndex = Math.max(indices.asin, indices.title, indices.url, indices.youth, indices.colors);
        const rows = results.filter(r => r.success).map(r => {
          const row = new Array(maxIndex + 1).fill("");
          if (indices.asin !== -1) row[indices.asin] = r.item.asin || "";
          if (indices.title !== -1) row[indices.title] = r.item.title || "";
          if (indices.url !== -1) row[indices.url] = r.driveUrl || "";
          if (indices.youth !== -1) row[indices.youth] = r.item.youth || "";
          if (indices.colors !== -1) row[indices.colors] = r.item.color || "";
          return row;
        });
        if (rows.length > 0) {
          const appendResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`, {
            method: 'POST',
            headers: new Headers({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }),
            body: JSON.stringify({ values: rows })
          });
          if (!appendResponse.ok) { const err = await appendResponse.text(); throw new Error(`Sheets Append Error: ${appendResponse.status} ${err}`); }
          addLog(`Wrote ${rows.length} rows to Sheet.`);
        }
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        sendResponse({ success: true, successCount, errorCount, results });
      } catch (error) {
        addLog(`Batch Drive/Sheet Error: ${error.message}`);
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }

  if (request.action === "copyAIPrompt") {
    (async () => {
      try {
        addLog(`Opening analysis tab for: ${request.imageUrl}`);
        const analysisId = 'analysis_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        await chrome.storage.local.set({
          [analysisId]: {
            imageUrl: request.imageUrl,
            analysis: null,
            error: null,
            asin: request.asin || "",
            title: request.title || "",
            ready: true
          }
        });
        const analysisUrl = chrome.runtime.getURL(`analysis.html?id=${analysisId}`);
        chrome.tabs.create({ url: analysisUrl });
        addLog("Opened analysis tab: " + analysisId);
        sendResponse({ success: true, message: "Design analysis tab opened!" });
      } catch (error) {
        addLog(`Error opening analysis tab: ${error.message}`);
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }

  if (request.action === "regenerateAnalysis") {
    (async () => {
      try {
        const { analysisId, imageUrl, promptVN } = request;
        addLog(`Regenerating analysis ${analysisId}`);
        await chrome.storage.local.set({ [analysisId]: { imageUrl, analysis: null, error: null, asin: request.asin || "", title: request.title || "" } });
        const { analysisProvider, geminiKey, geminiModel, useGoogleSearch, openaiKey, openaiModel, useOpenaiWebSearch } = await new Promise(resolve => {
          chrome.storage.sync.get(["analysisProvider", "geminiKey", "geminiModel", "useGoogleSearch", "openaiKey", "openaiModel", "useOpenaiWebSearch"], resolve);
        });
        const provider = analysisProvider || "gemini";
        addLog("Fetching image for regeneration...");
        const imageFetchResponse = await fetch(imageUrl);
        if (!imageFetchResponse.ok) throw new Error(`Failed to fetch image: ${imageFetchResponse.status}`);
        const blob = await imageFetchResponse.blob();
        const reader = new FileReader();
        const imageData = await new Promise((resolve, reject) => { reader.onloadend = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        const base64Data = imageData.split(",")[1];
        let analysisText = "";
        if (provider === "openai") {
          if (!openaiKey) throw new Error("OpenAI API key not configured.");
          const model = openaiModel || "gpt-4o-mini";
          addLog(`Sending to OpenAI Responses API (${model})`);
          const openaiBody = {
            model,
            input: [{ role: "user", content: [{ type: "input_text", text: promptVN }, { type: "input_image", image_url: `data:${blob.type || "image/jpeg"};base64,${base64Data}`, detail: "high" }] }],
            text: { format: { type: "json_object" } }
          };
          if (useOpenaiWebSearch) { openaiBody.tools = [{ type: "web_search_preview" }]; }
          const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
            method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(openaiBody)
          });
          const openaiBodyText = await openaiResponse.text();
          if (!openaiResponse.ok) throw new Error(`OpenAI API failed: ${openaiResponse.status}`);
          const openaiData = JSON.parse(openaiBodyText);
          const messageOutput = openaiData?.output?.find(o => o.type === "message");
          analysisText = messageOutput?.content?.find(c => c.type === "output_text")?.text || "";
        } else {
          if (!geminiKey) throw new Error("Gemini API key not configured.");
          const modelToUse = geminiModel || "gemini-3.5-flash";
          const geminiApiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${geminiKey}`;
          addLog(`Sending to Gemini (${modelToUse})`);
          const requestBody = {
            contents: [{ parts: [{ text: promptVN }, { inlineData: { mimeType: blob.type || "image/jpeg", data: base64Data } }] }]
          };
          // Google Search không tương thích với response_mime_type json — chỉ bật 1 trong 2
          if (useGoogleSearch) {
            requestBody.tools = [{ google_search: {} }];
          } else {
            requestBody.generationConfig = { response_mime_type: "application/json" };
          }
          const geminiResponse = await fetch(geminiApiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
          const geminiResponseBodyText = await geminiResponse.text();
          if (!geminiResponse.ok) throw new Error(`Gemini API failed: ${geminiResponse.status}`);
          const geminiData = JSON.parse(geminiResponseBodyText);
          analysisText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
        addLog("Regeneration result: " + analysisText.slice(0, 100) + "...");
        await chrome.storage.local.set({ [analysisId]: { imageUrl, analysis: analysisText, error: null, asin: request.asin || "", title: request.title || "" } });
        sendResponse({ success: true, message: "Regeneration completed" });
      } catch (error) {
        addLog(`Error during regeneration: ${error.message}`);
        await chrome.storage.local.set({ [request.analysisId]: { imageUrl: request.imageUrl, analysis: null, error: error.message, asin: request.asin || "", title: request.title || "" } });
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }

  if (request.action === "autoEvaluateDesigns") {
    (async () => {
      try {
        const { items, designContext } = request;
        if (!items?.length) { sendResponse({ success: false, message: "No images to evaluate." }); return; }
        addLog(`autoEvaluateDesigns: ${items.length} images`);

        const { analysisProvider, geminiKey, geminiModel, openaiKey, openaiModel, autoCheckModel, autoCheckPrompt } =
          await new Promise(resolve => chrome.storage.sync.get(
            ["analysisProvider", "geminiKey", "geminiModel", "openaiKey", "openaiModel", "autoCheckModel", "autoCheckPrompt"], resolve
          ));
        const provider = analysisProvider || "gemini";

        // Fetch images as base64 (service worker không bị CORS)
        const imageDataList = await Promise.all(items.map(async item => {
          try {
            if (item.url.startsWith('data:')) {
              const [header, base64] = item.url.split(',');
              return { ...item, base64, mimeType: header.match(/data:([^;]+)/)?.[1] || 'image/png' };
            }
            const res = await fetch(item.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const reader = new FileReader();
            const dataUrl = await new Promise((ok, err) => {
              reader.onloadend = () => ok(reader.result);
              reader.onerror = err;
              reader.readAsDataURL(blob);
            });
            return { ...item, base64: dataUrl.split(',')[1], mimeType: blob.type || 'image/png' };
          } catch (e) {
            addLog(`Failed to load image ${item.index}: ${e.message}`);
            return { ...item, base64: null, mimeType: 'image/png' };
          }
        }));

        const defaultCheckPrompt = `You are a t-shirt design QC expert. Analyze the image and perform 2 tasks:

TASK 1 — TEXT CHECK (only if text is visible on the design):
- Read all text visible in the image
- Cross-check against the original text mentioned in the design description below — ensure no text was added, removed, or misspelled
- If any issue found: describe briefly (e.g. "Spelling error: 'Hapiness' → 'Happiness'" or "Extra text added")
- If no text visible or no issues: set hasError to false and feedback to ""

TASK 2 — BACKGROUND SELECTION:
- "black": bright/colorful design → dark background makes it pop
- "grey": neutral tones
- "white": dark/bold design → light background for visibility`;

        const checkPromptBase = autoCheckPrompt || defaultCheckPrompt;
        const contextBlock = designContext
          ? `\n=== DESIGN DESCRIPTION ===\n${designContext}\n===\n`
          : '';
        const textPrompt = `${checkPromptBase}
${contextBlock}
Return ONLY a JSON object:
{"background": "black", "hasError": false, "feedback": ""}`;

        const validBg = new Set(["black", "grey", "white"]);

        const allResults = await Promise.all(imageDataList.map(async img => {
          try {
            let raw = '{}';
            if (provider === "openai") {
              if (!openaiKey) throw new Error("OpenAI API key not configured.");
              const model = autoCheckModel || openaiModel || "gpt-4o-mini";
              const contentParts = [{ type: "input_text", text: textPrompt }];
              if (img.base64) contentParts.push({
                type: "input_image",
                image_url: `data:${img.mimeType};base64,${img.base64}`,
                detail: "high"
              });
              const res = await fetch("https://api.openai.com/v1/responses", {
                method: "POST",
                headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model, input: [{ role: "user", content: contentParts }] })
              });
              const txt = await res.text();
              if (!res.ok) throw new Error(`OpenAI: ${res.status} ${txt.slice(0, 200)}`);
              raw = JSON.parse(txt)?.output?.find(o => o.type === "message")?.content?.find(c => c.type === "output_text")?.text || '{}';
            } else {
              if (!geminiKey) throw new Error("Gemini API key not configured.");
              const model = autoCheckModel || geminiModel || "gemini-2.0-flash";
              const parts = [{ text: textPrompt }];
              if (img.base64) parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
              const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
                { method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ contents: [{ parts }], generationConfig: { response_mime_type: "application/json" } }) }
              );
              const txt = await res.text();
              if (!res.ok) throw new Error(`Gemini: ${res.status} ${txt.slice(0, 200)}`);
              raw = JSON.parse(txt)?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            }
            const r = JSON.parse(raw);
            return {
              index: img.index,
              background: validBg.has(r.background) ? r.background : "black",
              hasError: !!r.hasError,
              feedback: typeof r.feedback === 'string' ? r.feedback : ''
            };
          } catch (e) {
            addLog(`autoEvaluateDesigns image ${img.index} error: ${e.message}`);
            return { index: img.index, background: "black", hasError: false, feedback: '' };
          }
        }));

        addLog(`autoEvaluateDesigns: done, ${allResults.length} results.`);
        sendResponse({ success: true, results: allResults });

      } catch (error) {
        addLog(`autoEvaluateDesigns error: ${error.message}`);
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }

  if (request.action === "generateIdeogramImage") {
    (async () => {
      const jobId = request.jobId;
      try {
        addLog(`Generating Ideogram image for job ${jobId}`);
        const { ideogramKey } = await new Promise(resolve => { chrome.storage.sync.get(["ideogramKey"], resolve); });
        if (!ideogramKey) throw new Error("Ideogram API key not configured.");
        const config = request.config || {};
        const formData = new FormData();
        formData.append("prompt", request.prompt);
        formData.append("rendering_speed", config.rendering_speed || "TURBO");
        if (config.aspect_ratio) formData.append("aspect_ratio", config.aspect_ratio);
        if (config.magic_prompt) formData.append("magic_prompt", config.magic_prompt);
        if (config.num_images && config.num_images > 1) formData.append("num_images", String(config.num_images));
        if (config.negative_prompt) formData.append("negative_prompt", config.negative_prompt);
        const ideogramResponse = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate-transparent", { method: "POST", headers: { "Api-Key": ideogramKey }, body: formData });
        const responseText = await ideogramResponse.text();
        if (!ideogramResponse.ok) throw new Error(`Ideogram API failed: ${ideogramResponse.status} ${responseText.slice(0, 200)}`);
        const responseData = JSON.parse(responseText);
        const imageUrls = responseData?.data?.map(img => img.url).filter(Boolean) || [];
        if (imageUrls.length === 0) throw new Error("No image URL in Ideogram response");
        addLog(`Ideogram generated: ${imageUrls.length} images`);
        await chrome.storage.local.set({ [jobId]: { jobId, status: "done", imageUrl: imageUrls[0], imageUrls, prompt: request.prompt, audience: request.audience, styleName: request.styleName, error: null } });
        sendResponse({ success: true, message: "Image generation completed" });
      } catch (error) {
        addLog(`Error generating Ideogram image: ${error.message}`);
        await chrome.storage.local.set({ [jobId]: { jobId, status: "error", imageUrl: null, prompt: request.prompt, audience: request.audience, styleName: request.styleName, error: error.message } });
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }

  if (request.action === "generateGptImage2") {
    (async () => {
      const jobId = request.jobId;
      try {
        addLog(`Generating GPT Image for job ${jobId}`);
        const { openaiKey } = await new Promise(resolve => { chrome.storage.sync.get(["openaiKey"], resolve); });
        if (!openaiKey) throw new Error("OpenAI API key not configured.");
        const config = request.config || {};
        let imageUrls = [];
        if (config.apiType === 'responses_api') {
          const model = config.model || "gpt-4.1";
          const tool = { type: "image_generation", size: config.size || "1024x1536", quality: config.quality || "medium", background: config.background || "auto" };
          const respBody = { model, input: request.prompt, tools: [tool] };
          const response = await fetchWithRetry("https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(respBody) });
          const responseText = await response.text();
          if (!response.ok) throw new Error(`Responses API failed: ${response.status} ${responseText.slice(0, 200)}`);
          const responseData = JSON.parse(responseText);
          imageUrls = (responseData.output || []).filter(o => o.type === "image_generation_call" && o.result).map(o => `data:image/png;base64,${o.result}`);
        } else {
          const body = { model: config.model || "gpt-image-2", prompt: request.prompt, n: config.n || 1, size: config.size || "1024x1536", quality: config.quality || "medium", moderation: config.moderation || "low", output_format: "png", background: config.background || "auto" };
          const response = await fetchWithRetry("https://api.openai.com/v1/images/generations", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const responseText = await response.text();
          if (!response.ok) throw new Error(`GPT Image API failed: ${response.status} ${responseText.slice(0, 200)}`);
          const responseData = JSON.parse(responseText);
          imageUrls = (responseData.data || []).map(img => img.b64_json ? `data:image/png;base64,${img.b64_json}` : null).filter(Boolean);
        }
        if (imageUrls.length === 0) throw new Error("No image data in GPT Image response");
        if (config.removeBg === 'ideogram') {
          await chrome.storage.local.set({ [jobId]: { jobId, status: "removing_bg", imageUrl: imageUrls[0], imageUrls, prompt: request.prompt, audience: request.audience, styleName: request.styleName, error: null } });
          const { ideogramKey } = await new Promise(resolve => { chrome.storage.sync.get(["ideogramKey"], resolve); });
          if (!ideogramKey) throw new Error("Ideogram API key chưa cấu hình (cần để xóa nền).");
          imageUrls = await Promise.all(imageUrls.map(async (url) => {
            try {
              const base64 = url.split(',')[1];
              const byteStr = atob(base64);
              const arr = new Uint8Array(byteStr.length);
              for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
              const blob = new Blob([arr], { type: 'image/png' });
              const form = new FormData();
              form.append('image', blob, 'image.png');
              const res = await fetchWithRetry('https://api.ideogram.ai/v1/remove-background', { method: 'POST', headers: { 'Api-Key': ideogramKey }, body: form });
              if (!res.ok) { const err = await res.text(); throw new Error(`Remove background failed: ${res.status} ${err.slice(0, 200)}`); }
              const data = await res.json();
              const resultUrl = data.data?.[0]?.url;
              if (!resultUrl) throw new Error("Không nhận được URL từ Ideogram remove-background");
              return resultUrl;
            } catch (err) {
              addLog(`Remove background failed, dùng ảnh gốc: ${err.message}`);
              return url;
            }
          }));
        }
        await chrome.storage.local.set({ [jobId]: { jobId, status: "done", imageUrl: imageUrls[0], imageUrls, prompt: request.prompt, audience: request.audience, styleName: request.styleName, error: null } });
        sendResponse({ success: true, message: "Image generation completed" });
      } catch (error) {
        addLog(`Error generating GPT Image: ${error.message}`);
        await chrome.storage.local.set({ [jobId]: { jobId, status: "error", imageUrl: null, prompt: request.prompt, audience: request.audience, styleName: request.styleName, error: error.message } });
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }

  return false;
});