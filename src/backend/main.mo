import Time "mo:base/Time";
import Text "mo:base/Text";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Buffer "mo:base/Buffer";
import Option "mo:base/Option";

persistent actor P2PSignaling {
    // Types
    type SessionId = Text;
    type PeerId = Text;
    type Signal = Text; // JSON string containing SDP offer/answer or ICE candidate
    type Timestamp = Int;

    type PeerInfo = {
        id: PeerId;
        joinedAt: Timestamp;
    };

    type Session = {
        id: SessionId;
        code: Text; // 6-digit alphanumeric code
        createdAt: Timestamp;
        peers: [PeerInfo];
        isLocked: Bool;
        signals: [(PeerId, [Signal])]; // Map of peerId to their signal queue
    };

    // Constants
    private transient let SESSION_TTL_SECONDS : Int = 600; // 10 minutes
    private transient let MAX_PEERS_PER_SESSION : Nat = 2;

    // State
    private transient var sessions = HashMap.HashMap<SessionId, Session>(10, Text.equal, Text.hash);
    private transient var codeToSessionId = HashMap.HashMap<Text, SessionId>(10, Text.equal, Text.hash);
    private transient var sessionCounter : Nat = 0;

    // Helper: Generate a random 6-digit alphanumeric code
    private func generateCode(seed: Nat) : Text {
        let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let charsArray = Text.toArray(chars);
        var code = "";
        
        // Use Linear Congruential Generator with good mixing
        var state = seed;
        
        for (i in Iter.range(0, 5)) {
            // LCG: next = (a * current + c) mod m
            // Using well-tested constants for good randomness
            state := (state * 1664525 + 1013904223) % 4294967296;
            
            // Additional mixing with different prime
            state := (state * 2654435761) % 4294967296;
            
            let index = state % 36;
            code := code # Text.fromChar(charsArray[index]);
        };
        
        code
    };

    // Helper: Check if session has expired
    private func isSessionExpired(session: Session) : Bool {
        let now = Time.now();
        let elapsedSeconds = (now - session.createdAt) / 1_000_000_000;
        elapsedSeconds > SESSION_TTL_SECONDS
    };

    // Helper: Clean up expired sessions
    private func cleanupExpiredSessions() : () {
        let _now = Time.now();
        let sessionsToRemove = Buffer.Buffer<SessionId>(0);

        for ((sessionId, session) in sessions.entries()) {
            if (isSessionExpired(session)) {
                sessionsToRemove.add(sessionId);
            };
        };

        for (sessionId in sessionsToRemove.vals()) {
            switch (sessions.get(sessionId)) {
                case (?session) {
                    codeToSessionId.delete(session.code);
                };
                case null {};
            };
            sessions.delete(sessionId);
        };
    };

    // Helper: Get peer signals
    private func getPeerSignals(session: Session, peerId: PeerId) : [Signal] {
        for ((pid, signals) in session.signals.vals()) {
            if (pid == peerId) {
                return signals;
            };
        };
        []
    };

    // Helper: Update session signals
    private func updateSessionSignals(session: Session, targetPeerId: PeerId, newSignal: Signal) : Session {
        let updatedSignals = Buffer.Buffer<(PeerId, [Signal])>(session.signals.size());
        var found = false;

        for ((peerId, signals) in session.signals.vals()) {
            if (peerId == targetPeerId) {
                let signalBuffer = Buffer.Buffer<Signal>(signals.size() + 1);
                for (sig in signals.vals()) {
                    signalBuffer.add(sig);
                };
                signalBuffer.add(newSignal);
                updatedSignals.add((peerId, Buffer.toArray(signalBuffer)));
                found := true;
            } else {
                updatedSignals.add((peerId, signals));
            };
        };

        // If peer not found, add them
        if (not found) {
            updatedSignals.add((targetPeerId, [newSignal]));
        };

        {
            id = session.id;
            code = session.code;
            createdAt = session.createdAt;
            peers = session.peers;
            isLocked = session.isLocked;
            signals = Buffer.toArray(updatedSignals);
        }
    };

    // Helper: Clear peer signals after retrieval
    private func clearPeerSignals(session: Session, peerId: PeerId) : Session {
        let updatedSignals = Buffer.Buffer<(PeerId, [Signal])>(session.signals.size());

        for ((pid, signals) in session.signals.vals()) {
            if (pid == peerId) {
                updatedSignals.add((pid, [])); // Clear signals
            } else {
                updatedSignals.add((pid, signals));
            };
        };

        {
            id = session.id;
            code = session.code;
            createdAt = session.createdAt;
            peers = session.peers;
            isLocked = session.isLocked;
            signals = Buffer.toArray(updatedSignals);
        }
    };

    // Public API

    /// Create a new signaling session
    /// Returns: { sessionId, code } - The session ID and 6-digit shareable code
    public func createSession() : async { sessionId: Text; code: Text } {
        cleanupExpiredSessions();

        sessionCounter += 1;
        let sessionId = "session_" # Nat.toText(sessionCounter) # "_" # Int.toText(Time.now());
        
        // Generate unique code with high entropy (combine timestamp + counter)
        let timestamp = Int.abs(Time.now());
        let baseSeed = (timestamp % 999999999) + (sessionCounter * 7919); // Mix timestamp with counter
        var code = generateCode(baseSeed);
        var attempts = 0;
        while (Option.isSome(codeToSessionId.get(code)) and attempts < 100) {
            attempts += 1;
            code := generateCode(baseSeed + attempts * 104729); // Use prime number for collision handling
        };

        let newSession : Session = {
            id = sessionId;
            code = code;
            createdAt = Time.now();
            peers = [];
            isLocked = false;
            signals = [];
        };

        sessions.put(sessionId, newSession);
        codeToSessionId.put(code, sessionId);

        { sessionId = sessionId; code = code }
    };

    /// Register a peer to a session using the 6-digit code
    /// Returns: Result with sessionId on success, or error message
    public func registerPeer(code: Text, peerId: PeerId) : async {
        #ok: Text;
        #err: Text;
    } {
        cleanupExpiredSessions();

        // Find session by code
        switch (codeToSessionId.get(code)) {
            case null {
                #err("Session not found or expired")
            };
            case (?sessionId) {
                switch (sessions.get(sessionId)) {
                    case null {
                        #err("Session not found")
                    };
                    case (?session) {
                        // Check if expired
                        if (isSessionExpired(session)) {
                            sessions.delete(sessionId);
                            codeToSessionId.delete(code);
                            return #err("Session expired");
                        };

                        // Check if locked
                        if (session.isLocked) {
                            return #err("Session is full");
                        };

                        // Check if peer already registered
                        for (peer in session.peers.vals()) {
                            if (peer.id == peerId) {
                                return #ok(sessionId);
                            };
                        };

                        // Check max peers
                        if (session.peers.size() >= MAX_PEERS_PER_SESSION) {
                            return #err("Session is full");
                        };

                        // Add peer
                        let peerBuffer = Buffer.Buffer<PeerInfo>(session.peers.size() + 1);
                        for (peer in session.peers.vals()) {
                            peerBuffer.add(peer);
                        };
                        peerBuffer.add({
                            id = peerId;
                            joinedAt = Time.now();
                        });

                        let newPeers = Buffer.toArray(peerBuffer);
                        let shouldLock = newPeers.size() >= MAX_PEERS_PER_SESSION;

                        // Initialize signal queue for new peer
                        let signalBuffer = Buffer.Buffer<(PeerId, [Signal])>(session.signals.size() + 1);
                        for (sig in session.signals.vals()) {
                            signalBuffer.add(sig);
                        };
                        signalBuffer.add((peerId, []));

                        let updatedSession : Session = {
                            id = session.id;
                            code = session.code;
                            createdAt = session.createdAt;
                            peers = newPeers;
                            isLocked = shouldLock;
                            signals = Buffer.toArray(signalBuffer);
                        };

                        sessions.put(sessionId, updatedSession);
                        #ok(sessionId)
                    };
                };
            };
        };
    };

    /// Send a WebRTC signal (SDP/ICE) to the other peer in the session
    public func sendSignal(sessionId: SessionId, fromPeerId: PeerId, signal: Signal) : async {
        #ok;
        #err: Text;
    } {
        switch (sessions.get(sessionId)) {
            case null {
                #err("Session not found")
            };
            case (?session) {
                // Check if expired
                if (isSessionExpired(session)) {
                    sessions.delete(sessionId);
                    codeToSessionId.delete(session.code);
                    return #err("Session expired");
                };

                // Verify peer is in session
                var peerFound = false;
                for (peer in session.peers.vals()) {
                    if (peer.id == fromPeerId) {
                        peerFound := true;
                    };
                };

                if (not peerFound) {
                    return #err("Peer not registered in this session");
                };

                // Send signal to the OTHER peer (not the sender)
                var targetPeerId : ?PeerId = null;
                for (peer in session.peers.vals()) {
                    if (peer.id != fromPeerId) {
                        targetPeerId := ?peer.id;
                    };
                };

                switch (targetPeerId) {
                    case null {
                        #err("No other peer in session yet")
                    };
                    case (?toPeerId) {
                        let updatedSession = updateSessionSignals(session, toPeerId, signal);
                        sessions.put(sessionId, updatedSession);
                        #ok
                    };
                };
            };
        };
    };

    /// Get pending signals for a peer (polling approach)
    /// Returns all queued signals and clears the queue
    public query func getSignals(sessionId: SessionId, peerId: PeerId) : async {
        #ok: [Signal];
        #err: Text;
    } {
        switch (sessions.get(sessionId)) {
            case null {
                #err("Session not found")
            };
            case (?session) {
                // Check if expired (query can't modify state, so just report)
                if (isSessionExpired(session)) {
                    return #err("Session expired");
                };

                // Verify peer is in session
                var peerFound = false;
                for (peer in session.peers.vals()) {
                    if (peer.id == peerId) {
                        peerFound := true;
                    };
                };

                if (not peerFound) {
                    return #err("Peer not registered in this session");
                };

                // Get signals
                let signals = getPeerSignals(session, peerId);
                #ok(signals)
            };
        };
    };

    /// Clear signals after retrieval (separate update call since getSignals is a query)
    public func clearSignals(sessionId: SessionId, peerId: PeerId) : async {
        #ok;
        #err: Text;
    } {
        switch (sessions.get(sessionId)) {
            case null {
                #err("Session not found")
            };
            case (?session) {
                let updatedSession = clearPeerSignals(session, peerId);
                sessions.put(sessionId, updatedSession);
                #ok
            };
        };
    };

    /// Get session info (for debugging/UI)
    public query func getSessionInfo(code: Text) : async ?{
        sessionId: Text;
        createdAt: Int;
        peerCount: Nat;
        isLocked: Bool;
        isExpired: Bool;
    } {
        switch (codeToSessionId.get(code)) {
            case null { null };
            case (?sessionId) {
                switch (sessions.get(sessionId)) {
                    case null { null };
                    case (?session) {
                        ?{
                            sessionId = session.id;
                            createdAt = session.createdAt;
                            peerCount = session.peers.size();
                            isLocked = session.isLocked;
                            isExpired = isSessionExpired(session);
                        }
                    };
                };
            };
        };
    };
}

