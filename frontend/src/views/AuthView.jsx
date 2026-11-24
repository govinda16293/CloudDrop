import { useState } from "react";
import Icon from "../components/Icon.jsx";

const ICONS = { email: "mail", password: "lock", text: "user" };

function Field({ label, hint, type, ...input }) {
  const [shown, setShown] = useState(false);
  const secret = type === "password";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="sr-only">{label}</span>
      <span className="relative block text-white/85">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2"><Icon name={ICONS[type] || "user"} size={19} /></span>
        <input {...input} className="h-13 w-full rounded-xl border border-white/45 bg-white/12 pl-12 pr-12 text-[15px] font-medium text-white outline-none transition placeholder:text-white/80 focus:border-white focus:bg-white/20 focus:ring-3 focus:ring-white/25" type={secret && shown ? "text" : type} placeholder={input.placeholder || label} />
        {secret && (
          <button type="button" className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-white/85 transition hover:bg-white/15 hover:text-white" onClick={() => setShown(!shown)} aria-label={shown ? "Hide password" : "Show password"}>
            <Icon name={shown ? "eye" : "eyeOff"} size={19} />
          </button>
        )}
      </span>
      {hint && <small className="text-[12.5px] text-white/80">{hint}</small>}
    </label>
  );
}

function FormHead({ title, sub }) {
  return (
    <div className="mb-2">
      <h2 className="text-3xl font-extrabold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-[15px] text-white/78">{sub}</p>
    </div>
  );
}

const Arrow = () => <span className="transition group-hover:translate-x-0.5"><Icon name="arrow" size={18} /></span>;

