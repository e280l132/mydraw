// Small stroke icons sized and weighted like Excalidraw's own menu icons.
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const NewIcon = () => (
  <Icon>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </Icon>
);

export const OpenIcon = () => (
  <Icon>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);

export const SaveIcon = () => (
  <Icon>
    <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M7 3v5h8V3M7 21v-7h10v7" />
  </Icon>
);

export const SaveAsIcon = () => (
  <Icon>
    <path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l3 3v5" />
    <path d="M7 3v5h8V3M15 21l5-5-2-2-5 5v2z" />
  </Icon>
);

export const ExportIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
    <circle cx="16" cy="9" r="1.5" />
  </Icon>
);

export const CloseTabIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
  </Icon>
);

export const RecentIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const ClearIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
);

export const CheckOnIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="4" fill="currentColor" stroke="none" opacity="0.15" />
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M8 12.5l3 3 5-6" />
  </Icon>
);

export const CheckOffIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="4" />
  </Icon>
);

export const HelpIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01" />
  </Icon>
);
