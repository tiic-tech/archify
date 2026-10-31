# Product goal: a canvas workspace for product development

## End state

Treat Archify and the requirements-workspace development as one product. Its primary interaction space is an infinite canvas in which a project grows from early research through requirements, workflows, prototypes, feedback, decisions and a confirmed development baseline. People and Agents can record context at any point, connect it to the affected work, inspect its lineage, version changes and produce standardized deliverables.

PRD generation is one product output. A private pilot is one test corpus. Neither an isolated exporter nor one polished document defines success. Future product separation means taking this integrated capability forward as a product; it does not make removal of the Archify renderer or a standalone export kernel an acceptance goal. Reuse the native diagrams, Explainer, navigation, interactions and existing validation.

## Product invariants

1. **One versioned workspace.** Project facts, activities, screens, fields, rules, states and integrations have stable identities. Sources, evidence, questions, assumptions, comments and decisions connect to them through typed relationships. Layout/views and generated documents reference this model; they do not silently become competing authorities for a requirement.
2. **Capture before completeness.** A person can retain a note, source, question or comment while the requirement is incomplete. Research drafts need not fill a publication template to be saved. Classify and connect the capture as understanding improves. Distinguish draft-save validity, export validity, readiness and business confirmation.
3. **Graph, views and density.** Information can be a hierarchy and a network at the same time. Overview nodes explain purpose, status and next decisions; deeper views contain details and evidence. Feature workflows include the actual participants, systems, alternatives and outcomes. Page/action/field/rule granularity evolves with knowledge. Use native diagram types according to meaning; do not reduce every concept to a text card.
4. **Iteration at every level.** Editing a workflow branch, adding a screen, refining a field constraint, attaching a prototype or resolving a question records a change with source and scope. Preserve identity when meaning remains the same. Detect affected dependencies, stale summaries/projections and conflicting edits. Reuse unchanged content/resources without losing history.
5. **Accountable collaboration.** Manual capture and Agent changes use the same workspace identities/revisions and reviewable change contract. A comment is not a confirmed decision; a technical check is not customer approval. Keep source/meeting context and explicit authority where applicable. Public outputs use separately approved context and assets.
6. **Outputs are projections.** Standard Markdown, HTML/PDF, native visual views and frozen sharing packages derive from a selected workspace baseline and presentation profile. Keep provenance and links. Editing an export does not silently rewrite the workspace; reconcile it as an explicit change.
7. **Project neutrality.** Domain concepts, names, roles, materials, policies and locations are project data. The generic product/Skill must work without a private pilot repository, its recipe or business constants. Adapt the interpretation of supplied material to evidence, not guesses.

Implementation sequence and current code boundaries are recorded in [BACKWARD_PLAN.md](BACKWARD_PLAN.md).

## Work backwards to the current development slice

The present slice establishes a reusable workspace-to-delivery foundation, with the supplied PRD standard as its first strict output profile:

- Make canonical objects, relationships, evidence references, draft gaps and scope/version identity explicit. Keep the current model and legacy input compatibility where applicable.
- Bind native workflows and other views to those same objects; preserve step/page/rule correspondence, parent context, stable links and readable information density.
- Finish the shared standard-output path, public disclosure/asset closure, scoped incremental export, source-change review and frozen-reader consistency. Do not introduce a second authoritative requirement store inside a template.
- Ship project-neutral Skill instructions, starter data and supported authoring/change helpers. A new project supplies its own material and configuration, not a bespoke exporter.
- Validate the complete path with unrelated source corpora, sparse research and later changes. The private pilot supplies additional realistic complexity and boundary evidence.

A source-only formatter passing a structure check cannot close this slice. It needs a repeatable new-project workflow, meaningful source/gap checks, native view correspondence, persistent versioned source, reviewable iteration and independently verified outputs.

## Product stages and truthful capability claims

| Stage | Product result | Evidence |
| --- | --- | --- |
| Current foundation | Generic evidence/model/view/change/output contracts and a repeatable versioned PRD delivery path | Cross-project raw-material generation, iteration/reuse/isolation, native reader and exact package/deployment checks |
| Continuous capture and editing | Canvas actions retain notes/questions/decisions, edit/link nodes and submit Agent changes into the durable workspace | Capture -> save -> refresh/reopen -> find -> trace -> revise -> version -> export; stale revisions and conflicts preserve work |
| Collaborative development baseline | Research, prototypes, demonstrations, feedback and confirmed requirements stay connected across participants and releases | Multi-round decisions/prototype changes/approval lineage, permissions and sharing, complete downstream handoff |

Record the actual gaps between the current implementation and each stage. An offline reader with browser-local annotations is useful but does not itself establish a durable editable workspace. A future server, cloud collaboration, connector, deployment or product rename requires its own scoped implementation; do not add those merely to satisfy a hypothetical extraction architecture.

## Acceptance centred on the workspace

- Start from different projects' materials without private-pilot code or settings. Retain locators/quotes and ask precise questions where facts are absent.
- Trace a chosen Feature across its complete workflow, participants, pages/actions, fields/rules, source evidence and decisions; changing one part updates the appropriate views/deliverables or produces a located review gap.
- Iterate a workflow branch, rule/field, question and design asset from an existing baseline. Stable nodes stay stable; changed dependencies propagate, unaffected scope reuses content, and version-log prefixes remain intact.
- Check sparse capture and draft-save independently from formal export/readiness. Incomplete knowledge must remain recordable and visible.
- Verify internal/client boundaries and stale-public contracts, selected-image approval, ordinary and conflicting external edits, old links/input compatibility and exact frozen downloads.
- Independently test native canvas navigation, focused parent/child context, selected-version output correspondence and the generic new-Session workflow. Distinguish what is implemented now from subsequent capture/editing and collaboration stages.

The release remains an independently reviewed foundation preview until its declared stage gates pass. Keep branch/commit/PR context, source and package identities, local deployment/rollback evidence and cleanup. Do not declare the eventual product complete by finishing this development slice.
