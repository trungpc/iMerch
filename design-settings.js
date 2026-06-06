const DEFAULT_ANALYSIS_PROMPT = `1. Phân tích nội dung thiết kế:
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

const DEFAULT_AUTO_CHECK_PROMPT = `You are a t-shirt design QC expert. Analyze the image and perform 2 tasks:

TASK 1 — TEXT CHECK (only if text is visible on the design):
- Read all text visible in the image
- Cross-check against the original text mentioned in the design description below — ensure no text was added, removed, or misspelled
- If any issue found: describe briefly (e.g. "Spelling error: 'Hapiness' → 'Happiness'" or "Extra text added")
- If no text visible or no issues: set hasError to false and feedback to ""

TASK 2 — BACKGROUND SELECTION:
- "black": bright/colorful design → dark background makes it pop
- "grey": neutral tones
- "white": dark/bold design → light background for visibility`;

const KEYS = [
  "analysisProvider", "geminiKey", "geminiModel", "useGoogleSearch",
  "openaiKey", "openaiModel", "useOpenaiWebSearch", "ideogramKey", "promptVN",
  "autoCheckModel", "autoCheckPrompt",
  "sheetId", "sheetName", "googleClientId", "driveFolderId",
  "colAsinHeader", "colTitleHeader", "colUrlHeader", "colYouthHeader", "colColorsHeader",
  "maxFilenameLength",
  "hoverEnabled", "hoverMinWidth", "hoverBtnPosition", "hoverBlacklist"
];

const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

let currentProvider = "gemini"; // analysis provider: gemini | openai
let currentTab = "gemini";     // active tab: gemini | openai | ideogram

function setTab(tab) {
  currentTab = tab;
  if (tab === "gemini" || tab === "openai") currentProvider = tab;
  document.getElementById("geminiSection").style.display = tab === "gemini" ? "flex" : "none";
  document.getElementById("openaiSection").style.display = tab === "openai" ? "flex" : "none";
  document.getElementById("ideogramSection").style.display = tab === "ideogram" ? "flex" : "none";
  document.querySelectorAll(".provider-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.provider === tab);
  });
}

document.querySelectorAll(".provider-btn").forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.provider));
});

function showStatus(msg, type = "success") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status " + type;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 3000);
}

// Show Redirect URI for OAuth setup
const redirectUri = chrome.identity.getRedirectURL();
const rdEl = document.getElementById("currentRedirectUri");
if (rdEl) rdEl.textContent = redirectUri;

// Load
chrome.storage.sync.get(KEYS, (result) => {
  setTab(result.analysisProvider || "gemini");
  setVal("geminiKey", result.geminiKey);
  setVal("geminiModel", result.geminiModel || "gemini-3.5-flash");
  setCheck("useGoogleSearch", result.useGoogleSearch);
  setVal("openaiKey", result.openaiKey);
  setVal("openaiModel", result.openaiModel || "gpt-4.1");
  setCheck("useOpenaiWebSearch", result.useOpenaiWebSearch);
  setVal("ideogramKey", result.ideogramKey);
  const promptEl = document.getElementById("promptVN");
  if (promptEl) promptEl.value = result.promptVN || DEFAULT_ANALYSIS_PROMPT;
  const autoCheckSelect = document.getElementById("autoCheckModel");
  if (autoCheckSelect && result.autoCheckModel) {
    const opt = document.createElement("option");
    opt.value = result.autoCheckModel;
    opt.textContent = result.autoCheckModel;
    opt.selected = true;
    autoCheckSelect.appendChild(opt);
  }
  const autoCheckPromptEl = document.getElementById("autoCheckPrompt");
  if (autoCheckPromptEl) autoCheckPromptEl.value = result.autoCheckPrompt || DEFAULT_AUTO_CHECK_PROMPT;
  setVal("sheetId", result.sheetId);
  setVal("sheetName", result.sheetName);
  setVal("googleClientId", result.googleClientId);
  setVal("driveFolderId", result.driveFolderId);
  setVal("colAsinHeader", result.colAsinHeader);
  setVal("colTitleHeader", result.colTitleHeader);
  setVal("colUrlHeader", result.colUrlHeader);
  setVal("colYouthHeader", result.colYouthHeader);
  setVal("colColorsHeader", result.colColorsHeader);
  if (result.maxFilenameLength) document.getElementById("maxFilenameLength").value = result.maxFilenameLength;

  // Image Hover Analysis
  setCheck("hoverEnabled", result.hoverEnabled !== false); // default true
  document.getElementById("hoverMinWidth").value = result.hoverMinWidth ?? 300;
  setVal("hoverBtnPosition", result.hoverBtnPosition || "top-right");
  document.getElementById("hoverBlacklist").value = result.hoverBlacklist || "";
});

// Fetch models from API
async function fetchGeminiModels() {
  const key = getVal("geminiKey");
  if (!key) { showStatus("Enter Gemini API key first.", "error"); return; }
  const btn = document.getElementById("refreshGeminiModels");
  const select = document.getElementById("geminiModel");
  const current = select.value;
  btn.classList.add("spinning");
  btn.disabled = true;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace("models/", ""))
      .filter(id => id.includes("gemini"))
      .sort();
    if (!models.length) throw new Error("No models found.");
    select.innerHTML = models.map(id =>
      `<option value="${id}"${id === current ? " selected" : ""}>${id}</option>`
    ).join("");
    if (!models.includes(current) && models.length) select.value = models[0];
    showStatus(`✅ Loaded ${models.length} Gemini models.`);
  } catch (e) {
    showStatus(`Gemini: ${e.message}`, "error");
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

async function fetchOpenAIModels() {
  const key = getVal("openaiKey");
  if (!key) { showStatus("Enter OpenAI API key first.", "error"); return; }
  const btn = document.getElementById("refreshOpenaiModels");
  const select = document.getElementById("openaiModel");
  const current = select.value;
  btn.classList.add("spinning");
  btn.disabled = true;
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || [])
      .map(m => m.id)
      .filter(id => /^(gpt|o\d)/.test(id) && !id.includes("audio") && !id.includes("realtime") && !id.includes("instruct"))
      .sort();
    if (!models.length) throw new Error("No models found.");
    select.innerHTML = models.map(id =>
      `<option value="${id}"${id === current ? " selected" : ""}>${id}</option>`
    ).join("");
    if (!models.includes(current) && models.length) select.value = models[0];
    updateAutoCheckModelPlaceholder();
    showStatus(`✅ Loaded ${models.length} OpenAI models.`);
  } catch (e) {
    showStatus(`OpenAI: ${e.message}`, "error");
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

async function fetchAutoCheckModels() {
  const btn = document.getElementById("refreshAutoCheckModels");
  const select = document.getElementById("autoCheckModel");
  const current = select.value;
  btn.classList.add("spinning");
  btn.disabled = true;
  try {
    let models = [];
    if (currentProvider === "openai") {
      const key = getVal("openaiKey");
      if (!key) throw new Error("Enter OpenAI API key first.");
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      models = (data.data || [])
        .map(m => m.id)
        .filter(id => /^(gpt|o\d)/.test(id) && !id.includes("audio") && !id.includes("realtime") && !id.includes("instruct"))
        .sort();
    } else {
      const key = getVal("geminiKey");
      if (!key) throw new Error("Enter Gemini API key first.");
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      models = (data.models || [])
        .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
        .map(m => m.name.replace("models/", ""))
        .filter(id => id.includes("gemini"))
        .sort();
    }
    if (!models.length) throw new Error("No models found.");
    select.innerHTML = `<option value="">— Use analysis model —</option>` +
      models.map(id => `<option value="${id}"${id === current ? " selected" : ""}>${id}</option>`).join("");
    if (current && models.includes(current)) select.value = current;
    showStatus(`✅ Loaded ${models.length} models for Auto Check.`);
  } catch (e) {
    showStatus(e.message, "error");
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

document.getElementById("resetPromptVN").addEventListener("click", () => {
  const el = document.getElementById("promptVN");
  if (el) el.value = DEFAULT_ANALYSIS_PROMPT;
});

document.getElementById("resetAutoCheckPrompt").addEventListener("click", () => {
  const el = document.getElementById("autoCheckPrompt");
  if (el) el.value = DEFAULT_AUTO_CHECK_PROMPT;
});

document.getElementById("refreshGeminiModels").addEventListener("click", fetchGeminiModels);
document.getElementById("refreshOpenaiModels").addEventListener("click", fetchOpenAIModels);
document.getElementById("refreshAutoCheckModels").addEventListener("click", fetchAutoCheckModels);

// Save
document.getElementById("saveBtn").addEventListener("click", () => {
  const btn = document.getElementById("saveBtn");
  btn.disabled = true;

  const settings = {
    analysisProvider: currentProvider,
    geminiKey: getVal("geminiKey"),
    geminiModel: getVal("geminiModel"),
    useGoogleSearch: getCheck("useGoogleSearch"),
    openaiKey: getVal("openaiKey"),
    openaiModel: getVal("openaiModel"),
    useOpenaiWebSearch: getCheck("useOpenaiWebSearch"),
    ideogramKey: getVal("ideogramKey"),
    promptVN: document.getElementById("promptVN")?.value || "",
    autoCheckModel: getVal("autoCheckModel"),
    autoCheckPrompt: document.getElementById("autoCheckPrompt")?.value || "",
    sheetId: getVal("sheetId"),
    sheetName: getVal("sheetName"),
    googleClientId: getVal("googleClientId"),
    driveFolderId: getVal("driveFolderId"),
    colAsinHeader: getVal("colAsinHeader"),
    colTitleHeader: getVal("colTitleHeader"),
    colUrlHeader: getVal("colUrlHeader"),
    colYouthHeader: getVal("colYouthHeader"),
    colColorsHeader: getVal("colColorsHeader"),
    maxFilenameLength: parseInt(document.getElementById("maxFilenameLength")?.value) || 60,
    hoverEnabled: getCheck("hoverEnabled"),
    hoverMinWidth: parseInt(document.getElementById("hoverMinWidth")?.value) || 300,
    hoverBtnPosition: getVal("hoverBtnPosition") || "top-right",
    hoverBlacklist: document.getElementById("hoverBlacklist")?.value.trim() || "",
  };

  chrome.storage.sync.set(settings, () => {
    btn.disabled = false;
    showStatus("✅ Settings saved!");
  });
});
