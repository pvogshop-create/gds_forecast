import Link from "next/link";

interface MarketTabSwitcherProps {
  activeHref: string;
  completedHref: string;
  isCompleted: boolean;
}

export function MarketTabSwitcher({
  activeHref,
  completedHref,
  isCompleted,
}: MarketTabSwitcherProps) {
  const tabs = [
    { label: "Active", href: activeHref, selected: !isCompleted },
    { label: "Completed", href: completedHref, selected: isCompleted },
  ];

  return (
    <nav
      className="flex gap-1 rounded-xl p-1 mb-4"
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
      aria-label="Market view"
    >
      {tabs.map(({ label, href, selected }) => (
        <Link
          key={label}
          href={href}
          className="flex-1 text-center px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150"
          style={{
            backgroundColor: selected ? "var(--color-bg)" : "transparent",
            color: selected
              ? "var(--color-ink-primary)"
              : "var(--color-ink-secondary)",
            boxShadow: selected ? "var(--shadow-card)" : "none",
          }}
          aria-current={selected ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
