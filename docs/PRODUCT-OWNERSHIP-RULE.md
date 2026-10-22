# MERAK — NON-NEGOTIABLE PRODUCT OWNERSHIP POLICY

## Rule 0: Merak Is an Independently Engineered Product

**Priority: Highest — Mandatory for all agents and contributors.**

Merak is a fully independent email infrastructure and AI-native communication platform developed and owned by Navin Research.

This is an architectural requirement, not a branding preference.

### 1. Complete Product Ownership

Merak must own and control its complete product architecture, including:

- Mail engine and mail-processing logic.
- Mail transport, delivery and queue management.
- Mailbox storage and synchronization.
- Mail protocols and protocol-facing services.
- Identity, authentication and authorization.
- Backend services and APIs.
- Control plane and infrastructure management.
- Web, desktop and CLI applications.
- AI agents, tools, workflows and automation.
- Data models, schemas and state machines.
- Configuration, monitoring, backup and recovery.
- Product design system and user experience.

No existing third-party mail server, email application, agent platform or commercial product may become Merak's permanent underlying product core.

Generic libraries, operating-system facilities and standards-compliant components may be used only under approved dependency policies. They must not transfer ownership or architectural control of Merak's core to another product.

Merak's essential functionality must not depend on a proprietary service or another mail product's implementation.

### 2. External Software Is Research Material Only

External applications, repositories, engines and platforms may be studied as engineering references.

Permitted research includes:

- Architecture and design principles.
- Protocol semantics.
- Algorithms and state machines.
- Data flow and execution flow.
- Security mechanisms.
- Failure handling and recovery strategies.
- Performance optimization.
- Product workflows.
- Testing approaches.
- UX behavior.

Use REA, static analysis, source inspection, protocol documentation and controlled behavioral experiments where authorized.

The purpose is to understand how problems are solved, not to reproduce another product's implementation.

### 3. Independent Implementation Is Mandatory

The required workflow is:

**Research → Understand → Abstract → Specify → Redesign → Implement Independently → Verify**

Research findings must first be converted into an implementation-neutral behavioral specification.

Merak's architecture and source code must then be independently designed against that specification and applicable open standards.

Do not copy, translate, mechanically rewrite, disguise, vendor or import external application source code.

Do not treat decompiled output or REA-generated pseudocode as source code that may be transplanted into Merak.

Prefer separation between reference analysis and implementation workers for components with licensing or provenance risks.

All new core implementations require appropriate tests and evidence of independent development.

### 4. Merak-Only Product Identity

All official product-facing materials must present Merak as a standalone Navin Research product.

This includes:

- Product website and marketing pages.
- README product overview.
- Public architecture diagrams.
- Product descriptions.
- UI text, screenshots and onboarding.
- Official feature documentation.
- Public API and SDK documentation.
- Product design system.
- Pitch decks and demonstrations.

Do not describe Merak as a wrapper, fork, clone, rebrand, extension or managed interface for another mail product.

Do not expose unrelated upstream product names, branding, logos or borrowed identity in Merak's official product experience.

Research attribution and external-source evidence belong in restricted internal research records, not in product storytelling.

**Legal exception:** Required third-party license notices, copyright notices, SBOM records, provenance and security disclosures must remain accurate and accessible where legally required. Never delete or conceal required attribution.

### 5. No Hidden Core Dependencies

Every architectural component must be classified as:

- Merak-owned implementation.
- Approved generic dependency.
- Development-only tool.
- Research-only reference.
- Temporary migration component.

A temporary external engine is not a completed Merak-owned engine.

Temporary dependencies must have an explicit replacement plan, acceptance criteria and retirement milestone.

Never declare architectural independence while a critical runtime function still relies on an external product core.

### 6. Architecture Authority

Merak's product requirements and independently approved architecture are authoritative.

External reference implementations have no authority over Merak's design.

An agent must not:

- Change the product architecture to match another repository.
- Introduce an external engine as a permanent dependency.
- Import external product source.
- Add infrastructure solely to imitate another product.
- Change official branding or identity.
- Present an unverified implementation as production-ready.

Significant architecture changes require a documented proposal, evidence, trade-off analysis and owner approval.

### 7. Mandatory Documentation

Record this policy in the project's permanent agent instructions.

Ensure product plans, architecture decisions, reference policies and implementation guidance remain consistent with it.

Legacy documents that assume a permanently external mail engine must be reviewed and revised through an explicit architecture decision.

Do not silently erase historical decisions or falsify the current implementation state.

### 8. Verification

Before declaring a milestone complete, verify:

- Ownership of core source and architecture.
- Runtime dependency boundaries.
- License and provenance compliance.
- Product identity consistency.
- Independently implemented functionality.
- Protocol conformance.
- Security and reliability.
- End-to-end executable evidence.

**Final rule:**

Merak may learn from existing software, but Merak must remain its own product in architecture, implementation, operation, identity and future development.

**No borrowed product core. No disguised source reuse. No architectural lock-in. No false ownership claims.**
