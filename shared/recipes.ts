// Recipes: step-by-step instructions for Claude. The MCP server offers TIDY_RECIPE as the
// `tidy_diagram` prompt (/mcp__mydraw__tidy_diagram) and the app's "Tidy with Claude" (Phase 10,
// shared/askClaude.ts) runs the same text through `claude -p`.

export const TIDY_RECIPE = (target: string, focus: string, keep: boolean) =>
  [
    `Tidy the mydraw drawing ${target} so it reads clearly${focus}. Work with the mydraw MCP tools.`,
    "",
    "1. Look first: list_drawings, then get_scene (ids, zones, arrows, kinds, properties) and screenshot. Say in one or two sentences what the diagram shows and what makes it hard to read.",
    "2. Understand the roles: entry points (users, internet, DNS, load balancers), the main path, services, data stores (databases, queues, storage), management/monitoring, external systems. Note which nodes are peers (web-1, web-2...) and which zones hold what.",
    keep
      ? "3. Keep the user's arrangement: do NOT run auto_layout on the whole drawing. Start with `tidy` (small moves only), then fix specific problems by hand."
      : "3. Decide the flow: entry points at the start (top or left), data stores at the end, management off to the side. If the arrangement is far from that or messy, run auto_layout (with onlyIfBetter: true first; with a direction if the flow is clear); otherwise start with `tidy`.",
    "4. Refine by meaning, which the automatic layout can't know: peers in a row with align + distribute (equal gaps), related nodes next to each other, a node into the zone it belongs to (update_elements or move, then tidy), labels only on short arrows, one arrow to a zone instead of many to its nodes, arrows `routing: \"elbow\"` or `route_around` where they cut through shapes.",
    "5. Check: lint_diagram (fix: true for the safe fixes), then screenshot again. Repeat 4-5 at most twice; stop when lint has no warnings and the screenshot reads cleanly.",
    "6. Never delete nodes, rename labels, or change colours or properties unless the user asked; only move, align, resize zones and re-route. Each tool call is one undo step, so the user can step back.",
    "7. Finish with zoom_to_fit and a short report: what you changed and why, the lint result, and anything only the user can decide (e.g. a diagram with too many arrows to split).",
  ].join("\n");

/**
 * How a good mydraw diagram looks. Claude follows it in the Ask Claude box (shared/askClaude.ts),
 * in Polish (POLISH_RECIPE) and the MCP's polish_diagram prompt. build_diagram's default "polished"
 * look already applies the colour/stroke/shadow rules (shared/nodeRoles.ts has the same role hues).
 */
export const DESIGN_GUIDE = [
  "Design guide for mydraw diagrams (follow it unless the user asks for something else):",
  "- Colour by role, one hue per role: a pale tint as fill (shade 50) and a deeper shade of the same hue as stroke (shade 700). Roles and hues: entry/users blue, network/edge (load balancers, gateways, DNS, routers) violet, compute (servers, VMs, containers) teal, services sky, data stores (databases, caches) green, queues/streams orange, storage (buckets, NAS) emerald, security (firewall, auth, vault) red, monitoring/management slate, external systems gray with a dashed border. Colour names like \"green-50\" / \"green-700\" work everywhere. At most about 6 hues; text stays dark. Icons keep their own colours.",
  "- Strokes: nodes strokeWidth 2, the few most important nodes 3 (emphasis primary), zones 1-1.5. Rounded corners on rectangles.",
  "- Fills: solid tints on shapes, zones paler than the nodes inside them. A gradient only for one or two highlight nodes, never everywhere. No hachure in the clean look.",
  "- Shadows: shadow \"soft\" on nodes (\"lifted\" on primary ones); none on zones, arrows, text or the legend.",
  "- Arrows: elbow routing; the main request/data path weight primary (about 3.5 px) in one strong colour; normal arrows 2 px; management, async or optional paths secondary (thin, dashed or faded). One kind per relationship (Traffic, Replication, Async, Management), each with its own colour and dash, so arrows of a kind look the same; labels only on short arrows.",
  "- Structure: a title (and a subtitle line) on top, consistent node sizes per row, a legend when there are two or more kinds or roles, enough white space.",
  "- Check your work: screenshot, compare it with this guide, fix what is off, run lint_diagram.",
].join("\n");

/** Restyle an existing drawing to the design guide without moving anything (the "Polish" button, MCP polish_diagram). */
export const POLISH_RECIPE = (target: string, focus: string) =>
  [
    `Polish the look of the mydraw drawing ${target}${focus}: make it clear and good-looking, following the design guide below. Work with the mydraw MCP tools.`,
    "",
    DESIGN_GUIDE,
    "",
    "1. Look first: get_scene (ids, types, colours, kinds, zones) and screenshot. Say in one sentence what the diagram shows and what makes it look plain or messy.",
    "2. Give every node a role (entry, edge, compute, service, data, queue, storage, security, monitoring, external) from its label, icon and connections; find the main path and the kinds of arrows.",
    "3. Restyle in a few batched calls (each call is one undo step): update_elements with strokeColor, backgroundColor, fillStyle solid, strokeWidth, roundness and shadow per node (one call for all nodes); zones: paler tints, no shadow; arrows: strokeColor, strokeWidth and strokeStyle per kind, main path thicker. copy_look can repeat one finished node's look onto its peers. Icon nodes: leave the icon colours, add a soft shadow; recolor only monochrome icons that clash.",
    "4. If there is no legend and there are two or more roles or arrow kinds, add_legend. If there is no title, don't invent one unless the drawing clearly needs it.",
    "5. Do NOT move, resize, rename, delete or re-route anything: that is Tidy's job. Don't change label text or properties.",
    "6. Check: screenshot again, compare with the guide, fix what is off (at most twice), lint_diagram (fix: true only for colour snaps). Finish with zoom_to_fit and 1-3 sentences: what you changed.",
  ].join("\n");
