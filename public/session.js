// Theme management
const themeToggle = document.getElementById('themeToggle');
const currentTheme = localStorage.getItem('theme') || 'dark';
document.body.setAttribute('data-theme', currentTheme);

themeToggle.addEventListener('click', () => {
    const theme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
});

// Form elements
const appIdInput = document.getElementById('appId');
const appHashInput = document.getElementById('appHash');
const phoneNumberInput = document.getElementById('phoneNumber');
const botTokenInput = document.getElementById('botToken');
const sendCodeBtn = document.getElementById('sendCodeBtn');

const codeGroup = document.getElementById('codeGroup');
const verificationCodeInput = document.getElementById('verificationCode');
const passwordGroup = document.getElementById('passwordGroup');
const passwordInput = document.getElementById('password');
const verifyBtn = document.getElementById('verifyBtn');
const resetBtn = document.getElementById('resetBtn');

const outputArea = document.getElementById('outputArea');
const dcIdInput = document.getElementById('dcId');
const clearOutputBtn = document.getElementById('clearOutputBtn');
const showConsoleBtn = document.getElementById('showConsoleBtn');
const sendVerification = document.getElementById('sendVerification');
const sendPassword = document.getElementById('sendPassword');
const statusText = document.getElementById('statusText');

// Progress steps
const progressSteps = document.querySelectorAll('.progress-step');
const progressLine = document.querySelector('.progress-line');

// WASM instance and state
let wasmInstance = null;
let wasmGo = null;
let isGenerating = false; // Prevent duplicate calls
let sessionState = {
    appId: '',
    appHash: '',
    phoneNumber: '',
    phoneCodeHash: '',
    awaitingCode: false,
    awaiting2FA: false,
    currentStep: 1
};

// Update status indicator
function setStatus(s) {
    if (statusText) statusText.textContent = s;
}

// Phone normalization helper
function normalizePhoneNumber(phone) {
    if (!phone) return phone;
    let s = phone.trim();
    // remove all except digits and leading +
    s = s.replace(/[^0-9+]/g, '');
    if (s.startsWith('+')) return s;
    // strip leading zeros
    s = s.replace(/^0+/, '');
    // if 10 digits -> assume India
    const digits = s.replace(/\D/g, '');
    if (digits.length === 10) return '+91' + digits;
    if (s.startsWith('91') && digits.length === 12) return '+' + s;
    // if it looks like a number starting with country code without plus, add plus
    if (/^\d{8,15}$/.test(s)) return '+' + s;
    return s;
}

// Update progress step
function updateProgress(step) {
    sessionState.currentStep = step;

    progressSteps.forEach((stepEl, index) => {
        const stepNum = index + 1;

        if (stepNum < step) {
            stepEl.classList.add('completed');
            stepEl.classList.remove('active');
        } else if (stepNum === step) {
            stepEl.classList.add('active');
            stepEl.classList.remove('completed');
        } else {
            stepEl.classList.remove('active', 'completed');
        }
    });

    // Update progress line
    if (progressLine) {
        const progress = ((step - 1) / (progressSteps.length - 1)) * 100;
        progressLine.style.setProperty('--progress', `${progress}%`);
    }
}

// Add output line
function addOutput(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `output-line ${type}`;
    line.textContent = message;
    outputArea.appendChild(line);
    outputArea.scrollTop = outputArea.scrollHeight;
}

// Clear output
function clearOutput() {
    outputArea.innerHTML = '';
}

// Disable button with spinner
function disableButton(btn) {
    btn.disabled = true;
    const spinner = btn.querySelector('.spinner');
    if (spinner) spinner.style.display = 'inline-block';
}

// Enable button
function enableButton(btn) {
    btn.disabled = false;
    const spinner = btn.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
}

// Load WASM
async function loadWasm() {
    try {
        addOutput('Loading session generator...', 'info');

        wasmGo = new Go();

        const result = await WebAssembly.instantiateStreaming(
            fetch('session.wasm'),
            wasmGo.importObject
        );

        wasmInstance = result.instance;

        // Run WASM asynchronously
        wasmGo.run(wasmInstance);

        addOutput('Session generator ready', 'success');

    } catch (error) {
        addOutput(`Failed to load WASM: ${error.message}`, 'error');
        console.error('WASM load error:', error);
    }
}

// Global callback for session generation result
window.onSessionGenerated = function (result) {
    isGenerating = false;
    if (result.success) {
        showSession(result.session, result.fullName);
        setStatus('done');
        // Kill the WASM program after session is received
        setTimeout(() => {
            if (window.wasmInstance) {
                try {
                    // Force terminate the Go program
                    window.wasmInstance = null;
                    addOutput('✓ Session saved. Connection terminated.', 'success');
                } catch (e) {
                    console.log('WASM cleanup:', e);
                }
            }
        }, 100);
    } else {
        addOutput(`ERROR: ${result.error || 'Session generation failed'}`, 'error');
        enableButton(verifyBtn);
        setStatus('failed');
    }
};

