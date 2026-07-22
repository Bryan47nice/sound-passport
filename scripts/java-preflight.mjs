import { spawnSync } from 'node:child_process';
import { posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const JAVA_SETUP_URL = 'https://firebase.google.com/docs/emulator-suite/install_and_configure';

function javaSetupMessage() {
  return `Set JAVA_HOME to a JDK 21+ directory or add java to PATH. ${JAVA_SETUP_URL}`;
}

export function parseJavaMajorVersion(versionOutput) {
  const match = versionOutput.match(/(?:openjdk|java)\s+version\s+"?([^"\s]+)/i);
  if (!match) return undefined;

  const parts = match[1].split(/[._-]/);
  const major = parts[0] === '1' ? parts[1] : parts[0];
  const parsed = Number.parseInt(major, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function javaExecutable(environment, platform) {
  const javaHome = environment.JAVA_HOME?.trim();
  if (!javaHome) return platform === 'win32' ? 'java.exe' : 'java';

  const path = platform === 'win32' ? win32 : posix;
  return path.join(javaHome, 'bin', platform === 'win32' ? 'java.exe' : 'java');
}

export function checkJava({
  environment = process.env,
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  const executable = javaExecutable(environment, platform);
  const result = spawn(executable, ['-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    throw new Error(
      `Java 21+ is required for Firebase Emulator Suite. Could not run ${executable}. ${javaSetupMessage()}`,
    );
  }

  const majorVersion = parseJavaMajorVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (majorVersion === undefined) {
    throw new Error(
      `Java 21+ is required for Firebase Emulator Suite, but its version could not be read from ${executable}. ${javaSetupMessage()}`,
    );
  }

  if (majorVersion < 21) {
    throw new Error(
      `Firebase Emulator Suite requires Java 21 or newer; found Java ${majorVersion} at ${executable}. ${javaSetupMessage()}`,
    );
  }

  return { executable, majorVersion };
}

export function javaPathEnvironment(environment, executable, platform = process.platform) {
  const path = platform === 'win32' ? win32 : posix;
  if (path.dirname(executable) === '.') return { ...environment };

  const existingPath = environment.PATH ?? environment.Path ?? '';
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  const javaBinDirectory = path.dirname(executable);

  return {
    ...environment,
    PATH: [javaBinDirectory, existingPath].filter(Boolean).join(pathDelimiter),
  };
}

function main() {
  try {
    const { executable, majorVersion } = checkJava();
    console.log(`Firebase Emulator Suite Java preflight passed: Java ${majorVersion} at ${executable}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
