import { useEffect, useState } from "react";
import { authLoginStart, authLogout, authCurrentUser, type Account } from "./lib/invoke";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import Timeline from "./Timeline";
import Compose from "./Compose";
import Profile from "./Profile";
import ConversationList from "./ConversationList";
import ChatView from "./ChatView";
import RoomList from "./RoomList";
import RoomView from "./RoomView";

type Screen = "loading" | "login" | "app";

type Tab = "home" | "chats" | "rooms" | "profile";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [user, setUser] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("home");
  const [composing, setComposing] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);

  useEffect(() => {
    authCurrentUser()
      .then((u) => {
        setUser(u);
        setScreen(u ? "app" : "login");
      })
      .catch(() => setScreen("login"));

    const unlisteners: (() => void)[] = [];

    listen("oauth-success", () => {
      authCurrentUser()
        .then((u) => {
          if (u) {
            setUser(u);
            setScreen("app");
          } else {
            setError("Token stored but auth returned null");
          }
        })
        .catch((e) => setError(String(e)));
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

  async function handleLogin() {
    setError(null);
    try {
      const url = await authLoginStart();
      await open(url);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleLogout() {
    try {
      await authLogout();
      setUser(null);
      setScreen("login");
    } catch (e) {
      setError(String(e));
    }
  }

  function handleNavigateProfile(id: string) {
    setProfileId(id);
    setTab("profile");
  }

  function handleSelectChat(username: string) {
    setChatUsername(username);
    setTab("chats");
  }

  function handleSelectRoom(id: string) {
    setRoomId(id);
    setTab("rooms");
  }

  if (screen === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-on-surface-variant">Loading…</div>
      </div>
    );
  }

  if (screen === "login") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6">
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
        if (chatUsername) return <ChatView username={chatUsername} onBack={() => setChatUsername(null)} />;
        return <ConversationList onSelect={handleSelectChat} />;
      case "rooms":
        if (roomId) return <RoomView id={roomId} onBack={() => setRoomId(null)} />;
        return <RoomList onSelect={handleSelectRoom} />;
      case "profile":
        return profileId ? (
          <Profile id={profileId} onBack={() => setTab("home")} onNavigateProfile={handleNavigateProfile} />
        ) : null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-outline-variant">
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
        {renderContent()}
      </div>

      <nav className="flex border-t border-outline-variant bg-surface-container-low">
        {([
          ["home", "Home"],
          ["chats", "Chats"],
          ["rooms", "Rooms"],
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
