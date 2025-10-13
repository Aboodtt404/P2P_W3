// Phase 2+ - Complete WebRTC P2P File Transfer with Real ICP Integration
// Now using @dfinity/agent for actual canister communication

// ============================================================================
// CANISTER INTERFACE - Real ICP Agent Integration
// ============================================================================

// ICPAgent should be loaded by app-entry.js before this file executes
if (typeof window.ICPAgent === 'undefined') {
    console.error('FATAL: ICPAgent not loaded! This should not happen.');
    throw new Error('ICPAgent not available');
}

const canister = window.ICPAgent;

// ============================================================================
// CONFIGURATION
// ============================================================================

const CHUNK_SIZE = 64 * 1024; // 64KB chunks
const POLL_INTERVAL = 1000; // Poll for signals every 1 second

// ICE Servers configuration (STUN for NAT traversal)
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ]
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
        
        // Transfer state
        this.fileMetadata = null;
        this.receivedChunks = [];
        this.totalChunks = 0;
        this.receivedBytes = 0;
        
        // Polling
        this.pollingInterval = null;
        
        // Track expected chunk
        this.expectingChunkData = false;
        this.currentChunkSize = 0;
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
        this.expectingChunkData = false;
        this.currentChunkSize = 0;
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

console.log('🚀 P2P File Transfer - ICP Integration Active');
console.log('Peer ID:', state.peerId);
console.log('Attempting to connect to ICP backend canister...');

// ============================================================================
// EVENT LISTENERS
// ============================================================================

btnSend.addEventListener('click', () => {
    console.log('Send mode selected');
    state.currentMode = 'send';
    modeSelection.classList.add('hidden');
    sendMode.classList.remove('hidden');
    backBtn.classList.remove('hidden');
});

btnReceive.addEventListener('click', () => {
    console.log('Receive mode selected');
    state.currentMode = 'receive';
    modeSelection.classList.add('hidden');
    receiveMode.classList.remove('hidden');
    backBtn.classList.remove('hidden');
});

backBtn.addEventListener('click', resetApp);

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        console.log('File selected:', file.name, formatFileSize(file.size));
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
    console.log('File accepted by receiver');
    filePreview.classList.add('hidden');
    receiverStatus.classList.remove('hidden');
    receiverStatusText.textContent = 'Receiving file...';
    document.querySelector('#receiver-status .progress-bar').classList.remove('hidden');
});

btnReject.addEventListener('click', () => {
    console.log('File rejected by receiver');
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
        console.log('Creating session...');
        senderStatus.classList.remove('hidden');
        senderStatusText.textContent = 'Creating session...';

        const response = await canister.createSession();
        state.sessionId = response.sessionId;
        state.sessionCode = response.code;

        // IMPORTANT: Sender must also register as a peer!
        console.log('Registering sender as peer...');
        const registerResponse = await canister.registerPeer(state.sessionCode, state.peerId);
        
        if (registerResponse.err) {
            console.error('Error registering sender:', registerResponse.err);
            alert('Failed to register as peer: ' + registerResponse.err);
            resetApp();
            return;
        }

        sessionCodeText.textContent = state.sessionCode;
        sessionDisplay.classList.remove('hidden');
        senderStatusText.textContent = 'Waiting for receiver...';
        btnCancelSend.classList.remove('hidden');

        console.log('Session created:', { sessionId: state.sessionId, code: state.sessionCode });
        console.log('Sender registered to session');

        // Setup as offerer (sender creates the offer)
        await setupWebRTCConnection(true);
        startPollingForSignals();

    } catch (error) {
        console.error('Error creating session:', error);
        alert('Failed to create session. Please try again.');
        resetApp();
    }
}

