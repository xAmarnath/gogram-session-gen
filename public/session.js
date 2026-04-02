const html = document.documentElement;
const themeToggle = document.getElementById("themeToggle");
const statusText = document.getElementById("statusText");
const outputArea = document.getElementById("outputArea");
const clearOutputBtn = document.getElementById("clearOutputBtn");
const showConsoleBtn = document.getElementById("showConsoleBtn");

const appIdInput = document.getElementById("appId");
const appHashInput = document.getElementById("appHash");
const phoneNumberInput = document.getElementById("phoneNumber");
const botTokenInput = document.getElementById("botToken");
const dcIdInput = document.getElementById("dcId");

const sendCodeBtn = document.getElementById("sendCodeBtn");
const verifyBtn = document.getElementById("verifyBtn");
const resetBtn = document.getElementById("resetBtn");
const verificationCodeInput = document.getElementById("verificationCode");
const passwordInput = document.getElementById("password");
const codeGroup = document.getElementById("codeGroup");
const passwordGroup = document.getElementById("passwordGroup");
const sendVerification = document.getElementById("sendVerification");
const sendPassword = document.getElementById("sendPassword");

let wasmGo = null;
let wasmInstance = null;
let wasmReady = false;
let wasmLoadPromise = null;
let busy = false;
let currentMode = "idle";
let originalConsole = null;

function setStatus(value) {
  currentMode = value;
  if (statusText) {
    statusText.textContent = value;
  }
}

function setButtonBusy(button, isBusy, label) {
  if (!button) return;
  button.disabled = isBusy;
  const spinner = button.querySelector(".spinner");
  const text = button.querySelector(".btn-label");

  if (spinner) {
    spinner.classList.toggle("hidden", !isBusy);
  }

  if (text && label) {
    text.textContent = label;
  }
}

function setTheme(theme) {
  html.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("theme");
  const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const theme = saved || preferred;
  setTheme(theme);
}

function toggleTheme() {
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  setTheme(next);
}

function pushLine(message, type = "info") {
  if (!outputArea) return;
  const line = document.createElement("div");
  line.className = `console-line ${type} fade-in`;
  line.textContent = message;
  outputArea.appendChild(line);
  outputArea.scrollTop = outputArea.scrollHeight;
}

function clearConsole() {
  if (outputArea) {
    outputArea.innerHTML = "";
  }
}

function normalizePhoneNumber(phone) {
  if (!phone) return "";
  let value = phone.trim().replace(/[^\d+]/g, "");
  if (value.startsWith("+")) return value;
  value = value.replace(/^0+/, "");
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (/^\d{8,15}$/.test(value)) return `+${value}`;
  return value;
}

function showField(field, visible) {
  if (!field) return;
  field.classList.toggle("hidden", !visible);
}

