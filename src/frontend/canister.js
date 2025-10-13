// Canister interface for backend communication
// This will be generated automatically by dfx, but we'll create a manual version for now

export class BackendCanister {
    constructor(canisterId, agent) {
        this.canisterId = canisterId;
        this.agent = agent;
    }

    async createSession() {
        // Call the backend canister's createSession method
        const response = await this.agent.call(this.canisterId, {
            methodName: 'createSession',
            arg: [],
        });
        return response;
    }

    async registerPeer(code, peerId) {
        const response = await this.agent.call(this.canisterId, {
            methodName: 'registerPeer',
            arg: [code, peerId],
        });
        return response;
    }

    async sendSignal(sessionId, peerId, signal) {
        const response = await this.agent.call(this.canisterId, {
            methodName: 'sendSignal',
            arg: [sessionId, peerId, signal],
        });
        return response;
    }

    async getSignals(sessionId, peerId) {
        const response = await this.agent.query(this.canisterId, {
            methodName: 'getSignals',
            arg: [sessionId, peerId],
        });
        return response;
    }

    async clearSignals(sessionId, peerId) {
        const response = await this.agent.call(this.canisterId, {
            methodName: 'clearSignals',
            arg: [sessionId, peerId],
        });
        return response;
    }

    async getSessionInfo(code) {
        const response = await this.agent.query(this.canisterId, {
            methodName: 'getSessionInfo',
            arg: [code],
        });
        return response;
    }
}

// Simple agent wrapper for local development
export function getCanisterFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const canisterId = params.get('canisterId');
    
    if (!canisterId) {
        console.error('No canisterId found in URL');
        return null;
    }

    // For now, return a mock that will be replaced with actual ICP agent
    return {
        canisterId,
        createSession: async () => mockCreateSession(),
        registerPeer: async (code, peerId) => mockRegisterPeer(code, peerId),
        sendSignal: async (sessionId, peerId, signal) => mockSendSignal(sessionId, peerId, signal),
        getSignals: async (sessionId, peerId) => mockGetSignals(sessionId, peerId),
        clearSignals: async (sessionId, peerId) => ({ ok: null }),
    };
}

// Mock implementations for testing without full ICP setup
let mockSessions = {};
let mockSignalQueues = {};

async function mockCreateSession() {
    const code = generateMockCode();
    const sessionId = 'session_' + Date.now();
    mockSessions[code] = { sessionId, peers: [], signals: {} };
    mockSignalQueues[sessionId] = {};
    await delay(500);
    return { sessionId, code };
}

async function mockRegisterPeer(code, peerId) {
    await delay(500);
    const session = mockSessions[code];
    if (!session) {
        return { err: 'Session not found' };
    }
    if (session.peers.length >= 2) {
        return { err: 'Session is full' };
    }
    if (!session.peers.includes(peerId)) {
        session.peers.push(peerId);
        mockSignalQueues[session.sessionId][peerId] = [];
    }
    return { ok: session.sessionId };
}

async function mockSendSignal(sessionId, fromPeerId, signal) {
    await delay(100);
    const session = Object.values(mockSessions).find(s => s.sessionId === sessionId);
    if (!session) {
        return { err: 'Session not found' };
    }
    
    // Send to the other peer
    const otherPeer = session.peers.find(p => p !== fromPeerId);
    if (otherPeer && mockSignalQueues[sessionId]) {
        if (!mockSignalQueues[sessionId][otherPeer]) {
            mockSignalQueues[sessionId][otherPeer] = [];
        }
        mockSignalQueues[sessionId][otherPeer].push(signal);
    }
    
    return { ok: null };
}

async function mockGetSignals(sessionId, peerId) {
    await delay(100);
    if (!mockSignalQueues[sessionId] || !mockSignalQueues[sessionId][peerId]) {
        return { ok: [] };
    }
    const signals = mockSignalQueues[sessionId][peerId];
    mockSignalQueues[sessionId][peerId] = []; // Clear after retrieval
    return { ok: signals };
}

function generateMockCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