// Send input to WASM (use wrapper if available, else dispatcher)
function sendInputToWasm(type, value) {
    const callbackName = `__wasmInput_${type}`;
    try {
        if (typeof window[callbackName] === 'function') {
            window[callbackName](value);
            addOutput(`Dispatched ${type} via wrapper`, 'debug');
            return;
        }
        if (typeof window.__wasmInputDispatcher === 'function') {
            window.__wasmInputDispatcher(type, value);
            addOutput(`Dispatched ${type} via dispatcher`, 'debug');
            return;
        }
    } catch (e) {
        addOutput(`Dispatcher error: ${e}`, 'error');
    }
    addOutput(`No dispatcher available for ${type}`, 'warn');
}

// Show session result
function showSession(sessionString, userName) {
    updateProgress(3); // Move to Session step
    resetBtn.style.display = 'flex';
    verifyBtn.style.display = 'none';
    sendCodeBtn.style.display = 'none';

    if (userName) {
        addOutput(`\n✓ Session generated successfully for ${userName}!`, 'success');
    } else {
        addOutput('\n✓ Session generated successfully!', 'success');
    }

    // Add session string with copy button in terminal
    const sessionDiv = document.createElement('div');
    sessionDiv.className = 'session-line';
    sessionDiv.innerHTML = `
        <div class="session-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>Session String:</span>
        </div>
        <div class="session-string-container">
            <code class="session-string">${sessionString}</code>
            <button class="copy-session-btn" onclick="copySessionString('${sessionString}')" title="Copy session">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
        </div>
    `;
    outputArea.appendChild(sessionDiv);
    outputArea.scrollTop = outputArea.scrollHeight;

    enableButton(verifyBtn);
}

// Copy session string function
window.copySessionString = function (sessionString) {
    navigator.clipboard.writeText(sessionString).then(() => {
        addOutput('✓ Session copied to clipboard!', 'success');
    }).catch(() => {
        addOutput('✗ Failed to copy session', 'error');
    });
};

// Send code
sendCodeBtn.addEventListener('click', async () => {
    if (isGenerating) {
        addOutput('Already processing...', 'info');
        return;
    }

    const appId = appIdInput.value.trim();
    const appHash = appHashInput.value.trim();
    let phoneNumber = phoneNumberInput.value.trim();
    const botToken = botTokenInput.value.trim();

    if (!phoneNumber && !botToken) {
        addOutput('ERROR: Phone number or bot token is required', 'error');
        return;
    }

    if (phoneNumber && botToken) {
        addOutput('ERROR: Use either phone number or bot token, not both', 'error');
        return;
    }

    // Normalize and validate phone number
    let normalizedPhone = '';
    if (phoneNumber) {
        normalizedPhone = normalizePhoneNumber(phoneNumber);
        if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
            addOutput('ERROR: Invalid phone number after normalization: ' + normalizedPhone, 'error');
            return;
        }
        phoneNumberInput.value = normalizedPhone;
    }

    // Validate DC ID (default 5)
    let dc = '5';
    if (dcIdInput && dcIdInput.value) {
        const tmp = dcIdInput.value.trim();
        if (!/^\d+$/.test(tmp)) {
            addOutput('ERROR: Data Center ID must be a positive integer', 'error');
            return;
        }
        dc = tmp;
    }

    sessionState.appId = appId;
    sessionState.appHash = appHash;
    sessionState.phoneNumber = normalizedPhone || phoneNumber;
    sessionState.botToken = botToken;

    isGenerating = true;
    disableButton(sendCodeBtn);
    clearOutput();
    setStatus('starting');

    // Load WASM if not loaded
    if (!wasmInstance) {
        await loadWasm();
    }

    // Wait for WASM to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    if (window.generateSession) {
        try {
            if (botToken) {
                addOutput('Logging in as bot...', 'info');
                updateProgress(2); // Move to processing for bot
            } else {
                addOutput(`Sending code to ${normalizedPhone || phoneNumber}...`, 'info');
                setStatus('waiting_for_code');
            }
            window.generateSession(appId, appHash, normalizedPhone || phoneNumber, botToken, dc);
        } catch (error) {
            addOutput(`ERROR: ${error.message}`, 'error');
            enableButton(sendCodeBtn);
            isGenerating = false;
            setStatus('error');
        }

        // Validate bot token format
        if (botToken) {
            // Bot token format: [bot_id]:[token] (e.g., 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz)
            const botTokenRegex = /^\d{8,10}:[A-Za-z0-9_-]{35}$/;
            if (!botTokenRegex.test(botToken)) {
                addOutput('ERROR: Invalid bot token format. Must be [bot_id]:[token]', 'error');
                return;
            }
        }

        sessionState.appId = appId;
        sessionState.appHash = appHash;
        sessionState.phoneNumber = phoneNumber;
        sessionState.botToken = botToken;

        isGenerating = true;
        disableButton(sendCodeBtn);
        clearOutput();

        // Load WASM if not loaded
        if (!wasmInstance) {
            await loadWasm();
        }

        // Wait for WASM to be ready
        await new Promise(resolve => setTimeout(resolve, 500));

        if (window.generateSession) {
            try {
                if (botToken) {
                    addOutput('Logging in as bot...', 'info');
                    updateProgress(2); // Move to processing for bot
                } else {
                    addOutput(`Sending code to ${phoneNumber}...`, 'info');
                }
                window.generateSession(appId, appHash, phoneNumber, botToken);
            } catch (error) {
                addOutput(`ERROR: ${error.message}`, 'error');
                enableButton(sendCodeBtn);
                isGenerating = false;
            }

            // Override console.log to catch WASM output
            const originalLog = console.log;
            console.log = (...args) => {
                const msg = args.join(' ');
                addOutput(msg, 'info');
                originalLog(...args);

                // Check for prompts from WASM
                if (msg.includes('PROMPT_CODE') && !sessionState.botToken) {
                    sessionState.awaitingCode = true;
                    updateProgress(2); // Move to Verify step
                    codeGroup.style.display = 'block';
                    verifyBtn.style.display = 'flex';
                    sendCodeBtn.style.display = 'none';
                    enableButton(sendCodeBtn);
                    enableButton(verifyBtn);
                } else if (msg.includes('PROMPT_CODE') && !sessionState.botToken) {
                    sessionState.awaitingCode = true;
                    updateProgress(2); // Move to Verify step
                    codeGroup.style.display = 'block';
                    verifyBtn.style.display = 'flex';
                    sendCodeBtn.style.display = 'none';
                    enableButton(sendCodeBtn);
                    enableButton(verifyBtn);
                    // Auto-focus code input
                    setTimeout(() => verificationCodeInput.focus(), 100);
                } else if (msg.includes('PROMPT_PASSWORD')) {
                    sessionState.awaiting2FA = true;
                    passwordGroup.style.display = 'block';
                    addOutput('2FA enabled - Please enter your password', 'info');
                    enableButton(verifyBtn);
                    // Auto-focus password field
                    setTimeout(() => passwordInput.focus(), 100);
                } else if (msg.includes('ERROR')) {
                    enableButton(sendCodeBtn);
                    enableButton(verifyBtn);
                    isGenerating = false;
                    setStatus('failed');
                }
            };
        } else {
            addOutput('ERROR: Session generator not ready', 'error');
            enableButton(sendCodeBtn);
            isGenerating = false;
        }
    }
});

