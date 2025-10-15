// Phase 2+ - Complete WebRTC P2P File Transfer with Real ICP Integration
// Now using @dfinity/agent for actual canister communication

import pako from 'pako'; // Compression library

// ============================================================================
// CANISTER INTERFACE - Real ICP Agent Integration
// ============================================================================

// ICPAgent should be loaded by app-entry.js before this file executes
if (typeof window.ICPAgent === 'undefined') {
    
    throw new Error('ICPAgent not available');
}

const canister = window.ICPAgent;

// ============================================================================
// CONFIGURATION
// ============================================================================

// Dynamic chunk sizing - will be calibrated based on connection speed
let CHUNK_SIZE = 64 * 1024; // Start with 64KB, will adjust up to 1MB
const MIN_CHUNK_SIZE = 64 * 1024; // 64KB minimum
const MAX_CHUNK_SIZE = 1024 * 1024; // 1MB maximum
const POLL_INTERVAL = 1000; // Poll for signals every 1 second

// Flow control settings
const MAX_BUFFER_SIZE = 16 * 1024 * 1024; // 16MB buffer limit
const BUFFER_CHECK_THRESHOLD = 8 * 1024 * 1024; // Start throttling at 8MB

// Debug mode for transfer diagnostics
const DEBUG_TRANSFER = true; // Set to false in production

// Resume capability settings
const ENABLE_RESUME = true; // Enable resume on disconnect
const RESUME_DB_NAME = 'P2PTransferResume';
const RESUME_STORE_NAME = 'partialTransfers';
const RESUME_EXPIRY_HOURS = 24; // Auto-delete after 24 hours

// Compression settings
const ENABLE_COMPRESSION = true; // Enable automatic compression for text files
const COMPRESSION_MIN_SIZE = 1024; // Only compress files > 1KB
const COMPRESSIBLE_TYPES = [
    'text/', 'application/json', 'application/javascript', 'application/xml',
    'application/x-javascript', 'application/typescript'
];
const COMPRESSIBLE_EXTENSIONS = [
    '.txt', '.js', '.json', '.html', '.css', '.xml', '.csv', '.md',
    '.ts', '.tsx', '.jsx', '.yml', '.yaml', '.log', '.sql', '.sh'
];

// ICE Servers configuration (STUN for NAT traversal + TURN for relay fallback)
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        
        {
            urls: 'turn:194.31.150.154:3478',
            username: 'p2puser',
            credential: '7c7b566b994f24d4de4664007af235c31002484500f5546259b508f758e62323'
        },
        {
            urls: 'turn:194.31.150.154:3478?transport=tcp',
            username: 'p2puser',
            credential: '7c7b566b994f24d4de4664007af235c31002484500f5546259b508f758e62323'
        }
    ],
    iceCandidatePoolSize: 10
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

class AppState {
    constructor() {
        this.currentMode = null;
        this.sessionId = null;
        this.sessionCode = null;
        this.peerId = this.generatePeerId();
        this.selectedFile = null;
        
        // WebRTC
        this.peerConnection = null;
        this.dataChannel = null;
        this.isConnected = false;
        this.remoteDescriptionSet = false; // Track if remote description is set
        this.pendingIceCandidates = []; // Buffer for ICE candidates received before answer
        
        // Transfer state
        this.fileMetadata = null;
        this.receivedChunks = [];
        this.totalChunks = 0;
        this.receivedBytes = 0;
        
        // Transfer metrics (for debugging and optimization)
        this.transferStartTime = null;
        this.lastSpeedUpdate = null;
        this.lastBytesTransferred = 0;
        this.currentSpeed = 0; // MB/s
        this.bufferStalls = 0; // Count how many times we had to wait for buffer
        this.chunksSent = 0;
        this.chunksReceived = 0;
        
        // Polling
        this.pollingInterval = null;
        
        // Track expected chunk
        this.expectingChunkData = false;
        this.currentChunkSize = 0;
        
        // Track processed signals to avoid duplicates
        this.processedSignals = new Set();
        
        // Compression state
        this.isCompressed = false;
        this.originalSize = 0;
        this.compressedSize = 0;
        
        // Resume capability
        this.isResuming = false;
        this.resumeFromChunk = 0;
        this.receivedChunkMap = new Set(); // Track which chunks we have
        
        // Pause/Resume + Transfer control
        this.isPaused = false;
        this.transferAccepted = false; // Receiver must accept before transfer starts
        this.pendingChunks = []; // Buffer chunks before acceptance
    }

