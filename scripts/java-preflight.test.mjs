import { describe, expect, it } from 'vitest';
import { checkJava, javaPathEnvironment, parseJavaMajorVersion } from './java-preflight.mjs';

describe('parseJavaMajorVersion', () => {
  it('parses modern and legacy Java version output', () => {
    expect(parseJavaMajorVersion('openjdk version "21.0.11" 2025-10-21')).toBe(21);
    expect(parseJavaMajorVersion('java version "1.8.0_441"')).toBe(8);
  });

  it('returns undefined when the output has no Java version', () => {
    expect(parseJavaMajorVersion('not a Java runtime')).toBeUndefined();
  });
});

describe('checkJava', () => {
  it('prefers JAVA_HOME over PATH and accepts Java 21', () => {
    const calls = [];

    const result = checkJava({
      environment: { JAVA_HOME: 'C:\\portable-jdk' },
      platform: 'win32',
      spawn: (executable, args) => {
        calls.push([executable, args]);
        return { status: 0, stdout: '', stderr: 'openjdk version "21.0.11"' };
      },
    });

    expect(result).toEqual({ executable: 'C:\\portable-jdk\\bin\\java.exe', majorVersion: 21 });
    expect(calls).toEqual([['C:\\portable-jdk\\bin\\java.exe', ['-version']]]);
  });

  it('uses PATH when JAVA_HOME is absent', () => {
    const result = checkJava({
      environment: {},
      platform: 'linux',
      spawn: () => ({ status: 0, stdout: '', stderr: 'openjdk version "22.0.2"' }),
    });

    expect(result).toEqual({ executable: 'java', majorVersion: 22 });
  });

  it('preserves PATH without prepending the current directory for PATH fallback', () => {
    expect(javaPathEnvironment(
      { PATH: '/usr/local/bin:/usr/bin' },
      'java',
      'linux',
    )).toEqual({ PATH: '/usr/local/bin:/usr/bin' });
  });

  it('adds the validated JAVA_HOME bin directory to the Firebase child PATH only', () => {
    expect(javaPathEnvironment(
      { PATH: 'C:\\existing-tools' },
      'C:\\portable-jdk\\bin\\java.exe',
      'win32',
    )).toEqual({ PATH: 'C:\\portable-jdk\\bin;C:\\existing-tools' });
  });

  it('rejects a missing Java executable with setup guidance', () => {
    expect(() => checkJava({
      environment: {},
      platform: 'linux',
      spawn: () => ({ status: null, stdout: '', stderr: '', error: new Error('not found') }),
    })).toThrow(/Set JAVA_HOME.*add java to PATH/i);
  });

  it('rejects Java versions below 21 with setup guidance', () => {
    expect(() => checkJava({
      environment: {},
      platform: 'linux',
      spawn: () => ({ status: 0, stdout: '', stderr: 'openjdk version "17.0.13"' }),
    })).toThrow(/requires Java 21 or newer; found Java 17/i);
  });
});
