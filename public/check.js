const html = document.documentElement;
const themeToggle = document.getElementById("themeToggle");

const sessionInput = document.getElementById("session");
const appIdInput = document.getElementById("appId");
const appHashInput = document.getElementById("appHash");
const forgePasswordPanel = document.getElementById("forgePasswordPanel");
const forgePasswordInput = document.getElementById("forgePassword");
const sendForgePassword = document.getElementById("sendForgePassword");

const checkBtn = document.getElementById("checkBtn");
const getOtpBtn = document.getElementById("getOtpBtn");
const clearLogsBtn = document.getElementById("clearLogsBtn");
const copyResultBtn = document.getElementById("copyResultBtn");

const logs = document.getElementById("logs");
const result = document.getElementById("result");
const resultBody = document.getElementById("resultBody");
const resultStatus = document.getElementById("resultStatus");
const otpPanel = document.getElementById("otpPanel");
const otpText = document.getElementById("otpText");

let wasmGo = null;
let wasmInstance = null;
let wasmReady = false;
let wasmLoadPromise = null;
let originalConsole = null;
let busy = false;
let currentResultText = "";

function setTheme(theme) {
  html.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("theme");
  const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setTheme(saved || preferred);
}

function toggleTheme() {
  setTheme(html.getAttribute("data-theme") === "dark" ? "light" : "dark");
}

function showResult(type, title, body, status = type) {
  result.className = `result ${type}`;
  resultStatus.textContent = status;
  resultBody.textContent = body;
  currentResultText = `${title}\n${body}`;
}

function appendLog(message, type = "info") {
  if (!logs) return;
  const line = document.createElement("div");
  line.className = `console-line ${type} fade-in`;
  line.textContent = message;
  logs.appendChild(line);
  logs.scrollTop = logs.scrollHeight;
}

function clearLogPanel() {
  logs.innerHTML = "";
}

function setButtonBusy(button, isBusy, label) {
  if (!button) return;
  button.disabled = isBusy;
  const spinner = button.querySelector(".spinner");
  const text = button.querySelector(".btn-label");
  if (spinner) spinner.classList.toggle("hidden", !isBusy);
  if (text && label) text.textContent = label;
}

function hookConsole() {
  if (originalConsole) return;
  originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  };

  const proxy = (level) => (...args) => {
    const text = args
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ");
    if (text) {
      const mapped =
        level === "error" ? "error" :
        level === "warn" ? "warn" :
        text.includes("SUCCESS") ? "success" :
        text.includes("ERROR") ? "error" :
        text.includes("OTP") ? "success" :
        "info";
      appendLog(text, mapped);
      if (text.includes("PROMPT_CODE")) {
        appendLog("OTP requested from Telegram notifications.", "info");
      }
      if (text.includes("PROMPT_PASSWORD")) {
        if (forgePasswordPanel) forgePasswordPanel.classList.remove("hidden");
        forgePasswordInput?.focus();
      }
    }
    originalConsole[level](...args);
  };

  console.log = proxy("log");
  console.info = proxy("info");
  console.warn = proxy("warn");
  console.error = proxy("error");
  console.debug = proxy("debug");
}

function readAuditInputs() {
  return {
    session: sessionInput.value.trim(),
    appId: appIdInput.value.trim(),
    appHash: appHashInput.value.trim(),
  };
}

async function loadWasm() {
  if (wasmReady) return wasmInstance;
  if (wasmLoadPromise) return wasmLoadPromise;

  if (!wasmGo) {
    wasmGo = new Go();
  }

  appendLog("Loading runtime...", "info");

  wasmLoadPromise = WebAssembly.instantiateStreaming(fetch("check.wasm"), wasmGo.importObject)
    .then((result) => {
      wasmInstance = result.instance;
      wasmGo.run(wasmInstance);
      wasmReady = true;
      appendLog("Runtime ready.", "success");
      return wasmInstance;
    })
    .catch((error) => {
      wasmLoadPromise = null;
      throw error;
    });

  return wasmLoadPromise;
}

function dispatchInput(kind, value) {
  const key = `__wasmInput_${kind}`;
  if (typeof window[key] === "function") {
    window[key](value);
    return true;
  }
  if (typeof window.__wasmInputDispatcher === "function") {
    window.__wasmInputDispatcher(kind, value);
    return true;
  }
  return false;
}

