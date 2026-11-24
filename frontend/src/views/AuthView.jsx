import { useState } from "react";
import Icon from "../components/Icon.jsx";

const ICONS = { email: "mail", password: "lock", text: "user" };

function Field({ label, hint, type, ...input }) {
  const [shown, setShown] = useState(false);
  const secret = type === "password";
  return (
    <label className="field">
      <span className="visually-hidden">{label}</span>
      <span className="input-wrap">
        <Icon name={ICONS[type] || "user"} size={19} />
        <input {...input} type={secret && shown ? "text" : type} placeholder={input.placeholder || label} />
        {secret && (
          <button type="button" className="reveal" onClick={() => setShown(!shown)} aria-label={shown ? "Hide password" : "Show password"}>
            <Icon name={shown ? "eye" : "eyeOff"} size={19} />
          </button>
        )}
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}

function FormHead({ title, sub }) {
  return (
    <div className="form-head">
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}

const Arrow = () => <Icon name="arrow" size={18} />;

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
      <FormHead title="Welcome back" sub="Sign in to continue to CloudDrop" />
      <p className="notice">Local mode has no passwords. Enter any @{auth.emailDomain} address to try the app.</p>
      <Field label="College e-mail" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${auth.emailDomain}`} />
      <Field label="Your name" type="text" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="check">
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
        Sign in as an admin
      </label>
      <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : <>Sign in <Arrow /></>}</button>
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
        <FormHead title="Create your account" sub="Use your college e-mail" />
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
      <FormHead title="Welcome back" sub="Sign in to continue to CloudDrop" />
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
      <FormHead title="Create your account" sub="Use your @thapar.edu e-mail" />
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
      <FormHead title="Reset password" sub="We will e-mail you a reset link" />
      {emailField}
      <button className="button primary wide" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      <p className="switch"><button type="button" className="link" onClick={() => go("signIn")}>Back to sign in</button></p>
    </form>
  );
  if (step === "reset") return (
    <form onSubmit={submit(async () => { await auth.updatePassword({ password }); await onSignedIn(); })}>
      <FormHead title="Choose a new password" sub="At least 8 characters" />
      {passwordField("New password", "new-password")}
      <button className="button primary wide" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
    </form>
  );
  return (
    <form onSubmit={submit(async () => { await auth.signIn({ email, password }); await onSignedIn(); })}>
      <FormHead title="Welcome back" sub="Sign in to continue to CloudDrop" />
      {emailField}{passwordField("Password", "current-password")}
      <p className="forgot"><button type="button" className="link" onClick={() => go("forgot")}>Forgot password?</button></p>
      <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : <>Sign in <Arrow /></>}</button>
      <p className="switch">Don't have an account? <button type="button" className="link" onClick={() => go("signUp")}>Create one</button></p>
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
      <header className="auth-top">
        {logo}
        <p className="auth-words" aria-hidden="true"><span>Share</span><span>Search</span><span>Learn</span></p>
      </header>
      <section className="auth-intro">
        <h1>Notes<br />that outlast<br />the semester.</h1>
        <p className="kicker">Thapar's shared library<br />for notes, labs and papers</p>
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
      <ul className="auth-features">
        <li><Icon name="users" size={26} /><span><strong>Campus only</strong>@{auth.emailDomain} accounts</span></li>
        <li><Icon name="lock" size={26} /><span><strong>Private storage</strong>Signed, short-lived links</span></li>
        <li><Icon name="search" size={26} /><span><strong>Find fast</strong>Search by subject code</span></li>
      </ul>
    </main>
  );
}
