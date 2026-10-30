# Wavecase

Wavecase is a self-hosted application for sharing unfinished music through private links, collecting feedback, and understanding how recipients listen.

The project is currently in the specification stage. The application has not been implemented.

Read the [product and technical specification](docs/wavecase-specification.md) for the agreed behavior, technology choices, acceptance scenarios, and remaining details.

The planned stack is React with React Compiler, React Router, TypeScript, Node.js, PostgreSQL, Drizzle, SimpleWebAuthn, FFmpeg, wavesurfer.js, and pg-boss. Deployment uses Docker Compose with persistent files and database storage outside container writable layers.

The project is licensed under [GNU AGPL version 3](LICENSE).

The [interface concept](docs/design/wavecase-design.html) can be opened locally in a browser. It contains example data and local preview interactions, without working audio or a backend. Its editable source is [the HTML fragment](docs/design/wavecase-design.fragment.html).

All committed content, including code, comments, documentation, and interface text, is written in English.
