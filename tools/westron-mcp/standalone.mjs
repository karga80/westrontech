#!/usr/bin/env node
/**
 * westron-mcp — MCP stdio shim for Westron's in-app control server.
 *
 * Westron (the Tauri desktop app) runs a loopback-only HTTP control server on
 * 127.0.0.1:7777. This process translates MCP tool calls into those HTTP calls,
 * attaching the Bearer token that the app writes to disk on first start.
 *
 * Nothing here talks to a chain, a marketplace, or the network at large — it
 * only talks to localhost. API keys stay inside the Rust app; they are never
 * sent through this shim and never appear in a response.
 *
 * Environment overrides (all optional):
 *   WESTRON_CONTROL_URL         full base URL, e.g. http://127.0.0.1:7777
 *   WESTRON_CONTROL_PORT        port only, when the app was started with it
 *   WESTRON_CONTROL_TOKEN       token value, bypassing the token file
 *   WESTRON_CONTROL_TOKEN_FILE  explicit path to the token file
 *
 * ZERO-DEPENDENCY BUILD: implements the MCP stdio JSON-RPC protocol directly,
 * so this file runs with plain `node` and needs no `npm install`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const NOT_RUNNING = 'Westron is not running — start the app on the Mac first.';

// ── Connection details ────────────────────────────────────────────────────────

function baseUrl() {
  if (process.env.WESTRON_CONTROL_URL) {
    return process.env.WESTRON_CONTROL_URL.replace(/\/+$/, '');
  }
  const port = process.env.WESTRON_CONTROL_PORT || '7777';
  return `http://127.0.0.1:${port}`;
}

function tokenCandidates() {
  if (process.env.WESTRON_CONTROL_TOKEN_FILE) {
    return [process.env.WESTRON_CONTROL_TOKEN_FILE];
  }
  const home = os.homedir();
  return [
    // macOS: where the app writes it. Both spellings are listed because the
    // default macOS volume is case-insensitive but an APFS case-sensitive
    // volume is not.
    path.join(home, 'Library', 'Application Support', 'Westron', 'control-token'),
    path.join(home, 'Library', 'Application Support', 'westron', 'control-token'),
    // Linux fallback (dirs_next::data_dir()), useful for development.
    path.join(home, '.local', 'share', 'Westron', 'control-token'),
  ];
}

/** Read the token fresh on every call — the app may have just been started. */
function readToken() {
  if (process.env.WESTRON_CONTROL_TOKEN) {
    return process.env.WESTRON_CONTROL_TOKEN.trim();
  }
  for (const candidate of tokenCandidates()) {
    try {
      const value = fs.readFileSync(candidate, 'utf8').trim();
      if (value) return value;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `No Westron control token found. Looked in:\n  ${tokenCandidates().join('\n  ')}\n` +
      `The file is created the first time Westron starts — ${NOT_RUNNING}`,
  );
}

function isConnectionRefused(err) {
  const codes = [];
  for (let e = err; e; e = e.cause) {
    if (e.code) codes.push(e.code);
    if (e === e.cause) break;
  }
  return codes.some((c) =>
    ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'UND_ERR_SOCKET'].includes(c),
  );
}

