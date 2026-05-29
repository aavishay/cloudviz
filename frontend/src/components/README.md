# CloudViz UI Components

A modern, accessible, and performant React component library for CloudViz.

## Component Architecture

```
src/
├── components/
│   ├── ScoreRing.tsx      # Animated score indicator with tooltips
│   ├── Sparkline.tsx      # Mini chart with hover interactions
│   ├── Button.tsx         # Polished button with ripple effects
│   ├── CostCard.tsx       # Enhanced cost display card
│   ├── Skeleton.tsx       # Loading skeletons
│   └── index.ts           # Barrel exports
└── ...
```

## Components

### ScoreRing

An animated circular progress indicator with score display.

```tsx
import { ScoreRing } from './components';

// Basic usage
<ScoreRing score={85} />

// With all features
<ScoreRing
  score={85}
  size={40}
  showTooltip={true}
  tooltipText="Custom tooltip message"
  animated={true}
/>
```

**Props:**
- `score: number` - Score value (0-100, auto-clamped)
- `size?: number` - Ring size in pixels (default: 30)
- `showTooltip?: boolean` - Show hover tooltip (default: true)
- `tooltipText?: string` - Custom tooltip text
- `animated?: boolean` - Animate score changes (default: true)

**Features:**
- Smooth cubic-ease animation on mount/value change
- Dynamic color based on score (red/yellow/green gradient)
- Glow effect matching score color
- Status-based tooltip descriptions

---

### Sparkline

A minimal line chart for trend visualization.

```tsx
import { Sparkline } from './components';

<Sparkline
  data={[12, 19, 3, 5, 2, 3, 15, 8]}
  width={100}
  height={30}
  showArea={true}
  animated={true}
/>
```

**Props:**
- `data: number[]` - Array of values
- `width?: number` - Chart width (default: 72)
- `height?: number` - Chart height (default: 22)
- `showArea?: boolean` - Fill area under line (default: true)
- `animated?: boolean` - Draw-in animation (default: true)
- `interactive?: boolean` - Hover tooltips (default: true)

**Features:**
- Automatic NaN/Infinity filtering
- Gradient fill under line
- Interactive hover with value tooltip
- Trend indicator (green=up, red=down)

---

### Button

A polished button component with ripple effects.

```tsx
import { Button } from './components';

<Button
  variant="primary"
  size="md"
  onClick={handleClick}
  loading={isLoading}
  icon={<Icon />}
>
  Click Me
</Button>
```

**Props:**
- `variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent'` (default: 'secondary')
- `size?: 'sm' | 'md' | 'lg'` (default: 'md')
- `loading?: boolean` - Show loading spinner
- `disabled?: boolean` - Disable interactions
- `icon?: ReactNode` - Icon element
- `iconPosition?: 'left' | 'right'` (default: 'left')
- `fullWidth?: boolean` - Full width button
- `ripple?: boolean` - Click ripple effect (default: true)
- `onClick?: (e) => void | Promise<void>` - Click handler

**Features:**
- Smooth press animation (scale down on click)
- Material-style ripple effect
- Loading state with spinner
- Accessible focus states
- Multiple size/variant combinations

---

### CostCard

An enhanced card for displaying resource costs.

```tsx
import { CostCard } from './components';

<CostCard
  title="Production VM"
  cost={1250.50}
  previousCost={1100.00}
  trendData={[1000, 1050, 1100, 1150, 1200, 1250]}
  resourceGroup="production-rg"
  location="East US"
  onClick={() => showDetails()}
/>
```

**Props:**
- `title: string` - Card title
- `cost: number` - Current cost
- `previousCost?: number` - Previous period cost
- `trend?: number` - Trend percentage
- `trendData?: number[]` - Data for sparkline
- `resourceGroup?: string` - Resource group name
- `resourceType?: string` - Resource type
- `location?: string` - Azure region
- `onClick?: () => void` - Click handler
- `index?: number` - Animation stagger index

**Features:**
- Smart cost formatting ($1.2M, $850k, $123)
- Inline sparkline for trends
- Comparison badges (up/down %)
- Staggered entrance animation
- Hover lift effect
- Top accent gradient matching trend

---

### Skeleton

Loading skeleton components for async states.

```tsx
import { SkeletonCard, SkeletonTable, SkeletonStatCard, SkeletonDashboard } from './components';

// Individual skeleton
<SkeletonCard height={200} />

// Table skeleton
<SkeletonTable rows={5} columns={6} />

// Stat card
<SkeletonStatCard />

// Full dashboard
<SkeletonDashboard />
```

**Components:**
- `SkeletonCard` - Generic card placeholder
- `SkeletonText` - Text line placeholders
- `SkeletonTable` - Table row skeletons
- `SkeletonStatCard` - Stat card skeleton
- `SkeletonDashboard` - Complete dashboard layout

**Features:**
- Shimmer animation
- Configurable dimensions
- Responsive layout
- Multiple skeleton types

---

## Typography System

```css
/* Font families */
--font-display: 'Space Grotesk', sans-serif;  /* Headings */
--font-body:    'Inter', sans-serif;          /* Body text */
--font-mono:    'JetBrains Mono', monospace; /* Numbers, code */

/* Usage */
.font-display { font-family: var(--font-display); }
.font-mono { font-family: var(--font-mono); }
```

---

## Animation System

All components use consistent animations:

- **Durations**: 0.2s (fast), 0.3s (standard), 0.5s (emphasis)
- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-out)
- **Entrance**: `fadeSlideUp` - Fade + translateY(12px → 0)
- **Hover**: Transform + shadow transitions
- **Loading**: Shimmer gradient animation

```css
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

---

## Design Tokens

### Colors
```css
--accent:  #10b981;  /* Success, growth */
--danger:  #f43f5e;  /* Errors, deletions */
--warning: #f59e0b;  /* Warnings, alerts */
--blue:    #3b82f6;  /* Info, links */
--purple:  #8b5cf6;  /* Highlights */
--cyan:    #06b6d4;  /* Locations */
```

### Spacing Scale
```css
4px, 8px, 12px, 16px, 20px, 24px, 32px, 48px
```

### Border Radius
```css
6px (small), 8px (buttons), 10px (inputs), 14px (cards), 16px (modals)
```

---

## Migration Guide

### From App.tsx monolith to components:

1. Replace inline ScoreRing:
   ```tsx
   // Before
   const ScoreRing = ({ score }) => { ... }

   // After
   import { ScoreRing } from './components';
   <ScoreRing score={85} />
   ```

2. Replace inline Sparkline:
   ```tsx
   // Before
   const Sparkline = ({ data }) => { ... }

   // After
   import { Sparkline } from './components';
   <Sparkline data={trendData} />
   ```

3. Add loading states:
   ```tsx
   import { SkeletonCard } from './components';

   {loading ? <SkeletonCard /> : <CostCard {...props} />}
   ```

---

## Accessibility

All components implement:
- ARIA labels where needed
- Focus-visible states
- Keyboard navigation
- Reduced motion support
- Color contrast compliance

---

## Performance

- Components are tree-shakeable
- Animations use transform/opacity (GPU-accelerated)
- No layout thrashing
- Lazy loading compatible
