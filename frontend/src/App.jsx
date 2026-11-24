import { useCallback, useEffect, useMemo, useState } from "react";
import { createApi, createSupabaseApi } from "./lib/api.js";
import { createAuth } from "./lib/auth/index.js";
import { loadConfig } from "./lib/config.js";
import AdminView from "./views/AdminView.jsx";
import AuthView from "./views/AuthView.jsx";
import BrowseView from "./views/BrowseView.jsx";
import UploadView from "./views/UploadView.jsx";

const VIEWS = [
  { id: "library", label: "Library" },
  { id: "upload", label: "Upload" },
  { id: "mine", label: "My uploads" },
  { id: "admin", label: "Dashboard", adminOnly: true },
];

// Views live in the # part of the address. CloudFront then never sees a path
// it has no file for, so it needs no rewrite rule that would also catch /api.
function viewFromHash() {
  const id = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.some((view) => view.id === id) ? id : "library";
}

function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" />
        <path d="M16 7v12m0 0-5-5m5 5 5-5M9 24h14" />
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
    if (boot.config.authMode === "supabase") return createSupabaseApi(boot.auth.client);
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
  if (session.state === "signedOut") {
    return <AuthView auth={boot.auth} notice={session.notice} onSignedIn={refreshSession} logo={<Logo />} />;
  }

  const { user, limits } = session;
  const visible = VIEWS.filter((item) => !item.adminOnly || user.isAdmin);
  const current = visible.some((item) => item.id === view) ? view : "library";

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/library" aria-label="CloudDrop library"><Logo /></a>
        <nav aria-label="Main">
          {visible.map((item) => (
            <a key={item.id} href={`#/${item.id}`} className={item.id === current ? "active" : ""} aria-current={item.id === current ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="account">
          <span className="who" title={user.email}>{user.name}</span>
          {user.isAdmin && <span className="badge">admin</span>}
          <button className="button quiet" onClick={signOut}>Sign out</button>
        </div>
      </header>
      {boot.auth.mode === "local" && (
        <p className="localbar">Local mode: mock AWS on this computer. Files vanish when the server stops.</p>
      )}
      <main className="page">
        {current === "library" && <BrowseView key="library" api={api} limits={limits} />}
        {current === "mine" && <BrowseView key="mine" api={api} limits={limits} mine />}
        {current === "upload" && <UploadView api={api} limits={limits} />}
        {current === "admin" && <AdminView api={api} />}
      </main>
    </>
  );
}
