// Recipes: step-by-step instructions for Claude. The MCP server offers TIDY_RECIPE as the
// `tidy_diagram` prompt (/mcp__mydraw__tidy_diagram) and the app's "Tidy with Claude" (Phase 10,
// shared/askClaude.ts) runs the same text through `claude -p`.

export const TIDY_RECIPE = (target: string, focus: string, keep: boolean) =>
  [
    `Tidy the mydraw drawing ${target} so it reads clearly${focus}. Work with the mydraw MCP tools.`,
    "",
    "1. Look first: list_drawings, then get_scene (ids, zones, arrows, kinds, properties) and screenshot. Say in one or two sentences what the diagram shows and what makes it hard to read.",
    "1b. If the diagram was built with build_diagram (get_diagram_spec returns its spec) and its structure is the problem (wrong nesting, nodes in the wrong zone, a grid that would read better transposed, too many arrows), fix the SPEC and rebuild it with build_diagram {replace: <diagram id>} instead of moving elements one by one; then continue with step 5. Mention it in the report (hand edits made after the build are rebuilt from the spec).",
    "2. Understand the roles: entry points (users, internet, DNS, load balancers), the main path, services, data stores (databases, queues, storage), management/monitoring, external systems. Note which nodes are peers (web-1, web-2...) and which zones hold what.",
    keep
      ? "3. Keep the user's arrangement: do NOT run auto_layout on the whole drawing. Start with `tidy` (small moves only), then fix specific problems by hand."
      : "3. Decide the flow: entry points at the start (top or left), data stores at the end, management off to the side. If the arrangement is far from that or messy, run auto_layout (with onlyIfBetter: true first; with a direction if the flow is clear); otherwise start with `tidy`.",
    "4. Refine by meaning, which the automatic layout can't know: peers in a row with align + distribute (equal gaps), related nodes next to each other, a node into the zone it belongs to (update_elements or move, then tidy), labels only on short arrows, one arrow to a zone instead of many to its nodes, arrows `routing: \"elbow\"` or `route_around` where they cut through shapes.",
    "5. Check: lint_diagram (fix: true for the safe fixes), then screenshot again. Repeat 4-5 at most twice; stop when lint has no warnings and the screenshot reads cleanly.",
    "6. Never delete nodes, rename labels, or change colours or properties unless the user asked; only move, align, resize zones and re-route (or rebuild from the unchanged-in-meaning spec, step 1b). Never edit arrow points or positions with raw elements: use move, tidy, align, distribute and route_around, which keep arrows bound and step badges on their arrows. Each tool call is one undo step, so the user can step back.",
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
  "- Zones: give each zone a `kind` (cloud, region, vpc, az, subnet-public, subnet-private, cluster, namespace, network, dmz, onprem, trust, tier, group) instead of colours; zones of the same kind look the same, and zones without a kind stay neutral grey. Never colour zones in turn. Subnets per availability zone: use build_diagram `grid` (rows = tiers, columns = AZs) so rows and columns line up.",
  "- Model the real topology, not a summary: one node per AZ instance when Multi-AZ matters, one node per Deployment (replicas in the subtitle) in Kubernetes; show the boundaries the user cares about.",
  "- Structure: a title (and a subtitle line) on top, consistent node sizes per row, a compact legend (arrow kinds and roles; captioned icons need no legend row) when there are two or more kinds or roles, enough white space. For a flow the user wants to follow, number it (edge `step` + `steps`); for several flows use `views` (one page each).",
  "- Change a built diagram by its spec: get_diagram_spec, edit, build_diagram {replace}. Small nudges with move / align / tidy are fine; never move arrows or badges with raw elements.",
  "- Check your work before you finish (screenshot, then lint_diagram) and fix what fails, at most twice:",
  "  1. No text is cut off (title, zone titles, captions, legend).",
  "  2. The legend has at most about 8 rows and sits under the diagram, not beside it.",
  "  3. Zone colours mean something (kinds), with at most about 4 zone hues.",
  "  4. No arrow loops around the diagram or crosses a zone that holds neither end; no arrows on top of each other.",
  "  5. Labels only on short arrows; long arrows carry a kind (legend) instead.",
  "  6. Nothing important is tiny or crammed, and there is no large empty area.",
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
