# Backward plan: one evolving product workspace

Status: scoped design, 2026-10-31. Read [PRODUCT_GOAL.md](PRODUCT_GOAL.md) first. This plan does not assert that future capabilities have shipped. The current implementation task and its remaining standard-output/public-consumer findings stay open.

## Start with the user's complete loop

Bring project material -> retain incomplete understanding -> model a Feature's end-to-end process -> inspect its pages/actions/fields/rules -> attach prototype and review feedback -> revise affected work -> preserve the baseline/history -> deliver a readable specification. Reopen at any point and continue without reconstructing context from exported documents or a previous chat.

The canvas is the main interaction space for that loop. Archify's native diagram types express different meanings within it; a PRD profile is one standardized reading of a selected baseline. The reusable unit is the workspace lifecycle, not a private pilot's Service hierarchy or a detached formatter.

## Reuse the foundation, close its actual gaps

| Boundary | Existing implementation to reuse | Current limitation / smallest addition |
| --- | --- | --- |
| Facts and context | `prd-workspace.schema.json`, `prd-model.mjs`: typed objects, containment, relations, source quotes, questions, review flags | Document which objects own facts, which are reading context and which are presentation IDs. Do not add another requirement store or rename existing objects merely to resemble a document. |
| Incomplete intake | Source records, source-backed `extension`, explicit gaps; optional `profile.productDocument` | A minimal research model can already validate/compile without a PRD plan. Supply a supported project-neutral starting/recording path instead of requiring authors to build a complete PRD first. |
| Views | `prd-prepare.mjs`, native renderers, explicit node/lane/target bindings, reader | Bind view navigation and layout to stable model IDs; retain parent and cross-node context. Broad multi-view direct authoring is not yet delivered. |
| Review changes | Feedback Store, `prd-proposal.mjs`, `prd-feedback-cli.mjs`, expected revision/old hash, review history | Current proposal operations replace selected properties or supersede decisions. They are not a general source/node/link/view/asset/profile editing contract. Extend only the next vertical slice's typed operations. |
| Delivery | Standard profile, shared document IR, Service selection/cache/history, public projection, reader/frozen packages | Complete the current approved-public and consumer path. Validate facts/relationships separately from document layout; a checker pass does not validate meaning. |
| Durable use | Versioned source files/assets and create-only compiled/output packets | Browser feedback uses a local journal and explicit JSON transfer. It is not the authoring workspace persistence layer. Establish durable changes before adding direct canvas save controls. |

These are ownership boundaries inside one Archify product, not independent services or a new extraction architecture. Trace existing callers and contracts before adding a layer.

## Decisions to make now

1. **Authority:** keep semantic facts/evidence, authored reviewed summaries/output profiles, native view specifications and transient camera state distinct. Summaries and diagram specifications may need author review; do not claim every view is automatically derived from facts today. All references use stable workspace/object identities.
2. **Process correspondence:** for the bounded editing slice, use the Feature's explicitly selected existing native workflow as the full-process editing entry. Its authored topology must agree with applicable `activity.next` links and numbered step/block mappings. Changes preview and reconcile these representations together, or retain a located review gap; never silently choose a contradictory diagram/table. Do not promise automatic topology derivation today. Preserve old view contracts.
3. **Validation:** integrity of stored research, draft export, formal deliverable validity, development readiness and business confirmation are different judgments. Preserve located gaps and review-needed candidates without weakening ordinary publication or manufacturing approval.
4. **Change:** UI and Agent entry points must ultimately submit the same reviewable typed change set. A change set identifies workspace/base revision, affected IDs, expected old values/hashes, new or changed source versions, explicit operations and reasons/evidence. Preview affected dependencies and stale views/summaries. Apply all authorized operations or none; retain the previous baseline on conflict/error. Reuse existing proposal checks rather than opening arbitrary JSON patch access.
5. **History:** original source versions and prior decisions are retained; append corrected versions and explicit supersession. Business status, technical review and a Git commit are distinct. A capture/save need not be a release or one Git commit per keystroke.
6. **Version context:** use Git for code, authoring baselines, agreed scope, changes and review evidence. Delivery receipts also bind workspace, profile/policy and recipe/resource identities. Keep the existing profile/view-inclusive revision compatibility; distinct new identities need an explicit migration/use case, not a renamed hash. Source/history ancestry protection requires the recorded base, not a cold snapshot alone. A source hash detects change, not truth or authorization. Keep confidential project data in that project's repository.
7. **Generic input:** an Agent interprets supplied materials into the typed workspace, retaining quotes/locators and unknowns. Deterministic components validate and project authored data. New-project instructions and helpers must not depend on a private recipe, domain names, roles, paths or source Skill examples.

