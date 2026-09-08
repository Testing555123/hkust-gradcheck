import animate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // 港澳优先：系统字体（PingFang HK / 微軟正黑體）命中时零网络请求，Noto Sans TC 仅兜底
        sans: [
          '"Noto Sans TC"',
          '"PingFang HK"',
          '"Microsoft JhengHei"',
          'system-ui',
          'sans-serif',
        ],
      },
      // 4 级字阶：display / title / body / caption（禁止 text-[10px] 这类魔法值）
      fontSize: {
        display: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        title: ['1.125rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        body: ['0.875rem', { lineHeight: '1.4rem' }],
        caption: ['0.75rem', { lineHeight: '1rem' }],
      },
      // 4 级间距：页面分区一律 lg，卡内一律 md
      spacing: {
        xs: '0.5rem', // 8
        sm: '0.75rem', // 12
        md: '1rem', // 16
        lg: '1.5rem', // 24
      },
      colors: {
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        'brand-soft': {
          DEFAULT: 'hsl(var(--brand-soft))',
          foreground: 'hsl(var(--brand-soft-foreground))',
        },
        'surface-2': 'hsl(var(--surface-2))',
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
      },
      // 3 级圆角：卡片 12 / 控件 6 / 小元素 4（rounded-full 仅用于徽标）
      borderRadius: {
        lg: 'var(--radius)',
        md: 'var(--radius-sm)',
        sm: 'calc(var(--radius-sm) - 2px)',
      },
      // 3 层 elevation（暗色下 --elevation-1 归零，层级交给描边）
      boxShadow: {
        flat: 'var(--elevation-1)',
        raised: 'var(--elevation-2)',
        overlay: 'var(--elevation-3)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
      },
      zIndex: {
        header: 'var(--z-header)',
        overlay: 'var(--z-overlay)',
        toast: 'var(--z-toast)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        // 进度条指示器从左向右揭示（clip-path 动画，与指示器的 translateX 内联样式互不冲突）
        'progress-grow': {
          '0%': { 'clip-path': 'inset(0 100% 0 0)' },
          '100%': { 'clip-path': 'inset(0 0 0 0)' },
        },
        // 已修行划线从左到右展开
        strike: {
          '0%': { 'background-size': '0% 1px' },
          '100%': { 'background-size': '100% 1px' },
        },
        'row-in': {
          '0%': { opacity: '0', transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.25s ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'progress-grow': 'progress-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
        strike: 'strike 0.2s ease-out forwards',
        'row-in': 'row-in 0.15s ease-out',
      },
    },
  },
  plugins: [animate],
}
