// ICP Agent Integration - Real canister communication
// Uses global window.ic object from @dfinity/agent UMD build

(function() {
    'use strict';

    // Wait for @dfinity libraries to load
    if (typeof window.ic === 'undefined' || typeof window.ic.HttpAgent === 'undefined') {

        window.ICPAgent = createMockAgent();
        return;
    }

    const { HttpAgent, Actor } = window.ic;

    // Candid interface definition
    const idlFactory = ({ IDL }) => {
        const Result = IDL.Variant({
            'ok': IDL.Text,
            'err': IDL.Text
        });
        
        const Result_1 = IDL.Variant({
            'ok': IDL.Null,
            'err': IDL.Text
        });
        
        const Result_2 = IDL.Variant({
            'ok': IDL.Vec(IDL.Text),
            'err': IDL.Text
        });
        
        return IDL.Service({
            'createSession': IDL.Func(
                [],
                [IDL.Record({ 'sessionId': IDL.Text, 'code': IDL.Text })],
                []
            ),
            'registerPeer': IDL.Func(
                [IDL.Text, IDL.Text],
                [Result],
                []
            ),
            'sendSignal': IDL.Func(
                [IDL.Text, IDL.Text, IDL.Text],
                [Result_1],
                []
            ),
            'getSignals': IDL.Func(
                [IDL.Text, IDL.Text],
                [Result_2],
                ['query']
            ),
            'clearSignals': IDL.Func(
                [IDL.Text, IDL.Text],
                [Result_1],
                []
            )
        });
    };

    // Environment detection
    function getCanisterId() {
        const urlParams = new URLSearchParams(window.location.search);
        const canisterIdFromUrl = urlParams.get('canisterId');
        
        if (canisterIdFromUrl) {
            return canisterIdFromUrl;
        }
        
        // Fall back to known local canister ID
        return 'uxrrr-q7777-77774-qaaaq-cai';
    }

    function getHost() {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://127.0.0.1:4943';
        }
        return 'https://ic0.app';
    }

    // Initialize the agent and actor
    let actor = null;
    let isInitialized = false;

    async function initializeAgent() {
        if (isInitialized) return actor;
        
        try {

            
            const canisterId = getCanisterId();
            const host = getHost();
            


            
            // Create agent
            const agent = new HttpAgent({ host });
            
            // Fetch root key for local development
            if (host.includes('localhost') || host.includes('127.0.0.1')) {

                await agent.fetchRootKey();
            }
            
            // Create actor
            actor = Actor.createActor(idlFactory, {
                agent,
                canisterId,
            });
            
            isInitialized = true;

            
            return actor;
            
        } catch (error) {


            return null;
        }
    }

    // Real canister interface functions
    async function createSession() {
        const canisterActor = await initializeAgent();
        
        if (!canisterActor) {

            return await mockCreateSession();
        }
        
        try {
...');
            const response = await canisterActor.createSession();

            return response;
        } catch (error) {

            return await mockCreateSession();
        }
    }

    async function registerPeer(code, peerId) {
        const canisterActor = await initializeAgent();
        
        if (!canisterActor) {

            return await mockRegisterPeer(code, peerId);
        }
        
        try {
...', { code, peerId });
            const response = await canisterActor.registerPeer(code, peerId);

            return response;
        } catch (error) {

            return await mockRegisterPeer(code, peerId);
        }
    }

    async function sendSignal(sessionId, peerId, signal) {
        const canisterActor = await initializeAgent();
        
        if (!canisterActor) {
            return await mockSendSignal(sessionId, peerId, signal);
        }
        
        try {
            const response = await canisterActor.sendSignal(sessionId, peerId, signal);
            return response;
        } catch (error) {

            return await mockSendSignal(sessionId, peerId, signal);
        }
    }

    async function getSignals(sessionId, peerId) {
        const canisterActor = await initializeAgent();
        
        if (!canisterActor) {
            return await mockGetSignals(sessionId, peerId);
        }
        
        try {
            const response = await canisterActor.getSignals(sessionId, peerId);
            return response;
        } catch (error) {

            return await mockGetSignals(sessionId, peerId);
        }
    }

    async function clearSignals(sessionId, peerId) {
        const canisterActor = await initializeAgent();
        
        if (!canisterActor) {
            return { ok: null };
        }
        
        try {
            const response = await canisterActor.clearSignals(sessionId, peerId);
            return response;
        } catch (error) {

            return { ok: null };
        }
    }

    // Export to global scope
    window.ICPAgent = {
        createSession,
        registerPeer,
        sendSignal,
        getSignals,
        clearSignals
    };

    // Mock implementation helpers
    function createMockAgent() {
        return {
            createSession: mockCreateSession,
            registerPeer: mockRegisterPeer,
            sendSignal: mockSendSignal,
            getSignals: mockGetSignals,
            clearSignals: async () => ({ ok: null })
        };
    }

    function getMockSessions() {
        const data = localStorage.getItem('p2p_mock_sessions');
        return data ? JSON.parse(data) : {};
    }

    function setMockSessions(sessions) {
        localStorage.setItem('p2p_mock_sessions', JSON.stringify(sessions));
    }

    function getMockSignalQueues() {
        const data = localStorage.getItem('p2p_mock_signals');
        return data ? JSON.parse(data) : {};
    }

    function setMockSignalQueues(queues) {
        localStorage.setItem('p2p_mock_signals', JSON.stringify(queues));
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

    async function mockCreateSession() {
        const code = generateMockCode();
        const sessionId = 'session_' + Date.now();
        
        const sessions = getMockSessions();
        sessions[code] = { sessionId, peers: [] };
        setMockSessions(sessions);
        
        const queues = getMockSignalQueues();
        queues[sessionId] = {};
        setMockSignalQueues(queues);
        
        await delay(300);

        return { sessionId, code };
    }

    async function mockRegisterPeer(code, peerId) {
        await delay(300);
        
        const sessions = getMockSessions();
        const session = sessions[code];
        
        if (!session) {

            return { err: 'Session not found' };
        }
        
        if (session.peers.length >= 2) {
            return { err: 'Session is full' };
        }
        
        if (!session.peers.includes(peerId)) {
            session.peers.push(peerId);
            setMockSessions(sessions);
            
            const queues = getMockSignalQueues();
            if (!queues[session.sessionId]) {
                queues[session.sessionId] = {};
            }
            queues[session.sessionId][peerId] = [];
            setMockSignalQueues(queues);
        }
        

        return { ok: session.sessionId };
    }

    async function mockSendSignal(sessionId, fromPeerId, signal) {
        await delay(30);
        
        const sessions = getMockSessions();
        const session = Object.values(sessions).find(s => s.sessionId === sessionId);
        
        if (!session) {
            return { err: 'Session not found' };
        }
        
        const otherPeer = session.peers.find(p => p !== fromPeerId);
        
        if (otherPeer) {
            const queues = getMockSignalQueues();
            
            if (!queues[sessionId]) {
                queues[sessionId] = {};
            }
            if (!queues[sessionId][otherPeer]) {
                queues[sessionId][otherPeer] = [];
            }
            
            queues[sessionId][otherPeer].push(signal);
            setMockSignalQueues(queues);
        }
        
        return { ok: null };
    }

    async function mockGetSignals(sessionId, peerId) {
        await delay(30);
        
        const queues = getMockSignalQueues();
        
        if (!queues[sessionId] || !queues[sessionId][peerId]) {
            return { ok: [] };
        }
        
        const signals = queues[sessionId][peerId];
        queues[sessionId][peerId] = [];
        setMockSignalQueues(queues);
        
        return { ok: signals };
    }

})();
