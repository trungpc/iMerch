const KEYS = [
  "analysisProvider", "geminiKey", "geminiModel", "useGoogleSearch",
  "openaiKey", "openaiModel", "useOpenaiWebSearch", "ideogramKey", "promptVN",
  "sheetId", "sheetName", "googleClientId", "driveFolderId",
  "colAsinHeader", "colTitleHeader", "colUrlHeader", "colYouthHeader", "colColorsHeader",
  "maxFilenameLength"
];

const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

let currentProvider = "gemini"; // analysis provider: gemini | openai
let currentTab = "gemini";     // active tab: gemini | openai | ideogram

function setTab(tab) {
  currentTab = tab;
  // Chỉ cập nhật analysisProvider khi tab là gemini hoặc openai
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
  if (promptEl) promptEl.value = result.promptVN || "";
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
});

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
  };

  chrome.storage.sync.set(settings, () => {
    btn.disabled = false;
    showStatus("✅ Settings saved!");
  });
});
