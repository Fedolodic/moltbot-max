import { randomToken, storeGatewayTokenInKeychain } from "../commands/onboard-helpers.js";
import type { GatewayAuthChoice } from "../commands/onboard-types.js";
import type { MoltbotConfig } from "../config/config.js";
import { validateToken, MIN_TOKEN_LENGTH } from "../gateway/token.js";
import { findTailscaleBinary } from "../infra/tailscale.js";
import type { RuntimeEnv } from "../runtime.js";
import type {
  GatewayWizardSettings,
  QuickstartGatewayDefaults,
  WizardFlow,
} from "./onboarding.types.js";
import type { WizardPrompter } from "./prompts.js";

/** Whether the gateway token was stored in keychain. */
export type KeychainStorageInfo = {
  stored: boolean;
  backend?: string;
  error?: string;
};

type ConfigureGatewayOptions = {
  flow: WizardFlow;
  baseConfig: MoltbotConfig;
  nextConfig: MoltbotConfig;
  localPort: number;
  quickstartGateway: QuickstartGatewayDefaults;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
};

type ConfigureGatewayResult = {
  nextConfig: MoltbotConfig;
  settings: GatewayWizardSettings;
  keychainStorage?: KeychainStorageInfo;
};

export async function configureGatewayForOnboarding(
  opts: ConfigureGatewayOptions,
): Promise<ConfigureGatewayResult> {
  const { flow, localPort, quickstartGateway, prompter } = opts;
  let { nextConfig } = opts;

  const port =
    flow === "quickstart"
      ? quickstartGateway.port
      : Number.parseInt(
          String(
            await prompter.text({
              message: "Gateway port",
              initialValue: String(localPort),
              validate: (value) => (Number.isFinite(Number(value)) ? undefined : "Invalid port"),
            }),
          ),
          10,
        );

  let bind = (
    flow === "quickstart"
      ? quickstartGateway.bind
      : ((await prompter.select({
          message: "Gateway bind",
          options: [
            { value: "loopback", label: "Loopback (127.0.0.1)" },
            { value: "lan", label: "LAN (0.0.0.0)" },
            { value: "tailnet", label: "Tailnet (Tailscale IP)" },
            { value: "auto", label: "Auto (Loopback → LAN)" },
            { value: "custom", label: "Custom IP" },
          ],
        })) as "loopback" | "lan" | "auto" | "custom" | "tailnet")
  ) as "loopback" | "lan" | "auto" | "custom" | "tailnet";

  let customBindHost = quickstartGateway.customBindHost;
  if (bind === "custom") {
    const needsPrompt = flow !== "quickstart" || !customBindHost;
    if (needsPrompt) {
      const input = await prompter.text({
        message: "Custom IP address",
        placeholder: "192.168.1.100",
        initialValue: customBindHost ?? "",
        validate: (value) => {
          if (!value) return "IP address is required for custom bind mode";
          const trimmed = value.trim();
          const parts = trimmed.split(".");
          if (parts.length !== 4) return "Invalid IPv4 address (e.g., 192.168.1.100)";
          if (
            parts.every((part) => {
              const n = parseInt(part, 10);
              return !Number.isNaN(n) && n >= 0 && n <= 255 && part === String(n);
            })
          )
            return undefined;
          return "Invalid IPv4 address (each octet must be 0-255)";
        },
      });
      customBindHost = typeof input === "string" ? input.trim() : undefined;
    }
  }

  let authMode = (
    flow === "quickstart"
      ? quickstartGateway.authMode
      : ((await prompter.select({
          message: "Gateway auth",
          options: [
            {
              value: "token",
              label: "Token",
              hint: "Recommended default (local + remote)",
            },
            { value: "password", label: "Password" },
          ],
          initialValue: "token",
        })) as GatewayAuthChoice)
  ) as GatewayAuthChoice;

  const tailscaleMode = (
    flow === "quickstart"
      ? quickstartGateway.tailscaleMode
      : ((await prompter.select({
          message: "Tailscale exposure",
          options: [
            { value: "off", label: "Off", hint: "No Tailscale exposure" },
            {
              value: "serve",
              label: "Serve",
              hint: "Private HTTPS for your tailnet (devices on Tailscale)",
            },
            {
              value: "funnel",
              label: "Funnel",
              hint: "Public HTTPS via Tailscale Funnel (internet)",
            },
          ],
        })) as "off" | "serve" | "funnel")
  ) as "off" | "serve" | "funnel";

  // Detect Tailscale binary before proceeding with serve/funnel setup.
  if (tailscaleMode !== "off") {
    const tailscaleBin = await findTailscaleBinary();
    if (!tailscaleBin) {
      await prompter.note(
        [
          "Tailscale binary not found in PATH or /Applications.",
          "Ensure Tailscale is installed from:",
          "  https://tailscale.com/download/mac",
          "",
          "You can continue setup, but serve/funnel will fail at runtime.",
        ].join("\n"),
        "Tailscale Warning",
      );
    }
  }

  let tailscaleResetOnExit = flow === "quickstart" ? quickstartGateway.tailscaleResetOnExit : false;
  if (tailscaleMode !== "off" && flow !== "quickstart") {
    await prompter.note(
      ["Docs:", "https://docs.molt.bot/gateway/tailscale", "https://docs.molt.bot/web"].join("\n"),
      "Tailscale",
    );
    tailscaleResetOnExit = Boolean(
      await prompter.confirm({
        message: "Reset Tailscale serve/funnel on exit?",
        initialValue: false,
      }),
    );
  }

  // Safety + constraints:
  // - Tailscale wants bind=loopback so we never expose a non-loopback server + tailscale serve/funnel at once.
  // - Funnel requires password auth.
  if (tailscaleMode !== "off" && bind !== "loopback") {
    await prompter.note("Tailscale requires bind=loopback. Adjusting bind to loopback.", "Note");
    bind = "loopback";
    customBindHost = undefined;
  }

  if (tailscaleMode === "funnel" && authMode !== "password") {
    await prompter.note("Tailscale funnel requires password auth.", "Note");
    authMode = "password";
  }

  let gatewayToken: string | undefined;
  if (authMode === "token") {
    if (flow === "quickstart") {
      gatewayToken = quickstartGateway.token ?? randomToken();
    } else {
      const tokenInput = await prompter.text({
        message: "Gateway token (blank to generate)",
        placeholder: `Min ${MIN_TOKEN_LENGTH} chars. Leave blank for secure auto-generation.`,
        initialValue: quickstartGateway.token ?? "",
        validate: (value) => {
          if (!value || !value.trim()) return undefined; // Blank is OK (will generate)
          const result = validateToken(value.trim());
          if (!result.valid && result.errors.length > 0) {
            return result.errors[0];
          }
          return undefined;
        },
      });
      const inputToken = String(tokenInput).trim();
      if (inputToken) {
        gatewayToken = inputToken;
        // Warn about weak patterns but allow the token
        const validation = validateToken(inputToken);
        if (validation.warnings.length > 0) {
          await prompter.note(
            [
              "Token security notice:",
              ...validation.warnings.map((w) => `  - ${w}`),
              "",
              "Consider using a stronger token for better security.",
            ].join("\n"),
            "Warning",
          );
        }
      } else {
        gatewayToken = randomToken();
      }
    }
  }

  if (authMode === "password") {
    const password =
      flow === "quickstart" && quickstartGateway.password
        ? quickstartGateway.password
        : await prompter.text({
            message: "Gateway password",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          });
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        auth: {
          ...nextConfig.gateway?.auth,
          mode: "password",
          password: String(password).trim(),
        },
      },
    };
  } else if (authMode === "token") {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        auth: {
          ...nextConfig.gateway?.auth,
          mode: "token",
          token: gatewayToken,
        },
      },
    };
  }

  // Store gateway token in keychain for native app access
  let keychainStorage: KeychainStorageInfo | undefined;
  if (authMode === "token" && gatewayToken) {
    const result = await storeGatewayTokenInKeychain(gatewayToken);
    keychainStorage = {
      stored: result.ok,
      backend: result.backend,
      error: result.error,
    };
  }

  nextConfig = {
    ...nextConfig,
    gateway: {
      ...nextConfig.gateway,
      port,
      bind,
      ...(bind === "custom" && customBindHost ? { customBindHost } : {}),
      tailscale: {
        ...nextConfig.gateway?.tailscale,
        mode: tailscaleMode,
        resetOnExit: tailscaleResetOnExit,
      },
    },
  };

  return {
    nextConfig,
    settings: {
      port,
      bind,
      customBindHost: bind === "custom" ? customBindHost : undefined,
      authMode,
      gatewayToken,
      tailscaleMode,
      tailscaleResetOnExit,
    },
    keychainStorage,
  };
}
