import { useCallback, useEffect, useMemo, useState } from "react";
import { createApi, createSupabaseApi } from "./lib/api.js";
import { createAuth } from "./lib/auth/index.js";
import { loadConfig } from "./lib/config.js";
import AdminView from "./views/AdminView.jsx";
import AuthView from "./views/AuthView.jsx";
import BrowseView from "./views/BrowseView.jsx";
import UploadView from "./views/UploadView.jsx";
import Icon from "./components/Icon.jsx";

const VIEWS = [
  { id: "library", label: "Library", icon: "search" },
  { id: "upload", label: "Upload", icon: "upload" },
  { id: "mine", label: "My uploads", icon: "folder" },
  { id: "saved", label: "Saved", icon: "bookmark", needs: "savedIds" },
  { id: "admin", label: "Dashboard", icon: "chart", adminOnly: true },
];

// Views live in the # part of the address. CloudFront then never sees a path
// it has no file for, so it needs no rewrite rule that would also catch /api.
function viewFromHash() {
  const id = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return VIEWS.some((view) => view.id === id) ? id : "library";
}

function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4f7cff" /><stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
        <path d="M16 8v11m0 0-4.5-4.5M16 19l4.5-4.5M10 24h12" />
      </svg>
      CloudDrop
    </span>
  );
}

export default function App() {
  const [boot, setBoot] = useState(null); // { config, auth } once config.json is loaded
  const [bootError, setBootError] = useState(null);
  const [session, setSession] = useState({ state: "loading" }); // loading | signedOut | ready | error
  const [view, setView] = useState(viewFromHash);
  const [featuresOn, setFeaturesOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadConfig()
      .then(async (config) => ({ config, auth: await createAuth(config) }))
      .then((loaded) => !cancelled && setBoot(loaded))
      .catch((error) => !cancelled && setBootError(error.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const api = useMemo(() => {
    if (!boot) return null;
    if (boot.config.authMode === "supabase") return createSupabaseApi(boot.auth.client, { analyzerUrl: boot.config.analyzerUrl });
    return createApi({
      apiBase: boot.config.apiBase,
      getToken: () => boot.auth.getToken(),
      onUnauthorized: () => setSession({ state: "signedOut" }),
    });
  }, [boot]);

  const refreshSession = useCallback(async () => {
    if (!api) return;
    setSession({ state: "loading" });
    try {
      const me = await api.me();
      setSession({ state: "ready", user: me.user, limits: me.limits });
    } catch (error) {
      // No session, or an expired one: the API client has already called
      // onUnauthorized, which switched to the sign-in screen.
      if (error.status === 401) {
        // The Supabase client reports a missing local session directly; unlike
        // the AWS HTTP client it has no onUnauthorized callback to do this.
        return setSession({ state: "signedOut" });
      }
      if (error.status === 403) {
        await boot.auth.signOut();
        return setSession({ state: "signedOut", notice: error.message });
      }
      setSession({ state: "error", message: error.message });
    }
  }, [api, boot]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!api?.hasFeatures || session.state !== "ready") return;
    api.hasFeatures().then(setFeaturesOn);
  }, [api, session.state]);

  async function signOut() {
    await boot.auth.signOut();
    window.location.hash = "";
    setSession({ state: "signedOut" });
  }

  if (bootError) {
    return (
      <main className="centered">
        <Logo />
        <p className="notice error" role="alert">CloudDrop could not start. {bootError}</p>
      </main>
    );
  }
  if (!boot || session.state === "loading") {
    return (
      <main className="centered" aria-busy="true">
        <Logo />
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (session.state === "error") {
    return (
      <main className="centered">
        <Logo />
        <p className="notice error" role="alert">{session.message}</p>
        <button className="button" onClick={refreshSession}>Try again</button>
      </main>
    );
  }
  if (session.state === "signedOut" || (boot.auth.recovering && session.state === "ready")) {
    return <AuthView auth={boot.auth} notice={session.notice} onSignedIn={refreshSession} logo={<Logo />} />;
  }

  const { user, limits } = session;
  const visible = VIEWS.filter((item) => (!item.adminOnly || user.isAdmin) && (!item.needs || featuresOn));
  const current = visible.some((item) => item.id === view) ? view : "library";

  const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/library" aria-label="CloudDrop library"><Logo /></a>
        <nav aria-label="Main">
          {visible.map((item) => (
            <a key={item.id} href={`#/${item.id}`} className={item.id === current ? "active" : ""} aria-current={item.id === current ? "page" : undefined}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="account">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="who" title={user.email}>
            <strong>{user.name}</strong>
            {user.isAdmin ? <span className="badge">admin</span> : <small>{user.email}</small>}
          </span>
          <button className="icon-button" onClick={signOut} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </div>
      </aside>
      <div className="main">
        {boot.auth.mode === "local" && (
          <p className="localbar">Local mode: mock AWS on this computer. Files vanish when the server stops.</p>
        )}
        <main className="page">
          {current === "library" && <BrowseView key="library" api={api} limits={limits} />}
          {current === "mine" && <BrowseView key="mine" api={api} limits={limits} mine />}
          {current === "saved" && <BrowseView key="saved" api={api} limits={limits} saved />}
          {current === "upload" && <UploadView api={api} limits={limits} />}
          {current === "admin" && <AdminView api={api} />}
        </main>
      </div>
    </div>
  );
}
