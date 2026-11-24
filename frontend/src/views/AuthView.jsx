import { useState } from "react";

function Field({ label, hint, ...input }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...input} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function LocalSignIn({ auth, onSignedIn, run, busy }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          await auth.signIn({ email, name, admin });
          await onSignedIn();
        });
      }}
    >
      <p className="notice">Local mode has no passwords. Enter any @{auth.emailDomain} address to try the app.</p>
      <Field label="College e-mail" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${auth.emailDomain}`} />
      <Field label="Your name" type="text" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="check">
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
        Sign in as an admin
      </label>
      <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

function CognitoForms({ auth, onSignedIn, run, busy, setMessage }) {
  const [step, setStep] = useState("signIn"); // signIn | signUp | confirm | forgot | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const goToStep = (next, message) => {
    setStep(next);
    setCode("");
    setMessage(message ? { kind: "info", text: message } : null);
  };
  const emailField = (
    <Field label="College e-mail" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${auth.emailDomain}`} />
  );
  const passwordField = (label, autoComplete) => (
    <Field label={label} type="password" required minLength={8} autoComplete={autoComplete} value={password} onChange={(e) => setPassword(e.target.value)}
      hint={autoComplete === "new-password" ? "8+ characters with upper case, lower case and a number." : undefined} />
  );
  const codeField = (
    <Field label="Code from the e-mail" type="text" inputMode="numeric" required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
  );
  const submit = (action) => (event) => {
    event.preventDefault();
    run(action);
  };

  if (step === "signUp") {
    return (
      <form onSubmit={submit(async () => {
        try {
          await auth.signUp({ email, password, name });
        } catch (error) {
          if (error.code !== "UsernameExistsException") throw error;
          // Anyone can start a sign-up for an address they do not own. The real
          // owner must still be able to take the account: prove the address
          // with a fresh code, then choose their own password.
          setPassword("");
          return goToStep(
            "confirm",
            "This e-mail is already registered. If you never finished signing up, send a new code and confirm it, then use Forgot password to set your own password.",
          );
        }
        goToStep("confirm", "We sent a code to your e-mail. Enter it to finish.");
      })}>
        <Field label="Your name" type="text" required maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        {emailField}
        {passwordField("Password", "new-password")}
        <button className="button primary wide" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <p className="switch">Have an account? <button type="button" className="link" onClick={() => goToStep("signIn")}>Sign in</button></p>
      </form>
    );
  }
  if (step === "confirm") {
    return (
      <form onSubmit={submit(async () => {
        await auth.confirmSignUp({ email, code });
        if (password) {
          await auth.signIn({ email, password });
          await onSignedIn();
        } else goToStep("signIn", "E-mail confirmed. Sign in, or use Forgot password to set a new one.");
      })}>
        {emailField}
        {codeField}
        <button className="button primary wide" disabled={busy}>{busy ? "Checking…" : "Confirm e-mail"}</button>
        <p className="switch">
          <button type="button" className="link" disabled={busy} onClick={() => run(async () => {
            await auth.resendCode({ email });
            setMessage({ kind: "info", text: "A new code is on its way." });
          })}>Send a new code</button>
          {" · "}
          <button type="button" className="link" onClick={() => goToStep("signIn")}>Back to sign in</button>
        </p>
      </form>
    );
  }
  if (step === "forgot") {
    return (
      <form onSubmit={submit(async () => {
        await auth.forgotPassword({ email });
        setPassword("");
        goToStep("reset", "We sent a code to your e-mail. Enter it with a new password.");
      })}>
        {emailField}
        <button className="button primary wide" disabled={busy}>{busy ? "Sending…" : "Send reset code"}</button>
        <p className="switch"><button type="button" className="link" onClick={() => goToStep("signIn")}>Back to sign in</button></p>
      </form>
    );
  }
  if (step === "reset") {
    return (
      <form onSubmit={submit(async () => {
        await auth.confirmNewPassword({ email, code, password });
        await auth.signIn({ email, password });
        await onSignedIn();
      })}>
        {emailField}
        {codeField}
        {passwordField("New password", "new-password")}
        <button className="button primary wide" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
      </form>
    );
  }
  return (
    <form onSubmit={submit(async () => {
      try {
        await auth.signIn({ email, password });
      } catch (error) {
        if (error.code === "UserNotConfirmedException") return goToStep("confirm", error.message);
        throw error;
      }
      await onSignedIn();
    })}>
      {emailField}
      {passwordField("Password", "current-password")}
      <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="switch">
        New here? <button type="button" className="link" onClick={() => goToStep("signUp")}>Create an account</button>
        {" · "}
        <button type="button" className="link" onClick={() => goToStep("forgot")}>Forgot password</button>
      </p>
    </form>
  );
}