## Ordered implementation slices

### A. Finish a generic versioned workspace-to-delivery foundation (current task)

- Freeze the source/view/profile/change ownership and compatibility contracts above. Identify and reuse the existing incomplete-research path.
- Complete the current standard-output implementation: approved client plan/native/image closure, referenced rule scope, stale review handling, consistent reader/download/print, incremental and external-edit protection. Do not spend this stage perfecting one pilot's wording or adding domain rules.
- Provide a supported generic new-project starter and evidence/authoring/iteration workflow. Assess the smallest typed additions needed for appending source/note/question and changing a scoped workflow/field/rule; keep unsupported operations explicit. Do not invent a future CLI as if it exists.
- Exercise two unrelated raw-material corpora plus sparse research through the installed-resource path. Iterate a corpus against its previous baseline, not only against a hand-authored final fixture. Use the real private pilot as supplementary complexity evidence.
- Independently review and release the declared foundation preview, including package/Skill/local deployment and documented remaining capture/editing gaps. Finishing this slice does not complete the final product.

### B. Make one persistent canvas authoring loop work

Use the contracts established in A for a bounded flow: capture an incomplete note/question in project or Feature context; save; refresh/reopen; link it to a workflow/page/rule; preview and apply an Agent/human revision; inspect its source and affected view; create the next baseline; export. Select the smallest existing-native-view edit needed to prove this loop. Include unsaved work, stale revision and conflicting edits. Avoid building every diagram editor or real-time collaboration at once.

### C. Expand the development lifecycle and collaboration

Extend the same identities/change/review path to more view edits, prototype versions, demonstrations, decisions, scoped maturity/approval and downstream development handoff. Scope permissions, concurrent collaboration, connectors and hosting explicitly when implemented. Do not introduce them merely because the eventual product could be independent.

## Acceptance follows the loop

| Scenario | Observable gate |
| --- | --- |
| Different projects | Human/external workflow and unrelated P-only/integration workflow authored from distinct raw briefs/notes/tables; no private project access required. |
| Sparse research | Save/reopen source-backed incomplete content without a standard PRD profile; later classification preserves identity/provenance. Readiness fails for actual gaps. |
| Connected understanding | Trace a Feature through full participant/system process, page/action or system work, fields/rules, exact source and question/decision; native links resolve. |
| Later evidence | Add a source version, revise a branch and field/rule, add a question/image; retained IDs/history, affected review/projections, unchanged reuse and unrelated-project isolation are verified. |
| Conflicts | Stale expected baseline, conflicting edits and invalid multi-object change do not partially publish or overwrite either baseline or recoverable draft. Test only supported operations and state unsupported ones. |
| Client delivery | Approved readable context without internal codes, independent public facts/assets, scoped dependencies, selected-version MD/HTML/PDF/frozen correspondence. |
| New Session | Generic installed instructions and project Git context suffice to resume; no dependence on earlier chat, a disposable author recipe or private pilot. |

Synthetic fixtures establish deterministic behavior on those inputs. Raw-material Agent use, content review and business authority remain separate evidence. Keep initial comparison, source/revision pins, final independent review, declared limitations and cleanup. Follow existing PR/CI/install/deploy gates; no release is accepted by this plan alone.
