// Static placement checks complement the interactive component tests.
// @vitest-environment node
import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { informationHelp, pageHelp, inventoryHelp } from "@/lib/information-help";
const root = path.resolve("src");

it("covers every existing operational page route, including redirect destinations", () => {
  const excluded = new Set(["__root.tsx", "index.tsx", "login.tsx"]);
  for (const file of readdirSync(path.join(root, "routes")).filter((name) => name.endsWith(".tsx") && !excluded.has(name))) {
    const source = readFileSync(path.join(root, "routes", file), "utf8");
    const route = /createFileRoute\("([^"]+)"\)/.exec(source)?.[1];
    expect(route, file).toBeTruthy();
    expect(pageHelp[route!], file).toBeTruthy();
    expect(informationHelp[pageHelp[route!]], file).toBeTruthy();
  }
  expect(Object.keys(inventoryHelp).sort()).toEqual(["dashboard", "inventory", "locations", "picking", "putaway", "requests"]);
}, 20000);

it("keeps information tooltips out of navigation, sidebars and the global header", () => {
  const file = path.join(root, "components/wms/app-shell.tsx");
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  function inspect(node: ts.Node, restricted = false) {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(tree);
      restricted ||= ["aside", "nav", "header"].includes(tag);
      if (restricted && /Tooltip/.test(tag)) violations.push(tag);
      if (restricted && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "title")) violations.push("native title tooltip");
    }
    if (restricted && ts.isJsxSelfClosingElement(node) && /Tooltip/.test(node.tagName.getText(tree))) violations.push(node.tagName.getText(tree));
    ts.forEachChild(node, (child) => inspect(child, restricted));
  }
  inspect(tree);
  expect(violations).toEqual([]);
}, 20000);

it("never nests an information trigger inside a button or link", () => {
  const files = [...readdirSync(path.join(root, "routes")).filter((file) => file.endsWith(".tsx")).map((file) => path.join(root, "routes", file)),
    ...readdirSync(path.join(root, "components/wms")).filter((file) => file.endsWith(".tsx")).map((file) => path.join(root, "components/wms", file))];
  for (const file of files) {
    const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function inspect(node: ts.Node, button = false) {
      if (ts.isJsxElement(node)) button ||= ["Button", "button", "Link", "a"].includes(node.openingElement.tagName.getText(tree));
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "InformationTooltip") expect(button, file).toBe(false);
      ts.forEachChild(node, (child) => inspect(child, button));
    }
    inspect(tree);
  }
}, 20000);
