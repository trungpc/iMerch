// Hàm hiển thị thông báo tạm thời
function showMessage(text, type = "success") {
    const messageEl = document.getElementById("message");
    messageEl.textContent = text;
    messageEl.className = type === "success" ? "" : "error";
    setTimeout(() => (messageEl.textContent = ""), 3000);
}

// Hàm định dạng số với dấu phẩy
function formatNumber(value) {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Hàm xóa dấu phẩy để lấy giá trị số thực
function parseNumber(value) {
    return parseInt(value.replace(/,/g, ""), 10);
}

document.addEventListener("DOMContentLoaded", () => {
    const daysInput = document.getElementById("daysInput");
    const daysColor = document.getElementById("daysColor");
    const rankInput = document.getElementById("rankInput");
    const rankColor = document.getElementById("rankColor");
    const bothColor = document.getElementById("bothColor");
    const saveButton = document.getElementById("saveButton");
    const copyAsinsButton = document.getElementById("copyAsinsButton");
    const copyTitlesButton = document.getElementById("copyTitlesButton");
    const scrapingModeRadios = document.querySelectorAll('input[name="scrapingMode"]');
    const delaySettings = document.getElementById("delaySettings");
    const delayMinInput = document.getElementById("delayMin");
    const delayMaxInput = document.getElementById("delayMax");
    const proxyEnabledCheckbox = document.getElementById("proxyEnabled");
    const proxySettings = document.getElementById("proxySettings");
    const proxyScopeSelect = document.getElementById("proxyScope");
    const proxyHostInput = document.getElementById("proxyHost");
    const proxyPortInput = document.getElementById("proxyPort");
    const proxyUsernameInput = document.getElementById("proxyUsername");
    const proxyPasswordInput = document.getElementById("proxyPassword");

    // Load giá trị đã lưu
    chrome.storage.sync.get(
        ["highlightDays", "daysColor", "highlightRank", "rankColor", "bothColor", "scrapingMode", "delayMin", "delayMax",
            "proxyEnabled", "proxyScope", "proxyHost", "proxyPort", "proxyUsername", "proxyPassword"],
        (result) => {
            daysInput.value = formatNumber(result.highlightDays || 30);
            daysColor.value = result.daysColor || "#abfaaf";
            rankInput.value = formatNumber(result.highlightRank || 10000);
            rankColor.value = result.rankColor || "#ffeb3b";
            bothColor.value = result.bothColor || "#ff9800";

            // Load scraping mode
            const scrapingMode = result.scrapingMode || "sequential";
            document.querySelector(`input[name="scrapingMode"][value="${scrapingMode}"]`).checked = true;

            // Load delay settings
            delayMinInput.value = formatNumber(result.delayMin || 1500);
            delayMaxInput.value = formatNumber(result.delayMax || 3500);

            // Load proxy settings
            proxyEnabledCheckbox.checked = result.proxyEnabled || false;
            proxyScopeSelect.value = result.proxyScope || "amazon";
            proxyHostInput.value = result.proxyHost || "";
            proxyPortInput.value = result.proxyPort || "";
            proxyUsernameInput.value = result.proxyUsername || "";
            proxyPasswordInput.value = result.proxyPassword || "";

            // Update visibility
            updateDelayVisibility();
            updateProxyVisibility();
        }
    );

    // Hàm cập nhật hiển thị delay settings
    function updateDelayVisibility() {
        const selectedMode = document.querySelector('input[name="scrapingMode"]:checked').value;
        delaySettings.style.display = selectedMode === "sequential" ? "block" : "none";
    }

    // Hàm cập nhật hiển thị proxy settings
    function updateProxyVisibility() {
        proxySettings.style.display = proxyEnabledCheckbox.checked ? "block" : "none";
    }

    // Xử lý thay đổi scraping mode
    scrapingModeRadios.forEach(radio => {
        radio.addEventListener("change", updateDelayVisibility);
    });

    // Xử lý thay đổi proxy checkbox
    proxyEnabledCheckbox.addEventListener("change", updateProxyVisibility);

    // Xử lý định dạng khi người dùng nhập
    [daysInput, rankInput, delayMinInput, delayMaxInput].forEach((input) => {
        input.addEventListener("input", () => {
            let value = input.value.replace(/[^0-9]/g, ""); // Chỉ cho phép số
            if (value) {
                input.value = formatNumber(parseInt(value, 10));
            }
        });
    });

    // Xử lý nút Save
    saveButton.addEventListener("click", async () => {
        const days = parseNumber(daysInput.value);
        const rank = parseNumber(rankInput.value);
        const delayMin = parseNumber(delayMinInput.value);
        const delayMax = parseNumber(delayMaxInput.value);
        const scrapingMode = document.querySelector('input[name="scrapingMode"]:checked').value;
        const proxyEnabled = proxyEnabledCheckbox.checked;
        const proxyScope = proxyScopeSelect.value;
        const proxyHost = proxyHostInput.value.trim();
        const proxyPort = proxyPortInput.value.trim();
        const proxyUsername = proxyUsernameInput.value.trim();
        const proxyPassword = proxyPasswordInput.value;

        if (isNaN(days) || days < 1 || days > 365) {
            showMessage("Days must be between 1 and 365", "error");
            return;
        }
        if (isNaN(rank) || rank < 1) {
            showMessage("Rank must be a positive number", "error");
            return;
        }
        if (scrapingMode === "sequential") {
            if (isNaN(delayMin) || delayMin < 0) {
                showMessage("Min delay must be a positive number", "error");
                return;
            }
            if (isNaN(delayMax) || delayMax < delayMin) {
                showMessage("Max delay must be >= Min delay", "error");
                return;
            }
        }
        if (proxyEnabled) {
            if (!proxyHost || !proxyPort) {
                showMessage("Proxy host and port are required", "error");
                return;
            }
            if (isNaN(parseInt(proxyPort)) || parseInt(proxyPort) < 1 || parseInt(proxyPort) > 65535) {
                showMessage("Invalid proxy port", "error");
                return;
            }
        }

        saveButton.disabled = true;
        try {
            const settings = {
                highlightDays: days,
                daysColor: daysColor.value,
                highlightRank: rank,
                rankColor: rankColor.value,
                bothColor: bothColor.value,
                scrapingMode: scrapingMode,
                delayMin: delayMin,
                delayMax: delayMax,
                proxyEnabled: proxyEnabled,
                proxyScope: proxyScope,
                proxyHost: proxyHost,
                proxyPort: proxyPort,
                proxyUsername: proxyUsername,
                proxyPassword: proxyPassword,
            };
            await chrome.storage.sync.set(settings);

            // Send settings to background to configure proxy
            chrome.runtime.sendMessage({ action: "configureProxy", settings }, (response) => {
                if (response && response.success) {
                    showMessage("Settings saved successfully");
                } else {
                    showMessage(response?.error || "Settings saved but proxy config failed", "error");
                }
            });

            chrome.tabs.query({
                active: true,
                currentWindow: true
            }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "updateSettings",
                        settings
                    });
                }
            });
        } catch (error) {
            showMessage("Failed to save settings", "error");
        } finally {
            saveButton.disabled = false;
        }
    });

    copyAsinsButton.addEventListener("click", () => {
        injectAndCopy("asins");
    });

    copyTitlesButton.addEventListener("click", () => {
        injectAndCopy("titles");
    });

    function injectAndCopy(type) {
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, (tabs) => {
            chrome.scripting.executeScript({
                target: {
                    tabId: tabs[0].id
                },
                function: (type) => {
                    function copyToClipboard(text) {
                        const textarea = document.createElement("textarea");
                        textarea.value = text;
                        textarea.style.position = "fixed";
                        document.body.appendChild(textarea);
                        textarea.focus();
                        textarea.select();
                        try {
                            const successful = document.execCommand('copy');
                            if (!successful) {
                                console.error('Failed to copy text using document.execCommand("copy")');
                                return {
                                    success: false,
                                    error: 'Failed to copy text.'
                                };
                            }
                            document.body.removeChild(textarea);
                            return {
                                success: true
                            };
                        } catch (err) {
                            console.error('Unable to copy: ', err);
                            document.body.removeChild(textarea);
                            return {
                                success: false,
                                error: err.message
                            };
                        }
                    }

                    function copyAsinsToClipboard() {
                        try {
                            const productElements = Array.from(document.querySelectorAll(".s-result-item:not(.s-sponsored-product):not(.AdHolder)"));
                            const asins = productElements.map(product => {
                                const link = product.querySelector("a[href*='/dp/']");
                                if (link) {
                                    const asinMatch = link.href.match(/\/dp\/([A-Za-z0-9]{10})/);
                                    return asinMatch ? asinMatch[1] : null;
                                }
                                return null;
                            }).filter(asin => asin !== null);

                            const asinString = asins.join("\n");
                            return copyToClipboard(asinString);
                        } catch (err) {
                            console.error("Error in copyAsinsToClipboard: ", err);
                            return {
                                success: false,
                                error: err.message
                            };
                        }
                    }

                    function copyTitlesToClipboard() {
                        try {
                            const productElements = Array.from(document.querySelectorAll(".s-result-item:not(.s-sponsored-product):not(.AdHolder)"));
                            const titles = productElements.map(product => {
                                const titleElement = product.querySelector("a.a-link-normal > h2 > span");
                                return titleElement ? titleElement.textContent.trim() : null;
                            }).filter(title => title !== null);

                            const uniqueTitles = [...new Set(titles)];
                            const titleString = uniqueTitles.join("\n");
                            return copyToClipboard(titleString);
                        } catch (err) {
                            console.error("Error in copyTitlesToClipboard: ", err);
                            return {
                                success: false,
                                error: err.message
                            };
                        }
                    }

                    if (type === "asins") {
                        return copyAsinsToClipboard();
                    } else if (type === "titles") {
                        return copyTitlesToClipboard();
                    }
                },
                args: [type]
            }, (injectionResults) => {
                if (chrome.runtime.lastError) {
                    showMessage("Failed to copy: " + chrome.runtime.lastError.message, "error");
                } else if (injectionResults && injectionResults[0]) {
                    const response = injectionResults[0].result;
                    if (response && response.success) {
                        showMessage("Copied to clipboard!");
                    } else {
                        showMessage("Failed to copy: " + (response?.error || "Unknown error"), "error");
                    }
                } else {
                    showMessage("Failed to copy: Unknown error", "error");
                }
            });
        });
    }
});