function SupabaseForms({ auth, onSignedIn, run, busy, setMessage }) {
  const [step, setStep] = useState("signIn"); // signIn | signUp | forgot | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const go = (next, text) => {
    setStep(next);
    setMessage(text ? { kind: "info", text } : null);
  };
  const emailField = <Field label="College e-mail" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${auth.emailDomain}`} />;
  const passwordField = (label, autoComplete) => <Field label={label} type="password" required minLength={8} autoComplete={autoComplete} value={password} onChange={(e) => setPassword(e.target.value)} hint={autoComplete === "new-password" ? "Use at least 8 characters." : undefined} />;
  const submit = (action) => (event) => { event.preventDefault(); run(action); };

  if (step === "signUp") return (
    <form onSubmit={submit(async () => {
      const signedIn = await auth.signUp({ email, password, name });
      if (signedIn) return onSignedIn();
      go("signIn", "Check your college inbox to confirm your e-mail, then sign in.");
    })}>
      <Field label="Your name" type="text" required maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      {emailField}{passwordField("Password", "new-password")}
      <button className="button primary wide" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      <p className="switch">Have an account? <button type="button" className="link" onClick={() => go("signIn")}>Sign in</button></p>
    </form>
  );
  if (step === "forgot") return (
    <form onSubmit={submit(async () => {
      await auth.forgotPassword({ email });
      go("signIn", "A password reset link has been sent to your college e-mail.");
    })}>
      {emailField}
      <button className="button primary wide" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      <p className="switch"><button type="button" className="link" onClick={() => go("signIn")}>Back to sign in</button></p>
    </form>
  );
  if (step === "reset") return (
    <form onSubmit={submit(async () => { await auth.updatePassword({ password }); await onSignedIn(); })}>
      {passwordField("New password", "new-password")}
      <button className="button primary wide" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
    </form>
  );
  return (
    <form onSubmit={submit(async () => { await auth.signIn({ email, password }); await onSignedIn(); })}>
      {emailField}{passwordField("Password", "current-password")}
      <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="switch">New here? <button type="button" className="link" onClick={() => go("signUp")}>Create an account</button>{" · "}<button type="button" className="link" onClick={() => go("forgot")}>Forgot password</button></p>
    </form>
  );
}

export default function AuthView({ auth, notice, onSignedIn, logo }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(notice ? { kind: "error", text: notice } : null);

  async function run(action) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ kind: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-intro">
        {logo}
        <h1>Notes that don't get <mark>lost in the group chat.</mark></h1>
        <p>Upload a note, lab manual or question paper once. Tag it with the subject code. Everyone on campus can find it next semester too.</p>
        <ul className="stamps" aria-label="Highlights">
          <li>@{auth.emailDomain} only</li>
          <li>Private cloud storage</li>
          <li>Search by subject code</li>
        </ul>
      </section>
      <section className="auth-card" aria-label="Sign in">
        {message && <p className={`notice ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
        {auth.mode === "local" ? (
          <LocalSignIn auth={auth} onSignedIn={onSignedIn} run={run} busy={busy} />
        ) : auth.mode === "supabase" ? (
          <SupabaseForms auth={auth} onSignedIn={onSignedIn} run={run} busy={busy} setMessage={setMessage} />
        ) : (
          <CognitoForms auth={auth} onSignedIn={onSignedIn} run={run} busy={busy} setMessage={setMessage} />
        )}
      </section>
    </main>
  );
}
