const { execSync } = require('child_process');

exports.default = async function (context) {
  const appPath = context.appOutDir;
  // Remove resource forks and extended attributes that break codesign
  execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
  execSync(`dot_clean "${appPath}"`, { stdio: 'inherit' });
};