async function joinSession(code) {
    try {
        console.log('Joining session with code:', code);
        receiverStatus.classList.remove('hidden');
        receiverStatusText.textContent = 'Joining session...';
        btnJoin.disabled = true;

        const response = await canister.registerPeer(code, state.peerId);

        if (response.err) {
            console.error('Error registering peer:', response.err);
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

        console.log('Joined session:', { sessionId: state.sessionId, code: state.sessionCode });

        // Setup as answerer (receiver responds to offer)
        await setupWebRTCConnection(false);
        startPollingForSignals();

    } catch (error) {
        console.error('Error joining session:', error);
        alert('Failed to join session. Please try again.');
        receiverStatus.classList.add('hidden');
        btnJoin.disabled = false;
    }
}

// ============================================================================
// WEBRTC SETUP
// ============================================================================

async function setupWebRTCConnection(isOfferer) {
    console.log('Setting up WebRTC connection as', isOfferer ? 'OFFERER' : 'ANSWERER');

    state.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // ICE Candidate handling
    state.peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            console.log('New ICE candidate');
            await sendSignalToCanister({
                type: 'ice-candidate',
                candidate: event.candidate.toJSON()
            });
        } else {
            console.log('ICE gathering complete');
        }
    };

    // Connection state monitoring
    state.peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', state.peerConnection.connectionState);
        
        if (state.peerConnection.connectionState === 'connected') {
            state.isConnected = true;
            console.log('WebRTC connection established!');
            if (state.currentMode === 'send') {
                senderStatusText.textContent = 'Connected! Preparing file...';
            } else {
                receiverStatusText.textContent = 'Connected! Waiting for file...';
            }
        } else if (state.peerConnection.connectionState === 'failed') {
            console.error('Connection failed');
            alert('Connection failed. Please try again.');
            resetApp();
        }
    };

    if (isOfferer) {
        // Sender creates data channel
        console.log('Creating data channel...');
        state.dataChannel = state.peerConnection.createDataChannel('fileTransfer');
        setupDataChannel();

        // Create and send offer
        const offer = await state.peerConnection.createOffer();
        await state.peerConnection.setLocalDescription(offer);
        console.log('Created SDP offer');

        await sendSignalToCanister({
            type: 'offer',
            sdp: offer.sdp
        });

    } else {
        // Receiver waits for data channel
        console.log('Waiting for data channel...');
        state.peerConnection.ondatachannel = (event) => {
            console.log('Data channel received');
            state.dataChannel = event.channel;
            setupDataChannel();
        };
    }
}

function setupDataChannel() {
    if (!state.dataChannel) return;

    state.dataChannel.binaryType = 'arraybuffer';
    console.log('Data channel configured');

    state.dataChannel.onopen = () => {
        console.log('✅ Data channel opened!');
        state.isConnected = true;

        if (state.currentMode === 'send') {
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
        console.error('Data channel error:', error);
        alert('Data transfer error occurred');
    };

    state.dataChannel.onclose = () => {
        console.log('Data channel closed');
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
            console.error('Error sending signal:', response.err);
        }
    } catch (error) {
        console.error('Error sending signal to canister:', error);
    }
}

function startPollingForSignals() {
    console.log('Starting signal polling...');
    state.pollingInterval = setInterval(async () => {
        try {
            const response = await canister.getSignals(state.sessionId, state.peerId);
            
            if (response.ok && response.ok.length > 0) {
                console.log('📨 Received', response.ok.length, 'signal(s)');
                
                for (const signalJson of response.ok) {
                    const signal = JSON.parse(signalJson);
                    await handleSignalFromCanister(signal);
                }
            }
        } catch (error) {
            console.error('Error polling for signals:', error);
        }
    }, POLL_INTERVAL);
}

