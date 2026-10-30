# Wavecase Agent Instructions

## Project context

Wavecase is a self-hosted music sharing and feedback application. Read [the product and technical specification](docs/wavecase-specification.md) before making product-affecting changes. It defines this project's domain, stack, and requirements and takes precedence over conflicting product-specific guidance in parent directories.

Write all committed content in English.

## Balance value against complexity

A simple, healthy codebase is a project goal in its own right. Completing a task does not justify disproportionate implementation or maintenance complexity.

- Before adding special cases, abstractions, dependencies, or new state, weigh the user benefit against the lasting cost. Consider the issue's likely frequency, severity, and effect on real workflows. Do not assume a case is rare merely because it is inconvenient to handle.
- Prefer the smallest coherent solution that fits the existing design. Simplicity means easy to understand and change, not merely fewer lines of code.
- Reassess when a small feature or fix starts spreading across the codebase or accumulating exceptions. Simplify the approach or recommend a narrower solution instead of continuing just because work has already begun.
- You may leave a rare, low-impact edge case unresolved when handling it would add disproportionate complexity. Briefly state the remaining limitation and why the tradeoff is worthwhile. Do not use this allowance to compromise security, privacy, access control, data integrity, or core user workflows.
- Do not silently drop explicit requirements or describe an unresolved requested fix as completed. If meeting a requirement would impose disproportionate complexity, explain the tradeoff and propose an alternative.
- Keep verification proportional to risk. Test meaningful behavior and important failure modes; avoid speculative infrastructure or tests that merely mirror the implementation.

Use engineering judgment for routine tradeoffs without requesting approval for every minor limitation. Keep this assessment brief; it should prevent overengineering, not become another process to maintain.
