import { useEffect, useState } from "react";
import { authLoginStart, authLogout, authCurrentUser, getAnnouncement, type Account, type Announcement, registerPushEndpoint } from "./lib/invoke";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import Timeline from "./Timeline";
import Compose from "./Compose";
import Profile from "./Profile";
import ChatList from "./ChatList";
import type { ChatEntry } from "./ChatList";
import ChatView from "./ChatView";
import RoomView from "./RoomView";
import UnlockScreen from "./UnlockScreen";
import NotificationsScreen from "./NotificationsScreen";
import { CallProvider } from "./CallUI";
import { e2eeEnsureReady } from "./lib/e2ee";

type Screen = "loading" | "login" | "app";

type Tab = "home" | "chats" | "profile";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [user, setUser] = useState<Account | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [e2eeChecked, setE2eeChecked] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("home");
  const [composing, setComposing] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [chatOtherId, setChatOtherId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // After login: prepare the Olm account. On a new device this either creates
  // keys silently (no backup yet) or needs the login password to restore the
  // server-side backup → unlock screen. Only then do chats/rooms work.
  async function ensureE2ee() {
    try {
      const ready = await e2eeEnsureReady();
      setUnlocked(ready);
    } catch {
      setUnlocked(false);
    } finally {
      setE2eeChecked(true);
    }
  }

  useEffect(() => {
    let unlisteners: (() => void)[] = [];

    async function checkUser() {
      try {
        const u = await authCurrentUser();
        if (u) {
          setUser(u);
          setScreen("app");
          ensureE2ee();
        } else {
          setScreen("login");
        }
      } catch {
        setScreen("login");
      }
    }

    checkUser();

    listen("oauth-success", () => {
      checkUser();
    }).then((fn) => unlisteners.push(fn));

    listen<string>("oauth-error", (e) => {
      setError(e.payload);
    }).then((fn) => unlisteners.push(fn));

    listen<string>("oauth-debug", (e) => {
      setDebug((prev) => [...prev.slice(-9), e.payload]);
    }).then((fn) => unlisteners.push(fn));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Server announcement banner (same content as the web top bar).
  useEffect(() => {
    getAnnouncement().then(setAnnouncement).catch(() => {});
  }, []);

  // Register push endpoint with the server when it becomes available.
  // The native MainActivity.kt injects window.__push_endpoint + dispatches a
  // 'push-endpoint' custom event after reading the UnifiedPush distributor
  // endpoint from SharedPreferences (written by ExtrovertPushReceiver.onNewEndpoint).
  // If no endpoint is available yet (no distributor installed), this is a no-op
  // — Phase 1 offline calling still works via ring-on-reconnect.
  useEffect(() => {
    function handleEndpoint(endpoint: string) {
      if (endpoint) registerPushEndpoint(endpoint).catch(() => {});
    }
    if ((window as any).__push_endpoint) handleEndpoint((window as any).__push_endpoint);
    const onEndpoint = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) handleEndpoint(detail);
    };
    window.addEventListener("push-endpoint", onEndpoint as EventListener);
    return () => window.removeEventListener("push-endpoint", onEndpoint as EventListener);
  }, []);

  // Poll for login state while on the login screen (handles deep-link
  // opening a second OS process that completes the OAuth flow externally).
  useEffect(() => {
    if (screen !== "login") return;
    const interval = setInterval(async () => {
      try {
        const u = await authCurrentUser();
        if (u) {
          setUser(u);
          setScreen("app");
          ensureE2ee();
        }
      } catch (e) {
        setError(`auth check failed: ${e}`);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [screen]);

  async function handleLogin() {
    setError(null);
    try {
      const url = await authLoginStart();
      await openUrl(url);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleLogout() {
    try {
      await authLogout();
      setUser(null);
      setUnlocked(false);
      setE2eeChecked(false);
      setScreen("login");
    } catch (e) {
      setError(String(e));
    }
  }

  function handleNavigateProfile(id: string) {
    setProfileId(id);
    setTab("profile");
  }

  function handleSelectChat(entry: ChatEntry) {
    if (entry.kind === "dm") {
      setChatUsername(entry.c.username);
      setChatOtherId(entry.c.id);
      setRoomId(null);
    } else {
      setRoomId(entry.r.id);
      setChatUsername(null);
    }
    setTab("chats");
  }

  if (screen === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen safe-top">
        <div className="text-on-surface-variant">Loading…</div>
      </div>
    );
  }

  if (screen === "login") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6 safe-top safe-bottom">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-lg"
            style={{ background: "var(--primary)", color: "var(--on-primary)" }}
          >
            E
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-on-surface">Extrovert</h1>
        </div>
        <p className="text-on-surface-variant text-center max-w-sm">
          A social network where content is discovered through your network of friends and friends-of-friends.
        </p>
        {error && <div className="text-error text-sm text-center max-w-sm">{error}</div>}
        {debug.length > 0 && (
          <div className="text-on-surface-variant text-xs text-left max-w-sm w-full border border-outline-variant rounded p-2" style={{ maxHeight: 120, overflowY: "auto" }}>
            {debug.map((d, i) => <div key={i}>{d}</div>)}
          </div>
        )}
        <button
          onClick={handleLogin}
          className="px-8 py-3 rounded-btn font-semibold text-on-primary transition-opacity hover:opacity-90"
          style={{ background: "var(--primary)" }}
        >
          Log in with Extrovert
        </button>
      </div>
    );
  }

  const renderContent = () => {
    if (notificationsOpen) {
      return <NotificationsScreen onClose={() => setNotificationsOpen(false)} />;
    }
    switch (tab) {
      case "home":
        if (composing) {
          return (
            <Compose
              onCreated={() => setComposing(false)}
              onCancel={() => setComposing(false)}
            />
          );
        }
        return <Timeline onNavigateProfile={handleNavigateProfile} onCompose={() => setComposing(true)} />;
      case "chats":
        if (chatUsername) return <ChatView username={chatUsername} otherId={chatOtherId || user!.id} onBack={() => setChatUsername(null)} myId={user!.id} />;
        if (roomId) return <RoomView id={roomId} onBack={() => setRoomId(null)} myId={user!.id} unlocked={unlocked} />;
        return <ChatList onSelect={handleSelectChat} myId={user!.id} unlocked={unlocked} />;
      case "profile":
        return profileId ? (
          <Profile id={profileId} onBack={() => setTab("home")} onNavigateProfile={handleNavigateProfile} />
        ) : null;
    }
  };

  if (user && e2eeChecked && !unlocked) {
    return (
      <UnlockScreen
        username={user.username}
        onUnlocked={() => setUnlocked(true)}
        onRetry={() => ensureE2ee()}
      />
    );
  }

  return (
    <div className="flex flex-col" style={{ height: '100dvh' }}>
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-outline-variant safe-top">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-xs"
            style={{ background: "var(--primary)", color: "var(--on-primary)" }}
          >
            E
          </div>
          <h1 className="font-semibold text-sm">Extrovert</h1>
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setNotificationsOpen((v) => !v)}
              className="text-base text-on-surface-variant hover:text-on-surface transition-colors"
              aria-label="Notifications"
            >
              🔔
            </button>
            <span className="text-on-surface-variant text-xs">@{user.username}</span>
            <button onClick={handleLogout} className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">
              Log out
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        {error && (
          <div className="px-4 py-2 bg-error text-on-error text-xs text-center">{error}</div>
        )}
        {announcement && !announcementDismissed && (
          <div className="flex items-start gap-3 px-4 py-2.5 bg-surface-container-high border-b border-outline-variant">
            <p className="flex-1 text-xs text-on-surface whitespace-pre-wrap break-words">{announcement.body}</p>
            <button
              onClick={() => setAnnouncementDismissed(true)}
              className="text-on-surface-variant hover:text-on-surface text-sm shrink-0"
              aria-label="Dismiss announcement"
            >
              ✕
            </button>
          </div>
        )}
        {renderContent()}
      </div>

      <CallProvider />

      <nav className="flex border-t border-outline-variant bg-surface-container-low" style={{ paddingBottom: '32px' }}>
        {([
          ["home", "Home"],
          ["chats", "Chats"],
          ["profile", "Profile"],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => {
              setComposing(false);
              if (t === "profile" && user) {
                setProfileId(user.id);
              }
              setTab(t);
            }}
            className="flex-1 py-3 text-xs font-medium text-center transition-colors"
            style={{
              color: tab === t ? "var(--primary)" : "var(--on-surface-variant)",
              borderTop: tab === t ? "2px solid var(--primary)" : "2px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
