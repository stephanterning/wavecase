import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
type Package = {
  name?: string;
  version?: string;
  license?: string;
  path?: string;
  dependencies?: Record<string, Package>;
};
const tree = JSON.parse(
  execFileSync("npm", ["ls", "--omit=dev", "--all", "--long", "--json"], {
    encoding: "utf8",
  }),
) as Package;
const packages = new Map<
  string,
  { name: string; version: string; license: string }
>();
function collect(dependencies: Record<string, Package>) {
  for (const [name, entry] of Object.entries(dependencies)) {
    if (!entry.version) continue;
    const key = name + "@" + entry.version;
    if (packages.has(key)) continue;
    let license = entry.license;
    try {
      license ||= JSON.parse(
        readFileSync(join(entry.path!, "package.json"), "utf8"),
      ).license;
    } catch {
      /* Missing optional packages remain explicitly unidentified. */
    }
    packages.set(key, {
      name,
      version: entry.version || "unknown",
      license: typeof license === "string" ? license : "See package license",
    });
    collect(entry.dependencies || {});
  }
}
collect(tree.dependencies || {});
writeFileSync(
  "THIRD_PARTY_NOTICES.md",
  "# Third-party notices\n\nWavecase uses the following production npm packages. Their copyright and license texts remain in the installed packages in `node_modules`; consult those texts for the applicable terms. The container also includes Node.js, Debian packages and FFmpeg, with their notices under `/usr/share/doc`. PostgreSQL is provided by its official container image. Optional geolocation data has its own provider license and is not distributed with Wavecase.\n\nGenerated with `npm run notices`.\n\n| Package | Version | License |\n| --- | --- | --- |\n" +
    [...packages.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (p) =>
          `| ${p.name} | ${p.version} | ${p.license.replaceAll("|", "\\|")} |`,
      )
      .join("\n") +
    "\n",
);
