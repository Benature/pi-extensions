import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Isolated read-only host adapter. Never imports the MCP client or resolves credentials. */
export type SidebarMcpHost = {
  validate(name: string, value: unknown): unknown;
  namespace(name: string): string;
  projectOverrides: boolean;
  stripBom: boolean;
};

// Verified against native file parsers; unknown formats still fail closed.
const HOST_FORMATS = new Map([
  ["0.99.0", { projectOverrides: false, stripBom: false }],
  ["1.0.0", { projectOverrides: false, stripBom: false }],
  ["1.1.0", { projectOverrides: true, stripBom: false }],
  ["1.3.0", { projectOverrides: true, stripBom: false }],
  ["1.4.0", { projectOverrides: true, stripBom: true }],
]);

export async function loadSidebarMcpHost(packageDir: string, version: string): Promise<SidebarMcpHost | undefined> {
  try {
    const patch = /^1\.0\.(\d+)$/.exec(version);
    const format = HOST_FORMATS.get(version)
      ?? (patch !== null && Number(patch[1]) >= 4 ? { projectOverrides: true, stripBom: false } : undefined);
    if (!format) return undefined;
    const native = await import(pathToFileURL(join(packageDir, "dist/core/mcp-servers.js")).href) as {
      validateMcpServerConfig?: SidebarMcpHost["validate"];
      mcpNamespace?: SidebarMcpHost["namespace"];
    };
    if (typeof native.validateMcpServerConfig !== "function") return undefined;
    const { projectOverrides, stripBom } = format;
    if (projectOverrides && typeof native.mcpNamespace !== "function") return undefined;
    return { validate: native.validateMcpServerConfig,
      namespace: projectOverrides ? native.mcpNamespace! : name => name, projectOverrides, stripBom };
  } catch { return undefined; }
}