    generatePeerId() {
        return 'peer_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    reset() {
        this.stopPolling();
        this.closeConnections();
        
        this.currentMode = null;
        this.sessionId = null;
        this.sessionCode = null;
        this.selectedFile = null;
        this.fileMetadata = null;
        this.receivedChunks = [];
        this.totalChunks = 0;
        this.receivedBytes = 0;
        this.isConnected = false;
        this.remoteDescriptionSet = false;
        this.pendingIceCandidates = [];
        this.expectingChunkData = false;
        this.currentChunkSize = 0;
        this.processedSignals = new Set();
        
        // Reset transfer metrics
        this.transferStartTime = null;
        this.lastSpeedUpdate = null;
        this.lastBytesTransferred = 0;
        this.currentSpeed = 0;
        this.bufferStalls = 0;
        this.chunksSent = 0;
        this.chunksReceived = 0;
        
        // Reset compression state
        this.isCompressed = false;
        this.originalSize = 0;
        this.compressedSize = 0;
        
        // Reset resume state
        this.isResuming = false;
        this.resumeFromChunk = 0;
        this.receivedChunkMap = new Set();
        
        // Reset pause/control state
        this.isPaused = false;
        this.transferAccepted = false;
        this.pendingChunks = [];
    }

    closeConnections() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
}

const state = new AppState();

// ============================================================================
// DEBUG & UTILITY FUNCTIONS
// ============================================================================

