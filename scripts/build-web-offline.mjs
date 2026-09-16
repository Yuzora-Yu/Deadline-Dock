import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve("dist-web");
const assets = (await fs.readdir(path.join(root, "assets")))
  .filter((n) => /\.(js|css)$/.test(n))
  .map((n) => "assets/" + n);
const files = ["index.html", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.webmanifest", ...assets];
// Stable artifacts on Windows and Linux, before hashing/caching/exporting.
for (const file of files.filter(file => !file.endsWith('.png'))) {
  const filename = path.join(root, file);
  await fs.writeFile(filename, (await fs.readFile(filename, 'utf8')).replace(/\r\n/g, '\n'));
}
const version = createHash("sha256")
  .update(Buffer.concat(await Promise.all(files.map(f => fs.readFile(path.join(root, f))))))
  .digest("hex")
  .slice(0, 16);
const script = `const CACHE='deadline-dock-web-${version}';
const BASE='/tools/deadline-dock/';
const FILES=${JSON.stringify(files)}.map(f=>BASE+f);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('deadline-dock-web-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match(BASE+'index.html',{ignoreVary:true}))));return;
 }
 if(FILES.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async c=>(await c.match(event.request,{ignoreVary:true}))||fetch(event.request)));
});
`;
await fs.writeFile(path.join(root, "sw.js"), script);
const bytes = (
  await Promise.all(
    [...files, "sw.js"].map(
      async (f) => (await fs.stat(path.join(root, f))).size,
    ),
  )
).reduce((a, b) => a + b, 0);
console.log(
  `Web bundle: ${files.length + 1} files, ${(bytes / 1024).toFixed(1)} KiB uncompressed. No desktop binary or secrets.`,
);
