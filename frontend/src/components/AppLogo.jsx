import { useId } from 'react';

const FULL_STAR_PATH = 'M 19.3 98.5 L 51.7 1.5 L 80.6 89.7 L 1.5 43.3 L 98.5 27.6';

const AppLogo = ({
  size = 22,
  className = '',
  color = 'currentColor',
  strokeWidth = 5.2,
  gradient = false,
  tile = false,
  trace = false,
  glowColor,
  traceDuration = 5.0,
}) => {
  const reactId = useId().replace(/:/g, '');
  const gradId = `logo-grad-${reactId}`;

  if (tile) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`app-logo-tile ${className}`}
        aria-label="IT Asset Engine Logo"
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      >
        <defs>
          <linearGradient id={`${gradId}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#141c2e" />
            <stop offset="100%" stopColor="#090d16" />
          </linearGradient>
          <linearGradient id={`${gradId}-gold`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE072" />
            <stop offset="100%" stopColor="#FFB300" />
          </linearGradient>
        </defs>

        <rect width="64" height="64" rx="15" fill={`url(#${gradId}-bg)`} />
        <rect
          x="0.75"
          y="0.75"
          width="62.5"
          height="62.5"
          rx="14.25"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth="1.5"
        />

        <g transform="translate(9.6, 10.4) scale(0.448)">
          <path
            d="M 19.3 98.5 L 51.7 1.5"
            stroke={`url(#${gradId}-gold)`}
            strokeWidth="8.5"
            strokeLinecap="round"
          />
          <path
            d="M 51.7 1.5 L 80.6 89.7 L 1.5 43.3 L 98.5 27.6"
            stroke={`url(#${gradId}-gold)`}
            strokeWidth="8.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 51.7 1.5 L 80.6 89.7"
            stroke={`url(#${gradId}-gold)`}
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    );
  }

  const effectiveStroke = gradient ? `url(#${gradId}-stroke)` : color;
  const sparkColor = glowColor || (gradient ? '#FFE072' : '#FFD54F');
  const baseOpacity = trace ? 0.82 : 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`app-logo-star ${className}`}
      aria-label="IT Asset Engine Logo"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, overflow: 'visible' }}
    >
      <defs>
        {gradient && (
          <linearGradient id={`${gradId}-stroke`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE072" />
            <stop offset="100%" stopColor="#FFB300" />
          </linearGradient>
        )}

        {trace && (
          <>
            <radialGradient id={`${gradId}-corona`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
              <stop offset="25%" stopColor={sparkColor} stopOpacity="0.85" />
              <stop offset="60%" stopColor={sparkColor} stopOpacity="0.45" />
              <stop offset="100%" stopColor={sparkColor} stopOpacity="0" />
            </radialGradient>

            <filter id={`${gradId}-spark-glow`} x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur2" />
              <feMerge>
                <feMergeNode in="blur2" />
                <feMergeNode in="blur2" />
                <feMergeNode in="blur1" />
                <feMergeNode in="blur1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </>
        )}
      </defs>

      <path
        d="M 19.3 98.5 L 51.7 1.5"
        stroke={effectiveStroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity={baseOpacity}
      />
      <path
        d="M 51.7 1.5 L 80.6 89.7 L 1.5 43.3 L 98.5 27.6"
        stroke={effectiveStroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={baseOpacity}
      />
      <path
        d="M 51.7 1.5 L 80.6 89.7"
        stroke={effectiveStroke}
        strokeWidth={Number(strokeWidth) * 1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={baseOpacity}
      />

      {trace && (
        <g className="star-tracer-group">
          <circle
            cx={0}
            cy={0}
            r={Number(strokeWidth) * 2.4}
            fill={`url(#${gradId}-corona)`}
            className="star-tracer-corona"
          >
            <animateMotion
              path={FULL_STAR_PATH}
              dur={`${traceDuration}s`}
              repeatCount="indefinite"
              keyPoints="0; 1; 1; 0"
              keyTimes="0; 0.8; 0.86; 1"
              calcMode="linear"
            />
            <animate
              attributeName="opacity"
              values="0; 0.85; 0.85; 0; 0"
              keyTimes="0; 0.04; 0.78; 0.84; 1"
              dur={`${traceDuration}s`}
              repeatCount="indefinite"
            />
          </circle>

          <circle
            cx={0}
            cy={0}
            r={Number(strokeWidth) * 1.05}
            fill={sparkColor}
            filter={`url(#${gradId}-spark-glow)`}
            className="star-tracer-dot"
          >
            <animateMotion
              path={FULL_STAR_PATH}
              dur={`${traceDuration}s`}
              repeatCount="indefinite"
              keyPoints="0; 1; 1; 0"
              keyTimes="0; 0.8; 0.86; 1"
              calcMode="linear"
            />
            <animate
              attributeName="opacity"
              values="0; 1; 1; 0; 0"
              keyTimes="0; 0.04; 0.78; 0.84; 1"
              dur={`${traceDuration}s`}
              repeatCount="indefinite"
            />
          </circle>

          <circle
            cx={0}
            cy={0}
            r={Number(strokeWidth) * 0.5}
            fill="#FFFFFF"
            className="star-tracer-core"
          >
            <animateMotion
              path={FULL_STAR_PATH}
              dur={`${traceDuration}s`}
              repeatCount="indefinite"
              keyPoints="0; 1; 1; 0"
              keyTimes="0; 0.8; 0.86; 1"
              calcMode="linear"
            />
            <animate
              attributeName="opacity"
              values="0; 1; 1; 0; 0"
              keyTimes="0; 0.04; 0.78; 0.84; 1"
              dur={`${traceDuration}s`}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      )}
    </svg>
  );
};

export default AppLogo;
