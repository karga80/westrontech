import React from 'react';

// Ethereum diamond logo — inline SVG, no external deps
interface EthIconProps {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function EthIcon({ size = 12, color = 'currentColor', className, style }: EthIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', flexShrink: 0, ...style }}
    >
      {/* Top pyramid */}
      <path d="M6 0L0 10.2L6 7.6L12 10.2L6 0Z" fill={color} opacity="1" />
      {/* Middle upper */}
      <path d="M0 10.2L6 13.4L12 10.2L6 7.6L0 10.2Z" fill={color} opacity="0.6" />
      {/* Bottom pyramid */}
      <path d="M6 14.8L0 11.6L6 20L12 11.6L6 14.8Z" fill={color} opacity="0.8" />
    </svg>
  );
}
