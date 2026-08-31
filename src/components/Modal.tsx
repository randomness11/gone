import { X } from 'lucide-react';
import type { PropsWithChildren } from 'react';

export function Modal({ open, onClose, title, children, wide = false }: PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
}>) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-panel ${wide ? 'modal-panel-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-topline">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}