function LocalSignIn({ auth, onSignedIn, run, busy }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(false);
  return (
    <form className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          await auth.signIn({ email, name, admin });
          await onSignedIn();
        });
      }}
    >
      <FormHead title="Welcome back" sub="Sign in to continue to CloudDrop" />
      <p className="rounded-xl border border-white/30 bg-white/18 px-3.5 py-3 text-sm font-medium text-white">Local mode has no passwords. Enter any @{auth.emailDomain} address to try the app.</p>
      <Field label="College e-mail" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${auth.emailDomain}`} />
      <Field label="Your name" type="text" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="flex items-center gap-2 text-[14.5px] font-semibold text-white">
        <input className="size-4.5 accent-terracotta-500" type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
        Sign in as an admin
      </label>
      <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Signing in…" : <>Sign in <Arrow /></>}</button>
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
      <form className="flex flex-col gap-3.5" onSubmit={submit(async () => {
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
        <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <p className="mt-1 text-center text-[14.5px] text-white/85">Have an account? <button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => goToStep("signIn")}>Sign in</button></p>
      </form>
    );
  }
  if (step === "confirm") {
    return (
      <form className="flex flex-col gap-3.5" onSubmit={submit(async () => {
        await auth.confirmSignUp({ email, code });
        if (password) {
          await auth.signIn({ email, password });
          await onSignedIn();
        } else goToStep("signIn", "E-mail confirmed. Sign in, or use Forgot password to set a new one.");
      })}>
        {emailField}
        {codeField}
        <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Checking…" : "Confirm e-mail"}</button>
        <p className="mt-1 text-center text-[14.5px] text-white/85">
          <button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" disabled={busy} onClick={() => run(async () => {
            await auth.resendCode({ email });
            setMessage({ kind: "info", text: "A new code is on its way." });
          })}>Send a new code</button>
          {" · "}
          <button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => goToStep("signIn")}>Back to sign in</button>
        </p>
      </form>
    );
  }
  if (step === "forgot") {
    return (
      <form className="flex flex-col gap-3.5" onSubmit={submit(async () => {
        await auth.forgotPassword({ email });
        setPassword("");
        goToStep("reset", "We sent a code to your e-mail. Enter it with a new password.");
      })}>
        {emailField}
        <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Sending…" : "Send reset code"}</button>
        <p className="mt-1 text-center text-[14.5px] text-white/85"><button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => goToStep("signIn")}>Back to sign in</button></p>
      </form>
    );
  }
  if (step === "reset") {
    return (
      <form className="flex flex-col gap-3.5" onSubmit={submit(async () => {
        await auth.confirmNewPassword({ email, code, password });
        await auth.signIn({ email, password });
        await onSignedIn();
      })}>
        {emailField}
        {codeField}
        {passwordField("New password", "new-password")}
        <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
      </form>
    );
  }
  return (
    <form className="flex flex-col gap-3.5" onSubmit={submit(async () => {
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
      <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="mt-1 text-center text-[14.5px] text-white/85">
        New here? <button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => goToStep("signUp")}>Create an account</button>
        {" · "}
        <button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => goToStep("forgot")}>Forgot password</button>
      </p>
    </form>
  );
}

function SupabaseForms({ auth, onSignedIn, run, busy, setMessage }) {
  const [step, setStep] = useState(auth.recovering ? "reset" : "signIn"); // signIn | signUp | forgot | reset
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
    <form className="flex flex-col gap-3.5" onSubmit={submit(async () => {
      const signedIn = await auth.signUp({ email, password, name });
      if (signedIn) return onSignedIn();
      go("signIn", "Check your college inbox to confirm your e-mail, then sign in.");
    })}>
      <FormHead title="Create your account" sub="Use your @thapar.edu e-mail" />
      <Field label="Your name" type="text" required maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      {emailField}{passwordField("Password", "new-password")}
      <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      <p className="mt-1 text-center text-[14.5px] text-white/85">Have an account? <button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => go("signIn")}>Sign in</button></p>
    </form>
  );
  if (step === "forgot") return (
    <form className="flex flex-col gap-3.5" onSubmit={submit(async () => {
      await auth.forgotPassword({ email });
      go("signIn", "A password reset link has been sent to your college e-mail.");
    })}>
      <FormHead title="Reset password" sub="We will e-mail you a reset link" />
      {emailField}
      <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      <p className="mt-1 text-center text-[14.5px] text-white/85"><button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => go("signIn")}>Back to sign in</button></p>
    </form>
  );
  if (step === "reset") return (
    <form className="flex flex-col gap-3.5" onSubmit={submit(async () => { await auth.updatePassword({ password }); await onSignedIn(); })}>
      <FormHead title="Choose a new password" sub="At least 8 characters" />
      {passwordField("New password", "new-password")}
      <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
    </form>
  );
  return (
    <form className="flex flex-col gap-3.5" onSubmit={submit(async () => { await auth.signIn({ email, password }); await onSignedIn(); })}>
      <FormHead title="Welcome back" sub="Sign in to continue to CloudDrop" />
      {emailField}{passwordField("Password", "current-password")}
      <p className="-mt-1 text-right text-sm"><button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => go("forgot")}>Forgot password?</button></p>
      <button className="group inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-linear-to-b from-terracotta-400 to-terracotta-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(120,40,25,0.35)] transition hover:from-terracotta-500 hover:to-terracotta-700 disabled:cursor-default disabled:opacity-60" disabled={busy}>{busy ? "Signing in…" : <>Sign in <Arrow /></>}</button>
      <p className="mt-1 text-center text-[14.5px] text-white/85">Don't have an account? <button type="button" className="cursor-pointer font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white disabled:opacity-60" onClick={() => go("signUp")}>Create one</button></p>
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
    <main className="relative grid min-h-screen grid-cols-1 gap-7 bg-cover bg-[center_65%] px-5 pt-9 pb-8 font-sans text-white sm:px-10 lg:grid-cols-[1.15fr_minmax(340px,440px)] lg:grid-rows-[auto_1fr_auto] lg:gap-x-12 lg:px-16"
      style={{ backgroundImage: "linear-gradient(90deg, rgba(12,16,22,.55) 0%, rgba(12,16,22,.2) 45%, rgba(12,16,22,0) 70%), linear-gradient(180deg, rgba(10,20,35,.15) 0%, rgba(10,20,35,0) 38%, rgba(25,10,5,.5) 100%), url(/campus.webp)" }}>
      <header className="flex items-center justify-between gap-4 lg:col-span-2">
        <span className="drop-shadow">{logo}</span>
        <p className="hidden text-xs font-bold tracking-[0.24em] uppercase drop-shadow md:flex" aria-hidden="true">
          {["Share", "Search", "Learn"].map((word, i) => (
            <span key={word} className={`px-7 ${i ? "border-l border-white/60" : ""}`}>{word}</span>
          ))}
        </p>
      </header>

      <section className="self-center">
        <h1 className="text-[clamp(44px,7vw,92px)] leading-[0.95] font-extrabold tracking-tight uppercase drop-shadow-[0_2px_18px_rgba(0,0,0,0.25)]">
          Notes<br />that outlast<br />the semester.
        </h1>
        <p className="mt-6 ml-1 text-[12.5px] leading-[1.9] font-bold tracking-[0.24em] text-white/90 uppercase drop-shadow">
          Thapar's shared library<br />for notes, labs and papers
        </p>
      </section>

      <section aria-label="Sign in"
        className="flex flex-col gap-3.5 self-center rounded-3xl border border-white/45 bg-white/15 px-6 py-8 shadow-[0_24px_60px_rgba(0,0,0,0.25)] backdrop-blur-2xl backdrop-saturate-125 sm:px-9 sm:py-10">
        {message && (
          <p className={`rounded-xl border px-3.5 py-3 text-sm font-medium ${message.kind === "error" ? "border-red-200/50 bg-red-700/55" : "border-white/30 bg-white/18"}`}
            role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>
        )}
        {auth.mode === "local" ? (
          <LocalSignIn auth={auth} onSignedIn={onSignedIn} run={run} busy={busy} />
        ) : auth.mode === "supabase" ? (
          <SupabaseForms auth={auth} onSignedIn={onSignedIn} run={run} busy={busy} setMessage={setMessage} />
        ) : (
          <CognitoForms auth={auth} onSignedIn={onSignedIn} run={run} busy={busy} setMessage={setMessage} />
        )}
      </section>

      <p className="text-[13px] font-medium text-white/80 drop-shadow lg:col-span-2">
        Only @{auth.emailDomain} accounts can sign in. Files are stored privately; download links expire after five minutes.
      </p>
    </main>
  );
}
