# westron-mcp

MCP stdio server that lets Claude drive a **running** Westron desktop app.

```
Claude desktop ──stdio──► westron-mcp (this package)
                              │ HTTP 127.0.0.1:7777, Bearer token
                          Westron.app (Tauri) → control server → Rust core
```

Nothing here reaches the internet. It only talks to loopback, and the Alchemy /
OpenSea / Etherscan keys never leave the Rust process — they are read from the
app's key store inside each handler and are never present in a request or a
response.

## Install

```bash
cd tools/westron-mcp
npm install
node --check index.js   # syntax sanity check
```

Node 18 or newer (it uses the built-in `fetch`).

## Register with Claude desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add a
`westron` entry. Use the **absolute** path to `index.js` — Claude desktop does not
expand `~` and does not run from your project directory.

```json
{
  "mcpServers": {
    "westron": {
      "command": "node",
      "args": ["/Users/emir/Developer/westron/tools/westron-mcp/index.js"]
    }
  }
}
```

Quit Claude desktop completely (⌘Q) and reopen it. The Westron tools appear in
the tools menu once the server handshakes.

## The token

Westron writes a 32-byte random hex token to

```
~/Library/Application Support/Westron/control-token     (mode 0600)
```

the first time it starts. The shim reads that file **on every call**, so you can
start Westron after Claude desktop without restarting anything. Every route
requires `Authorization: Bearer <token>`; without it the control server answers
401 and nothing else.

If Westron is not running you get exactly:

> Westron is not running — start the app on the Mac first.

## Tools

| Tool | Does |
| --- | --- |
| `westron_status` | version, envelope, kill switch, scheduler state, active rule count |
| `westron_portfolio` | ETH balance / USD value / token + NFT counts for a wallet |
| `westron_floor_price` | collection floor in ETH (by **contract address**) |
| `westron_list_rules` | snipe rules, with expiry and spend-cap guardrails |
| `westron_create_rule` | new conditional snipe rule |
| `westron_cancel_rule` | delete a rule |
| `westron_set_rule_active` | pause / resume a rule |
| `westron_snipe_check_now` | run one check immediately |
| `westron_create_envelope` | create the spend envelope |
| `westron_revoke_envelope` | revoke it |
| `westron_kill_switch` | engage / release the kill switch |
| `westron_list_alerts` | notification alerts for a wallet |
| `westron_create_alert` | new notification alert |
| `westron_delete_alert` | delete an alert |
| `westron_scheduler` | **arm** the loop (it starts off), change the interval |

Two things the tool descriptions hammer on, because they are the usual way an
LLM caller gets it wrong:

* **All prices are in ETH.** Never USD, never wei.
* **Collections are identified by CONTRACT ADDRESS**, e.g.
  `0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d` — *not* an OpenSea slug like
  `boredapeyachtclub`. The floor lookup goes through Alchemy by contract
  address; a slug returns no price.

**The automatic snipe loop starts DISABLED at every app launch.** Westron runs on
a free Alchemy tier where concurrent-call bursts have already caused real HTTP
429s and blanked wallet data, and the product's sequencing is monitoring first,
automation last — so a 15s floor poll is opt-in, not the default. Creating a
rule does *not* arm it. `westron_status` returns a `scheduler_hint` saying so,
`POST /rules` repeats it in its response, and `westron_scheduler {"enabled":
true}` turns the loop on (15s cadence once enabled). `westron_snipe_check_now`
works regardless and is the right tool for a one-off check.

Sniping is **simulated** in this build. A triggered rule emits an event and
records a `0xSIMULATED_…` hash. No real purchase happens — that is Faz 2.

## Smoke test (no Mac, no Rust build needed)

```bash
node smoke.mjs
```

It stands up a fake control server with canned data, spawns this shim as a real
MCP child process, and drives all 15 tools plus the guardrail surfaces (loop-off
warnings, spend-cap deactivation, applied envelope TTL) and the failure paths
(bad token, app down, missing contract address). It also cross-checks the paths the shim
requests against the `.route(...)` table in
`src-tauri/src/control/mod.rs`, so a route rename on the Rust side fails the
test instead of silently breaking at runtime.

## Environment overrides

Only needed for development and for `smoke.mjs`:

| Variable | Effect |
| --- | --- |
| `WESTRON_CONTROL_URL` | full base URL instead of `http://127.0.0.1:7777` |
| `WESTRON_CONTROL_PORT` | port only (matches the app's `WESTRON_CONTROL_PORT`) |
| `WESTRON_CONTROL_TOKEN` | token value, bypassing the token file |
| `WESTRON_CONTROL_TOKEN_FILE` | explicit token file path |
