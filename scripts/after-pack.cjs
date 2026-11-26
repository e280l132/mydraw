// electron-builder afterPack hook: the shell wrapper must stay executable (extraResources copies
// keep the mode on most setups; make sure).
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const wrapper = path.join(app, "Contents", "Resources", "bin", "mydraw");
  if (fs.existsSync(wrapper)) fs.chmodSync(wrapper, 0o755);
};
