# Architecture diagrams

Two-track during refactor:

- **`current/`** — what the code does **today**. Diagrams reflect actual call graphs, dependency directions, and known violations (drift, leaks, coupling). Update when a refactor lands; never aspirational.
- **`desired/`** — the target architecture we're refactoring **toward**. Diagrams here are not yet true. They define seams, dependency rules, and the engine/game split that the refactor must preserve as it moves.

A diagram in `current/` and one in `desired/` will normally disagree. That gap is the refactor backlog — when they converge for a given subsystem, retire the `current/` diagram for it and promote `desired/` to canonical.

`Design/architecture.md` is human-readable narrative and is independent of these diagrams; keep it pointing at the **desired** end-state once the refactor stabilises.

## Rendering

PlantUML sources are the source of truth (`.puml`). Render with the VS Code PlantUML extension, the official online server, or:

```bash
java -jar plantuml.jar arch/current/*.puml
java -jar plantuml.jar arch/desired/*.puml
```

(Java + plantuml.jar are not currently installed locally; CI is not wired for this. The `.puml` text is meant to be readable on its own.)

## Conventions used in these diagrams

- **Layer direction** (top → bottom is allowed):
  `config → data → engine/sim → systems → ui/render`
  Arrows that go upward are flagged as violations.
- **Engine vs. game** is annotated where the seam matters: an `<<engine>>` stereotype marks a module that should outlive UC Life Sim and ship in any future game; `<<game>>` is UC-specific.
- **Multi-world**: each koota `World` instance is shown separately when the diagram needs to distinguish them (`vonBraun`, `playerShipInterior`, `spaceCampaign`, …).
- **Notes** on violations are tagged `(VIOLATION)` so they're greppable.
