import StatusBadge from './StatusBadge';

export default function AppPageHero({
  title,
  subtitle,
  status,
  primaryAction,
  secondaryAction,
  children,
  size = 'default',
}) {
  const titleClass = size === 'lg'
    ? "text-3xl md:text-4xl font-bold font-heading text-navy leading-tight tracking-tight"
    : "text-2xl font-bold font-heading text-navy leading-tight";
    
  const subtitleClass = size === 'lg'
    ? "text-[15px] md:text-[16px] text-[var(--color-text-muted)] font-sans mt-1"
    : "text-[13px] text-[var(--color-text-muted)] font-sans";

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className={titleClass}>
              {title}
            </h1>
            {status && <StatusBadge {...status} size={size === 'lg' ? 'default' : 'sm'} />}
          </div>
          {subtitle && (
            <p className={subtitleClass}>
              {subtitle}
            </p>
          )}
          {children && <div className="mt-3">{children}</div>}
        </div>

        {(primaryAction || secondaryAction) && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {secondaryAction && (
              <button
                onClick={secondaryAction.onClick}
                disabled={secondaryAction.disabled}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-navy border border-[var(--color-border)] bg-white hover:bg-[var(--color-bg-elevated)] active:scale-[0.98] transition-all"
                style={{
                  cursor: secondaryAction.disabled ? 'not-allowed' : 'pointer',
                  opacity: secondaryAction.disabled ? 0.65 : 1,
                }}
              >
                {secondaryAction.label}
              </button>
            )}
            {primaryAction && (
              <button
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white bg-coral hover:brightness-110 active:scale-[0.98] transition-all border-none shadow-sm"
                style={{
                  cursor: primaryAction.disabled ? 'not-allowed' : 'pointer',
                  opacity: primaryAction.disabled ? 0.65 : 1,
                }}
              >
                {primaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
