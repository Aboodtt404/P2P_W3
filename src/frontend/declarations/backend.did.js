// Candid interface for the backend canister
// This will be used by @dfinity/agent to communicate with the canister

export const idlFactory = ({ IDL }) => {
  const SessionId = IDL.Text;
  const PeerId = IDL.Text;
  const Signal = IDL.Text;
  
  const Result = IDL.Variant({
    'ok': IDL.Text,
    'err': IDL.Text
  });
  
  const Result_1 = IDL.Variant({
    'ok': IDL.Null,
    'err': IDL.Text
  });
  
  const Result_2 = IDL.Variant({
    'ok': IDL.Vec(Signal),
    'err': IDL.Text
  });
  
  const SessionInfo = IDL.Record({
    'sessionId': IDL.Text,
    'createdAt': IDL.Int,
    'peerCount': IDL.Nat,
    'isLocked': IDL.Bool,
    'isExpired': IDL.Bool
  });
  
  return IDL.Service({
    'createSession': IDL.Func(
      [],
      [IDL.Record({ 'sessionId': IDL.Text, 'code': IDL.Text })],
      []
    ),
    'registerPeer': IDL.Func(
      [IDL.Text, PeerId],
      [Result],
      []
    ),
    'sendSignal': IDL.Func(
      [SessionId, PeerId, Signal],
      [Result_1],
      []
    ),
    'getSignals': IDL.Func(
      [SessionId, PeerId],
      [Result_2],
      ['query']
    ),
    'clearSignals': IDL.Func(
      [SessionId, PeerId],
      [Result_1],
      []
    ),
    'getSessionInfo': IDL.Func(
      [IDL.Text],
      [IDL.Opt(SessionInfo)],
      ['query']
    )
  });
};

