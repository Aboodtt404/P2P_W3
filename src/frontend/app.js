// Phase 1 - Basic UI and Canister Integration
// WebRTC implementation will be added in Phase 2

// State
let currentMode = null;
let sessionId = null;
let sessionCode = null;
let peerId = null;
let selectedFile = null;

// Generate a unique peer ID
function generatePeerId() {
    return 'peer_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// UI Elements
const modeSelection = document.getElementById('mode-selection');
const sendMode = document.getElementById('send-mode');
const receiveMode = document.getElementById('receive-mode');
const backBtn = document.getElementById('btn-back');

// Send Mode Elements
const btnSend = document.getElementById('btn-send');
const fileInput = document.getElementById('file-input');
const fileLabel = document.querySelector('.file-label');
const fileName = document.getElementById('file-name');
const sessionDisplay = document.getElementById('session-display');
const sessionCodeText = document.getElementById('session-code-text');
const btnCopy = document.getElementById('btn-copy');
const senderStatus = document.getElementById('sender-status');
const senderStatusText = document.getElementById('sender-status-text');
const btnCancelSend = document.getElementById('btn-cancel-send');

// Receive Mode Elements
const btnReceive = document.getElementById('btn-receive');
const codeInput = document.getElementById('code-input');
const btnJoin = document.getElementById('btn-join');
const filePreview = document.getElementById('file-preview');
const receiverStatus = document.getElementById('receiver-status');
const receiverStatusText = document.getElementById('receiver-status-text');
const btnCancelReceive = document.getElementById('btn-cancel-receive');

// Initialize peer ID
peerId = generatePeerId();
console.log('Peer ID:', peerId);

// Mode Selection
btnSend.addEventListener('click', () => {
    currentMode = 'send';
    modeSelection.classList.add('hidden');
    sendMode.classList.remove('hidden');
    backBtn.classList.remove('hidden');
});

btnReceive.addEventListener('click', () => {
    currentMode = 'receive';
    modeSelection.classList.add('hidden');
    receiveMode.classList.remove('hidden');
    backBtn.classList.remove('hidden');
});

backBtn.addEventListener('click', () => {
    resetApp();
});

// File Selection
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        fileName.textContent = `${file.name} (${formatFileSize(file.size)})`;
        createSession();
    }
});

// Copy Session Code
btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(sessionCode);
    btnCopy.textContent = '✓';
    setTimeout(() => {
        btnCopy.textContent = '📋';
    }, 2000);
});

// Join Session
btnJoin.addEventListener('click', async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
        alert('Please enter a valid 6-digit code');
        return;
    }
    await joinSession(code);
});

// Cancel Actions
btnCancelSend.addEventListener('click', resetApp);
btnCancelReceive.addEventListener('click', resetApp);

// Canister Integration Functions

async function createSession() {
    try {
        senderStatus.classList.remove('hidden');
        senderStatusText.textContent = 'Creating session...';

        // TODO: Call actual canister method
        // For now, simulate with mock data
        const response = await mockCreateSession();
        
        sessionId = response.sessionId;
        sessionCode = response.code;

        sessionCodeText.textContent = sessionCode;
        sessionDisplay.classList.remove('hidden');
        senderStatusText.textContent = 'Waiting for receiver to join...';
        btnCancelSend.classList.remove('hidden');

        console.log('Session created:', { sessionId, sessionCode });

        // Start polling for peer connection (Phase 2)
        // pollForPeer();
    } catch (error) {
        console.error('Error creating session:', error);
        alert('Failed to create session. Please try again.');
        resetApp();
    }
}

async function joinSession(code) {
    try {
        receiverStatus.classList.remove('hidden');
        receiverStatusText.textContent = 'Joining session...';
        btnJoin.disabled = true;

        // TODO: Call actual canister method
        // For now, simulate with mock data
        const response = await mockRegisterPeer(code);

        if (response.err) {
            alert(response.err);
            receiverStatusText.textContent = 'Failed to join session';
            btnJoin.disabled = false;
            return;
        }

        sessionId = response.ok;
        sessionCode = code;

        receiverStatusText.textContent = 'Connected! Waiting for file transfer...';
        btnCancelReceive.classList.remove('hidden');

        console.log('Joined session:', { sessionId, sessionCode });

        // Start WebRTC connection process (Phase 2)
        // initiateWebRTCConnection();
    } catch (error) {
        console.error('Error joining session:', error);
        alert('Failed to join session. Please try again.');
        receiverStatusText.textContent = '';
        receiverStatus.classList.add('hidden');
        btnJoin.disabled = false;
    }
}

// Mock Functions (to be replaced with actual canister calls)
async function mockCreateSession() {
    await delay(1000);
    return {
        sessionId: 'session_' + Date.now(),
        code: generateMockCode()
    };
}

async function mockRegisterPeer(code) {
    await delay(1000);
    // Simulate successful registration
    return {
        ok: 'session_' + Date.now()
    };
    // To simulate error: return { err: 'Session not found' };
}

// Utility Functions
function generateMockCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetApp() {
    currentMode = null;
    sessionId = null;
    sessionCode = null;
    selectedFile = null;

    modeSelection.classList.remove('hidden');
    sendMode.classList.add('hidden');
    receiveMode.classList.add('hidden');
    backBtn.classList.add('hidden');

    sessionDisplay.classList.add('hidden');
    senderStatus.classList.add('hidden');
    btnCancelSend.classList.add('hidden');
    fileInput.value = '';
    fileName.textContent = 'Choose a file to share';

    codeInput.value = '';
    receiverStatus.classList.add('hidden');
    filePreview.classList.add('hidden');
    btnCancelReceive.classList.add('hidden');
    btnJoin.disabled = false;
}

console.log('P2P File Transfer App Initialized (Phase 1)');
console.log('Note: Currently using mock canister calls. Integration with ICP backend pending.');

