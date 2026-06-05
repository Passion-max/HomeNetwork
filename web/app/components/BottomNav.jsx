"use client";

const TABS = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "devices", label: "Devices", icon: DevicesIcon },
  { id: "usage", label: "Usage", icon: UsageIcon },
  { id: "health", label: "Health", icon: HealthIcon },
];

export default function BottomNav({ tab, setTab }) {
  return (
    <nav className="bottomnav">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`navbtn ${tab === id ? "active" : ""}`}
          onClick={() => setTab(id)}
          aria-label={label}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

const S = { width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
function HomeIcon() { return <svg viewBox="0 0 24 24" {...S}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></svg>; }
function DevicesIcon() { return <svg viewBox="0 0 24 24" {...S}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>; }
function UsageIcon() { return <svg viewBox="0 0 24 24" {...S}><path d="M4 19V5M4 19h16" /><path d="M8 16l3-5 3 3 4-7" /></svg>; }
function HealthIcon() { return <svg viewBox="0 0 24 24" {...S}><path d="M3 12h4l2 5 4-12 2 7h6" /></svg>; }
