import type { ReactElement, SVGProps } from "react";

// The AgentGuard icon set. Every icon is drawn on the same 24 x 24 grid with a
// 1.75 stroke, round caps and joins, and one colour (currentColor), so any
// icon can sit next to any other without looking heavier or lighter. The
// shield and the peak are the product's own marks; the rest follow them.

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "viewBox">;
export type Icon = (props: IconProps) => ReactElement;

function make(label: string, body: ReactElement): Icon {
  const Component: Icon = ({ className, ...rest }) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest["aria-label"] ? undefined : true}
      className={className ?? "h-5 w-5"}
      {...rest}
    >
      {body}
    </svg>
  );
  (Component as Icon & { displayName?: string }).displayName = `Icon(${label})`;
  return Component;
}

const SHIELD = "M12 3l7.5 2.8v6c0 4.6-3.1 8.1-7.5 9.7-4.4-1.6-7.5-5.1-7.5-9.7v-6Z";
const BUBBLE = "M5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4Z";
const BELL = "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15ZM10 21h4";
const COPY_BACK = "M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5";

// The product
export const Bot = make("Agent", <><rect x="4.5" y="8" width="15" height="11.5" rx="3.5" /><path d="M12 8V5.5M2.5 12.5v2M21.5 12.5v2M9 13v1.5M15 13v1.5" /><circle cx="12" cy="4.2" r="1.2" /></>);
export const ShieldCheck = make("Shield with check", <><path d={SHIELD} /><path d="M8.8 12l2.3 2.3 4.2-4.6" /></>);
export const ShieldQuestion = make("Shield with question", <><path d={SHIELD} /><path d="M9.9 9.6a2.3 2.3 0 0 1 4.4.8c0 1.5-2.300 1.700-2.300 3M12 16.300h.01" /></>);
export const ShieldAlert = make("Shield with alert", <><path d={SHIELD} /><path d="M12 8.500v4M12 15.500h.01" /></>);
export const LayoutDashboard = make("Overview", <><rect x="3.500" y="3.500" width="7" height="9" rx="1.500" /><rect x="13.500" y="3.500" width="7" height="5" rx="1.500" /><rect x="13.500" y="11.500" width="7" height="9" rx="1.500" /><rect x="3.500" y="15.500" width="7" height="5" rx="1.500" /></>);
export const ScrollText = make("Activity", <><rect x="5" y="3.500" width="14" height="17" rx="2" /><path d="M8.500 8.500h7M8.500 12h7M8.500 15.500h4" /></>);
export const Radar = make("Coverage", <><circle cx="12" cy="12" r="9" /><path d="M7 12a5 5 0 0 1 5-5M12 12l6-6" /><circle cx="12" cy="12" r="0.8" /></>);
export const Hand = make("Approval", <path d="M8.500 13V6.500a1.500 1.500 0 0 1 3 0V12M11.500 11.500v-7a1.500 1.500 0 0 1 3 0v7M14.500 11.500v-5a1.500 1.500 0 0 1 3 0v8c0 4-2.500 6.500-6 6.500-2.400 0-4-1-5.200-2.800l-3-4.600a1.400 1.400 0 0 1 2.300-1.500l2.400 2.400" />);
export const ListChecks = make("Rules", <path d="M3.500 6l1.500 1.500L8 4M3.500 12.500l1.500 1.500 3-3.500M3.500 18h4M11.500 6H20M11.500 12H20M11.500 18H20" />);
export const Gauge = make("Limits", <><path d="M4.200 17a8.500 8.500 0 1 1 15.600 0" /><path d="M12 15l3.500-5.500" /><circle cx="12" cy="15" r="1" /></>);
export const Wrench = make("Tools", <path d="M20 8a4.500 4.500 0 0 1-6.200 4.200L6.700 19.300a1.900 1.900 0 0 1-2.700-2.700l7.100-7.100A4.500 4.500 0 0 1 16 4l-2.700 2.700 1.300 2.700 2.700 1.300Z" />);
export const MessageSquareWarning = make("Reply check", <><path d={BUBBLE} /><path d="M12 7.500v4M12 13.500h.01" /></>);
export const MessageSquareQuote = make("Quoted reply", <><path d={BUBBLE} /><path d="M8.500 12V9.500H11V12ZM13 12V9.500h2.500V12Z" /></>);
export const KeyRound = make("Vault", <><circle cx="8" cy="16" r="4" /><path d="M11 13l8.500-8.500M16 8l2.500 2.500" /></>);
export const KeySquare = make("API keys", <><rect x="3.500" y="3.500" width="17" height="17" rx="3" /><circle cx="9.500" cy="14.500" r="2.500" /><path d="M11.500 12.500l5-5M14.500 9.500l1.500 1.500" /></>);
export const Plug = make("Connect", <path d="M9 3v4M15 3v4M6.500 7h11v4a5.500 5.500 0 0 1-11 0ZM12 16.500V21" />);
export const Unplug = make("Disconnected", <><path d="M9 3v4M15 3v4M6.500 7h11v4a5.500 5.500 0 0 1-11 0ZM12 16.500V21" /><path d="M4 4l16 16" /></>);
export const FlaskConical = make("Playground", <path d="M9.500 3h5M10.500 3v6L5 18.500A1.800 1.800 0 0 0 6.600 21h10.800a1.800 1.800 0 0 0 1.600-2.500L13.500 9V3M8 14h8" />);
export const Settings = make("Settings", <><circle cx="12" cy="12" r="5.500" /><circle cx="12" cy="12" r="2" /><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M18.700 5.300l-1.400 1.400M6.700 17.300l-1.400 1.400" /></>);
export const Workflow = make("Workflow", <><rect x="3.500" y="3.500" width="7" height="7" rx="1.500" /><rect x="13.500" y="13.500" width="7" height="7" rx="1.500" /><path d="M7 10.500V14a2 2 0 0 0 2 2h4.500" /></>);
export const LayoutTemplate = make("Templates", <><rect x="3.500" y="3.500" width="17" height="6" rx="1.500" /><rect x="3.500" y="12.500" width="7" height="8" rx="1.500" /><rect x="13.500" y="12.500" width="7" height="8" rx="1.500" /></>);
export const BookCheck = make("Approved answers", <><path d="M5 18.500A1.500 1.500 0 0 1 6.500 17H19V3H6.500A1.500 1.500 0 0 0 5 4.500ZM5 18.500A1.500 1.500 0 0 0 6.500 20H19v-3" /><path d="M9 10l2 2 3.500-4" /></>);
export const Database = make("Data", <><ellipse cx="12" cy="6" rx="7.500" ry="3" /><path d="M4.500 6v12c0 1.700 3.400 3 7.500 3s7.500-1.300 7.500-3V6M4.500 12c0 1.700 3.400 3 7.500 3s7.500-1.300 7.500-3" /></>);
export const Cpu = make("AI model", <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.500" y="9.500" width="5" height="5" rx="1" /><path d="M9.500 3v3M14.500 3v3M9.500 18v3M14.500 18v3M3 9.500h3M3 14.500h3M18 9.500h3M18 14.500h3" /></>);
export const Network = make("MCP", <><rect x="9" y="3.500" width="6" height="5" rx="1.200" /><rect x="3" y="15.500" width="6" height="5" rx="1.200" /><rect x="15" y="15.500" width="6" height="5" rx="1.200" /><path d="M12 8.500V12M6 15.500V12h12v3.500" /></>);
export const Building2 = make("Organization", <><rect x="5" y="3.500" width="10" height="17" rx="1.500" /><path d="M15 9.500h3.500A1.500 1.500 0 0 1 20 11v8.500a1 1 0 0 1-1 1h-4M8.500 8h3M8.500 12h3M8.500 16h3" /></>);

// People
export const User = make("Person", <><circle cx="12" cy="8" r="4" /><path d="M4.500 20.500a7.500 7.500 0 0 1 15 0" /></>);
export const Users = make("People", <><circle cx="9" cy="8.500" r="3.500" /><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 5.200a3.500 3.500 0 0 1 0 6.600M18 14.200A6.500 6.500 0 0 1 21.500 20" /></>);
export const LogOut = make("Sign out", <path d="M9.500 4.500H6A1.500 1.500 0 0 0 4.500 6v12A1.500 1.500 0 0 0 6 19.500h3.500M15 8l4 4-4 4M19 12H9.500" />);

// Status
export const Check = make("Allowed", <path d="M5 12.500l4.500 4.500L19 7.500" />);
export const X = make("Close", <path d="M6 6l12 12M18 6L6 18" />);
export const Ban = make("Blocked", <><circle cx="12" cy="12" r="9" /><path d="M5.600 5.600l12.800 12.800" /></>);
export const OctagonX = make("Kill switch", <><path d="M8.500 3h7L21 8.500v7L15.500 21h-7L3 15.500v-7Z" /><path d="M9.500 9.500l5 5M14.500 9.500l-5 5" /></>);
export const CircleAlert = make("Alert", <><circle cx="12" cy="12" r="9" /><path d="M12 7.500v5.500M12 16.500h.01" /></>);
export const TriangleAlert = make("Warning", <><path d="M12 3.500l9.500 16.500h-19Z" /><path d="M12 10v4.500M12 17.500h.01" /></>);
export const Info = make("Info", <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.500M12 7.500h.01" /></>);
export const CircleHelp = make("Unknown", <><circle cx="12" cy="12" r="9" /><path d="M9.500 9.500a2.500 2.500 0 0 1 4.800.9c0 1.700-2.300 2-2.300 3.400M12 17h.01" /></>);
export const CircleDashed = make("Not set", <circle cx="12" cy="12" r="9" strokeDasharray="3.200 3.600" />);
export const Radio = make("Live", <><circle cx="12" cy="12" r="2" /><path d="M7.500 7.500a6.400 6.400 0 0 0 0 9M16.500 7.500a6.400 6.400 0 0 1 0 9M4.500 4.500a10.500 10.500 0 0 0 0 15M19.500 4.500a10.500 10.500 0 0 1 0 15" /></>);
export const Eye = make("Observe", <><path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const Lock = make("Locked", <><rect x="5" y="10.500" width="14" height="10" rx="2.500" /><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500M12 14.500V17" /></>);
export const Fingerprint = make("Fingerprint", <path d="M4.500 9.500a8 8 0 0 1 15 0M7 11a5 5 0 0 1 10 0v2.500M12 11v4.500c0 2-.7 3.500-1.700 5M9 12v3c0 1.800-.6 3.300-1.500 4.500M15 13v2.500c0 1.500-.3 2.700-.8 3.800" />);
export const Clock = make("Waiting", <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const Bell = make("Notifications", <path d={BELL} />);
export const BellRing = make("Alerts", <><path d={BELL} /><path d="M2.500 11c0-2.500 1-4.500 2.500-6M21.500 11c0-2.500-1-4.500-2.500-6" /></>);
export const CircleDollarSign = make("Money", <><circle cx="12" cy="12" r="9" /><path d="M14.500 9.200c-.4-.9-1.400-1.400-2.500-1.400-1.400 0-2.500.8-2.500 2 0 3 5 1.500 5 4.300 0 1.200-1.100 2-2.500 2-1.100 0-2.100-.5-2.500-1.400M12 6.500v1.300M12 16.200v1.300" /></>);
export const Lightbulb = make("Tip", <path d="M9 17.500h6M10 21h4M12 3a6 6 0 0 0-3.500 10.900c.6.500 1 1.200 1 2v1.600h5v-1.600c0-.8.4-1.500 1-2A6 6 0 0 0 12 3Z" />);
export const Sparkles = make("Suggestion", <path d="M10 4l1.800 5.200L17 11l-5.200 1.800L10 18l-1.800-5.200L3 11l5.200-1.800ZM18 3.500v4M16 5.500h4M18.500 15v4M16.500 17h4" />);

// Actions
export const Plus = make("Add", <path d="M12 5v14M5 12h14" />);
export const Minus = make("Remove", <path d="M5 12h14" />);
export const Trash2 = make("Delete", <path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12.500a1.500 1.500 0 0 0 1.500 1.400h6.400a1.500 1.500 0 0 0 1.500-1.400L17.500 7M10 11v6M14 11v6" />);
export const Copy = make("Copy", <><rect x="8.500" y="8.500" width="12" height="12" rx="2" /><path d={COPY_BACK} /></>);
export const CopyCheck = make("Duplicate", <><rect x="8.500" y="8.500" width="12" height="12" rx="2" /><path d={COPY_BACK} /><path d="M12 14.500l2 2 3.500-3.500" /></>);
export const Download = make("Download", <path d="M12 4v11M7 10.500l5 5 5-5M5 20h14" />);
export const Search = make("Search", <><circle cx="10.500" cy="10.500" r="6.500" /><path d="M15.500 15.500l5 5" /></>);
export const RefreshCw = make("Refresh", <path d="M20 11a8 8 0 0 0-14.500-3.500L4 9M4 4v5h5M4 13a8 8 0 0 0 14.500 3.500L20 15M20 20v-5h-5" />);
export const Undo2 = make("Undo", <path d="M9 14L4 9l5-5M4 9h10.500a5.500 5.500 0 0 1 0 11H11" />);
export const ArrowRight = make("Next", <path d="M4.500 12h15M13.500 6l6 6-6 6" />);
export const Menu = make("Menu", <path d="M4 6.500h16M4 12h16M4 17.500h16" />);
export const Pause = make("Pause", <><rect x="6.500" y="5" width="3.500" height="14" rx="1" /><rect x="14" y="5" width="3.500" height="14" rx="1" /></>);
export const Play = make("Resume", <path d="M7 4.500v15l12.500-7.500Z" />);
export const SlidersHorizontal = make("Controls", <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>);
export const LoaderCircle = make("Loading", <path d="M21 12a9 9 0 1 1-6.200-8.600" />);
