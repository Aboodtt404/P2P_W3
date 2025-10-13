// Webpack entry point - bundles ICP agent + app code
import { HttpAgent, Actor } from '@dfinity/agent';

// Candid interface definition (inline to avoid import issues)
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

// Initialize ICP Agent
async function initializeICPAgent() {
  try {
    // IMPORTANT: Use BACKEND canister ID, not frontend canister ID
    // The frontend canister ID is in the URL, but we need the backend one
    const BACKEND_CANISTER_ID = 'uxrrr-q7777-77774-qaaaq-cai';
    
    const host = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
      ? 'http://127.0.0.1:4943' 
      : 'https://ic0.app';
    
    console.log('Initializing ICP Agent...');
    console.log('Backend Canister ID:', BACKEND_CANISTER_ID);
    console.log('Host:', host);
    
    const agent = new HttpAgent({ host });
    
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      console.log('Fetching root key for local development...');
      await agent.fetchRootKey();
    }
    
    const actor = Actor.createActor(idlFactory, { agent, canisterId: BACKEND_CANISTER_ID });
    
    console.log('✅ ICP Agent initialized successfully');
    
    // Expose to global scope for app.js
    window.ICPAgent = {
      createSession: async () => await actor.createSession(),
      registerPeer: async (code, peerId) => await actor.registerPeer(code, peerId),
      sendSignal: async (sessionId, peerId, signal) => await actor.sendSignal(sessionId, peerId, signal),
      getSignals: async (sessionId, peerId) => await actor.getSignals(sessionId, peerId),
      clearSignals: async (sessionId, peerId) => await actor.clearSignals(sessionId, peerId)
    };
    
    return true;
  } catch (error) {
    console.error('Failed to initialize ICP Agent:', error);
    console.warn('Falling back to mock implementation');
    
    // Mock fallback (localStorage-based for same-browser testing)
    window.ICPAgent = createMockAgent();
    return false;
  }
}

// Mock implementation for fallback
function createMockAgent() {
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
  
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  return {
    createSession: async () => {
      const code = generateMockCode();
      const sessionId = 'session_' + Date.now();
      const sessions = getMockSessions();
      sessions[code] = { sessionId, peers: [] };
      setMockSessions(sessions);
      const queues = getMockSignalQueues();
      queues[sessionId] = {};
      setMockSignalQueues(queues);
      await delay(300);
      console.log('Mock: Created session', { sessionId, code });
      return { sessionId, code };
    },
    
    registerPeer: async (code, peerId) => {
      await delay(300);
      const sessions = getMockSessions();
      const session = sessions[code];
      if (!session) {
        console.log('Mock: Session not found');
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
      console.log('Mock: Registered peer');
      return { ok: session.sessionId };
    },
    
    sendSignal: async (sessionId, fromPeerId, signal) => {
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
    },
    
    getSignals: async (sessionId, peerId) => {
      await delay(30);
      const queues = getMockSignalQueues();
      if (!queues[sessionId] || !queues[sessionId][peerId]) {
        return { ok: [] };
      }
      const signals = queues[sessionId][peerId];
      queues[sessionId][peerId] = [];
      setMockSignalQueues(queues);
      return { ok: signals };
    },
    
    clearSignals: async () => {
      return { ok: null };
    }
  };
}

// Initialize agent FIRST, then load app
(async function() {
  await initializeICPAgent();
  console.log('ICP Agent ready, loading app...');
  
  // Now import and execute main app code
  require('./app.js');
})();

