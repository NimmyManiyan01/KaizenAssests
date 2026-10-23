import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { ConfigEnv, PluginOption, Plugin, UserConfig } from "vite";

const makeConfig = (defineConfig as any)({
  server: {
    port: 8080,
    strictPort: true,
    host: "0.0.0.0",
  },
  resolve: {
    tsconfigPaths: true,
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});

export default async (env: ConfigEnv): Promise<UserConfig> => {
  const config: UserConfig = await makeConfig(env);
  async function adapt(option: PluginOption): Promise<PluginOption> {
    const plugin = await option;
    if (Array.isArray(plugin)) return Promise.all(plugin.map(adapt));
    if (!plugin || plugin.name !== "@tanstack/devtools:inject-source" || !("transform" in plugin))
      return plugin;
    // The source inspector emits DOM data-* attributes; R3F host objects are
    // not DOM nodes. Keep source inspection everywhere outside the 3D renderer.
    const original = plugin.transform;
    if (!original) return plugin;
    const handler = typeof original === "function" ? original : original.handler;
    const wrapped: Plugin["transform"] = function (code, id, options) {
      if (id.replaceAll("\\", "/").includes("/src/components/journey/")) return null;
      return handler.call(this, code, id, options);
    };
    plugin.transform = typeof original === "function" ? wrapped : { ...original, handler: wrapped };
    return plugin;
  }
  config.plugins = await Promise.all((config.plugins ?? []).map(adapt));
  return config;
};
