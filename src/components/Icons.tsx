interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** App mark: a note page with a result rule. */
export function Mark({ size = 16 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3.4 1.9h6.1l3.1 3.1v9.1H3.4z" />
      <path d="M9.4 1.9v3.2h3.2" />
      <path d="M5.4 8.2h5.2M5.4 11h5.2" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconMinimize(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.6 8.4h8.8" />
    </Svg>
  );
}

export function IconMaximize(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2" />
    </Svg>
  );
}

export function IconRestore(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.6" y="6" width="7.4" height="7.4" rx="1.2" />
      <path d="M5.6 4.4V3.6a1.2 1.2 0 0 1 1.2-1.2h5.4a1.2 1.2 0 0 1 1.2 1.2v5.4a1.2 1.2 0 0 1-1.2 1.2h-.8" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3.4v9.2M3.4 8h9.2" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="M10.6 10.6l3 3" />
    </Svg>
  );
}

export function IconHelp(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.3 6.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.5-1.8 2.6" />
      <path d="M8 12.1h.01" />
    </Svg>
  );
}

export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.6 3.2h4.1c.7 0 1.3.6 1.3 1.3v8.3c0-.7-.6-1.3-1.3-1.3H2.6z" />
      <path d="M13.4 3.2H9.3c-.7 0-1.3.6-1.3 1.3v8.3c0-.7.6-1.3 1.3-1.3h4.1z" />
    </Svg>
  );
}