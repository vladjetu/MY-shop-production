export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="app-header-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon_MY.svg" alt="" className="app-header-logo" />
          <h1>MY shop production</h1>
        </div>
        <form action="/api/logout" method="POST" className="logout-form">
          <button type="submit">Odhlásiť sa</button>
        </form>
      </header>

      <main className="app-main">{children}</main>
    </>
  );
}
