import { HttpAgent, Actor } from '@dfinity/agent';

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
    ),
    'getSessionInfo': IDL.Func(
      [IDL.Text],
      [IDL.Opt(IDL.Record({
        'sessionId': IDL.Text,
        'createdAt': IDL.Int,
        'peerCount': IDL.Nat,
        'isLocked': IDL.Bool,
        'isExpired': IDL.Bool
      }))],
      ['query']
    )
  });
};

async function initializeICPAgent() {
  try {
    const isLocal = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.port === '4943';
    
    let BACKEND_CANISTER_ID = 'ocqlz-pyaaa-aaaae-achva-cai';
    
    if (window.location.hostname.includes('ic0.app') || 
        window.location.hostname.includes('icp0.io') ||
        window.location.hostname.includes('raw.icp0.io')) {
      BACKEND_CANISTER_ID = 'ocqlz-pyaaa-aaaae-achva-cai';
    }
    
    const host = isLocal ? 'http://127.0.0.1:4943' : 'https://ic0.app';
    
    const agent = new HttpAgent({ host });
    
    if (isLocal) {
      await agent.fetchRootKey();
    }
    
    const actor = Actor.createActor(idlFactory, { agent, canisterId: BACKEND_CANISTER_ID });
    
    window.ICPAgent = {
      createSession: async () => await actor.createSession(),
      registerPeer: async (code, peerId) => await actor.registerPeer(code, peerId),
      sendSignal: async (sessionId, peerId, signal) => await actor.sendSignal(sessionId, peerId, signal),
      getSignals: async (sessionId, peerId) => await actor.getSignals(sessionId, peerId),
      clearSignals: async (sessionId, peerId) => await actor.clearSignals(sessionId, peerId),
      getSessionInfo: async (code) => await actor.getSessionInfo(code)
    };
    
    return true;
  } catch (error) {
    window.ICPAgent = createMockAgent();
    return false;
  }
}

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
      
      return { sessionId, code };
    },
    
    registerPeer: async (code, peerId) => {
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
    },
    
    getSessionInfo: async (code) => {
      await delay(30);
      const sessions = getMockSessions();
      const session = sessions[code];
      if (!session) {
        return null;
      }
      return {
        sessionId: session.sessionId,
        createdAt: Date.now() * 1000000,
        peerCount: session.peers.length,
        isLocked: session.peers.length >= 2,
        isExpired: false
      };
    }
  };
}

(async function() {
  await initializeICPAgent();
  require('./app.js');
})();
