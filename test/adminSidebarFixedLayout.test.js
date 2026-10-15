const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminCssPath = path.join(__dirname, '..', 'admin', 'admin.css');
const dashboardHtmlPath = path.join(__dirname, '..', 'admin', 'dashboard.html');

test('Admin Sidebar: CSS ensures consistent width and fixed sticky layout on desktop', () => {
  const css = fs.readFileSync(adminCssPath, 'utf8');

  // Verify .sidebar base rule
  const sidebarMatch = css.match(/\.sidebar\s*\{([^}]+)\}/);
  assert.ok(sidebarMatch, '.sidebar CSS rule should exist');
  const sidebarBody = sidebarMatch[1];

  assert.match(sidebarBody, /width:\s*260px;?/, '.sidebar must set width: 260px');
  assert.match(sidebarBody, /min-width:\s*260px;?/, '.sidebar must set min-width: 260px to prevent shrinking');
  assert.match(sidebarBody, /flex-shrink:\s*0;?/, '.sidebar must have flex-shrink: 0 to prevent shrinking in flexbox');
  assert.match(sidebarBody, /position:\s*sticky;?/, '.sidebar must have position: sticky to remain fixed during scroll');
  assert.match(sidebarBody, /top:\s*0;?/, '.sidebar must have top: 0 for sticky positioning');
  assert.match(sidebarBody, /height:\s*100vh;?/, '.sidebar must span viewport height');
  assert.match(sidebarBody, /overflow-y:\s*auto;?/, '.sidebar must allow internal scrolling if content overflows');
});

test('Admin Main & Panels: min-width: 0 and table-shell horizontal containment prevents blowout', () => {
  const css = fs.readFileSync(adminCssPath, 'utf8');

  // Verify .dashboard-main has min-width: 0
  const mainMatch = css.match(/\.dashboard-main\s*\{([^}]+)\}/);
  assert.ok(mainMatch, '.dashboard-main CSS rule should exist');
  const mainBody = mainMatch[1];
  assert.match(mainBody, /min-width:\s*0;?/, '.dashboard-main must have min-width: 0 to allow flexbox shrinking');

  // Verify .table-shell has overflow: auto and max-width: 100%
  const tableShellMatch = css.match(/\.table-shell\s*\{([^}]+)\}/);
  assert.ok(tableShellMatch, '.table-shell CSS rule should exist');
  const tableShellBody = tableShellMatch[1];
  assert.match(tableShellBody, /overflow:\s*auto;?/, '.table-shell must have overflow: auto for table scrolling');
  assert.match(tableShellBody, /max-width:\s*100%;?/, '.table-shell must have max-width: 100%');
});

test('Admin Sidebar: Mobile media query preserves responsive collapsing', () => {
  const css = fs.readFileSync(adminCssPath, 'utf8');

  // Find @media (max-width: 860px) block
  const mediaIndex = css.indexOf('@media (max-width: 860px)');
  assert.ok(mediaIndex !== -1, '@media (max-width: 860px) should exist');

  const mediaSnippet = css.slice(mediaIndex, mediaIndex + 500);
  assert.match(mediaSnippet, /\.dashboard-body\s*\{\s*display:\s*block;?\s*\}/, 'dashboard-body becomes block on mobile');
  assert.match(mediaSnippet, /position:\s*static;?/, 'sidebar position resets to static on mobile');
  assert.match(mediaSnippet, /height:\s*auto;?/, 'sidebar height resets to auto on mobile');
  assert.match(mediaSnippet, /min-width:\s*0;?/, 'sidebar min-width resets to 0 on mobile');
  assert.match(mediaSnippet, /width:\s*100%;?/, 'sidebar width is 100% on mobile');
});

test('Admin Dashboard HTML: Retains layout structure with sidebar and dashboard-main in dashboard-body', () => {
  const html = fs.readFileSync(dashboardHtmlPath, 'utf8');

  assert.ok(html.includes('<body class="dashboard-body">'), 'HTML has body with dashboard-body class');
  assert.ok(html.includes('<aside class="sidebar">'), 'HTML has aside with sidebar class');
  assert.ok(html.includes('<main class="dashboard-main">'), 'HTML has main with dashboard-main class');
  assert.ok(html.includes('id="ordersView"'), 'HTML has ordersView section');
  assert.ok(html.includes('id="ordersTable"'), 'HTML has ordersTable container');
});