function showSession(sessionString, fullName) {
  setStatus("done");
  busy = false;
  setButtonBusy(sendCodeBtn, false, "Send Code");
  setButtonBusy(verifyBtn, false, "Generate Session");
  sendCodeBtn.classList.add("hidden");
  verifyBtn.classList.add("hidden");
  resetBtn.classList.remove("hidden");

  const result = document.createElement("section");
  result.className = "session-block fade-in";

  const head = document.createElement("div");
  head.className = "session-block-head";
  const badge = document.createElement("span");
  badge.className = "panel-badge";
  badge.textContent = "Session forged";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = "copy-ready";
  head.append(badge, tag);

  const title = document.createElement("div");
  title.style.marginBottom = "0.8rem";
  const strong = document.createElement("strong");
  strong.style.display = "block";
  strong.style.fontSize = "1.1rem";
  strong.style.marginBottom = "0.25rem";
  strong.textContent = fullName ? `Welcome, ${fullName}` : "Session completed";
  const sub = document.createElement("span");
  sub.className = "mini-note";
  sub.textContent = "Your string session is ready. Keep it private and store it securely.";
  title.append(strong, sub);

  const code = document.createElement("code");
  code.className = "session-code";
  code.textContent = sessionString;

  const row = document.createElement("div");
  row.className = "copy-row";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copy session";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sessionString);
      pushLine("✓ Session copied to clipboard", "success");
    } catch {
      pushLine("Failed to copy session", "error");
    }
  });

  const hint = document.createElement("span");
  hint.className = "mini-note";
  hint.textContent = "The output panel remains available if you want to inspect the login log again.";

  row.append(copyBtn, hint);
  result.append(head, title, code, row);

  outputArea.appendChild(result);
  outputArea.scrollTop = outputArea.scrollHeight;
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
        level === "debug" ? "debug" :
        text.includes("SUCCESS") ? "success" :
        text.includes("ERROR") ? "error" :
        "info";
      pushLine(text, mapped);
      if (text.includes("PROMPT_CODE")) {
        showField(codeGroup, true);
        showField(passwordGroup, false);
        verifyBtn.classList.remove("hidden");
        setButtonBusy(verifyBtn, false, "Generate Session");
        verificationCodeInput.focus();
      }
      if (text.includes("PROMPT_PASSWORD")) {
        showField(passwordGroup, true);
        verifyBtn.classList.remove("hidden");
        passwordInput.focus();
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

async function loadWasm() {
  if (wasmReady) return wasmInstance;
  if (wasmLoadPromise) return wasmLoadPromise;

  if (!wasmGo) {
    wasmGo = new Go();
  }

  setStatus("loading");
    pushLine("Loading runtime...", "info");

  wasmLoadPromise = WebAssembly.instantiateStreaming(fetch("session.wasm"), wasmGo.importObject)
    .then((result) => {
      wasmInstance = result.instance;
      wasmGo.run(wasmInstance);
      wasmReady = true;
      pushLine("Runtime ready.", "success");
      setStatus("ready");
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

window.onSessionGenerated = (result) => {
  busy = false;

  if (!result || !result.success) {
    pushLine(result?.error || "Session generation failed", "error");
    setStatus("error");
    setButtonBusy(sendCodeBtn, false, "Send Code");
    setButtonBusy(verifyBtn, false, "Generate Session");
    sendCodeBtn.classList.remove("hidden");
    return;
  }

  showSession(result.session, result.fullName || "");
};

window.copySessionString = async (sessionString) => {
  try {
    await navigator.clipboard.writeText(sessionString);
    pushLine("✓ Session copied to clipboard", "success");
  } catch {
    pushLine("Failed to copy session", "error");
  }
};

function readInputs() {
  const appId = appIdInput.value.trim();
  const appHash = appHashInput.value.trim();
  const phone = phoneNumberInput.value.trim();
  const botToken = botTokenInput.value.trim();
  const dc = dcIdInput.value.trim() || "5";

  if (!phone && !botToken) {
    throw new Error("Phone number or bot token is required");
  }

  if (phone && botToken) {
    throw new Error("Use either phone number or bot token, not both");
  }

  let normalizedPhone = "";
  if (phone) {
    normalizedPhone = normalizePhoneNumber(phone);
    if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
      throw new Error(`Invalid phone number: ${normalizedPhone}`);
    }
    phoneNumberInput.value = normalizedPhone;
  }

  if (!/^\d+$/.test(dc)) {
    throw new Error("Data center ID must be a positive integer");
  }

  if (botToken && !/^\d{8,10}:[A-Za-z0-9_-]{35}$/.test(botToken)) {
    throw new Error("Invalid bot token format");
  }

  return { appId, appHash, phone: normalizedPhone || phone, botToken, dc };
}

async function onSendCode() {
  if (busy) return;

  let input;
  try {
    input = readInputs();
  } catch (error) {
    pushLine(error.message, "error");
    setStatus("invalid");
    return;
  }

  busy = true;
  setButtonBusy(sendCodeBtn, true, "Preparing");
  setButtonBusy(verifyBtn, false, "Generate Session");
  clearConsole();
  pushLine("Preparing runtime...", "info");
  await loadWasm();

  sendCodeBtn.classList.add("hidden");
  verifyBtn.classList.remove("hidden");

  if (input.botToken) {
    setStatus("bot");
    pushLine("Starting bot login...", "info");
  } else {
    setStatus("awaiting_code");
    pushLine(`Sending verification code to ${input.phone}...`, "info");
    showField(codeGroup, true);
    verificationCodeInput.focus();
  }

  if (!window.generateSession) {
    pushLine("Session runtime not ready yet", "error");
    busy = false;
    setButtonBusy(sendCodeBtn, false, "Send Code");
    return;
  }

  try {
    window.generateSession(input.appId, input.appHash, input.phone, input.botToken, input.dc);
  } catch (error) {
    busy = false;
    setStatus("error");
    pushLine(error.message, "error");
    setButtonBusy(sendCodeBtn, false, "Send Code");
  }
}

function onVerify() {
  if (!busy) {
    pushLine("No active login flow to verify", "warn");
    return;
  }

  const code = verificationCodeInput.value.trim();
  const password = passwordInput.value.trim();

  if (passwordGroup && !passwordGroup.classList.contains("hidden")) {
    if (!password) {
      pushLine("Enter the 2FA password first", "warn");
      return;
    }
    setButtonBusy(verifyBtn, true, "Applying Password");
    pushLine("Submitting password...", "info");
    if (!dispatchInput("password", password)) {
      pushLine("Password channel not ready", "error");
    }
    return;
  }

  if (!code) {
    pushLine("Enter the verification code first", "warn");
    return;
  }

  setButtonBusy(verifyBtn, true, "Applying Code");
  pushLine("Submitting verification code...", "info");
  if (!dispatchInput("code", code)) {
    pushLine("Code channel not ready", "error");
  }
}

function resetFlow() {
  window.location.reload();
}

initTheme();
hookConsole();

if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
if (sendCodeBtn) sendCodeBtn.addEventListener("click", onSendCode);
if (verifyBtn) verifyBtn.addEventListener("click", onVerify);
if (resetBtn) resetBtn.addEventListener("click", resetFlow);
if (clearOutputBtn) clearOutputBtn.addEventListener("click", clearConsole);
if (showConsoleBtn) showConsoleBtn.addEventListener("click", () => pushLine("Console is already visible below.", "debug"));
if (sendVerification) sendVerification.addEventListener("click", () => {
  const code = verificationCodeInput.value.trim();
  if (!code) {
    pushLine("Enter a code before applying it", "warn");
    return;
  }
  if (!dispatchInput("code", code)) {
    pushLine("Code channel not ready", "error");
  }
});
if (sendPassword) sendPassword.addEventListener("click", () => {
  const password = passwordInput.value.trim();
  if (!password) {
    pushLine("Enter a password before applying it", "warn");
    return;
  }
  if (!dispatchInput("password", password)) {
    pushLine("Password channel not ready", "error");
  }
});

appIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") appHashInput.focus();
});

appHashInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") phoneNumberInput.focus();
});

phoneNumberInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") onSendCode();
});

botTokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") onSendCode();
});

verificationCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") onVerify();
});

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") onVerify();
});

showField(codeGroup, false);
showField(passwordGroup, false);
setStatus("idle");
  pushLine("Ready.", "info");
loadWasm().catch((error) => {
  pushLine(`Failed to load wasm: ${error.message}`, "error");
  setStatus("failed");
});
