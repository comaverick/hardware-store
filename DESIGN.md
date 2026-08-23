---
name: Orange Hardware Operations
description: A practical hardware-retail control center for branch inventory, sales, and operational follow-up.
colors:
  canvas: "#F5F2ED"
  panel: "#FBFAF7"
  panel-raised: "#FFFFFF"
  sidebar: "#20262B"
  sidebar-strong: "#151A1E"
  sidebar-ink: "#FFFAF4"
  sidebar-muted: "#A7ADB0"
  ink: "#20262B"
  heading: "#151A1E"
  muted: "#687178"
  subtle: "#8A9295"
  line: "#D9D5CE"
  line-strong: "#BCB7AE"
  accent: "#F96302"
  accent-light: "#FF7A1A"
  accent-strong: "#D94E00"
  accent-deep: "#B93600"
  accent-soft: "#FFF0E6"
  accent-wash: "#FFF7F1"
  success: "#2D8A5F"
  warning: "#C47A18"
  danger: "#B9433D"
typography:
  display:
    fontFamily: "Avenir Next, Segoe UI, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.5rem)"
    fontWeight: 780
    lineHeight: 1.03
  body:
    fontFamily: "Avenir Next, Segoe UI, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.08em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "13px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "32px"
motion:
  fast: "180ms cubic-bezier(0.22, 0.8, 0.2, 1)"
  shell: "260ms cubic-bezier(0.22, 0.8, 0.2, 1)"
  overlay: "200ms cubic-bezier(0.22, 0.8, 0.2, 1)"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  surface:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design system: Orange Hardware Operations

## Product mode

Operate. Store managers, administrators, and authorized staff need a fast read on branch scope, sales activity, stock risk, and the next operational action. The interface is dense by design, but every signal must be easy to classify and every control must feel dependable.

## Creative direction

The new visual world is inspired by professional hardware-retail environments: orange safety markings, charcoal fixtures, warm paper and concrete neutrals, and clean white work surfaces. Orange is a signal color for action, selection, and the strongest operating metric. Charcoal belongs to navigation and high-priority intelligence. Warm off-white keeps the workspace practical and less clinical than a cool SaaS gray. Select surfaces use industrial liquid glass: polished safety-glass depth, warm reflections, and readable instrumentation underneath—not full-screen decorative blur.

The Dashboard, Sidebar, and Topbar share one shell. The Sidebar is a matte graphite navigation rail with a compact orange hardware mark. The Topbar is a restrained liquid-glass work surface that keeps page context, global branch scope, system health, and the signed-in user aligned with the rail. The Dashboard uses a weighted overview instead of equal KPI tiles: one dominant sales signal when sales are active, or a dominant low-stock action when sales are empty and inventory risk is present. Supporting measures, sales history, inventory intelligence, recent activity, branch health, and explicit stock alerts remain operational and mostly opaque.

## Color rules

- Primary orange `#F96302` is used for the brand mark, active navigation signal, selected states, and key emphasis.
- Light orange `#FF7A1A`, deep orange `#D94E00`, and burnt deep orange `#B93600` form the restrained industrial gradient, used only on the strongest actionable surface and primary actions.
- Charcoal `#20262B` and deep graphite `#151A1E` are navigation and intelligence surfaces, not decorative dark blocks.
- Warm canvas `#F5F2ED` separates the working area from white data panels.
- White `#FFFFFF` is reserved for readable, raised operational surfaces.
- Muted text `#687178` and border `#D9D5CE` maintain hierarchy without introducing cool gray noise.
- Success, warning, and danger retain semantic meaning and always appear with a label or icon, never by color alone.

All reusable values live in `src/index.css` as `--app-*` tokens. Components should use tokens or semantic status classes rather than new one-off palette values.

## Typography and data

The body stack uses Avenir Next or Segoe UI for approachable dense reading. Dashboard, Sidebar, and Topbar labels use sentence case and normal interface typography. System mono is reserved for branch codes, SKUs, quantities, timestamps, and technical metadata. Headings use tight tracking and balanced wrapping. Operational numbers use tabular figures so sales, inventory quantities, and counts scan cleanly.

