# Navin NGMS - Owned Product and Clean-Room Rule

Status: **binding project rule**

Scope: all Navin source code, packages, applications, contracts, tests, runtime configuration, deployment material, documentation, agent tasks, and release artifacts.

## 1. Ownership

Navin NGMS is our independently authored product.

Every shipped capability must be implemented, owned, tested, operated, and maintained by Navin.

The product core must not be replaced by, derived from, or dependent on another product's core, engine, daemon, storage system, application source, branding, or distinctive user interface.

## 2. Clean-room boundary

External software, repositories, binaries, applications, and services may be studied only as research material.

Research may establish:

- observable behavior;
- protocol and standards compatibility;
- data and state transitions;
- failure modes and recovery behavior;
- security boundaries;
- interoperability requirements;
- test scenarios and acceptance evidence.

Research findings must be reimplemented independently in Navin.

Do not copy, translate, decompile into source, rename, vendor, fork, or mechanically adapt external implementation code into Navin.

Reverse-engineering output is evidence and provenance, not a source-code supply chain.

## 3. Runtime independence

No external product may be required in the Navin product runtime, default deployment, core API, public contract, or mandatory acceptance path.

An external system used as a disposable research fixture must remain isolated from the owned core and must never be presented as Navin functionality.

A research fixture may be used to validate protocol behavior only when the test is clearly marked, local or disposable, and does not make the fixture a product dependency.

## 4. Naming and documentation

Product-facing code, API contracts, UI copy, default configuration, operational commands, release notes, and public product documentation use Navin-owned vocabulary.

Names of external products are permitted only in isolated research, provenance, license, security-audit, or interoperability records where the name is necessary to identify evidence or a compatibility boundary.

Those records must state the source, version or revision when available, license status, studied scope, limitations, and `code_imported: false`.

No external product name may be used to imply ownership, endorsement, implementation origin, or a runtime requirement.

## 5. Dependencies

Language runtimes, operating-system primitives, standards, and generic libraries may be used only when they are necessary, explicitly reviewed, and compatible with the repository license and security policy.

A dependency must not become a substitute for an owned product boundary.

Any new dependency requires a license, maintenance, security, and runtime-necessity review before adoption.

## 6. Existing and future violations

Any existing adapter, integration, fixture, package, script, or deployment path that violates this rule is classified as `RESEARCH_ONLY` until it is isolated, replaced, or removed.

No milestone, release, or completion report may claim that the owned Navin core is complete while a prohibited external core remains on a required runtime path.

When a violation is found:

1. stop the affected product claim;
2. record the exact path and dependency boundary;
3. isolate the material from the product runtime;
4. define an owned replacement and its acceptance checks;
5. verify the replacement independently;
6. remove the prohibited path before release.

## 7. Agent and worker rule

Every agent, worker, reviewer, and automation task inherits this rule.

The coordinating agent must reject a task that proposes copying external code, making a research fixture a product dependency, hiding provenance, or using a third-party name as product identity.

Workers may inspect external material only for the bounded research question assigned to them and must return evidence, limitations, and an independent implementation recommendation.

## 8. Release gate

A change is blocked from integration when any of the following is true:

- product code imports or invokes an unapproved external product core;
- a required runtime path depends on a research fixture;
- external implementation code was copied or mechanically translated;
- public product material presents external work as Navin-owned;
- provenance, license, or dependency evidence is missing;
- the owned implementation lacks executable tests for the claimed behavior.

**Navin ships its own implementation, with evidence that it works.**

## 9. Worker completion, integration, and cleanup

Worker completion messages are reports, not acceptance evidence.

After every worker finishes, the coordinating agent must:

1. inspect the worker's complete diff and changed-file scope;
2. verify the result against the assigned contract and acceptance checks;
3. run the relevant tests, lint, typecheck, build, security, or smoke checks independently;
4. review provenance, dependency, secret, and product-boundary risks;
5. integrate only the reviewed change into the owning branch;
6. rerun the affected checks after integration and record the evidence.

Workers must not be left running or retained without a current purpose.

When a worker is no longer needed, the coordinator must clean up the worker's resources it owns: stop or release the agent, remove temporary panes, remove disposable worktrees and branches after confirming that no unmerged work or required evidence remains, and retain the final report or evidence needed for audit.

User-controlled or owner-inspected workers must not be closed, released, or deleted without explicit confirmation from that owner.

The final coordination report must list retained workers, their current purpose, and the cleanup status of every completed worker.
