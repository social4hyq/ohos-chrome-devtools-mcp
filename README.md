# ohos-chrome-devtools-mcp

Thin wrapper that lets [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) drive the ArkWeb browser on an OpenHarmony / HarmonyOS device. The OHOS counterpart of the upstream Chrome DevTools MCP server.

The MCP surface — tools, behaviour, output formats — is the upstream `chrome-devtools-mcp` verbatim. This wrapper exists only to do the OHOS-specific hdc dance:

1. Connect to the device (auto-discovery via `hdc tconn`, or a manual paste fallback).
2. Locate the ArkWeb browser process and its `@webview_devtools_remote_<pid>` abstract socket.
3. Forward that socket to a local TCP port with `hdc fport`.
4. Spawn `chrome-devtools-mcp` with `--browserUrl=http://127.0.0.1:<port>` and pipe its stdio straight through.

When the wrapper exits, the `hdc fport` rule is cleaned up.

## Install

```sh
npm i -g ohos-playwright@^0.6.0 ohos-chrome-devtools-mcp@^0.2.0 chrome-devtools-mcp
```

`ohos-playwright` and `chrome-devtools-mcp` are peer dependencies — npm 7+ installs them alongside automatically when you install this package globally.

## Compatibility

| ohos-chrome-devtools-mcp | ohos-playwright |
|---|---|
| 0.2.x | ≥0.6.0 |
| 0.1.x | ≥0.2.9 |

ohos-playwright 0.6.0+: **MainAbility** (multi-tab browser) is the default.
CustomTabAbility (single-page) is available via `OHOS_PW_CUSTOM_TAB=1`.

## MCP client configuration

```jsonc
{
  "mcpServers": {
    "ohos-chrome-devtools": {
      "command": "ohos-chrome-devtools-mcp",
      "args": []
    }
  }
}
```

Any additional flags accepted by the upstream `chrome-devtools-mcp` can be appended to `args` — they are forwarded as-is, with a short blocklist for flags that would conflict with the connect-only flow (see [Stripped flags](#stripped-flags)).

## How it differs from `chrome-devtools-mcp`

| | upstream `chrome-devtools-mcp` | this wrapper |
|---|---|---|
| Target browser | Chrome (launched locally) | ArkWeb on an OHOS device, over hdc |
| Setup | Puppeteer launches Chrome | `ohos-playwright/setup` (hdc connect + fport) |
| Connection | `--browserUrl` / `--wsEndpoint` / `--channel` | always connects via `--browserUrl` (injected) |
| Tool surface | full upstream API | identical — wrapper does not modify it |

## Stripped flags

These flags would make `chrome-devtools-mcp` ignore the OHOS device and either launch a local Chromium or connect somewhere unintended. The wrapper silently drops them with a stderr note:

- `--browserUrl` (we set this from the device endpoint)
- `--wsEndpoint`
- `--channel`
- `--userDataDir`
- `--executablePath`
- `--isolated`

## Environment

Configuration is inherited from `ohos-playwright`. The most useful variables:

| Variable | Default |
|---|---|
| `OHOS_PW_HDC` | `/data/service/hnp/bin/hdc` |
| `OHOS_PW_BUNDLE` | `com.huawei.hmos.browser` |
| `OHOS_PW_LAUNCH_URL` | `about:blank` |
| `OHOS_PW_AUTO_CONNECT` | auto (set `0` to skip auto-connect) |
| `OHOS_PW_INFO_PATH` | `<tmpdir>/ohos-playwright-cdp.json` |

Wrapper-specific overrides (rarely needed):

| Variable | Purpose |
|---|---|
| `OHOS_CDT_SETUP` | absolute path to a custom `setup` module |
| `OHOS_CDT_TEARDOWN` | absolute path to a custom `teardown` module |
| `OHOS_CDT_BIN` | absolute path to a `chrome-devtools-mcp` bin to spawn |

## Troubleshooting

- **`Cannot resolve "ohos-playwright/setup"`** — install ohos-playwright (`npm i -g ohos-playwright`) or set `OHOS_CDT_SETUP`.
- **`Cannot resolve "chrome-devtools-mcp/package.json"`** — install upstream (`npm i -g chrome-devtools-mcp`) or set `OHOS_CDT_BIN`.
- **`ohos-playwright setup finished but ... was not written`** — usually a stale `hdc tconn` / sandbox-blocked device. Run `hdc list targets` to check.
- The upstream `chrome-devtools-mcp` server writes its own diagnostics to stderr; check stderr first when a tool fails.

## License

MIT
