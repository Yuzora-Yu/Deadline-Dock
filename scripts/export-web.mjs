import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
// Only the explicitly named generated-app directory is updated. Source stays here.
const destination = path.resolve(process.argv[2] || "");
if (
  !process.argv[2] ||
  path.basename(destination) !== "deadline-dock" ||
  path.basename(path.dirname(destination)) !== "apps"
)
  throw new Error("Specify <portal>/site/apps/deadline-dock");
const source = path.resolve("dist-web");
async function inventory(dir, prefix = "") {
  const result = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory())
      result.push(...(await inventory(path.join(dir, item.name), name + "/")));
    else result.push(name);
  }
  return result.sort();
}
const names = await inventory(source);
if (
  names.some(
    (n) =>
      !/^(index\.html|icon\.svg|icon-(192|512)\.png|apple-touch-icon\.png|manifest\.webmanifest|sw\.js|assets\/[\w-]+\.(js|css))$/.test(
        n,
      ),
  )
)
  throw new Error("Unexpected file in web bundle");
const previous = await fs
  .readFile(path.join(destination, "build-manifest.json"), "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
if (previous) {
  for (const name of Object.keys(previous.files)) {
    if (
      !/^(index\.html|icon\.svg|icon-(192|512)\.png|apple-touch-icon\.png|manifest\.webmanifest|sw\.js|assets\/[\w-]+\.(js|css))$/.test(
        name,
      )
    )
      throw new Error("Invalid previous artifact path");
    if (!names.includes(name))
      await fs.unlink(path.join(destination, name)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
}
const hashes = {};
for (const name of names) {
  const data = await fs.readFile(path.join(source, name));
  hashes[name] = createHash("sha256").update(data).digest("hex");
  await fs.mkdir(path.dirname(path.join(destination, name)), {
    recursive: true,
  });
  await fs.writeFile(path.join(destination, name), data);
}
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await fs.writeFile(
  path.join(destination, "build-manifest.json"),
  JSON.stringify(
    {
      source: "https://github.com/Yuzora-Yu/Deadline-Dock",
      commit,
      files: hashes,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Exported ${names.length} runtime files to ${destination}`);
