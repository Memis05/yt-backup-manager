import { useEffect, useState } from 'react';

import type { FoundationStatus } from '@ytbm/core';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: FoundationStatus }
  | { status: 'error'; message: string };

function StatusPill({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
        ready ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {ready ? 'Ready' : 'Connecting'}
    </span>
  );
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.ytbm
      .getFoundationStatus()
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) =>
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to connect to the worker',
        }),
      );
  }, []);

  const updateStartMinimized = async (checked: boolean): Promise<void> => {
    if (state.status !== 'ready') return;
    setSaving(true);
    try {
      const settings = await window.ytbm.updateStartMinimized(checked);
      setState({ status: 'ready', data: { ...state.data, settings } });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-8 py-10">
        <header className="flex items-start justify-between border-b border-white/10 pb-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-red-400">
              YouTube Backup Manager
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Foundation diagnostics</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              The desktop shell communicates through a restricted preload bridge to the headless
              worker, which exclusively owns application persistence.
            </p>
          </div>
          <StatusPill ready={state.status === 'ready'} />
        </header>

        {state.status === 'error' ? (
          <section className="mt-8 rounded-2xl border border-red-400/30 bg-red-400/10 p-6">
            <h2 className="font-semibold text-red-200">Worker connection failed</h2>
            <p className="mt-2 text-sm text-red-100/80">{state.message}</p>
          </section>
        ) : null}

        {state.status === 'loading' ? (
          <section className="mt-8 grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-36 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </section>
        ) : null}

        {state.status === 'ready' ? (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-3">
              <article className="diagnostic-card">
                <p className="diagnostic-label">Worker</p>
                <p className="diagnostic-value">{state.data.worker.status}</p>
                <p className="diagnostic-detail">{state.data.worker.mode.replaceAll('_', ' ')}</p>
              </article>
              <article className="diagnostic-card">
                <p className="diagnostic-label">Database</p>
                <p className="diagnostic-value">Schema v{state.data.database.schemaVersion}</p>
                <p className="diagnostic-detail">
                  {state.data.database.journalMode.toUpperCase()} · foreign keys on
                </p>
              </article>
              <article className="diagnostic-card">
                <p className="diagnostic-label">Application</p>
                <p className="diagnostic-value">v{state.data.application.version}</p>
                <p className="diagnostic-detail">
                  {state.data.application.platform} · {state.data.application.arch}
                </p>
              </article>
            </section>

            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-6">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <h2 className="font-semibold">Settings persistence check</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    This allowed setting is validated in the renderer bridge, worker RPC, service,
                    and database repository.
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-3 text-sm text-slate-200">
                  <input
                    className="h-5 w-5 accent-red-500"
                    type="checkbox"
                    checked={state.data.settings.startMinimized}
                    disabled={saving}
                    onChange={(event) => void updateStartMinimized(event.currentTarget.checked)}
                  />
                  Start minimized
                </label>
              </div>
            </section>
          </>
        ) : null}

        <footer className="mt-auto pt-10 text-xs text-slate-600">
          YouTube remains read-only. Provider and backup operations are intentionally not enabled in
          Phase 1.
        </footer>
      </div>
    </main>
  );
}
