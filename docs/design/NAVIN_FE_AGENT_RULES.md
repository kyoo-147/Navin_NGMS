# Navin FE / UI Agent Rules

Use as mandatory context for Codex, Claude, Qoder or any frontend agent.

1. Start from the user's primary task.
2. One screen should have one primary job.
3. Prefer removing UI over adding UI.
4. Reuse existing components before creating new patterns.
5. Never use gradients.
6. Never use glassmorphism.
7. Never nest cards for visual grouping.
8. Do not add charts unless trend/comparison is needed.
9. Use Lucide only.
10. Use semantic tokens only.
11. Default body text: 14px.
12. Default input/button height: 34–36px.
13. Standard radius: 6–8px.
14. Shadows only for floating layers.
15. Low-frequency actions belong in overflow menus.
16. Always implement empty/loading/error/disabled states.
17. Never hide system activity behind a blank loading state.
18. Dangerous actions require friction.
19. Design for long strings, nulls and large datasets.
20. Mail must remain familiar and dense.
21. Control must remain quiet, intent-first and evidence-first.
22. AI is a capability, not a visual theme.
23. Do not use purple/blue gradients to indicate AI.
24. Do not turn every page into a dashboard.
25. Do not invent copy conventions.
26. Use progressive disclosure for advanced controls.
27. Use border and spacing before card containers.
28. Brand color and status color are separate.
29. Completion must be supported by system evidence.
30. Motion must explain state or transition.
31. Do not use decorative motion.
32. Do not use emoji as product icons.
33. Do not add giant operational illustrations.
34. Do not duplicate business logic in Web/Desktop.
35. Mail and Control share primitives, not information architecture.
36. The UI must remain usable with AI disabled.
37. Optimize for completing the task, not making the screenshot look impressive.

Before implementing a screen, determine:
- primary goal
- minimum required information
- primary action
- what can stay hidden
- empty state
- loading state
- failure states
- dangerous actions
- ugly-data behavior
- whether the screen can be simpler