// Debug logger for transfer diagnostics
function debugLog(category, message, data = null) {
    if (!DEBUG_TRANSFER) return;
    
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${timestamp}] [${category.toUpperCase()}]`;
    
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

// Calibrate chunk size based on connection quality
async function calibrateChunkSize() {
    if (!state.dataChannel || state.dataChannel.readyState !== 'open') {
        debugLog('calibrate', 'Cannot calibrate: data channel not ready');
        return;
    }
    
    debugLog('calibrate', 'Starting chunk size calibration...');
    
    const testStart = Date.now();
    const testSize = 256 * 1024; // 256KB test
    const testData = new ArrayBuffer(testSize);
    
    try {
        state.dataChannel.send(JSON.stringify({ type: 'calibration-test' }));
        state.dataChannel.send(testData);
        
        const sendDuration = Date.now() - testStart;
        const speedMBps = (testSize / sendDuration / 1024).toFixed(2);
        
        debugLog('calibrate', `Test send took ${sendDuration}ms (${speedMBps} MB/s)`);
        
        // Adjust chunk size based on speed
        if (sendDuration < 20) {
            // Very fast connection
            CHUNK_SIZE = MAX_CHUNK_SIZE; // 1MB
            debugLog('calibrate', '🚀 Fast connection detected, using 1MB chunks');
        } else if (sendDuration < 50) {
            // Good connection
            CHUNK_SIZE = 512 * 1024; // 512KB
            debugLog('calibrate', '✅ Good connection detected, using 512KB chunks');
        } else if (sendDuration < 100) {
            // Medium connection
            CHUNK_SIZE = 256 * 1024; // 256KB
            debugLog('calibrate', '⚡ Medium connection detected, using 256KB chunks');
        } else {
            // Slow connection
            CHUNK_SIZE = MIN_CHUNK_SIZE; // 64KB
            debugLog('calibrate', '⚠️  Slow connection detected, using 64KB chunks');
        }
        
        debugLog('calibrate', `Final chunk size: ${(CHUNK_SIZE / 1024).toFixed(0)}KB`);
    } catch (error) {
        debugLog('calibrate', 'Calibration failed, using default 64KB chunks', error);
        CHUNK_SIZE = MIN_CHUNK_SIZE;
    }
}

// Wait for buffer to drain
async function waitForBuffer(channel, maxWait = 5000) {
    const startTime = Date.now();
    
    while (channel.bufferedAmount > BUFFER_CHECK_THRESHOLD) {
        // Check timeout
        if (Date.now() - startTime > maxWait) {
            debugLog('buffer', `⚠️  Buffer wait timeout after ${maxWait}ms`, {
                bufferedAmount: channel.bufferedAmount,
                threshold: BUFFER_CHECK_THRESHOLD
            });
            break;
        }
        
        state.bufferStalls++;
        debugLog('buffer', `⏳ Waiting for buffer to drain... (${(channel.bufferedAmount / 1024 / 1024).toFixed(2)}MB buffered)`, {
            bufferedAmount: channel.bufferedAmount,
            threshold: BUFFER_CHECK_THRESHOLD,
            stallCount: state.bufferStalls
        });
        
        await delay(50);
    }
}

// Calculate current transfer speed
function updateTransferSpeed(bytesTransferred) {
    const now = Date.now();
    
    if (!state.lastSpeedUpdate) {
        state.lastSpeedUpdate = now;
        state.lastBytesTransferred = bytesTransferred;
        return;
    }
    
    const timeDiff = (now - state.lastSpeedUpdate) / 1000; // seconds
    
    // Update speed every second
    if (timeDiff >= 1.0) {
        const bytesDiff = bytesTransferred - state.lastBytesTransferred;
        const speedMBps = (bytesDiff / timeDiff / (1024 * 1024)).toFixed(2);
        
        state.currentSpeed = parseFloat(speedMBps);
        state.lastSpeedUpdate = now;
        state.lastBytesTransferred = bytesTransferred;
        
        debugLog('speed', `📊 Transfer speed: ${speedMBps} MB/s`, {
            bytesTransferred,
            bytesDiff,
            timeDiff: timeDiff.toFixed(2)
        });
    }
}

// ============================================================================
// INDEXEDDB FUNCTIONS (for resume capability)
// ============================================================================

// Initialize IndexedDB
function initResumeDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(RESUME_DB_NAME, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(RESUME_STORE_NAME)) {
                const store = db.createObjectStore(RESUME_STORE_NAME, { keyPath: 'sessionCode' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// Save partial transfer to IndexedDB
async function savePartialTransfer() {
    if (!ENABLE_RESUME || !state.sessionCode) return;
    
    try {
        const db = await initResumeDB();
        const transaction = db.transaction([RESUME_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(RESUME_STORE_NAME);
        
        const data = {
            sessionCode: state.sessionCode,
            sessionId: state.sessionId,
            fileMetadata: state.fileMetadata,
            receivedChunks: state.receivedChunks,
            receivedChunkMap: Array.from(state.receivedChunkMap),
            receivedBytes: state.receivedBytes,
            totalChunks: state.totalChunks,
            timestamp: Date.now(),
            isCompressed: state.isCompressed,
            originalSize: state.originalSize
        };
        
        store.put(data);
        
        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                debugLog('resume', '💾 Saved partial transfer', {
                    chunksReceived: state.receivedChunks.length,
                    totalChunks: state.totalChunks,
                    progress: `${Math.round((state.receivedChunks.length / state.totalChunks) * 100)}%`
                });
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
        
        db.close();
    } catch (error) {
        debugLog('resume', '❌ Failed to save partial transfer', error);
    }
}

// Load partial transfer from IndexedDB
async function loadPartialTransfer(sessionCode) {
    if (!ENABLE_RESUME) return null;
    
    try {
        const db = await initResumeDB();
        const transaction = db.transaction([RESUME_STORE_NAME], 'readonly');
        const store = transaction.objectStore(RESUME_STORE_NAME);
        
        const data = await new Promise((resolve, reject) => {
            const request = store.get(sessionCode);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        
        db.close();
        
        if (data) {
            // Check if expired
            const age = Date.now() - data.timestamp;
            const maxAge = RESUME_EXPIRY_HOURS * 60 * 60 * 1000;
            
            if (age > maxAge) {
                debugLog('resume', '⏰ Partial transfer expired, deleting', { age, maxAge });
                await deletePartialTransfer(sessionCode);
                return null;
            }
            
            debugLog('resume', '📂 Loaded partial transfer', {
                chunksReceived: data.receivedChunks.length,
                totalChunks: data.totalChunks,
                progress: `${Math.round((data.receivedChunks.length / data.totalChunks) * 100)}%`
            });
            
            return data;
        }
        
        return null;
    } catch (error) {
        debugLog('resume', '❌ Failed to load partial transfer', error);
        return null;
    }
}

// Delete partial transfer from IndexedDB
async function deletePartialTransfer(sessionCode) {
    if (!ENABLE_RESUME) return;
    
    try {
        const db = await initResumeDB();
        const transaction = db.transaction([RESUME_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(RESUME_STORE_NAME);
        
        store.delete(sessionCode);
        
        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                debugLog('resume', '🗑️  Deleted partial transfer', { sessionCode });
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
        
        db.close();
    } catch (error) {
        debugLog('resume', '❌ Failed to delete partial transfer', error);
    }
}

// ============================================================================
// COMPRESSION FUNCTIONS
// ============================================================================

// Check if file should be compressed
function shouldCompressFile(file) {
    if (!ENABLE_COMPRESSION) return false;
    if (file.size < COMPRESSION_MIN_SIZE) return false;
    
    // Check by MIME type
    for (const type of COMPRESSIBLE_TYPES) {
        if (file.type && file.type.startsWith(type)) {
            return true;
        }
    }
    
    // Check by file extension
    const fileName = file.name.toLowerCase();
    for (const ext of COMPRESSIBLE_EXTENSIONS) {
        if (fileName.endsWith(ext)) {
            return true;
        }
    }
    
    return false;
}

// Compress file data
async function compressFile(file) {
    debugLog('compression', '🗜️  Compressing file...', {
        fileName: file.name,
        originalSize: file.size
    });
    
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    const compressedData = pako.gzip(uint8Array, { level: 6 }); // Level 6 = good balance
    
    const compressionRatio = ((1 - compressedData.length / file.size) * 100).toFixed(1);
    
    debugLog('compression', '✅ Compression complete', {
        originalSize: file.size,
        compressedSize: compressedData.length,
        ratio: `${compressionRatio}%`,
        savings: `${(file.size - compressedData.length) / 1024 / 1024} MB`
    });
    
    return compressedData;
}

// Decompress file data
function decompressFile(compressedData) {
    debugLog('compression', '📦 Decompressing file...', {
        compressedSize: compressedData.byteLength
    });
    
    const uint8Array = new Uint8Array(compressedData);
    const decompressedData = pako.ungzip(uint8Array);
    
    debugLog('compression', '✅ Decompression complete', {
        decompressedSize: decompressedData.byteLength
    });
    
    return decompressedData.buffer;
}

// ============================================================================
// UI ELEMENTS
// ============================================================================

const modeSelection = document.getElementById('mode-selection');
const sendMode = document.getElementById('send-mode');
const receiveMode = document.getElementById('receive-mode');
const backBtn = document.getElementById('btn-back');

// Send Mode Elements
const btnSend = document.getElementById('btn-send');
const fileInput = document.getElementById('file-input');
const fileName = document.getElementById('file-name');
const sessionDisplay = document.getElementById('session-display');
const sessionCodeText = document.getElementById('session-code-text');
const btnCopy = document.getElementById('btn-copy');
const senderStatus = document.getElementById('sender-status');
const senderStatusText = document.getElementById('sender-status-text');
const sendProgressBar = document.getElementById('send-progress');
const sendProgressText = document.getElementById('send-progress-text');
const btnCancelSend = document.getElementById('btn-cancel-send');

// Receive Mode Elements
const btnReceive = document.getElementById('btn-receive');
const codeInput = document.getElementById('code-input');
const btnJoin = document.getElementById('btn-join');
const filePreview = document.getElementById('file-preview');
const previewFilename = document.getElementById('preview-filename');
const previewFilesize = document.getElementById('preview-filesize');
const previewFiletype = document.getElementById('preview-filetype');
const btnAccept = document.getElementById('btn-accept');
const btnReject = document.getElementById('btn-reject');
const receiverStatus = document.getElementById('receiver-status');
const receiverStatusText = document.getElementById('receiver-status-text');
const receiveProgressBar = document.getElementById('receive-progress');
const receiveProgressText = document.getElementById('receive-progress-text');
const btnCancelReceive = document.getElementById('btn-cancel-receive');

// ============================================================================
// INITIALIZATION
// ============================================================================





// ============================================================================
// EVENT LISTENERS
// ============================================================================

btnSend.addEventListener('click', () => {
    
    state.currentMode = 'send';
    modeSelection.classList.add('hidden');
    sendMode.classList.remove('hidden');
    backBtn.classList.remove('hidden');
});

btnReceive.addEventListener('click', () => {
    
    state.currentMode = 'receive';
    modeSelection.classList.add('hidden');
    receiveMode.classList.remove('hidden');
    backBtn.classList.remove('hidden');
});

backBtn.addEventListener('click', resetApp);

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        
        state.selectedFile = file;
        fileName.textContent = `${file.name} (${formatFileSize(file.size)})`;
        createSession();
    }
});

btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(state.sessionCode);
    btnCopy.textContent = '✓';
    setTimeout(() => { btnCopy.textContent = '📋'; }, 2000);
});

btnJoin.addEventListener('click', async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
        alert('Please enter a valid 6-digit code');
        return;
    }
    await joinSession(code);
});

btnAccept.addEventListener('click', () => {
    
    filePreview.classList.add('hidden');
    receiverStatus.classList.remove('hidden');
    receiverStatusText.textContent = 'Receiving file...';
    document.querySelector('#receiver-status .progress-bar').classList.remove('hidden');
});

btnReject.addEventListener('click', () => {
    
    alert('File transfer rejected');
    resetApp();
});

btnCancelSend.addEventListener('click', resetApp);
btnCancelReceive.addEventListener('click', resetApp);

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

async function createSession() {
    try {
        
        senderStatus.classList.remove('hidden');
        senderStatusText.textContent = 'Creating session...';

        const response = await canister.createSession();
        state.sessionId = response.sessionId;
        state.sessionCode = response.code;

        // IMPORTANT: Sender must also register as a peer!
        
        const registerResponse = await canister.registerPeer(state.sessionCode, state.peerId);
        
        if (registerResponse.err) {
            
            alert('Failed to register as peer: ' + registerResponse.err);
            resetApp();
            return;
        }

        sessionCodeText.textContent = state.sessionCode;
        sessionDisplay.classList.remove('hidden');
        senderStatusText.textContent = 'Waiting for receiver...';
        btnCancelSend.classList.remove('hidden');

        
        

        // IMPORTANT: Wait for receiver to join before creating offer
        senderStatusText.textContent = 'Waiting for receiver to join...';
        await waitForOtherPeer();
        
        senderStatusText.textContent = 'Receiver joined! Establishing connection...';
        
        // Setup as offerer (sender creates the offer)
        await setupWebRTCConnection(true);
        startPollingForSignals();

    } catch (error) {
        
        alert('Failed to create session. Please try again.');
        resetApp();
    }
}

async function joinSession(code) {
    try {
        
        receiverStatus.classList.remove('hidden');
        receiverStatusText.textContent = 'Joining session...';
        btnJoin.disabled = true;

        const response = await canister.registerPeer(code, state.peerId);

        if (response.err) {
            
            alert(response.err);
            receiverStatusText.textContent = 'Failed to join';
            receiverStatus.classList.add('hidden');
            btnJoin.disabled = false;
            return;
        }

        state.sessionId = response.ok;
        state.sessionCode = code;

        receiverStatusText.textContent = 'Connecting to peer...';
        btnCancelReceive.classList.remove('hidden');

        

        // Setup as answerer (receiver responds to offer)
        await setupWebRTCConnection(false);
        startPollingForSignals();

    } catch (error) {
        
        alert('Failed to join session. Please try again.');
        receiverStatus.classList.add('hidden');
        btnJoin.disabled = false;
    }
}

// Helper: Wait for the other peer to join the session
async function waitForOtherPeer() {
    
    
    return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
            try {
                // Check session info to see if 2 peers are registered
                const infoResult = await canister.getSessionInfo(state.sessionCode);
                
                // Handle Candid Opt type: returns [] or [value]
                const info = Array.isArray(infoResult) ? infoResult[0] : infoResult;
                
                
                
                if (info && info.peerCount >= 2) {
                    
                    clearInterval(checkInterval);
                    resolve();
                } else if (info) {
                    
                }
            } catch (error) {
                
            }
        }, 1000); // Check every 1 second
    });
}

// ============================================================================
// WEBRTC SETUP
// ============================================================================

async function setupWebRTCConnection(isOfferer) {
    

    state.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // ICE Candidate handling
    state.peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            await sendSignalToCanister({
                type: 'ice-candidate',
                candidate: event.candidate.toJSON()
            });
        }
    };

    // Connection state monitoring
    state.peerConnection.onconnectionstatechange = () => {
        
        
        if (state.peerConnection.connectionState === 'connected') {
            state.isConnected = true;
            
            if (state.currentMode === 'send') {
                senderStatusText.textContent = 'Connected! Preparing file...';
            } else {
                receiverStatusText.textContent = 'Connected! Waiting for file...';
            }
        } else if (state.peerConnection.connectionState === 'failed') {
            
            alert('Connection failed. Please try again.');
            resetApp();
        }
    };

    if (isOfferer) {
        // Sender creates data channel
        
        state.dataChannel = state.peerConnection.createDataChannel('fileTransfer');
        setupDataChannel();

        // Create and send offer
        const offer = await state.peerConnection.createOffer();
        await state.peerConnection.setLocalDescription(offer);
        

        await sendSignalToCanister({
            type: 'offer',
            sdp: offer.sdp
        });

    } else {
        // Receiver waits for data channel
        
        state.peerConnection.ondatachannel = (event) => {
            
            state.dataChannel = event.channel;
            setupDataChannel();
        };
    }
}

function setupDataChannel() {
    if (!state.dataChannel) return;

    state.dataChannel.binaryType = 'arraybuffer';
    

    state.dataChannel.onopen = async () => {
        debugLog('datachannel', '✅ Data channel opened', {
            readyState: state.dataChannel.readyState,
            mode: state.currentMode
        });
        
        state.isConnected = true;

        if (state.currentMode === 'send') {
            senderStatusText.textContent = 'Connected! Calibrating connection...';
            
            // Calibrate chunk size based on connection speed
            await calibrateChunkSize();
            
            senderStatusText.textContent = 'Connected! Sending file metadata...';
            setTimeout(() => sendFileMetadata(), 500);
        } else {
            receiverStatusText.textContent = 'Connected! Waiting for file info...';
        }
    };

    state.dataChannel.onmessage = (event) => {
        handleDataChannelMessage(event.data);
    };

    state.dataChannel.onerror = (error) => {
        
        alert('Data transfer error occurred');
    };

    state.dataChannel.onclose = () => {
        
    };
}

// ============================================================================
// SIGNALING VIA CANISTER
// ============================================================================

async function sendSignalToCanister(signal) {
    try {
        const signalJson = JSON.stringify(signal);
        const response = await canister.sendSignal(state.sessionId, state.peerId, signalJson);
        
        if (response.err) {
            
        }
    } catch (error) {
        
    }
}

function startPollingForSignals() {
    
    state.pollingInterval = setInterval(async () => {
        try {
            const response = await canister.getSignals(state.sessionId, state.peerId);
            
            if (response.ok && response.ok.length > 0) {
                
                
                let newSignalsProcessed = false;
                
                for (const signalJson of response.ok) {
                    const signal = JSON.parse(signalJson);
                    
                    // Create a unique hash for this signal based on type and content
                    let signalHash = signal.type;
                    if (signal.type === 'answer' || signal.type === 'offer') {
                        // For SDP, use type + first 50 chars of SDP
                        signalHash = signal.type + '_' + (signal.sdp || '').substring(0, 50);
                    } else if (signal.type === 'ice-candidate' && signal.candidate) {
                        // For ICE, use candidate string
                        signalHash = 'ice_' + (signal.candidate.candidate || '').substring(0, 50);
                    }
                    
                    // Skip if we've already processed this signal
                    if (state.processedSignals.has(signalHash)) {
                        
                        continue;
                    }
                    
                    await handleSignalFromCanister(signal);
                    
                    // Mark as processed
                    state.processedSignals.add(signalHash);
                    newSignalsProcessed = true;
                }
                
                // Only clear if we processed new signals
                if (newSignalsProcessed) {
                    // Clear signals after processing
                    await canister.clearSignals(state.sessionId, state.peerId);
                }
            }
        } catch (error) {
            
        }
    }, POLL_INTERVAL);
}

async function handleSignalFromCanister(signal) {
    

    if (signal.type === 'offer') {
        // Receiver gets offer from sender
        
        await state.peerConnection.setRemoteDescription({
            type: 'offer',
            sdp: signal.sdp
        });
        state.remoteDescriptionSet = true;

        // Create and send answer
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        
        
        await sendSignalToCanister({
            type: 'answer',
            sdp: answer.sdp
        });
        
        // Process any pending ICE candidates
        if (state.pendingIceCandidates.length > 0) {
            
            for (const candidate of state.pendingIceCandidates) {
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            state.pendingIceCandidates = [];
        }

    } else if (signal.type === 'answer') {
        // Sender gets answer from receiver
        // Only process if we haven't set remote description yet
        if (!state.remoteDescriptionSet) {
            try {
                
                await state.peerConnection.setRemoteDescription({
                    type: 'answer',
                    sdp: signal.sdp
                });
                state.remoteDescriptionSet = true;
                
                // Process any pending ICE candidates
                if (state.pendingIceCandidates.length > 0) {
                    
                    for (const candidate of state.pendingIceCandidates) {
                        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                    state.pendingIceCandidates = [];
                }
            } catch (error) {
                // If error setting remote description, it's likely already set
                
                state.remoteDescriptionSet = true;
            }
        } else {
            
        }

    } else if (signal.type === 'ice-candidate') {
        // Add ICE candidate
        if (signal.candidate) {
            if (state.remoteDescriptionSet) {
                // Remote description is set, add candidate immediately
                
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
                // Remote description not set yet, buffer the candidate
                
                state.pendingIceCandidates.push(signal.candidate);
            }
        }
    }
}

// ============================================================================
// FILE TRANSFER FUNCTIONS
// ============================================================================

async function sendFileMetadata() {
    if (!state.selectedFile || !state.dataChannel) {
        debugLog('transfer', '❌ Cannot send metadata: missing file or channel');
        return;
    }

    // Check if file should be compressed
    const shouldCompress = shouldCompressFile(state.selectedFile);
    let fileToSend = state.selectedFile;
    let actualSize = state.selectedFile.size;

    if (shouldCompress) {
        senderStatusText.textContent = 'Compressing file...';
        const compressedData = await compressFile(state.selectedFile);
        fileToSend = new Blob([compressedData]);
        actualSize = compressedData.length;
        state.isCompressed = true;
        state.originalSize = state.selectedFile.size;
        state.compressedSize = actualSize;
    }

    const metadata = {
        type: 'metadata',
        fileName: state.selectedFile.name,
        fileSize: actualSize,
        originalSize: state.selectedFile.size,
        fileType: state.selectedFile.type || 'application/octet-stream',
        totalChunks: Math.ceil(actualSize / CHUNK_SIZE),
        isCompressed: state.isCompressed
    };

    debugLog('transfer', '📤 Sending file metadata', {
        fileName: metadata.fileName,
        originalSize: state.selectedFile.size,
        actualSize: actualSize,
        isCompressed: state.isCompressed,
        compressionRatio: state.isCompressed ? `${((1 - actualSize / state.selectedFile.size) * 100).toFixed(1)}%` : 'N/A'
    });

    // Store the file to send
    state.fileToSend = fileToSend;
    
    state.dataChannel.send(JSON.stringify(metadata));
    
    // Auto-send file after a short delay
    setTimeout(() => sendFileData(), 1500);
}

async function sendFileData() {
    if (!state.selectedFile || !state.dataChannel) {
        debugLog('transfer', '❌ Cannot send: missing file or data channel');
        return;
    }

    // Use compressed file if available
    const fileToSend = state.fileToSend || state.selectedFile;
    const fileSize = fileToSend.size;

    // Initialize transfer metrics
    state.transferStartTime = Date.now();
    state.chunksSent = 0;
    state.bufferStalls = 0;
    state.lastSpeedUpdate = Date.now();
    state.lastBytesTransferred = 0;
    
    debugLog('transfer', '🚀 Starting file transfer', {
        fileName: state.selectedFile.name,
        fileSize: fileSize,
        isCompressed: state.isCompressed,
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(fileSize / CHUNK_SIZE)
    });
    
    senderStatusText.textContent = 'Sending file...';
    document.querySelector('#sender-status .progress-bar').classList.remove('hidden');

    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    let offset = 0;
    let chunkIndex = 0;
    let bytesSent = 0;

    while (offset < fileSize) {
        // ⭐ FLOW CONTROL: Wait for buffer to drain before sending more
        if (state.dataChannel.bufferedAmount > BUFFER_CHECK_THRESHOLD) {
            await waitForBuffer(state.dataChannel);
        }
        
        const chunk = fileToSend.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await chunk.arrayBuffer();
        
        // Send chunk header (as JSON string)
        const chunkHeader = {
            type: 'chunk',
            index: chunkIndex,
            size: arrayBuffer.byteLength
        };
        state.dataChannel.send(JSON.stringify(chunkHeader));
        
        // Send chunk data
        state.dataChannel.send(arrayBuffer);
        
        offset += CHUNK_SIZE;
        chunkIndex++;
        bytesSent += arrayBuffer.byteLength;
        state.chunksSent++;
        
        // Update transfer speed calculation
        updateTransferSpeed(bytesSent);

        // Update progress UI
        const progress = Math.min((chunkIndex / totalChunks) * 100, 100);
        sendProgressBar.style.width = progress + '%';
        
        // Show speed in progress text
        if (state.currentSpeed > 0) {
            sendProgressText.textContent = `${chunkIndex} / ${totalChunks} chunks (${state.currentSpeed} MB/s)`;
        } else {
            sendProgressText.textContent = `${chunkIndex} / ${totalChunks} chunks (${Math.round(progress)}%)`;
        }
        
        // Debug log every 50 chunks
        if (chunkIndex % 50 === 0) {
            debugLog('transfer', `📦 Progress: ${chunkIndex}/${totalChunks} chunks`, {
                progress: `${Math.round(progress)}%`,
                bytesSent,
                bufferedAmount: state.dataChannel.bufferedAmount,
                currentSpeed: `${state.currentSpeed} MB/s`,
                bufferStalls: state.bufferStalls
            });
        }
    }

    // Send completion signal
    state.dataChannel.send(JSON.stringify({ type: 'complete' }));
    
    const transferDuration = ((Date.now() - state.transferStartTime) / 1000).toFixed(2);
    const avgSpeed = (state.selectedFile.size / (Date.now() - state.transferStartTime) / 1024).toFixed(2);
    
    debugLog('transfer', '✅ Transfer complete!', {
        totalChunks: state.chunksSent,
        fileSize: state.selectedFile.size,
        duration: `${transferDuration}s`,
        avgSpeed: `${avgSpeed} MB/s`,
        bufferStalls: state.bufferStalls
    });
    
    senderStatusText.textContent = 'Transfer complete!';
    sendProgressText.textContent = `File sent successfully (${formatFileSize(state.selectedFile.size)}) - ${avgSpeed} MB/s avg`;
}

function handleDataChannelMessage(data) {
    // Check if it's a JSON message (metadata, chunk header, or control message)
    if (typeof data === 'string') {
        const message = JSON.parse(data);
        
        if (message.type === 'calibration-test') {
            // Ignore calibration test messages on receiver side
            debugLog('datachannel', 'Received calibration test (ignoring)');
            return;
        } else if (message.type === 'resume') {
            // Receiver wants to resume from specific chunk
            debugLog('transfer', '⏯️  Resume request received', { fromChunk: message.fromChunk });
            state.resumeFromChunk = message.fromChunk;
            // Sender will skip already-sent chunks
        } else if (message.type === 'metadata') {
            handleFileMetadata(message);
        } else if (message.type === 'chunk') {
            // Chunk header received, next message will be binary data
            state.expectingChunkData = true;
            state.currentChunkSize = message.size;
        } else if (message.type === 'complete') {
            handleTransferComplete();
        }
    } else {
        // Binary data (chunk or calibration)
        if (state.expectingChunkData) {
            handleFileChunk(data);
            state.expectingChunkData = false;
        } else {
            // Likely calibration data, ignore
            debugLog('datachannel', `Received ${data.byteLength} bytes (calibration or unexpected)`);
        }
    }
}

async function handleFileMetadata(metadata) {
    debugLog('receive', '📄 Received file metadata', {
        fileName: metadata.fileName,
        fileSize: metadata.fileSize,
        totalChunks: metadata.totalChunks,
        isCompressed: metadata.isCompressed
    });
    
    state.fileMetadata = metadata;
    state.totalChunks = metadata.totalChunks;
    state.receivedChunks = [];
    state.isCompressed = metadata.isCompressed || false;
    state.originalSize = metadata.originalSize || metadata.fileSize;
    
    // Initialize receive metrics
    state.transferStartTime = Date.now();
    state.lastSpeedUpdate = Date.now();
    state.lastBytesTransferred = 0;
    state.chunksReceived = 0;
    
    // Check for resume capability
    if (ENABLE_RESUME) {
        const partial = await loadPartialTransfer(state.sessionCode);
        if (partial && partial.fileMetadata.fileName === metadata.fileName) {
            const resumeConfirm = confirm(
                `Found incomplete transfer:\n${partial.fileMetadata.fileName}\n` +
                `Progress: ${partial.receivedChunks.length}/${partial.totalChunks} chunks ` +
                `(${Math.round((partial.receivedChunks.length / partial.totalChunks) * 100)}%)\n\n` +
                `Resume download?`
            );
            
            if (resumeConfirm) {
                // Restore state
                state.receivedChunks = partial.receivedChunks;
                state.receivedChunkMap = new Set(partial.receivedChunkMap);
                state.receivedBytes = partial.receivedBytes;
                state.isResuming = true;
                
                debugLog('resume', '⏯️  Resuming transfer', {
                    from: partial.receivedChunks.length,
                    total: partial.totalChunks
                });
                
                // Notify sender to resume from last chunk
                state.dataChannel.send(JSON.stringify({
                    type: 'resume',
                    fromChunk: partial.receivedChunks.length
                }));
            } else {
                // User declined, delete partial transfer
                await deletePartialTransfer(state.sessionCode);
            }
        }
    }

    // Show file preview for user acceptance
    previewFilename.textContent = metadata.fileName;
    previewFilesize.textContent = formatFileSize(metadata.originalSize || metadata.fileSize);
    
    let typeText = metadata.fileType;
    if (state.isCompressed) {
        const compressionRatio = ((1 - metadata.fileSize / metadata.originalSize) * 100).toFixed(1);
        typeText += ` (Compressed ${compressionRatio}%)`;
    }
    previewFiletype.textContent = typeText;
    
    receiverStatus.classList.add('hidden');
    filePreview.classList.remove('hidden');
}

function handleFileChunk(arrayBuffer) {
    state.receivedChunks.push(arrayBuffer);
    state.receivedBytes += arrayBuffer.byteLength;
    state.chunksReceived++;
    state.receivedChunkMap.add(state.chunksReceived - 1);
    
    // Update transfer speed calculation
    updateTransferSpeed(state.receivedBytes);

    // ⭐ Save progress every 50 chunks for resume capability
    if (ENABLE_RESUME && state.receivedChunks.length % 50 === 0) {
        savePartialTransfer();
    }

    // Update progress
    const progress = Math.min((state.receivedChunks.length / state.totalChunks) * 100, 100);
    receiveProgressBar.style.width = progress + '%';
    
    // Show speed in progress text
    if (state.currentSpeed > 0) {
        receiveProgressText.textContent = `${state.receivedChunks.length} / ${state.totalChunks} chunks (${state.currentSpeed} MB/s)`;
    } else {
        receiveProgressText.textContent = `${state.receivedChunks.length} / ${state.totalChunks} chunks (${Math.round(progress)}%)`;
    }
    
    // Debug log every 50 chunks
    if (state.receivedChunks.length % 50 === 0) {
        debugLog('receive', `📦 Progress: ${state.receivedChunks.length}/${state.totalChunks} chunks`, {
            progress: `${Math.round(progress)}%`,
            bytesReceived: state.receivedBytes,
            currentSpeed: `${state.currentSpeed} MB/s`
        });
    }
}

async function handleTransferComplete() {
    const transferDuration = ((Date.now() - state.transferStartTime) / 1000).toFixed(2);
    const avgSpeed = (state.receivedBytes / (Date.now() - state.transferStartTime) / 1024).toFixed(2);
    
    debugLog('receive', '✅ Transfer complete!', {
        totalChunks: state.chunksReceived,
        fileSize: state.receivedBytes,
        duration: `${transferDuration}s`,
        avgSpeed: `${avgSpeed} MB/s`,
        isCompressed: state.isCompressed
    });
    
    let blob;
    
    // Handle decompression if file was compressed
    if (state.isCompressed) {
        receiverStatusText.textContent = 'Decompressing file...';
        
        try {
            // Combine compressed chunks
            const compressedBlob = new Blob(state.receivedChunks);
            const compressedData = await compressedBlob.arrayBuffer();
            
            // Decompress
            const decompressedData = decompressFile(compressedData);
            blob = new Blob([decompressedData], { type: state.fileMetadata.fileType });
            
            debugLog('compression', '🎉 Decompression successful', {
                compressedSize: state.receivedBytes,
                decompressedSize: decompressedData.byteLength,
                ratio: `${((1 - state.receivedBytes / decompressedData.byteLength) * 100).toFixed(1)}%`
            });
        } catch (error) {
            debugLog('compression', '❌ Decompression failed', error);
            alert('Decompression failed! File may be corrupted.');
            return;
        }
    } else {
        // Combine chunks as-is (not compressed)
        blob = new Blob(state.receivedChunks, { type: state.fileMetadata.fileType });
    }
    
    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileMetadata.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Delete saved partial transfer (complete now)
    if (ENABLE_RESUME) {
        deletePartialTransfer(state.sessionCode);
    }

    receiverStatusText.textContent = 'Download complete!';
    receiveProgressText.textContent = `File received successfully (${formatFileSize(state.receivedBytes)}) - ${avgSpeed} MB/s avg`;
    
    debugLog('receive', `📥 File downloaded: ${state.fileMetadata.fileName}`);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
    
    state.reset();

    modeSelection.classList.remove('hidden');
    sendMode.classList.add('hidden');
    receiveMode.classList.add('hidden');
    backBtn.classList.add('hidden');

    sessionDisplay.classList.add('hidden');
    senderStatus.classList.add('hidden');
    document.querySelector('#sender-status .progress-bar').classList.add('hidden');
    btnCancelSend.classList.add('hidden');
    fileInput.value = '';
    fileName.textContent = 'Choose a file to share';
    sendProgressBar.style.width = '0%';
    sendProgressText.textContent = '';

    codeInput.value = '';
    receiverStatus.classList.add('hidden');
    filePreview.classList.add('hidden');
    document.querySelector('#receiver-status .progress-bar').classList.add('hidden');
    btnCancelReceive.classList.add('hidden');
    btnJoin.disabled = false;
    receiveProgressBar.style.width = '0%';
    receiveProgressText.textContent = '';
}


