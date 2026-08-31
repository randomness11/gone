export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Tabscope">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!compact && <span>Tabscope</span>}
    </div>
  );
}
