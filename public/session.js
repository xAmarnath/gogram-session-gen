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
const sessionResult = document.getElementById('sessionResult');
const sessionStringElement = document.getElementById('sessionString');
const copyBtn = document.getElementById('copyBtn');

// Progress steps
const progressSteps = document.querySelectorAll('.progress-step');
const progressLine = document.querySelector('.progress-line');

// WASM instance and state
let wasmInstance = null;
let wasmGo = null;
let sessionState = {
    appId: '',
    appHash: '',
    phoneNumber: '',
    phoneCodeHash: '',
    awaitingCode: false,
    awaiting2FA: false,
    currentStep: 1
};

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
window.onSessionGenerated = function(result) {
    if (result.success) {
        showSession(result.session, result.fullName);
        
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
    }
};

// Send input to WASM
function sendInputToWasm(type, value) {
    const callbackName = `__wasmInput_${type}`;
    if (window[callbackName]) {
        window[callbackName](value);
    }
}

// Show session result
function showSession(sessionString, userName) {
    updateProgress(3); // Move to Session step
    sessionStringElement.textContent = sessionString;
    sessionResult.style.display = 'block';
    resetBtn.style.display = 'flex';
    verifyBtn.style.display = 'none';
    
    if (userName) {
        addOutput(`✓ Session generated successfully for ${userName}!`, 'success');
    } else {
        addOutput('✓ Session generated successfully!', 'success');
    }
    
    enableButton(verifyBtn);
}

// Send code
sendCodeBtn.addEventListener('click', async () => {
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
    
    // Validate phone number format
    if (phoneNumber) {
        // Add + prefix if missing
        if (!phoneNumber.startsWith('+')) {
            phoneNumber = '+' + phoneNumber;
            phoneNumberInput.value = phoneNumber;
        }
        
        // Validate phone number format: +[country code][number]
        const phoneRegex = /^\+\d{8,15}$/;
        if (!phoneRegex.test(phoneNumber)) {
            addOutput('ERROR: Invalid phone number format. Must be +[country code][number] (8-15 digits)', 'error');
            return;
        }
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
    
    disableButton(sendCodeBtn);
    clearOutput();
    
    // Load WASM if not loaded
    if (!wasmInstance) {
        await loadWasm();
    }
    
    // Wait for WASM to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (window.generateSession) {
        if (botToken) {
            addOutput('Logging in as bot...', 'info');
        } else {
            addOutput(`Sending code to ${phoneNumber}...`, 'info');
        }
        try {
            window.generateSession(appId, appHash, phoneNumber, botToken);
            if (!botToken) {
                updateProgress(2); // Move to Verify step (only for user login)
            }
        } catch (error) {
            addOutput(`ERROR: ${error.message}`, 'error');
            enableButton(sendCodeBtn);
        }
        
        // Override console.log to catch WASM output
        const originalLog = console.log;
        console.log = (...args) => {
            const msg = args.join(' ');
            addOutput(msg, 'info');
            originalLog(...args);
            
            // Check for prompts from WASM
            if (msg.includes('PROMPT_CODE')) {
                sessionState.awaitingCode = true;
                updateProgress(2); // Move to Verify step
                codeGroup.style.display = 'block';
                verifyBtn.style.display = 'flex';
                sendCodeBtn.style.display = 'none';
                enableButton(sendCodeBtn);
                enableButton(verifyBtn);
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
            }
        };
        
        // Call WASM function
        window.generateSession(appId, appHash, phoneNumber);
    } else {
        addOutput('ERROR: Session generator not ready', 'error');
        enableButton(sendCodeBtn);
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

// Copy session
copyBtn.addEventListener('click', async () => {
    const session = sessionStringElement.textContent;
    
    try {
        await navigator.clipboard.writeText(session);
        const originalText = copyBtn.querySelector('span').textContent;
        copyBtn.querySelector('span').textContent = 'Copied!';
        copyBtn.style.background = 'var(--success)';
        copyBtn.style.color = 'white';
        
        setTimeout(() => {
            copyBtn.querySelector('span').textContent = originalText;
            copyBtn.style.background = '';
            copyBtn.style.color = '';
        }, 2000);
        
        addOutput('Session copied to clipboard', 'success');
    } catch (error) {
        addOutput('Failed to copy to clipboard', 'error');
    }
});

// Reset
resetBtn.addEventListener('click', () => {
    // Reset form
    appIdInput.value = '';
    appHashInput.value = '';
    phoneNumberInput.value = '';
    verificationCodeInput.value = '';
    passwordInput.value = '';
    
    // Reset UI
    codeGroup.style.display = 'none';
    passwordGroup.style.display = 'none';
    sessionResult.style.display = 'none';
    sendCodeBtn.style.display = 'flex';
    verifyBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    
    // Reset progress
    updateProgress(1);
    
    // Reset state
    sessionState = {
        appId: '',
        appHash: '',
        phoneNumber: '',
        phoneCodeHash: '',
        awaitingCode: false,
        awaiting2FA: false,
        currentStep: 1
    };
    
    clearOutput();
    addOutput('Enter your credentials to begin', 'info');
});

// Enter key handlers
appIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') appHashInput.focus();
});

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
