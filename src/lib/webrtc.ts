import { getCallToken } from "./invoke";

const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const WS_URL = "wss://extrovert.redforged.eu/ws";

interface CallState {
  callState: "idle" | "calling" | "ringing" | "connected";
  peerConnections: Record<string, RTCPeerConnection>;
  localStream: MediaStream | null;
  peerUsername: string | null;
  callStartTime: number | null;
  pendingOffer: { username: string; sdp: string | undefined } | null;
  pendingCall: string | null;
  callWaitTimeout: ReturnType<typeof setTimeout> | null;
}

type EventHandler = (...args: any[]) => void;
const listeners: Record<string, EventHandler[]> = {};

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

const state: CallState = {
  callState: "idle",
  peerConnections: {},
  localStream: null,
  peerUsername: null,
  callStartTime: null,
  pendingOffer: null,
  pendingCall: null,
  callWaitTimeout: null,
};

function on(event: string, fn: EventHandler) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

function off(event: string, fn: EventHandler) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter((f) => f !== fn);
}

function emit(event: string, ...args: any[]) {
  (listeners[event] || []).forEach((fn) => {
    try { fn(...args); } catch (e) { console.error("webrtc listener error:", e); }
  });
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  reconnectAttempts++;
  if (reconnectAttempts > 20) return;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, delay);
}

async function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    const token = await getCallToken();
    ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    send({ type: "ping" });
  };

  ws.onmessage = (e) => {
    let msg: any;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    cleanupAll();
    scheduleReconnect();
  };

  ws.onerror = () => {};
}

function send(data: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }
}

function handleMessage(msg: any) {
  switch (msg.type) {
    case "incoming_call":
      if (state.callState === "calling") {
        Object.keys(state.peerConnections).forEach(closePeerConnection);
        state.peerConnections = {};
      }
      state.callState = "ringing";
      state.peerUsername = msg.from;
      state.pendingOffer = { username: msg.from, sdp: msg.sdp };
      emit("incoming_call", msg.from, msg.from_display || msg.from, msg.sdp);
      break;

    case "callee_available":
      if (state.callState === "calling" && state.peerUsername) {
        produceOfferAndSend(state.peerUsername);
      }
      break;

    case "calling_offline":
      if (state.callState === "calling") {
        state.pendingCall = msg.to;
        emit("calling_offline", msg.to);
        if (state.callWaitTimeout) clearTimeout(state.callWaitTimeout);
        const waitMs = msg.expires_at ? Math.min(60000, Math.max(0, msg.expires_at - Date.now())) : 60000;
        state.callWaitTimeout = setTimeout(() => {
          state.callWaitTimeout = null;
          if (state.callState === "calling" && state.pendingCall) {
            emit("call_unanswered", state.pendingCall);
            send({ type: "call_cancel", to: state.pendingCall });
            endCallInternal();
          }
        }, waitMs);
      }
      break;

    case "callee_ringing":
      if (state.callWaitTimeout) { clearTimeout(state.callWaitTimeout); state.callWaitTimeout = null; }
      state.pendingCall = null;
      if (state.callState === "calling" && state.peerUsername) {
        produceOfferAndSend(state.peerUsername);
      }
      break;

    case "user_offline":
      emit("call_declined", msg.from);
      endCallInternal();
      break;

    case "call_unanswered":
      if (state.callWaitTimeout) { clearTimeout(state.callWaitTimeout); state.callWaitTimeout = null; }
      emit("call_unanswered", msg.to || msg.from);
      endCallInternal();
      break;

    case "call_answered":
      state.callState = "connected";
      state.callStartTime = Date.now();
      state.pendingOffer = null;
      setRemoteDescription(msg.from, msg.sdp);
      emit("call_connected", msg.from);
      break;

    case "ice_candidate":
      if (msg.candidate && state.peerConnections[msg.from]) {
        try {
          state.peerConnections[msg.from].addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch {}
      }
      break;

    case "call_ended":
      if (state.callState !== "idle") {
        emit("call_ended", msg.from);
        endCallInternal();
      }
      break;

    case "call_declined":
    case "user_busy":
      emit("call_declined", msg.from);
      endCallInternal();
      break;

    case "user_online":
      emit("user_online", msg.username, msg.display_name);
      break;

    case "new_dm":
      // Live DM delivery: { message, sender_curve, from_username, from_display }
      emit("new_dm", msg);
      break;

    case "user_offline":
      emit("user_offline", msg.username);
      break;

    case "error":
      emit("error", msg.message);
      break;
  }
}

async function getMedia(): Promise<MediaStream> {
  if (state.localStream) return state.localStream;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  state.localStream = stream;
  return stream;
}

function createPeerConnection(username: string): RTCPeerConnection {
  if (state.peerConnections[username]) return state.peerConnections[username];

  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      send({
        type: "ice_candidate",
        to: state.peerUsername,
        candidate: e.candidate.toJSON(),
      });
    }
  };

  pc.ontrack = (e) => {
    emit("remote_stream", username, e.streams[0]);
  };

  pc.oniceconnectionstatechange = () => {
    if (
      state.callState !== "idle" &&
      (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed")
    ) {
      emit("call_ended", username);
      endCallInternal();
    }
  };

  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream!));
  }

  state.peerConnections[username] = pc;
  return pc;
}

