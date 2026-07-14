import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkJava, javaPathEnvironment } from './java-preflight.mjs';

const require = createRequire(import.meta.url);

function main() {
  let java;
  try {
    java = checkJava();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(
    process.execPath,
    [require.resolve('firebase-tools/lib/bin/firebase.js'), ...process.argv.slice(2)],
    {
      env: javaPathEnvironment(process.env, java.executable),
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  if (result.error) {
    console.error(`Could not start Firebase CLI: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 1;
}

main();
