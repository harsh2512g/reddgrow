import Link from 'next/link';
import { Radio } from 'lucide-react';

export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="ThreadSignal home"
      className="inline-flex shrink-0 items-center gap-2.5 text-lg font-semibold tracking-[-0.04em]"
    >
      <span className="flex size-9 items-center justify-center rounded-[11px] bg-primary text-white shadow-[0_4px_10px_-5px_#5144ca80]">
        <Radio aria-hidden="true" size={24} strokeWidth={1.7} />
      </span>
      ThreadSignal
    </Link>
  );
}
