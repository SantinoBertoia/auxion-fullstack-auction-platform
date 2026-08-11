const { readdirSync, statSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.join(__dirname, '..');
const requestedRoots = process.argv.slice(2);
const roots = requestedRoots.length > 0 ? requestedRoots : ['test'];

const ignored = new Set(['node_modules', 'coverage']);

const collectTestFiles = (targetPath) => {
  const fullPath = path.resolve(backendRoot, targetPath);
  const stat = statSync(fullPath, { throwIfNoEntry: false });
  if (!stat) {
    return [];
  }

  if (stat.isFile()) {
    return fullPath.endsWith('.test.js') ? [fullPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(fullPath)) {
    if (ignored.has(entry)) continue;
    const childPath = path.join(fullPath, entry);
    const childStat = statSync(childPath);
    if (childStat.isDirectory()) {
      files.push(...collectTestFiles(path.relative(backendRoot, childPath)));
    } else if (entry.endsWith('.test.js')) {
      files.push(childPath);
    }
  }

  return files;
};

const files = [...new Set(roots.flatMap(collectTestFiles))].sort();

if (files.length === 0) {
  console.error(`No test files found under: ${roots.join(', ')}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: backendRoot,
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