async function handleSignalFromCanister(signal) {
    console.log('Handling signal type:', signal.type);

    if (signal.type === 'offer') {
        // Receiver gets offer from sender
        console.log('Received SDP offer, creating answer...');
        await state.peerConnection.setRemoteDescription({
            type: 'offer',
            sdp: signal.sdp
        });

        // Create and send answer
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        console.log('Created SDP answer');
        
        await sendSignalToCanister({
            type: 'answer',
            sdp: answer.sdp
        });

    } else if (signal.type === 'answer') {
        // Sender gets answer from receiver
        console.log('Received SDP answer');
        await state.peerConnection.setRemoteDescription({
            type: 'answer',
            sdp: signal.sdp
        });

    } else if (signal.type === 'ice-candidate') {
        // Add ICE candidate
        if (signal.candidate) {
            console.log('Adding ICE candidate');
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    }
}

// ============================================================================
// FILE TRANSFER FUNCTIONS
// ============================================================================

function sendFileMetadata() {
    if (!state.selectedFile || !state.dataChannel) {
        console.error('Cannot send metadata: missing file or data channel');
        return;
    }

    const metadata = {
        type: 'metadata',
        fileName: state.selectedFile.name,
        fileSize: state.selectedFile.size,
        fileType: state.selectedFile.type || 'application/octet-stream',
        totalChunks: Math.ceil(state.selectedFile.size / CHUNK_SIZE)
    };

    console.log('Sending file metadata:', metadata);
    state.dataChannel.send(JSON.stringify(metadata));
    
    // Auto-send file after a short delay
    setTimeout(() => sendFileData(), 1500);
}

async function sendFileData() {
    if (!state.selectedFile || !state.dataChannel) {
        console.error('Cannot send file: missing file or data channel');
        return;
    }

    console.log('Starting file transfer...');
    senderStatusText.textContent = 'Sending file...';
    document.querySelector('#sender-status .progress-bar').classList.remove('hidden');

    const totalChunks = Math.ceil(state.selectedFile.size / CHUNK_SIZE);
    let offset = 0;
    let chunkIndex = 0;

    while (offset < state.selectedFile.size) {
        const chunk = state.selectedFile.slice(offset, offset + CHUNK_SIZE);
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

        // Update progress
        const progress = Math.min((chunkIndex / totalChunks) * 100, 100);
        sendProgressBar.style.width = progress + '%';
        sendProgressText.textContent = `${chunkIndex} / ${totalChunks} chunks (${Math.round(progress)}%)`;

        // Small delay to prevent overwhelming the data channel
        if (chunkIndex % 10 === 0) {
            await delay(10);
        }
    }

    // Send completion signal
    state.dataChannel.send(JSON.stringify({ type: 'complete' }));
    
    senderStatusText.textContent = 'Transfer complete!';
    sendProgressText.textContent = `File sent successfully (${formatFileSize(state.selectedFile.size)})`;
    
    console.log('✅ File transfer complete!');
}

function handleDataChannelMessage(data) {
    // Check if it's a JSON message (metadata, chunk header, or control message)
    if (typeof data === 'string') {
        const message = JSON.parse(data);
        console.log('Received message type:', message.type);
        
        if (message.type === 'metadata') {
            handleFileMetadata(message);
        } else if (message.type === 'chunk') {
            // Chunk header received, next message will be binary data
            state.expectingChunkData = true;
            state.currentChunkSize = message.size;
        } else if (message.type === 'complete') {
            handleTransferComplete();
        }
    } else {
        // Binary data (chunk)
        if (state.expectingChunkData) {
            handleFileChunk(data);
            state.expectingChunkData = false;
        }
    }
}

function handleFileMetadata(metadata) {
    console.log('Received file metadata:', metadata);
    
    state.fileMetadata = metadata;
    state.totalChunks = metadata.totalChunks;
    state.receivedChunks = [];

    // Show file preview for user acceptance
    previewFilename.textContent = metadata.fileName;
    previewFilesize.textContent = formatFileSize(metadata.fileSize);
    previewFiletype.textContent = metadata.fileType;
    
    receiverStatus.classList.add('hidden');
    filePreview.classList.remove('hidden');
}

function handleFileChunk(arrayBuffer) {
    state.receivedChunks.push(arrayBuffer);
    state.receivedBytes += arrayBuffer.byteLength;

    // Update progress
    const progress = Math.min((state.receivedChunks.length / state.totalChunks) * 100, 100);
    receiveProgressBar.style.width = progress + '%';
    receiveProgressText.textContent = `${state.receivedChunks.length} / ${state.totalChunks} chunks (${Math.round(progress)}%)`;
    
    if (state.receivedChunks.length % 50 === 0) {
        console.log(`Received ${state.receivedChunks.length}/${state.totalChunks} chunks`);
    }
}

function handleTransferComplete() {
    console.log('Transfer complete! Assembling file...');
    
    // Combine all chunks into a single Blob
    const blob = new Blob(state.receivedChunks, { type: state.fileMetadata.fileType });
    
    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileMetadata.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    receiverStatusText.textContent = 'Download complete!';
    receiveProgressText.textContent = `File received successfully (${formatFileSize(state.receivedBytes)})`;
    
    console.log('✅ File downloaded:', state.fileMetadata.fileName);
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
    console.log('Resetting app...');
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

console.log('✅ App ready! Click Send or Receive to start.');
