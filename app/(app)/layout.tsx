export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="app-header">
        <h1>MY shop production</h1>
        <form action="/api/logout" method="POST" className="logout-form">
          <button type="submit">Odhlásiť sa</button>
        </form>
      </header>

      <main className="app-main">{children}</main>
    </>
  );
}
