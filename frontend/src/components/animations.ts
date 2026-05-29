// Animation variants and utilities for CloudViz components

// Easing functions
export const easings = {
  // Smooth deceleration - good for entrances
  easeOut: [0.4, 0, 0.2, 1],
  // Smooth acceleration - good for exits
  easeIn: [0.4, 0, 1, 1],
  // Smooth both ways - good for interactions
  easeInOut: [0.4, 0, 0.2, 1],
  // Springy - good for playful interactions
  spring: [0.34, 1.56, 0.64, 1],
  // Bouncy - good for emphasis
  bounce: [0.68, -0.55, 0.265, 1.55],
  // Linear - good for continuous animations
  linear: [0, 0, 1, 1]
} as const;

// Duration presets (in seconds)
export const durations = {
  instant: 0.1,
  fast: 0.2,
  normal: 0.3,
  slow: 0.5,
  emphasis: 0.6
} as const;

// Stagger delays
export const stagger = {
  fast: 0.03,
  normal: 0.05,
  slow: 0.1
} as const;

// Fade animation variants
export const fade = {
  in: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 }
  },
  slideUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 }
  },
  slideDown: {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 10 }
  },
  slideLeft: {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -10 }
  },
  slideRight: {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 10 }
  },
  scale: {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 }
  }
} as const;

// Card animation variants
export const card = {
  hover: {
    scale: 1.02,
    y: -4,
    transition: {
      duration: durations.fast,
      ease: easings.easeOut
    }
  },
  tap: {
    scale: 0.98,
    transition: {
      duration: durations.instant
    }
  },
  entrance: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: durations.normal,
      ease: easings.easeOut
    }
  }
} as const;

// Button animation variants
export const button = {
  hover: {
    scale: 1.05,
    transition: {
      duration: durations.fast,
      ease: easings.spring
    }
  },
  tap: {
    scale: 0.95,
    transition: {
      duration: durations.instant
    }
  },
  disabled: {
    opacity: 0.5,
    scale: 1
  }
} as const;

// List item animations
export const listItem = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
  transition: {
    duration: durations.fast,
    ease: easings.easeOut
  }
} as const;

// Modal animation variants
export const modal = {
  overlay: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: durations.fast }
  },
  content: {
    initial: { opacity: 0, scale: 0.95, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 20 },
    transition: {
      duration: durations.normal,
      ease: easings.spring
    }
  }
} as const;

// Page transition variants
export const pageTransition = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: {
    duration: durations.normal,
    ease: easings.easeOut
  }
} as const;

// Number counting animation
export function animateNumber(
  from: number,
  to: number,
  duration: number = 1000,
  callback: (value: number) => void
): () => void {
  const startTime = Date.now();
  let animationId: number;

  const tick = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease out cubic
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = from + (to - from) * easeOut;

    callback(current);

    if (progress < 1) {
      animationId = requestAnimationFrame(tick);
    }
  };

  animationId = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(animationId);
}

// Shimmer animation for loading states
export const shimmer = {
  background: `linear-gradient(
    90deg,
    var(--bg-surface) 25%,
    var(--bg-hover) 50%,
    var(--bg-surface) 75%
  )`,
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s ease-in-out infinite'
} as const;

// Pulse animation
export const pulse = {
  keyframes: `
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.05); }
    }
  `,
  style: {
    animation: 'pulse 2s ease-in-out infinite'
  }
} as const;

// Spin animation
export const spin = {
  keyframes: `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
  style: {
    animation: 'spin 1s linear infinite'
  }
} as const;

// Bounce animation
export const bounce = {
  keyframes: `
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }
  `,
  style: {
    animation: 'bounce 2s ease-in-out infinite'
  }
} as const;

// Shake animation for errors
export const shake = {
  keyframes: `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
      20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
  `,
  style: {
    animation: 'shake 0.5s ease-in-out'
  }
} as const;

// Glow animation
export const glow = {
  keyframes: `
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 5px var(--accent); }
      50% { box-shadow: 0 0 20px var(--accent), 0 0 30px var(--accent); }
    }
  `,
  style: {
    animation: 'glow 2s ease-in-out infinite'
  }
} as const;

// CSS for animations (add to global styles)
export const globalAnimations = `
  @keyframes fadeSlideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeSlideDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeSlideLeft {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @keyframes fadeSlideRight {
    from { opacity: 0; transform: translateX(-20px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @keyframes fadeScale {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.05); }
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
  }

  @keyframes glow {
    0%, 100% { box-shadow: 0 0 5px var(--accent); }
    50% { box-shadow: 0 0 20px var(--accent), 0 0 30px var(--accent); }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
  }

  @keyframes slideInUp {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  @keyframes slideOutDown {
    from { transform: translateY(0); opacity: 1; }
    to { transform: translateY(100%); opacity: 0; }
  }

  @keyframes countUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes ripple {
    to { transform: scale(4); opacity: 0; }
  }

  /* Utility classes */
  .animate-fade-in {
    animation: fadeSlideUp 0.3s ease-out;
  }

  .animate-fade-in-up {
    animation: fadeSlideUp 0.4s ease-out;
  }

  .animate-fade-in-down {
    animation: fadeSlideDown 0.4s ease-out;
  }

  .animate-scale {
    animation: fadeScale 0.3s ease-out;
  }

  .animate-pulse {
    animation: pulse 2s ease-in-out infinite;
  }

  .animate-bounce {
    animation: bounce 2s ease-in-out infinite;
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  .animate-shimmer {
    background: linear-gradient(
      90deg,
      var(--bg-surface) 25%,
      var(--bg-hover) 50%,
      var(--bg-surface) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .animate-glow {
    animation: glow 2s ease-in-out infinite;
  }

  .animate-float {
    animation: float 3s ease-in-out infinite;
  }

  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

// Stagger animation delays for lists
export function getStaggerDelay(index: number, baseDelay: number = stagger.normal): string {
  return `${index * baseDelay}s`;
}

// CSS transition shorthand
export function createTransition(properties: string[], duration: number = durations.fast, easing: readonly number[] = easings.easeOut): string {
  return properties.map(prop => `${prop} ${duration}s cubic-bezier(${easing.join(',')})`).join(', ');
}

export default {
  easings,
  durations,
  stagger,
  fade,
  card,
  button,
  listItem,
  modal,
  pageTransition,
  pulse,
  spin,
  bounce,
  shake,
  glow,
  shimmer,
  globalAnimations,
  animateNumber,
  getStaggerDelay,
  createTransition
};