// Verify and generate
verifyBtn.addEventListener('click', () => {
    const code = verificationCodeInput.value.trim();

    if (!code && !sessionState.awaiting2FA) {
        addOutput('ERROR: Please enter the verification code', 'error');
        return;
    }

    // If we're waiting for 2FA password
    if (sessionState.awaiting2FA) {
        const password = passwordInput.value.trim();
        if (!password) {
            addOutput('ERROR: Please enter your 2FA password', 'error');
            return;
        }

        disableButton(verifyBtn);
        addOutput('Verifying password...', 'info');
        sendInputToWasm('password', password);
        return;
    }

    disableButton(verifyBtn);
    addOutput('Verifying code...', 'info');

    // Send code to WASM
    sendInputToWasm('code', code);
});

// Reset
resetBtn.addEventListener('click', () => {
    // Reload the page for a clean start
    window.location.reload();
});

// Enter key handlers
appIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') appHashInput.focus();
});

// Extra UI buttons wiring
if (sendVerification) {
    sendVerification.addEventListener('click', () => {
        const v = verificationCodeInput.value.trim();
        if (!v) { addOutput('Please enter a verification code', 'warn'); return; }
        sendInputToWasm('code', v);
        setStatus('sent_code');
    });
}

if (sendPassword) {
    sendPassword.addEventListener('click', () => {
        const p = passwordInput.value.trim();
        if (!p) { addOutput('Please enter a password', 'warn'); return; }
        sendInputToWasm('password', p);
        setStatus('sent_password');
    });
}

if (clearOutputBtn) clearOutputBtn.addEventListener('click', clearOutput);
if (showConsoleBtn) showConsoleBtn.addEventListener('click', () => { addOutput('Open devtools to view console output', 'info'); });

appHashInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') phoneNumberInput.focus();
});

phoneNumberInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendCodeBtn.click();
});

verificationCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        if (passwordGroup.style.display === 'none') {
            verifyBtn.click();
        } else {
            passwordInput.focus();
        }
    }
});

passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') verifyBtn.click();
});

// Initial setup
updateProgress(1);
addOutput('Enter your credentials to begin', 'info');

// Load WASM on page load
loadWasm();
