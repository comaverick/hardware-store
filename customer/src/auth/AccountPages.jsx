import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle, EnvelopeSimple, Eye, EyeSlash, SignOut, UserCircle } from "@phosphor-icons/react";
import { useCustomerAuth } from "./CustomerAuthContext";
import { authErrorMessage } from "./firebaseAuth";
import "./AccountPages.css";

export function safeReturnPath(from) {
  const path = typeof from === "string" ? from : "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || [...path].some((character) => character.charCodeAt(0) < 32)) return "/account";
  if (/^\/(login|register|forgot-password|verify-email)(\/|\?|#|$)/i.test(path)) return "/account";
  return path;
}

function AccountFrame({ title, description, children, icon: Icon }) {
  return (
    <main className="customer-auth">
      <div className="customer-auth__wrap">
        <Link className="customer-auth__back" to="/"><ArrowLeft size={16} aria-hidden="true" /> Back to store</Link>
        <section className="customer-auth__card" aria-labelledby="customer-auth-title">
          {Icon && <span className="customer-auth__icon"><Icon size={32} weight="duotone" aria-hidden="true" /></span>}
          <h1 id="customer-auth-title">{title}</h1>
          <p className="customer-auth__intro">{description}</p>
          {children}
        </section>
      </div>
    </main>
  );
}

function Feedback({ error, message }) {
  return <>
    {error && <p className="customer-auth__feedback customer-auth__feedback--error" role="alert">{error}</p>}
    {message && <p className="customer-auth__feedback" role="status">{message}</p>}
  </>;
}

function PasswordField({ id, label, value, onChange, autoComplete, hint, disabled, minLength }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="customer-auth__field">
      <label htmlFor={id}>{label}</label>
      <div className="customer-auth__password">
        <input id={id} type={visible ? "text" : "password"} value={value} onChange={onChange}
          autoComplete={autoComplete} required minLength={minLength} disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined} />
        <button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible} onClick={() => setVisible((current) => !current)} disabled={disabled}>
          {visible ? <EyeSlash size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

function GoogleButton({ onClick, disabled }) {
  return (
    <button className="customer-auth__google" type="button" onClick={onClick} disabled={disabled}>
      <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z" />
        <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.86-2.86A9.58 9.58 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59C7.2 7.71 9.4 5.95 12 5.95Z" />
      </svg>
      Continue with Google
    </button>
  );
}

export function SignInPage({ register = false }) {
  const { session, initializing, sessionError, auth } = useCustomerAuth();
  const location = useLocation();
  const returnTo = safeReturnPath(location.state?.from);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationState, setVerificationState] = useState({});
  const disabled = busy || initializing;

  if (session && !busy) {
    return <Navigate to={session.emailVerified ? returnTo : "/verify-email"} replace state={{ from: returnTo, ...verificationState }} />;
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (register && (!name.trim() || password !== confirmation)) {
      setError(!name.trim() ? "Enter your name." : "Your passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (register) {
        const result = await auth.registerEmail(name, email, password, remember);
        setVerificationState({
          verificationSent: result.verificationSent,
          notice: !result.verificationSent
            ? "Your account was created, but the verification email could not be sent. Try sending it below."
            : !result.profileSaved ? "Your account was created, but your name could not be saved." : "",
        });
      } else {
        await auth.signInEmail(email, password, remember);
      }
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setError("");
    setBusy(true);
    try {
      await auth.signInGoogle(remember);
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFrame title={register ? "Create your account" : "Welcome back"}
      description={register ? "A few details, and you’re ready to go." : "Sign in to your Hardware Store account."}>
      <Feedback error={error || sessionError} />
      <GoogleButton onClick={googleSignIn} disabled={disabled} />
      <div className="customer-auth__divider"><span>or use email</span></div>
      <form className="customer-auth__form" onSubmit={submit}>
        {register && <div className="customer-auth__field">
          <label htmlFor="account-name">Full name</label>
          <input id="account-name" type="text" autoComplete="name" maxLength={100} required
            value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} />
        </div>}
        <div className="customer-auth__field">
          <label htmlFor="account-email">Email address</label>
          <input id="account-email" type="email" autoComplete="email" required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)} disabled={disabled} />
        </div>
        <PasswordField id="account-password" label="Password" value={password}
          onChange={(event) => setPassword(event.target.value)} disabled={disabled}
          autoComplete={register ? "new-password" : "current-password"} minLength={register ? 6 : undefined}
          hint={register ? "Use at least 6 characters. A longer password is better." : undefined} />
        {register && <PasswordField id="account-confirm-password" label="Confirm password" value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)} disabled={disabled} autoComplete="new-password" />}
        <div className="customer-auth__options">
          <label className="customer-auth__checkbox">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={disabled} />
            Remember me
          </label>
          {!register && <Link to="/forgot-password">Forgot password?</Link>}
        </div>
        <button className="shop-button shop-button--primary customer-auth__submit" type="submit" disabled={disabled}>
          {busy ? "Please wait…" : initializing ? "Checking session…" : register ? "Create account" : "Sign in"}
          {!disabled && <ArrowRight size={18} aria-hidden="true" />}
        </button>
      </form>
      <p className="customer-auth__switch">
        {register ? "Already have an account? " : "New to Hardware Store? "}
        <Link to={register ? "/login" : "/register"} state={{ from: returnTo }}>{register ? "Sign in" : "Create an account"}</Link>
      </p>
    </AccountFrame>
  );
}

