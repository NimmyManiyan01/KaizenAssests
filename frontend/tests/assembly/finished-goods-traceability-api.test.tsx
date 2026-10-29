import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { clearAuthSession, storeAuthSession } from "@/lib/auth-utils";

afterEach(() => { vi.unstubAllGlobals(); clearAuthSession(); });

it("reads the exact traceability route with encoded identity, session authorization and no cached response", async () => {
  storeAuthSession({ token: "test-session", username: "operator", roles: ["ASSEMBLY"] }, false);
  const response = { traceability: { overall_status: "PARTIAL" }, consumed_materials: [] };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
  vi.stubGlobal("fetch", fetch);
  expect(await api.getAssemblyFinishedGoodsTraceability("FG|Pump/Valve|LOT:001")).toEqual(response);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toEqual(expect.stringContaining("/api/v1/assembly/finished-goods/FG%7CPump%2FValve%7CLOT%3A001/traceability"));
  expect(options.cache).toBe("no-store");
  expect(options.method ?? "GET").toBe("GET");
  expect(options.headers.get("Authorization")).toBe("Bearer test-session");
  expect(options.headers.get("X-User-Roles")).toBe("ASSEMBLY");
  expect(options.body).toBeUndefined();
});

it.each([401, 403, 404, 500])("preserves HTTP %i for operator-friendly traceability errors", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "failure" }), { status })));
  await expect(api.getAssemblyFinishedGoodsTraceability("fg-a")).rejects.toMatchObject({ status });
});
