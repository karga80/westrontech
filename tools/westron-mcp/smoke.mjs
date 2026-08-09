#!/usr/bin/env node
/**
 * End-to-end smoke test for the westron-mcp shim — no Mac and no Rust build
 * required.
 *
 * It stands up a FAKE Westron control server (plain node:http) that speaks the
 * same routes with canned data, spawns the real MCP shim as a child process
 * over stdio, and drives every tool through a real MCP client. One PASS/FAIL
 * line per tool; non-zero exit if anything fails.
 *
 *   node smoke.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIM = path.join(HERE, 'index.js');
const TOKEN = 'a'.repeat(64);

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name} — ${detail}`);
  }
}

// ── Fake control server ───────────────────────────────────────────────────────

const seen = []; // requests the shim actually made, for assertions

function fakeControlServer() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(req.url, 'http://127.0.0.1');
      seen.push({ method: req.method, path: url.pathname, query: url.search, body });

      const send = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(text);
      };

      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        return send(401, { error: 'unauthorized' });
      }

      const p = url.pathname;
      const m = req.method;

      if (m === 'GET' && p === '/status') {
        return send(200, {
          app_version: '0.2.0',
          envelope: {
            active: true,
            kill_switch: false,
            spent_wei: '0',
            hard_cap_wei: '2000000000000000000',
            expires_at: 1786000000,
          },
          kill_switch: false,
          scheduler: {
            enabled: false,
            interval_secs: 15,
            last_check_at: null,
            last_cycle: null,
            cycles_run: 0,
          },
          scheduler_hint:
            'The snipe scheduler is OFF. Rules are stored but NOT checked automatically — ' +
            'nothing will ever fire on its own. Turn it on with westron_scheduler ' +
            '{"enabled": true} (HTTP: POST /scheduler), or run a single check by hand with ' +
            'westron_snipe_check_now.',
          active_rule_count: 1,
          rules_error: null,
          alchemy_key_configured: true,
        });
      }
      if (m === 'GET' && p.startsWith('/portfolio/')) {
        return send(200, {
          eth_balance: 3.25,
          eth_price_usd: 4100.0,
          portfolio_value_usd: 13325.0,
          token_count: 7,
          nft_count: 19,
        });
      }
      if (m === 'GET' && p.startsWith('/floor/')) {
        return send(200, {
          contract_address: decodeURIComponent(p.slice('/floor/'.length)),
          floor_price: 12.5,
          price_currency: 'ETH',
          marketplace: 'openSea',
          retrieved_at: '2026-08-09T09:59:00Z',
        });
      }
      if (m === 'GET' && p === '/rules') {
        return send(200, {
          rules: [
            {
              id: 'rule-1',
              collection_slug: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
              target_price_eth: 10.0,
              max_quantity: 1,
              wallet_address: '0x1111111111111111111111111111111111111111',
              active: true,
              created_at: '2026-08-09T09:00:00+00:00',
              triggered_count: 0,
              expires_at: '2026-08-11T09:00:00+00:00',
              max_total_spend_eth: 10.0,
              spent_eth: 0.0,
              deactivated_reason: null,
            },
          ],
          count: 1,
        });
      }
      if (m === 'POST' && p === '/rules') {
        if (!body || !body.collection_slug) return send(400, { error: 'collection_slug required' });
        return send(200, {
          id: 'rule-2',
          rule: { id: 'rule-2', deactivated_reason: null, ...body },
          scheduler_enabled: false,
          hint:
            'The snipe scheduler is OFF. Rules are stored but NOT checked automatically — ' +
            'nothing will ever fire on its own. Turn it on with westron_scheduler ' +
            '{"enabled": true} (HTTP: POST /scheduler), or run a single check by hand with ' +
            'westron_snipe_check_now.',
        });
      }
      if (m === 'DELETE' && /^\/rules\/[^/]+$/.test(p)) {
        return send(200, { deleted: p.split('/')[2] });
      }
      if (m === 'POST' && /^\/rules\/[^/]+\/active$/.test(p)) {
        return send(200, { id: p.split('/')[2], active: body.active });
      }
      if (m === 'GET' && p.startsWith('/alerts/')) {
        return send(200, {
          alerts: [
            {
              id: 'alert-1',
              alert_type: 'portfolio_value',
              wallet_address: decodeURIComponent(p.slice('/alerts/'.length)),
              collection_slug: null,
              threshold_eth: 5.0,
              condition: 'below',
              discord_webhook: null,
              active: true,
              created_at: '2026-08-09T08:00:00+00:00',
              last_triggered_at: null,
            },
          ],
          count: 1,
        });
      }
      if (m === 'POST' && p === '/alerts') {
        return send(200, { id: 'alert-2' });
      }
      if (m === 'DELETE' && /^\/alerts\/[^/]+$/.test(p)) {
        return send(200, { deleted: p.split('/')[2] });
      }
      if (m === 'POST' && p === '/envelope') {
        const applied = Math.min(body.ttl_hours ?? 24, 168);
        return send(200, {
          envelope_id: 'env-1',
          expires_at: 1786000000,
          expires_at_rfc3339: '2026-08-10T10:00:00+00:00',
          ttl_hours_applied: applied,
          ttl_hours_defaulted: body.ttl_hours === undefined || body.ttl_hours === null,
          hint: `Envelope active for ${applied} hour(s); it expires at the timestamp above.`,
        });
      }
      if (m === 'DELETE' && p === '/envelope') {
        return send(200, { revoked: true });
      }
      if (m === 'POST' && p === '/kill-switch') {
        return send(200, { kill_switch: body.active, envelope: null });
      }
      if (m === 'POST' && p === '/snipe-check') {
        return send(200, {
          checked_at: '2026-08-09T10:01:00+00:00',
          expired_deactivated: 0,
          spend_capped_deactivated: 1,
          triggered: 1,
          results: [
            {
              rule_id: 'rule-1',
              collection_slug: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
              floor_price_eth: 9.4,
              triggered: true,
              tx_hash: '0xSIMULATED_snipe_rule-1_1786000000',
              error: null,
              deactivated_reason: null,
            },
            {
              rule_id: 'rule-3',
              collection_slug: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
              floor_price_eth: 9.4,
              triggered: false,
              tx_hash: null,
              error: 'spend cap reached: 9.0000 spent + 9.4000 projected > 10.0000 ETH cap — rule deactivated',
              deactivated_reason: 'spend_cap_reached',
            },
          ],
        });
      }
      if (m === 'POST' && p === '/scheduler') {
        const enabled = body.enabled ?? false;
        return send(200, {
          enabled,
          interval_secs: body.interval_secs ?? 15,
          last_check_at: null,
          last_cycle: null,
          cycles_run: 0,
          hint: enabled
            ? 'The snipe scheduler is ON, checking active rules every 15 seconds.'
            : 'The snipe scheduler is OFF. Turn it on with westron_scheduler {"enabled": true}.',
        });
      }
      return send(404, { error: 'no such endpoint' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── MCP client helpers ────────────────────────────────────────────────────────

async function connectShim(env) {
  const client = new Client({ name: 'westron-smoke', version: '0.1.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SHIM],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  await client.connect(transport);
  return client;
}

function textOf(result) {
  return (result.content || []).map((c) => c.text).join('\n');
}

async function callTool(client, name, args) {
  const res = await client.callTool({ name, arguments: args ?? {} });
  return { isError: !!res.isError, text: textOf(res) };
}

/** Assert a successful call whose JSON payload satisfies `check`. */
async function expectOk(client, name, args, check, label) {
  const { isError, text } = await callTool(client, name, args);
  if (isError) return report(label ?? name, false, `returned an error: ${text}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return report(label ?? name, false, `response was not JSON: ${text.slice(0, 120)}`);
  }
  const verdict = check(json);
  report(label ?? name, verdict === true, verdict === true ? '' : verdict);
}

// ── Rust route-table cross-check ──────────────────────────────────────────────

const CONTROL_MOD = path.resolve(HERE, '..', '..', 'src-tauri', 'src', 'control', 'mod.rs');

/** `/rules/{id}/active` -> /^\/rules\/[^/]+\/active$/ */
function routeToRegex(pattern) {
  const body = pattern
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith('{') && s.endsWith('}') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^/${body}$`);
}