window.onSessionChecked = (res) => {
  busy = false;
  setButtonBusy(checkBtn, false, "Check");

  if (!res || !res.success) {
    showResult("error", "Invalid", res?.error || "Invalid session", "error");
    return;
  }

  showResult(
    "success",
    "Valid",
    `Name: ${res.fullName || "-"} Username: ${res.username || "-"} Phone: ${res.phone || "-"} ID: ${res.id}`,
    "valid"
  );
};

window.onOtpFetched = (res) => {
  busy = false;
  setButtonBusy(getOtpBtn, false, "Get OTP");
  if (!res || !res.success) {
    showResult("error", "OTP Failed", res?.error || "OTP could not be fetched", "error");
    appendLog(res?.error || "OTP failed", "error");
    if (otpPanel) otpPanel.classList.add("hidden");
    return;
  }

  showResult("success", "OTP Fetched", "OTP recovered from 777000", "done");
  if (otpPanel) otpPanel.classList.remove("hidden");
  if (otpText) otpText.textContent = res.otp;
  appendLog(`OTP recovered: ${res.otp}`, "success");
};

window.onForgeComplete = (res) => {
  busy = false;
  setButtonBusy(getOtpBtn, false, "Get OTP");

  if (!res || !res.success) {
    showResult("error", "Forge failed", res?.error || "Session minting failed", "error");
    return;
  }

  showResult(
    "success",
    "Session ready",
    `Session: ${res.session || "-"}`,
    "ready"
  );
};

async function checkSessionFlow() {
  if (busy) return;

  const { session, appId, appHash } = readAuditInputs();
  if (!session) {
    showResult("error", "Missing", "Paste a session.", "error");
    return;
  }

  busy = true;
  clearLogPanel();
  setButtonBusy(checkBtn, true, "Checking");
  showResult("info", "Checking", "Validating...", "running");

  try {
    await loadWasm();
    checkSession(session, appId || undefined, appHash || undefined);
  } catch (error) {
    busy = false;
    setButtonBusy(checkBtn, false, "Check");
    showResult("error", "Failed", error.message, "error");
  }
}

async function forgeSessionFlow() {
  if (busy) return;

  const { session, appId, appHash } = readAuditInputs();
  if (!session) {
    showResult("error", "Missing", "Paste a session first.", "error");
    return;
  }

  busy = true;
  clearLogPanel();
  if (otpPanel) otpPanel.classList.add("hidden");
  if (forgePasswordPanel) forgePasswordPanel.classList.add("hidden");
  if (otpText) otpText.textContent = "Waiting for OTP...";
  setButtonBusy(getOtpBtn, true, "Get OTP");
  showResult("info", "Get OTP", "Sending code and fetching OTP...", "running");

  try {
    await loadWasm();
    getOtp(session, appId || undefined, appHash || undefined);
  } catch (error) {
    busy = false;
    setButtonBusy(getOtpBtn, false, "Get OTP");
    showResult("error", "Failed", error.message, "error");
  }
}

function copyCurrentResult() {
  if (!currentResultText) {
    appendLog("No result yet.", "warn");
    return;
  }
  navigator.clipboard.writeText(currentResultText)
    .then(() => appendLog("Result copied", "success"))
    .catch(() => appendLog("Failed to copy result", "error"));
}

function applyForgePassword() {
  const password = forgePasswordInput.value.trim();
  if (!password) {
    appendLog("Enter 2FA password.", "warn");
    return;
  }

  if (!dispatchInput("password", password)) {
    appendLog("Password channel not ready.", "error");
  }
}

initTheme();
hookConsole();
showResult("info", "Ready", "Paste a session or tap Get OTP.", "idle");
appendLog("Ready.", "info");
loadWasm().catch((error) => {
  appendLog(`Failed to load wasm: ${error.message}`, "error");
  showResult("error", "Runtime failed", error.message, "error");
});

if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
if (checkBtn) checkBtn.addEventListener("click", checkSessionFlow);
if (getOtpBtn) getOtpBtn.addEventListener("click", forgeSessionFlow);
if (clearLogsBtn) clearLogsBtn.addEventListener("click", clearLogPanel);
if (copyResultBtn) copyResultBtn.addEventListener("click", copyCurrentResult);
if (sendForgePassword) sendForgePassword.addEventListener("click", applyForgePassword);

sessionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    checkSessionFlow();
  }
});

forgePasswordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyForgePassword();
});