async function call(method, urlPath, body) {
  const token = readToken();
  const url = `${baseUrl()}${urlPath}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (isConnectionRefused(err)) throw new Error(NOT_RUNNING);
    throw new Error(`Could not reach the Westron control server at ${baseUrl()}: ${err.message}`);
  }

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (res.status === 401) {
    throw new Error(
      'Westron rejected the control token (401). The token file may be stale — ' +
        'quit and restart Westron, or check WESTRON_CONTROL_TOKEN.',
    );
  }
  if (!res.ok) {
    const detail = payload && payload.error ? payload.error : text || `HTTP ${res.status}`;
    throw new Error(`Westron returned ${res.status}: ${detail}`);
  }
  return payload;
}

const seg = (v) => encodeURIComponent(String(v));

// ── Tool definitions ──────────────────────────────────────────────────────────

const ADDRESS_NOTE =
  'Must be a 0x-prefixed Ethereum address. Collections are identified by CONTRACT ADDRESS, ' +
  'never by an OpenSea slug like "boredapeyachtclub" — the floor lookup goes through Alchemy ' +
  'by contract address and a slug will simply return no price.';

const TOOLS = [
  {
    name: 'westron_status',
    description:
      'Health and state of the running Westron app: version, spend-envelope status, kill-switch ' +
      'state, snipe-scheduler state (enabled, interval in seconds, last check time, last cycle ' +
      'summary with the floor prices it saw), active snipe rule count, and whether an Alchemy API ' +
      'key is configured. Call this first when the user asks "what is Westron doing?" or before ' +
      'creating rules, to confirm the app is reachable. IMPORTANT: the automatic snipe loop ships ' +
      'DISABLED — read the scheduler_hint field and relay it to the user, because a rule created ' +
      'while the loop is off will never fire on its own.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => call('GET', '/status'),
  },
  {
    name: 'westron_portfolio',
    description:
      'Portfolio snapshot for one wallet: ETH balance, ETH price in USD, total portfolio value in ' +
      'USD, ERC-20 token count and NFT count. Live data via Alchemy. ' + ADDRESS_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address, 0x-prefixed.' },
      },
      required: ['address'],
      additionalProperties: false,
    },
    run: (a) => call('GET', `/portfolio/${seg(a.address)}`),
  },
  {
    name: 'westron_floor_price',
    description:
      'Current floor price of an NFT collection, in ETH, from Alchemy (OpenSea floor, falling back ' +
      'to LooksRare). ' + ADDRESS_NOTE + ' Returns floor_price: null when no marketplace floor is available.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_address: {
          type: 'string',
          description: 'NFT collection CONTRACT ADDRESS (0x…), not a slug.',
        },
      },
      required: ['contract_address'],
      additionalProperties: false,
    },
    run: (a) => call('GET', `/floor/${seg(a.contract_address)}`),
  },
  {
    name: 'westron_list_rules',
    description:
      'List conditional snipe rules. Each rule carries: target_price_eth (the floor must drop ' +
      'BELOW this, in ETH), max_quantity, active flag, triggered_count, expires_at (rules ' +
      'auto-deactivate at this time), max_total_spend_eth (per-rule ETH ceiling, may be null) and ' +
      'spent_eth accumulated so far. Omit wallet_address to list rules for every wallet.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_address: {
          type: 'string',
          description: 'Optional filter — only rules belonging to this wallet address.',
        },
      },
      additionalProperties: false,
    },
    run: (a) =>
      call('GET', a.wallet_address ? `/rules?wallet=${seg(a.wallet_address)}` : '/rules'),
  },
  {
    name: 'westron_create_rule',
    description:
      'Create a conditional snipe rule. The rule fires when the collection floor drops STRICTLY ' +
      'BELOW target_price_eth. All prices are in ETH (never USD, never wei). ' + ADDRESS_NOTE + ' ' +
      'Execution is SIMULATED in this build: a triggered rule emits an event and records a ' +
      '0xSIMULATED transaction hash — no real purchase is made. A spend envelope must exist and ' +
      'cover the wallet address for a trigger to be authorised. Creating a rule does NOT arm it: ' +
      'the automatic loop ships disabled, so check the scheduler_enabled and hint fields in the ' +
      'response and tell the user to enable it (westron_scheduler) if they expect it to fire.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_address: {
          type: 'string',
          description:
            'NFT collection CONTRACT ADDRESS (0x…) to watch. Alias: collection_slug (same meaning, ' +
            'still an address).',
        },
        collection_slug: {
          type: 'string',
          description: 'Deprecated alias for contract_address. Still expects a contract address.',
        },
        target_price_eth: {
          type: 'number',
          description: 'Trigger threshold in ETH. Fires when the floor is below this value.',
        },
        max_quantity: {
          type: 'integer',
          description: 'How many items the rule may sweep in one trigger. Minimum 1.',
        },
        wallet_address: {
          type: 'string',
          description: 'Wallet the rule belongs to and that the spend envelope must cover.',
        },
        ttl_hours: {
          type: 'integer',
          description:
            'How long the rule stays active, in hours. Defaults to 48, capped at 168 (7 days). ' +
            'The scheduler deactivates the rule once it expires.',
        },
        max_total_spend_eth: {
          type: 'number',
          description:
            'Optional per-rule total spend ceiling in ETH. Once accumulated spend plus the next ' +
            'projected purchase would exceed it, the rule refuses to trigger.',
        },
      },
      required: ['target_price_eth', 'max_quantity', 'wallet_address'],
      additionalProperties: false,
    },
    run: (a) => {
      const contract = a.contract_address || a.collection_slug;
      if (!contract) {
        throw new Error('contract_address is required (the collection CONTRACT ADDRESS, not a slug).');
      }
      return call('POST', '/rules', {
        collection_slug: contract,
        target_price_eth: a.target_price_eth,
        max_quantity: a.max_quantity,
        wallet_address: a.wallet_address,
        ttl_hours: a.ttl_hours,
        max_total_spend_eth: a.max_total_spend_eth,
      });
    },
  },
  {
    name: 'westron_cancel_rule',
    description:
      'Permanently delete a snipe rule by id. Use westron_set_rule_active with active=false ' +
      'instead if the user only wants to pause it.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Rule id (UUID) from westron_list_rules.' },
      },
      required: ['rule_id'],
      additionalProperties: false,
    },
    run: (a) => call('DELETE', `/rules/${seg(a.rule_id)}`),
  },
  {
    name: 'westron_set_rule_active',
    description:
      'Pause (active=false) or resume (active=true) a snipe rule without deleting it. A paused ' +
      'rule is skipped by the scheduler.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Rule id (UUID) from westron_list_rules.' },
        active: { type: 'boolean', description: 'true resumes the rule, false pauses it.' },
      },
      required: ['rule_id', 'active'],
      additionalProperties: false,
    },
    run: (a) => call('POST', `/rules/${seg(a.rule_id)}/active`, { active: a.active }),
  },
  {
    name: 'westron_snipe_check_now',
    description:
      'Run one snipe check immediately instead of waiting for the scheduler tick. Fetches the ' +
      'floor price for every active rule and reports, per rule, the floor seen (ETH), whether it ' +
      'triggered, the simulated tx hash, and any guardrail that blocked it (expired rule, spend ' +
      'cap reached, envelope rejection). Works even while the automatic loop is disabled, so this ' +
      'is the right tool for a one-off check. Rules that are past expires_at or have exhausted ' +
      'max_total_spend_eth are deactivated as a side effect, with deactivated_reason set.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => call('POST', '/snipe-check', {}),
  },
  {
    name: 'westron_create_envelope',
    description:
      'Create the spend envelope — the guardrail that authorises automated spending. Every snipe ' +
      'trigger is checked against it. All amounts are in ETH. Replaces any existing envelope. ' +
      'scope_addresses must include the wallet address used by the snipe rules, otherwise every ' +
      'trigger is rejected as out of scope. ttl_hours defaults to 24 (cap 168) — the response ' +
      'reports ttl_hours_applied and expires_at_rfc3339, so relay the actual expiry to the user ' +
      'rather than assuming the envelope lasts indefinitely.',
    inputSchema: {
      type: 'object',
      properties: {
        per_tx_ceiling_eth: {
          type: 'number',
          description: 'Maximum ETH for a single authorised transaction.',
        },
        hard_cap_eth: {
          type: 'number',
          description:
            'Total ETH the envelope may ever authorise. Breaching it trips the kill switch ' +
            'automatically.',
        },
        scope_addresses: {
          type: 'array',
          items: { type: 'string' },
          description: 'Addresses the envelope authorises. At least one is required.',
        },
        ttl_hours: {
          type: 'integer',
          description: 'Envelope lifetime in hours. Defaults to 24, capped at 168 (7 days).',
        },
      },
      required: ['per_tx_ceiling_eth', 'hard_cap_eth', 'scope_addresses'],
      additionalProperties: false,
    },
    run: (a) =>
      call('POST', '/envelope', {
        per_tx_ceiling_eth: a.per_tx_ceiling_eth,
        hard_cap_eth: a.hard_cap_eth,
        scope_addresses: a.scope_addresses,
        ttl_hours: a.ttl_hours,
      }),
  },
  {
    name: 'westron_revoke_envelope',
    description:
      'Revoke the current spend envelope entirely. After this, nothing is authorised to spend ' +
      'until a new envelope is created — snipe rules stay defined but every trigger is rejected.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => call('DELETE', '/envelope'),
  },
  {
    name: 'westron_kill_switch',
    description:
      'Engage (active=true) or release (active=false) the emergency kill switch. While engaged, ' +
      'the envelope rejects every transaction and the snipe scheduler skips its cycles entirely. ' +
      'The envelope itself is preserved, unlike westron_revoke_envelope.',
    inputSchema: {
      type: 'object',
      properties: {
        active: { type: 'boolean', description: 'true engages the kill switch, false releases it.' },
      },
      required: ['active'],
      additionalProperties: false,
    },
    run: (a) => call('POST', '/kill-switch', { active: a.active }),
  },
  {
    name: 'westron_list_alerts',
    description:
      'List notification alerts for a wallet. Alerts only notify (Tauri event + optional Discord ' +
      'webhook); they never spend. Thresholds are in ETH.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_address: { type: 'string', description: 'Wallet address, 0x-prefixed.' },
      },
      required: ['wallet_address'],
      additionalProperties: false,
    },
    run: (a) => call('GET', `/alerts/${seg(a.wallet_address)}`),
  },
  {
    name: 'westron_create_alert',
    description:
      'Create a notification alert. alert_type "portfolio_value" compares the wallet ETH balance ' +
      'against threshold_eth; "floor_price" compares a collection floor and needs collection_slug ' +
      'set to the CONTRACT ADDRESS. condition is "above" or "below". Thresholds are in ETH. ' +
      'Alerts never spend money — use snipe rules for that.',
    inputSchema: {
      type: 'object',
      properties: {
        alert_type: {
          type: 'string',
          enum: ['portfolio_value', 'floor_price'],
          description: 'What to watch.',
        },
        wallet_address: { type: 'string', description: 'Wallet the alert belongs to.' },
        collection_slug: {
          type: 'string',
          description: 'For floor_price alerts: the collection CONTRACT ADDRESS (0x…), not a slug.',
        },
        threshold_eth: { type: 'number', description: 'Threshold in ETH.' },
        condition: { type: 'string', enum: ['above', 'below'], description: 'Comparison direction.' },
        discord_webhook: {
          type: 'string',
          description: 'Optional Discord webhook URL to post the alert to when it fires.',
        },
      },
      required: ['alert_type', 'wallet_address', 'threshold_eth', 'condition'],
      additionalProperties: false,
    },
    run: (a) =>
      call('POST', '/alerts', {
        alert_type: a.alert_type,
        wallet_address: a.wallet_address,
        collection_slug: a.collection_slug ?? null,
        threshold_eth: a.threshold_eth,
        condition: a.condition,
        discord_webhook: a.discord_webhook ?? null,
      }),
  },
  {
    name: 'westron_delete_alert',
    description:
      'Delete a notification alert by id. This removes the alert permanently; deleting an alert ' +
      'never touches snipe rules or the spend envelope. Get ids from westron_list_alerts.',
    inputSchema: {
      type: 'object',
      properties: {
        alert_id: { type: 'string', description: 'Alert id (UUID) from westron_list_alerts.' },
      },
      required: ['alert_id'],
      additionalProperties: false,
    },
    run: (a) => call('DELETE', `/alerts/${seg(a.alert_id)}`),
  },
  {
    name: 'westron_scheduler',
    description:
      'Control the in-app snipe loop. The loop starts DISABLED every time Westron launches — ' +
      'Westron runs on a free Alchemy tier and an always-on floor poll would burn that quota — so ' +
      'send enabled=true to arm it after creating rules, and tell the user you did. enabled=false ' +
      'stops it again; interval_secs changes the cadence (15 seconds once enabled, clamped to ' +
      '5–3600). Both fields are optional; sending neither just returns the current state. Cycles ' +
      'are skipped automatically when there are no active rules, when no Alchemy key is ' +
      'configured, or while the kill switch is engaged — westron_status explains which.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description:
            'true arms the automatic loop (it is off at every app start), false stops it.',
        },
        interval_secs: {
          type: 'integer',
          description: 'Seconds between checks. Clamped to 5–3600.',
        },
      },
      additionalProperties: false,
    },
    run: (a) => {
      const body = {};
      if (a.enabled !== undefined) body.enabled = a.enabled;
      if (a.interval_secs !== undefined) body.interval_secs = a.interval_secs;
      return call('POST', '/scheduler', body);
    },
  },
];

// ── MCP stdio transport (hand-rolled, no SDK) ────────────────────────────────
// Newline-delimited JSON-RPC 2.0 over stdin/stdout — which is what the MCP
// stdio transport is. Only the methods a tools-only server needs are handled;
// anything else gets a proper "method not found".

const PROTOCOL_VERSION = '2024-11-05';

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'westron-mcp', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return reply(id, {});

  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) {
      return reply(id, { isError: true, content: [{ type: 'text', text: `Unknown tool: ${params?.name}` }] });
    }
    try {
      const result = await tool.run(params?.arguments ?? {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      return reply(id, { isError: true, content: [{ type: 'text', text: err.message }] });
    }
  }

  replyError(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    Promise.resolve(handle(msg)).catch((err) => replyError(msg?.id, -32603, err?.message ?? 'internal error'));
  }
});
process.stdin.on('end', () => process.exit(0));
