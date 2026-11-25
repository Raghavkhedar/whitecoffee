'use client';
// Save button that only shows a green tick once the awaited write resolves (= server ack).
import { useEffect, useRef, useState, type ReactNode } from 'react';

const TIMEOUT_MS = 10_000; // offline writes hang instead of failing
const TICK_MS = 900;

type Phase = 'idle' | 'saving' | 'ok' | 'err';

export default function AsyncButton({
  onClick, onDone, onError, className = 'btn-success', disabled, children, savingLabel = 'Saving…',
}: {
  onClick: () => Promise<unknown>;
  onDone?: () => void;   // runs after the tick has been shown (e.g. close the modal)
  onError?: (e: Error) => void;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
  savingLabel?: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  async function run() {
    if (phase !== 'idle') return;
    setPhase('saving');
    try {
      await Promise.race([
        onClick(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Not saved: no response from server. Check your connection and retry.')), TIMEOUT_MS)),
      ]);
      setPhase('ok');
      timer.current = setTimeout(() => { setPhase('idle'); onDone?.(); }, TICK_MS);
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Not saved.');
      setPhase('err');
      onError?.(err);
      timer.current = setTimeout(() => setPhase('idle'), 2500);
    }
  }

  return (
    <button onClick={run} disabled={disabled || phase === 'saving'} className={className} aria-live="polite">
      {phase === 'ok' ? (
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path className="tick-path" d="M4 12.5l5 5L20 6.5" />
          </svg>
          Saved
        </span>
      ) : phase === 'err' ? 'Not saved ✕' : phase === 'saving' ? savingLabel : children}
    </button>
  );
}
