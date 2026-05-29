import { useState, useRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  title?: string;
  ripple?: boolean;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  onClick,
  type = 'button',
  className = '',
  title,
  ripple = true
}: ButtonProps) {
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const [isPressed, setIsPressed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rippleIdCounter = useRef(0);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Create ripple effect
    if (ripple && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = rippleIdCounter.current++;

      setRipples(prev => [...prev, { x, y, id }]);

      // Remove ripple after animation
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== id));
      }, 600);
    }

    if (onClick && !loading && !disabled) {
      await onClick(e);
    }
  };

  const handleMouseDown = () => setIsPressed(true);
  const handleMouseUp = () => setIsPressed(false);
  const handleMouseLeave = () => setIsPressed(false);

  // Size styles
  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: {
      padding: '6px 12px',
      fontSize: 11,
      height: 32,
      gap: 6
    },
    md: {
      padding: '10px 16px',
      fontSize: 12,
      height: 40,
      gap: 8
    },
    lg: {
      padding: '14px 24px',
      fontSize: 14,
      height: 48,
      gap: 10
    }
  };

  // Variant styles
  const getVariantStyles = (v: ButtonVariant): React.CSSProperties => {
    const base: React.CSSProperties = {
      borderRadius: 10,
      border: '1px solid var(--border)',
      fontWeight: 600,
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      whiteSpace: 'nowrap',
      width: fullWidth ? '100%' : 'auto',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: disabled ? 0.5 : 1
    };

    switch (v) {
      case 'primary':
        return {
          ...base,
          background: 'var(--accent)',
          borderColor: 'var(--accent)',
          color: '#fff',
          boxShadow: isPressed
            ? '0 1px 2px rgba(16, 185, 129, 0.2)'
            : '0 4px 14px rgba(16, 185, 129, 0.3)'
        };
      case 'danger':
        return {
          ...base,
          background: 'var(--danger)',
          borderColor: 'var(--danger)',
          color: '#fff',
          boxShadow: isPressed
            ? '0 1px 2px rgba(244, 63, 94, 0.2)'
            : '0 4px 14px rgba(244, 63, 94, 0.3)'
        };
      case 'ghost':
        return {
          ...base,
          background: 'transparent',
          borderColor: 'transparent',
          color: 'var(--text-2)'
        };
      case 'accent':
        return {
          ...base,
          background: 'var(--accent-dim)',
          borderColor: 'var(--accent-border)',
          color: 'var(--accent)'
        };
      default: // secondary
        return {
          ...base,
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          color: 'var(--text-2)'
        };
    }
  };

  const variantStyles = getVariantStyles(variant);

  return (
    <button
      ref={buttonRef}
      type={type}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      disabled={disabled || loading}
      title={title}
      className={`btn btn-${variant} btn-${size} ${className}`}
      style={{
        ...variantStyles,
        ...sizeStyles[size],
        transform: isPressed && !disabled && !loading ? 'scale(0.96)' : 'scale(1)',
        opacity: loading ? 0.8 : variantStyles.opacity
      }}
    >
      {/* Ripple effects */}
      {ripples.map(ripple => (
        <span
          key={ripple.id}
          style={{
            position: 'absolute',
            borderRadius: '50%',
            background: variant === 'primary' || variant === 'danger'
              ? 'rgba(255, 255, 255, 0.3)'
              : 'rgba(16, 185, 129, 0.2)',
            transform: 'scale(0)',
            animation: 'ripple 0.6s linear',
            pointerEvents: 'none',
            left: ripple.x,
            top: ripple.y,
            width: 100,
            height: 100,
            marginLeft: -50,
            marginTop: -50
          }}
        />
      ))}

      {/* Loading spinner */}
      {loading && (
        <span style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'inherit',
          borderRadius: 'inherit'
        }}>
          <svg
            width={size === 'sm' ? 14 : size === 'lg' ? 20 : 16}
            height={size === 'sm' ? 14 : size === 'lg' ? 20 : 16}
            viewBox="0 0 24 24"
            style={{
              animation: 'spin 1s linear infinite'
            }}
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="60"
              strokeDashoffset="20"
            />
          </svg>
        </span>
      )}

      {/* Content */}
      <span style={{
        display: 'flex',
        alignItems: 'center',
        gap: sizeStyles[size].gap,
        opacity: loading ? 0 : 1,
        transition: 'opacity 0.2s ease'
      }}>
        {icon && iconPosition === 'left' && icon}
        {children}
        {icon && iconPosition === 'right' && icon}
      </span>

      <style>{`
        @keyframes ripple {
          to {
            transform: scale(4);
            opacity: 0;
          }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
}

export default Button;