function closePeerConnection(username: string) {
  const pc = state.peerConnections[username];
  if (pc) {
    pc.close();
    delete state.peerConnections[username];
  }
}

function setRemoteDescription(username: string, sdp: string) {
  const pc = state.peerConnections[username];
  if (!pc) return;
  pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp))).catch(() => {});
}

async function produceOfferAndSend(username: string) {
  try {
    await getMedia();
    const pc = createPeerConnection(username);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (state.callState !== "calling") return;
    send({ type: "call_offer", to: username, sdp: JSON.stringify(pc.localDescription) });
    emit("calling", username);
  } catch (err: any) {
    if (state.callState === "calling") state.callState = "idle";
    emit("error", "Failed to start call: " + err.message);
  }
}

async function startCall(username: string) {
  if (state.callState !== "idle") return;
  state.callState = "calling";
  state.peerUsername = username;
  send({ type: "call_request", to: username });
  emit("calling", username);
}

async function answerCall() {
  if (state.callState !== "ringing" || !state.pendingOffer || !state.pendingOffer.sdp) return;
  const { username, sdp } = state.pendingOffer;
  state.pendingOffer = null;

  try {
    await getMedia();
    const pc = createPeerConnection(username);
    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp)));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.callState = "connected";
    state.callStartTime = Date.now();
    send({ type: "call_answer", to: username, sdp: JSON.stringify(pc.localDescription) });
    emit("call_connected", username);
  } catch (err: any) {
    if (state.callState === "ringing") state.callState = "idle";
    emit("error", "Failed to answer call: " + err.message);
  }
}

function declineCall() {
  const username = state.peerUsername;
  if (!username) return;
  send({ type: "call_decline", to: username });
  emit("call_declined", username);
  state.callState = "idle";
  state.peerUsername = null;
  state.pendingOffer = null;
}

function endCall() {
  if (state.pendingCall && Object.keys(state.peerConnections).length === 0) {
    send({ type: "call_cancel", to: state.pendingCall });
    emit("call_ended", state.pendingCall);
    endCallInternal();
  } else {
    const peer = state.peerUsername || "";
    send({ type: "call_end", to: peer });
    emit("call_ended", peer);
    endCallInternal();
  }
}

function endCallInternal() {
  state.callState = "idle";
  state.peerUsername = null;
  state.pendingOffer = null;
  state.callStartTime = null;
  state.pendingCall = null;
  if (state.callWaitTimeout) { clearTimeout(state.callWaitTimeout); state.callWaitTimeout = null; }
  Object.keys(state.peerConnections).forEach(closePeerConnection);
  state.peerConnections = {};
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
}

function cleanupAll() {
  endCallInternal();
}

function toggleMute(): boolean {
  if (!state.localStream) return true;
  const track = state.localStream.getAudioTracks()[0];
  if (!track) return true;
  track.enabled = !track.enabled;
  return track.enabled;
}

function getState() {
  return state;
}

export const Call = { on, off, connect, startCall, answerCall, declineCall, endCall, toggleMute, getState };