function checkAgainstRustRoutes() {
  let source;
  try {
    source = fs.readFileSync(CONTROL_MOD, 'utf8');
  } catch {
    report('control/mod.rs route table cross-check', false, `could not read ${CONTROL_MOD} (skipped)`);
    return;
  }
  const declared = [...source.matchAll(/\.route\(\s*"([^"]+)"/g)].map((m) => m[1]);
  if (declared.length === 0) {
    return report('control/mod.rs route table cross-check', false, 'no .route("…") declarations found');
  }
  const regexes = declared.map((d) => ({ pattern: d, re: routeToRegex(d) }));

  const requested = [...new Set(seen.map((r) => r.path))];
  const unmatched = requested.filter((p) => !regexes.some(({ re }) => re.test(p)));
  report(
    'every path the shim called exists in the Rust router',
    unmatched.length === 0,
    `no route declared for: ${unmatched.join(', ')}`,
  );

  const unexercised = regexes
    .filter(({ re }) => !requested.some((p) => re.test(p)))
    .map(({ pattern }) => pattern);
  report(
    'every route in the Rust router is exercised by a tool',
    unexercised.length === 0,
    `never called: ${unexercised.join(', ')}`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const server = await fakeControlServer();
  const { port } = server.address();
  const tokenFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'westron-smoke-')), 'control-token');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });

  console.log(`fake Westron control server on http://127.0.0.1:${port}`);
  console.log(`token file: ${tokenFile}\n`);

  const env = {
    WESTRON_CONTROL_URL: `http://127.0.0.1:${port}`,
    WESTRON_CONTROL_TOKEN_FILE: tokenFile,
  };
  const client = await connectShim(env);

  // 0. tool inventory
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = [
    'westron_cancel_rule',
    'westron_create_alert',
    'westron_create_envelope',
    'westron_create_rule',
    'westron_delete_alert',
    'westron_floor_price',
    'westron_kill_switch',
    'westron_list_alerts',
    'westron_list_rules',
    'westron_portfolio',
    'westron_revoke_envelope',
    'westron_scheduler',
    'westron_set_rule_active',
    'westron_snipe_check_now',
    'westron_status',
  ];
  report(
    'tools/list exposes all 15 tools',
    JSON.stringify(names) === JSON.stringify(expected),
    `got ${names.length}: ${names.join(', ')}`,
  );
  report(
    'every tool has a non-trivial description',
    tools.every((t) => (t.description || '').length > 60),
    'at least one description is too short to guide an LLM',
  );

  // 1. status
  await expectOk(client, 'westron_status', {}, (j) =>
    j.app_version === '0.2.0' && j.scheduler.interval_secs === 15
      ? true
      : `unexpected status payload: ${JSON.stringify(j).slice(0, 120)}`,
  );

  // The loop ships disabled — /status must say so unmistakably, or Emir creates
  // a rule on his phone, assumes it is armed, and nothing ever fires.
  await expectOk(
    client,
    'westron_status',
    {},
    (j) =>
      j.scheduler.enabled === false &&
      /OFF/.test(j.scheduler_hint || '') &&
      /westron_scheduler/.test(j.scheduler_hint || '') &&
      /westron_snipe_check_now/.test(j.scheduler_hint || '')
        ? true
        : `scheduler_hint did not explain the disabled loop: ${j.scheduler_hint}`,
    'westron_status reports the loop is OFF and how to arm it',
  );

  // 2. portfolio
  await expectOk(
    client,
    'westron_portfolio',
    { address: '0x1111111111111111111111111111111111111111' },
    (j) => (j.eth_balance === 3.25 ? true : `eth_balance was ${j.eth_balance}`),
  );

  // 3. floor price
  await expectOk(
    client,
    'westron_floor_price',
    { contract_address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' },
    (j) => (j.floor_price === 12.5 ? true : `floor_price was ${j.floor_price}`),
  );

  // 4. list rules (with wallet filter -> must become a query string)
  await expectOk(
    client,
    'westron_list_rules',
    { wallet_address: '0x1111111111111111111111111111111111111111' },
    (j) => (j.count === 1 ? true : `count was ${j.count}`),
  );
  report(
    'westron_list_rules forwards the wallet filter as ?wallet=',
    seen.some((r) => r.path === '/rules' && r.query.includes('wallet=0x1111')),
    `requests seen: ${seen.map((r) => r.path + r.query).join(' ')}`,
  );

  // 5. create rule — contract address must land in collection_slug
  await expectOk(
    client,
    'westron_create_rule',
    {
      contract_address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      target_price_eth: 10,
      max_quantity: 1,
      wallet_address: '0x1111111111111111111111111111111111111111',
      ttl_hours: 24,
      max_total_spend_eth: 10,
    },
    (j) => (j.id === 'rule-2' ? true : `id was ${j.id}`),
  );
  await expectOk(
    client,
    'westron_create_rule',
    {
      contract_address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      target_price_eth: 10,
      max_quantity: 1,
      wallet_address: '0x1111111111111111111111111111111111111111',
    },
    (j) =>
      j.scheduler_enabled === false && /OFF/.test(j.hint || '')
        ? true
        : `create_rule did not warn that the loop is off: ${JSON.stringify(j).slice(0, 160)}`,
    'westron_create_rule warns that a new rule is not armed',
  );
  const createBody = seen.find((r) => r.method === 'POST' && r.path === '/rules')?.body;
  report(
    'westron_create_rule maps contract_address -> collection_slug and keeps guardrails',
    createBody?.collection_slug === '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' &&
      createBody?.ttl_hours === 24 &&
      createBody?.max_total_spend_eth === 10,
    `body was ${JSON.stringify(createBody)}`,
  );

  // 6. cancel rule
  await expectOk(client, 'westron_cancel_rule', { rule_id: 'rule-2' }, (j) =>
    j.deleted === 'rule-2' ? true : `deleted was ${j.deleted}`,
  );

  // 7. set rule active
  await expectOk(
    client,
    'westron_set_rule_active',
    { rule_id: 'rule-1', active: false },
    (j) => (j.active === false ? true : `active was ${j.active}`),
  );

  // 8. snipe check now
  await expectOk(client, 'westron_snipe_check_now', {}, (j) =>
    j.triggered === 1 && j.results[0].tx_hash.startsWith('0xSIMULATED')
      ? true
      : `unexpected snipe payload: ${JSON.stringify(j).slice(0, 120)}`,
  );
  await expectOk(
    client,
    'westron_snipe_check_now',
    {},
    (j) =>
      j.spend_capped_deactivated === 1 &&
      j.results.some((r) => r.deactivated_reason === 'spend_cap_reached')
        ? true
        : `spend-cap deactivation was not visible: ${JSON.stringify(j).slice(0, 200)}`,
    'westron_snipe_check_now surfaces spend_cap_reached deactivation',
  );

  // 9. create envelope
  await expectOk(
    client,
    'westron_create_envelope',
    {
      per_tx_ceiling_eth: 1.0,
      hard_cap_eth: 2.0,
      scope_addresses: ['0x1111111111111111111111111111111111111111'],
      ttl_hours: 24,
    },
    (j) => (j.envelope_id === 'env-1' ? true : `envelope_id was ${j.envelope_id}`),
  );
  // Omitting ttl_hours must come back saying the 24h default was applied.
  await expectOk(
    client,
    'westron_create_envelope',
    {
      per_tx_ceiling_eth: 1.0,
      hard_cap_eth: 2.0,
      scope_addresses: ['0x1111111111111111111111111111111111111111'],
    },
    (j) =>
      j.ttl_hours_applied === 24 && j.ttl_hours_defaulted === true && !!j.expires_at_rfc3339
        ? true
        : `envelope did not report the applied expiry: ${JSON.stringify(j).slice(0, 160)}`,
    'westron_create_envelope reports the 24h default it applied',
  );

  // 10. revoke envelope
  await expectOk(client, 'westron_revoke_envelope', {}, (j) =>
    j.revoked === true ? true : `revoked was ${j.revoked}`,
  );

  // 11. kill switch
  await expectOk(client, 'westron_kill_switch', { active: true }, (j) =>
    j.kill_switch === true ? true : `kill_switch was ${j.kill_switch}`,
  );

  // 12. list alerts
  await expectOk(
    client,
    'westron_list_alerts',
    { wallet_address: '0x1111111111111111111111111111111111111111' },
    (j) => (j.count === 1 ? true : `count was ${j.count}`),
  );

  // 13. create alert
  await expectOk(
    client,
    'westron_create_alert',
    {
      alert_type: 'portfolio_value',
      wallet_address: '0x1111111111111111111111111111111111111111',
      threshold_eth: 5,
      condition: 'below',
    },
    (j) => (j.id === 'alert-2' ? true : `id was ${j.id}`),
  );

  // 14. delete alert
  await expectOk(client, 'westron_delete_alert', { alert_id: 'alert-2' }, (j) =>
    j.deleted === 'alert-2' ? true : `deleted was ${j.deleted}`,
  );

  // 15. scheduler
  await expectOk(
    client,
    'westron_scheduler',
    { enabled: true, interval_secs: 30 },
    (j) =>
      j.interval_secs === 30 && j.enabled === true && /ON/.test(j.hint || '')
        ? true
        : `scheduler response was ${JSON.stringify(j).slice(0, 160)}`,
  );

  // Missing required argument is reported, not silently forwarded.
  {
    const { isError, text } = await callTool(client, 'westron_create_rule', {
      target_price_eth: 1,
      max_quantity: 1,
      wallet_address: '0x1111111111111111111111111111111111111111',
    });
    report(
      'westron_create_rule rejects a missing contract address',
      isError && /contract_address is required/.test(text),
      `isError=${isError} text=${text.slice(0, 120)}`,
    );
  }

  // The fake server is hand-written, so on its own it cannot catch a path that
  // the shim and the real axum router disagree about. Cross-check the paths the
  // shim actually requested against the route table declared in the Rust source.
  checkAgainstRustRoutes();

  await client.close();

  // Wrong token -> a clear 401 message, never a stack trace.
  {
    const bad = await connectShim({
      WESTRON_CONTROL_URL: `http://127.0.0.1:${port}`,
      WESTRON_CONTROL_TOKEN: 'b'.repeat(64),
    });
    const { isError, text } = await callTool(bad, 'westron_status', {});
    report(
      'wrong token surfaces a 401 explanation',
      isError && /401/.test(text),
      `isError=${isError} text=${text.slice(0, 160)}`,
    );
    await bad.close();
  }

  // App not running -> the exact operator-facing message.
  {
    const closedPort = port + 1;
    const down = await connectShim({
      WESTRON_CONTROL_URL: `http://127.0.0.1:${closedPort}`,
      WESTRON_CONTROL_TOKEN: TOKEN,
    });
    const { isError, text } = await callTool(down, 'westron_status', {});
    report(
      'connection refused reports "Westron is not running"',
      isError && text.includes('Westron is not running — start the app on the Mac first.'),
      `isError=${isError} text=${text.slice(0, 160)}`,
    );
    await down.close();
  }

  server.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`smoke run crashed: ${err.stack || err.message}`);
  process.exit(1);
});
