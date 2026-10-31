# Structured PRD authoring profile — implementation contract

Read [PRODUCT_GOAL.md](PRODUCT_GOAL.md) for the integrated canvas-product end state and [INFRASTRUCTURE_GOAL.md](INFRASTRUCTURE_GOAL.md) for cross-project evidence. This profile is the current output slice, not the whole product.

The requested profile turns an authored, source-backed product plan into the fixed eight-section PRD format. This is a new opt-in contract on the existing Product Document v2 machinery; preserve existing schema-v1, role-oriented and v2 behavior. The original detailed graph remains canonical. Markdown is primary; no Markdown reverse synchronization is requested.

## Outcome

Title/author/reviewer/start date; Introduction with Background and 3–6 outcome Objectives; Document control; six-column Feature list; Module H1 and Feature/Sub-module H2. Each chapter contains precisely these H3 sections in order:

1. Description
2. Preconditions
3. Postconditions
4. Role based workflow map
5. Prototype with UI elements & rules
6. Integration points
7. Audit & Security
8. Acceptance Criteria

Feature equals a document Sub-module. Existing editorial grouping may remain model metadata. Common, actually modeled roles/rules belong to General Module rather than repeated claims. A Service packet is a clearly labeled extract of the master document, sharing its profile, data and lineage; it is not a second authoritative PRD. Named primary Markdown and Feature correspondence remain valid.

## Required authoring semantics

- Add a closed, versioned optional standard profile and explicit authored semantic data, reusing v2 objects, groups, review dependencies, selection and public projection. Final property names must be recorded in schema/docs and demonstrated early in an unrelated synthetic example.
- Workflow has numbered native nodes, a Step/Role/Action/System response/Rules/Screen table, and a status list/transition table. Bind steps explicitly to native nodes and actual activities/roles. Preserve branch paths. Every step points to correctly typed S/P blocks and every block is used. External delivery/outcome is not an invented user input screen.
- Screens use explicit interface/variant context, actual buttons/element groups, images/routes only when supplied, seven-column fields (Field/Data type/Required/Default/Rules & validation/Source or integration/Editable when), and buttons/messages. Predicate dependency alone is not a displayed control. Keep distinct bindings and variant behavior. An explicit question-bound missing-screen placeholder is allowed in a draft; it must not masquerade as a real prototype.
- P blocks have Trigger/Input/Processing/Output/Exceptions/Volume & timing/Human checkpoint. Integrations and notifications are explicit references, not invented channels or retry counts.
- BR entries have named IDs, applies-to/inputs/logic/units and rounding/boundaries/worked example. Rules too simple for this need not acquire a fake BR. Unconfirmed/missing formulas and examples remain question-bound gaps; never compute a guessed production policy.
- Complete status models require valid endpoints/reachability/transitions and agreement with the native workflow. An incomplete target model must say so, preserve known/reference concepts without claiming a whitelist, and fail readiness.
- Preconditions are checkable conditions. Postconditions consider success/rejection/cancellation/failure. Audit/access/data integrity have facts or explicit gaps. Acceptance criteria are concrete, traceable observations; preserve rule/process/path coverage or report its exact gap. Never generate vague blanket acceptance to hide missing semantics.
- Document priority/readiness, authors, dates, version and release change notes are authored data, not fabricated. After released v1.0, support release references, per-changed-chapter summary and matching in-chapter callout. Preserve actual Service history prefix; reader/whole exports must not fabricate a Service log they do not receive.
- Match standardized known field types and Yes/No/Conditional; unknown attributes are explicit TBC with a scoped modeled question, not inferred from labels. Draft export remains possible with honest gaps; readiness must not pass them.
- Compact text is reviewed against transitive semantic dependencies. New public profile text/cells/roles/examples/refs are separately authored against allowlisted projected facts; fail closed with no private fallback. Public aliases cannot leak source IDs or private workflow/route/image data.

## Tests and independent acceptance

1. Complete unrelated synthetic multi-participant scenario: success, return and external error; native numbered diagram, steps, S/P blocks and BR; all eight sections and front matter rendered as intended.
2. Fail precisely for missing/reordered/duplicate sections, wrong Feature/Module correspondence, duplicate/orphan/mistyped block and step IDs, foreign or missing activities/roles/page bindings, wrong field scope and stale text. Do not add fragile source-string assertions.
3. State completeness/reachability/branch consistency, formula/example/criterion references and process/path coverage; explicit research gaps remain drafts, not approved implementation.
4. Shared behavior: whole Markdown, Service Markdown, HTML/PDF and frozen-reader package use the same IR; links, main filenames and Feature anchors agree. Old packets and explicit deep links remain supported.
5. Real incremental cold/warm equality/reuse, relevant dependency propagation, unrelated scope isolation, key-order stability, history-prefix preservation and edited-base conflict protection. Bind new modules and the recipe to preparation/cache identities and include them in the packaged Skill.
6. Public adversarial canaries in nested new fields/roles/metadata/examples/changes: no private fallback or leakage. Separate explicit disclosure is required; public stale snapshots bind public facts, not private hashes.
7. The supplied standalone structure checker is an additional external check, not a replacement for native semantic validation or independent content review. Its green result alone does not prove requirement truth or readability.

Codex owns the provided-format intake, real-case authoring outside this repository, independent source/output review and final acceptance. Pi implements application code/tests/rework here using synthetic content only. No private customer content or source Skill examples in the generic tree/package. Reuse native renderers, export IR, public projection, incrementality and reader components. Document any unavoidable compatibility change rather than silently broadening scope.

Use focused relevant checks, inspect generated/package freshness and applicable project test-value/simplification guidance. Record actual evidence, reused revision identities and limitations. No remote push/PR/merge, live installation or deployment is delegated. Use reviewable commits. Acceptance requires a settled successful Pi turn, independently reviewed unchanged full diff, appropriate successful checks and a bridge review matching the final fingerprint.