## Layout

Desktop uses a 78px collapsed rail or 264px expanded rail, a 72px Topbar, and a warm content canvas with a readable max width. Sidebar width, Topbar left offset, and content margin use the same CSS tokens and the same 260ms ease-out transition. Navigation expansion is explicit and stable, with a short hover preview that collapses only after the pointer leaves the rail. A manual toggle pins the expanded state. The Topbar owns the single interactive branch scope control; the Dashboard shows the selected scope as quiet context.

Below 900px the Sidebar becomes a 264px off-canvas drawer. The scrim stays mounted and transitions opacity, preventing flashes during open and close. Escape closes the drawer, body scrolling is locked while it is open, the menu button exposes `aria-expanded`, and the drawer retains keyboard-visible focus states. At 640px, branch and user context reduce to compact controls while the page title remains readable. The floating Assistant has a reserved bottom clearance and never becomes part of the document flow.

The Dashboard first viewport answers four questions: what is happening, which branch scope is active, what needs attention, and what the operator can do next. The overview leads with completed sales when sales are meaningful; when sales are empty, low-stock inventory becomes the dominant orange action with the existing Inventory destination, while sales remains a compact supporting measure. Sales performance remains a comparable analytical area through chart scale and typography rather than another orange panel. A range with no activity uses an intentional empty state and leaves its period controls available. The sales chart and inventory intelligence sit side by side on wide screens and stack on narrow screens. Dense stock rows retain a clear mobile two-column structure rather than shrinking unreadably.

## Surface and depth

The system is flat by default. The Sidebar remains matte deep graphite and Inventory Intelligence remains a solid dark instrumentation panel. Light Dashboard cards use restrained translucency (`rgba(255, 255, 255, 0.82)`) over a warm ambient canvas with 14px blur, so the page has depth without reducing text contrast. Operational stock alerts use one grouped surface with flat rows and quiet separators rather than nested cards. Industrial liquid glass remains limited to the Topbar, global branch selector, account dropdown, mobile navigation scrim, Ask Bolt, Assistant panel, and the selected low-stock overview surface. The low-stock surface uses a translucent orange gradient with 18px blur, 140% saturation, a thin highlighted edge, and a warm shadow; dark glass uses graphite, 20px blur, 125% saturation, a restrained border, and a subtle orange inner highlight. Solid white, graphite, or orange fallbacks are required. The account dropdown is anchored inside the fixed Topbar so it stays aligned during page scrolling. Gradients are limited to the strongest actionable overview surface, primary actions, selected navigation, and brand mark treatment. Rounded corners are moderate and vary by hierarchy: 8px controls, 10px dense groups, 13px larger panels.

## Components and states

- Primary buttons use deep orange with white text, 36px minimum height, hover feedback, pressed feedback, and visible focus rings.
- Navigation items keep their real routes and role-based visibility. The active item uses a restrained orange leading signal and `aria-current="page"`.
- Collapsed navigation remains useful through aligned icons and Ant Design tooltips.
- Branch selection exposes `aria-expanded`, keeps the selected branch visible, and uses a check icon plus text.
- User menus expose `aria-expanded` and rotate the disclosure icon when open.
- System status uses a text label plus a status dot.
- Loading uses layout-shaped skeletons. Errors remain inline and actionable. Empty activity states are quiet and explicit.
- Reduced motion removes shell and interaction transitions while preserving state changes and focus visibility.

## Do and do not

Do preserve API-backed values, branch scope, permissions, route labels, chart controls, and operational workflows. Do make stock risk and system status legible in seconds. Do keep the shell coordinated across resize and mobile drawer states.

Do not introduce fake metrics, fake users, fake branches, invented AI insights, rainbow charts, purple gradients, neon color, excessive blur, decorative KPI grids, or unrelated page redesigns.
