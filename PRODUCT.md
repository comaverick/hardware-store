# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Store managers, administrators, and authorized staff who monitor hardware inventory, process sales, manage branches, and review operational activity.

## Product Purpose

The Hardware Management System centralizes product catalog, inventory, branch stock, point-of-sale transactions, reservations, purchasing placeholders, reporting, audit activity, and user administration. Success means staff can understand stock and operational risk quickly, then move to the correct workflow without losing context.

## Positioning

The system connects branch-level inventory, sales activity, and operational controls in one role-aware workspace rather than treating them as separate tools.

## Operating Context

Users work from a desktop-first management interface with a collapsible navigation rail, branch-aware views, dense lists and tables, sales workflows, stock adjustments, and periodic operational review. The product must remain usable on tablet and mobile widths for quick monitoring and navigation.

## Capabilities and Constraints

- Existing routes include Dashboard, POS, Products, Inventory, Reservations, Product Finder, Stock History, Reports, Audit Logs, User Management, and placeholder routes for Transfers, Purchases, and Settings.
- Existing APIs provide products, inventory, inventory transactions, sales, smart-inventory recommendations, reservations, users, branches, and system health.
- Access is role-aware through the authenticated user context; elevated routes are restricted in the existing navigation.
- The redesign must preserve real API data, existing business rules, and the current React/Ant Design/Recharts stack.
- No new backend capabilities or fabricated metrics should be introduced.

## Brand Commitments

The product name is Hardware Store / Hardware Management System. The interface should communicate technical confidence, operational clarity, and trustworthiness without generic AI-dashboard language or decorative futurism.

## Evidence on Hand

Real data shapes and workflows are implemented in `src/pages`, `src/components/layout`, `src/services/api.js`, and the corresponding controllers/models under `server/`. No approved external brand assets were found; the system mark should therefore be implemented as reusable vector UI.

## Product Principles

- Make operational risk visible before secondary detail.
- Keep branch, stock, and transaction context close to the work.
- Prefer clear, dense structure over decorative dashboard chrome.
- Let status color communicate meaning consistently.
- Preserve fast navigation for staff who repeat tasks every day.

