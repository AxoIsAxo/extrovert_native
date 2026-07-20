import { useEffect, useRef, useState } from "react";
import { Call } from "./lib/webrtc";

export function CallProvider() {
  const [incoming, setIncoming] = useState<{ username: string; displayName: string } | null>(null);
  const [activeCall, setActiveCall] = useState<{ username: string; displayName: string } | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [muted, setMuted] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [timer, setTimer] = useState("00:00");
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const ringingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callTimerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Call.on("incoming_call", (username: string, displayName: string) => {
      setIncoming({ username, displayName });
      startRinging();

      ringingTimeout.current = setTimeout(() => {
        Call.declineCall();
        setIncoming(null);
        stopRinging();
      }, 30000);
    });

    Call.on("calling", (_username: string) => {
      setIsCalling(true);
      setActiveCall(null);
    });

    Call.on("call_connected", (username: string) => {
      stopRinging();
      setIncoming(null);
      setActiveCall({ username, displayName: username });
      setIsCalling(false);
      setCallError(null);
      startCallTimer();
    });

    Call.on("call_ended", () => {
      stopRinging();
      setIncoming(null);
      setActiveCall(null);
      setIsCalling(false);
      setMuted(false);
      stopCallTimer();
      cleanupRemoteAudio();
    });

    Call.on("call_declined", () => {
      stopRinging();
      setIncoming(null);
      setActiveCall(null);
      setIsCalling(false);
      setMuted(false);
      stopCallTimer();
      cleanupRemoteAudio();
    });

    Call.on("remote_stream", (_username: string, stream: MediaStream) => {
      if (!remoteAudio.current) {
        remoteAudio.current = document.createElement("audio");
        remoteAudio.current.autoplay = true;
        document.body.appendChild(remoteAudio.current);
      }
      remoteAudio.current.srcObject = stream;
    });

    Call.on("error", (msg: string) => {
      setCallError(msg);
      setIsCalling(false);
    });

    Call.connect();

    return () => {
      stopRinging();
      stopCallTimer();
      cleanupRemoteAudio();
      Call.off("incoming_call", () => {});
      Call.off("calling", () => {});
      Call.off("call_connected", () => {});
      Call.off("call_ended", () => {});
      Call.off("call_declined", () => {});
      Call.off("remote_stream", () => {});
      Call.off("error", () => {});
    };
  }, []);

  function startRinging() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { try { osc.stop(); ctx.close(); } catch {} }, 2000);
    } catch {}
  }

  function stopRinging() {
    if (ringingTimeout.current) { clearTimeout(ringingTimeout.current); ringingTimeout.current = null; }
    if (ringingInterval.current) { clearInterval(ringingInterval.current); ringingInterval.current = null; }
  }

  function cleanupRemoteAudio() {
    if (remoteAudio.current) {
      remoteAudio.current.pause();
      remoteAudio.current.srcObject = null;
      remoteAudio.current.remove();
      remoteAudio.current = null;
    }
  }

  function startCallTimer() {
    stopCallTimer();
    callTimerInterval.current = setInterval(() => {
      const start = Call.getState().callStartTime || Date.now();
      const s = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      setTimer(`${m < 10 ? "0" : ""}${m}:${sec < 10 ? "0" : ""}${sec}`);
    }, 1000);
  }

  function stopCallTimer() {
    if (callTimerInterval.current) { clearInterval(callTimerInterval.current); callTimerInterval.current = null; }
  }

  function handleAnswer() {
    if (incoming) {
      Call.answerCall();
      stopRinging();
    }
  }

  function handleDecline() {
    setIncoming(null);
    stopRinging();
    Call.declineCall();
  }

  function handleHangup() {
    Call.endCall();
  }

  function handleMute() {
    const active = Call.toggleMute();
    setMuted(!active);
  }

  return (
    <>
      {incoming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center flex-col gap-4"
          style={{ background: "rgba(0,0,0,0.75)" }}
        >
          <div className="text-2xl font-bold text-white">Incoming call...</div>
          <div className="text-lg" style={{ color: "var(--on-surface-variant)" }}>{incoming.displayName}</div>
          <div className="flex gap-4 mt-2">
            <button
              onClick={handleAnswer}
              className="px-8 py-2.5 rounded-full font-semibold text-white text-sm"
              style={{ background: "#22c55e" }}
            >
              Answer
            </button>
            <button
              onClick={handleDecline}
              className="px-8 py-2.5 rounded-full font-semibold text-white text-sm"
              style={{ background: "var(--error)" }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {(activeCall || isCalling || callError) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t gap-3" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          {callError ? (
            <div className="flex-1">
              <div className="text-sm text-error">{callError}</div>
              <button onClick={() => setCallError(null)} className="text-xs text-on-surface-variant mt-0.5">Dismiss</button>
            </div>
          ) : (
            <>
          <div className="flex items-center gap-3">
            <span className="text-lg">📞</span>
            <div>
              <div className="font-semibold text-sm text-on-surface">
                {isCalling ? `Calling...` : `In call with ${activeCall?.username || ""}`}
              </div>
              {activeCall && <div className="text-xs text-on-surface-variant">{timer}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMute}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{
                background: muted ? "var(--error)" : "var(--surface-container-low)",
                color: muted ? "#fff" : "var(--on-surface-variant)",
              }}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={handleHangup}
              className="px-4 py-1.5 rounded-full text-xs font-semibold text-white"
              style={{ background: "var(--error)" }}
            >
              Hang Up
            </button>
          </div>
          </>
          )}
        </div>
      )}
    </>
  );
}