// Inventory table operations: read the drawing's nodes, and apply cell edits to the diagram.
import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { inventoryEntries, type InventoryEntry } from "../../shared/inventory";
import { applyProperties, type PropertyKey } from "../../shared/properties";
import { extractGraph, type SceneEl } from "../../shared/sceneGraph";
import { applyUpdates, type El } from "./agent/sceneOps";
import { commitElements } from "./uiActions";

export function readInventory(api: ExcalidrawImperativeAPI): InventoryEntry[] {
  return inventoryEntries(extractGraph(api.getSceneElements() as unknown as SceneEl[]));
}

/** Rename a node (its label or icon caption). Same path as the MCP `update_elements` label; one undo step. */
export function renameNode(api: ExcalidrawImperativeAPI, id: string, name: string): void {
  const r = applyUpdates([{ id, label: name.trim() || null }], api.getSceneElements() as El[], api.getAppState());
  commitElements(api, r.changed, r.added);
}

/** Set one property on a node ("" removes it). Not undoable: Excalidraw's undo ignores customData. */
export function setNodeProperty(api: ExcalidrawImperativeAPI, id: string, key: PropertyKey, value: string): void {
  const el = api.getSceneElements().find((e) => e.id === id);
  if (!el) return;
  commitElements(api, [newElementWith(el, { customData: applyProperties(el.customData, { [key]: value }) } as never)]);
}

/** Select a node and bring it into view. */
export function revealNode(api: ExcalidrawImperativeAPI, id: string): void {
  const el = api.getSceneElements().find((e) => e.id === id);
  if (!el) return;
  api.updateScene({ appState: { selectedElementIds: { [id]: true } } as never, captureUpdate: "NEVER" as never });
  api.scrollToContent(el, { animate: true });
}
