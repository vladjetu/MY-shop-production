export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const hasError = searchParams?.error === "1";

  return (
    <main className="login-page">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon_MY.svg" alt="MERCHYOU" className="login-logo" />
        <h1>MY shop production</h1>
        <p className="login-subtitle">Interná appka pre výrobu — MERCHYOU.shop</p>
        <form action="/api/login" method="POST" className="login-form">
          <label htmlFor="password">Heslo</label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            required
            autoComplete="current-password"
          />
          {hasError && <p className="login-error">Nesprávne heslo, skús to znova.</p>}
          <button type="submit">Prihlásiť sa</button>
        </form>
      </div>
    </main>
  );
}