export function ForgotPasswordPage() {
  const { auth } = useCustomerAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.resetPassword(email);
      setSent(true);
    } catch (failure) {
      // Use the same confirmation for unregistered addresses.
      if (failure.code === "auth/user-not-found") setSent(true);
      else setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFrame title="Reset your password" description="We’ll email you a link to choose a new password." icon={EnvelopeSimple}>
      <Feedback error={error} message={sent ? "If an account uses that email, a reset link is on its way. Check your inbox and spam folder." : ""} />
      {!sent && <form className="customer-auth__form" onSubmit={submit}>
        <div className="customer-auth__field">
          <label htmlFor="reset-email">Email address</label>
          <input id="reset-email" type="email" autoComplete="email" required value={email}
            onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        </div>
        <button className="shop-button shop-button--primary customer-auth__submit" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>}
      <p className="customer-auth__switch"><Link to="/login">Back to sign in</Link></p>
    </AccountFrame>
  );
}

export function VerifyEmailPage() {
  const { session, initializing, auth, refreshSession } = useCustomerAuth();
  const location = useLocation();
  const returnTo = safeReturnPath(location.state?.from);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState(location.state?.notice || "");
  const [sent, setSent] = useState(location.state?.verificationSent === true);

  if (!initializing && !session) return <Navigate to="/login" replace state={{ from: returnTo }} />;
  if (session?.emailVerified && !busy) return <Navigate to={returnTo} replace />;

  async function perform(action) {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      if (action === "send") {
        await auth.sendVerification(session.user);
        setSent(true);
        setMessage("Verification email sent. Check your inbox and spam folder.");
      } else if (action === "check") {
        const user = await auth.refreshUser(session.user);
        await refreshSession();
        if (!user.emailVerified) setMessage("Your email is still unverified. Open the link in your verification email, then check again.");
      } else {
        await auth.signOut();
      }
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy("");
    }
  }

  return (
    <AccountFrame title="Check your email" icon={EnvelopeSimple}
      description={initializing ? "Checking your session…" : `Verify ${session?.email || "your email address"} to finish setting up your account.`}>
      <p className="customer-auth__explanation">Open the verification link in your email, then come back here to continue.</p>
      <Feedback error={error} message={message} />
      <div className="customer-auth__actions">
        <button className="shop-button shop-button--primary" type="button" onClick={() => perform("check")} disabled={Boolean(busy) || initializing}>
          {busy === "check" ? "Checking…" : "I’ve verified my email"}
        </button>
        <button className="shop-button shop-button--outline" type="button" onClick={() => perform("send")} disabled={Boolean(busy) || initializing}>
          {busy === "send" ? "Sending…" : sent ? "Resend verification email" : "Send verification email"}
        </button>
      </div>
      <p className="customer-auth__switch"><button type="button" onClick={() => perform("signout")} disabled={Boolean(busy) || initializing}>Use another account</button></p>
    </AccountFrame>
  );
}

export function AccountPage() {
  const { session, customer, initializing, profileLoading, sessionError, refreshSession, auth } = useCustomerAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!initializing && !session) return <Navigate to="/login" replace state={{ from: "/account" }} />;
  if (session && !session.emailVerified) return <Navigate to="/verify-email" replace state={{ from: "/account" }} />;

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await auth.signOut();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="customer-account shop-container">
      <div className="customer-account__heading">
        <div><span className="customer-account__eyebrow">Hardware Store</span><h1>Your account</h1></div>
        {session && <button className="shop-button shop-button--outline" type="button" onClick={logout} disabled={busy}>
          <SignOut size={18} aria-hidden="true" /> {busy ? "Signing out…" : "Sign out"}
        </button>}
      </div>
      <Feedback error={error || sessionError} />
      {initializing || profileLoading ? <p className="customer-account__loading" role="status">Loading your account…</p>
        : customer ? <section className="customer-account__profile" aria-label="Account details">
          <div className="customer-account__welcome">
            <UserCircle size={46} weight="duotone" aria-hidden="true" />
            <div><h2>{customer.name || session?.name || "Welcome back"}</h2><span>Good to see you.</span></div>
            {customer.emailVerified && <span className="customer-account__verified"><CheckCircle size={17} weight="fill" aria-hidden="true" /> Email verified</span>}
          </div>
          <dl>
            <div><dt>Full name</dt><dd>{customer.name || session?.name || "Not provided"}</dd></div>
            <div><dt>Email address</dt><dd>{customer.email}</dd></div>
          </dl>
          <Link className="shop-button shop-button--primary" to="/products">Browse products <ArrowRight size={17} aria-hidden="true" /></Link>
        </section>
        : session && <button className="shop-button shop-button--outline" type="button" onClick={refreshSession}>Try again</button>}
    </main>
  );
}
