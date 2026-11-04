import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretStore, StoreError } from '../../dist/index.js';
import { cleanupTmpConfigDir, createTmpConfigDir, runCli } from './helpers.js';
import { cleanupStoreWorkers, launchStoreWorker, runStoreWorker } from './store-process.js';

let root: string;
let configDir: string;
beforeEach(() => {
  root = createTmpConfigDir();
  configDir = path.join(root, 'store');
});
afterEach(async () => {
  await cleanupStoreWorkers();
  cleanupTmpConfigDir(root);
});
async function waitFor(file: string) {
  const deadline = performance.now() + 10000;
  while (!fs.existsSync(file)) {
    if (performance.now() > deadline) throw new Error(`Barrier timed out: ${file}`);
    await delay(10);
  }
}
function snapshot() {
  return ['master.key', 'secrets.json', 'master.key.bak'].map((file) => {
    const target = path.join(configDir, file);
    return fs.existsSync(target) ? fs.readFileSync(target) : undefined;
  });
}
async function parallel(operations: unknown[][][]) {
  const workers = operations.map((ops) => launchStoreWorker({ configDir, operations: ops, delayRead: 20 }));
  await Promise.all(workers.map((worker) => worker.ready));
  for (const worker of workers) worker.start();
  return Promise.all(workers.map((worker) => worker.done));
}

describe('independent processes sharing a store', () => {
  it.each([false, true])('preserves all 16 writers (existing key: %s)', async (seeded) => {
    if (seeded) new SecretStore({ configDir }).set('seed', 'seed-dummy');
    const results = await parallel(Array.from({ length: 16 }, (_, index) => [
      ['set', `key-${index}`, `global-dummy-${index}`],
      ['set', `key-${index}`, `work-dummy-${index}`, { namespace: 'work' }],
    ]));
    expect(results.map((result) => [result.code, result.error, result.stderr]))
      .toEqual(Array.from({ length: 16 }, () => [0, undefined, '']));
    const reader = new SecretStore({ configDir });
    expect(reader.list()).toHaveLength(16 + Number(seeded));
    expect(reader.list({ namespace: 'work' })).toHaveLength(16);
    if (seeded) expect(reader.get('seed')).toBe('seed-dummy');
    for (let index = 0; index < 16; index++) {
      expect(reader.get(`key-${index}`)).toBe(`global-dummy-${index}`);
      expect(reader.get(`key-${index}`, { namespace: 'work' })).toBe(`work-dummy-${index}`);
    }
    expect(fs.readdirSync(configDir).sort()).toEqual(['master.key', 'secrets.json']);
  });

  it.each(['delete', 'deleteNamespace'])('serializes %s with a writer without resurrecting deleted values', async (method) => {
    const store = new SecretStore({ configDir });
    store.set('seed', 'seed-dummy');
    store.set('removed', 'removed-dummy', { namespace: 'work' });
    const gate = path.join(root, 'delete');
    const remover = launchStoreWorker({
      configDir, gate, pauseAt: 'read',
      operations: method === 'delete' ? [['delete', 'removed', { namespace: 'work' }]] : [['deleteNamespace', 'work']],
    });
    await remover.ready;
    remover.start();
    await waitFor(`${gate}.held`);
    const writerGate = path.join(root, 'writer');
    const writer = launchStoreWorker({ configDir, gate: writerGate, operations: [['set', 'added', 'added-dummy', { namespace: 'work' }]] });
    await writer.ready;
    writer.start();
    await waitFor(`${writerGate}.contended`);
    fs.writeFileSync(`${gate}.release`, 'release');
    expect((await remover.done).results).toEqual([true]);
    expect((await writer.done).code).toBe(0);
    const reader = new SecretStore({ configDir });
    expect(reader.tryGet('removed', { namespace: 'work' })).toBeUndefined();
    expect(reader.get('added', { namespace: 'work' })).toBe('added-dummy');
    expect(reader.get('seed')).toBe('seed-dummy');
  });

  it.each(['key', 'data', 'cleanup'])('blocks readers and long-lived writers throughout rotation at %s', async (stage) => {
    new SecretStore({ configDir }).set('seed', 'seed-dummy');
    const writerGate = path.join(root, 'writer');
    const writer = launchStoreWorker({ configDir, gate: writerGate, warm: true, operations: [
      ['get', 'seed'], ['tryGet', 'seed'], ['set', 'added', 'added-dummy'], ['rotateMasterKey'],
    ] });
    await writer.ready;
    const gate = path.join(root, stage);
    const rotator = launchStoreWorker({ configDir, gate, pauseAt: stage, operations: [['rotateMasterKey']] });
    await rotator.ready;
    rotator.start();
    await waitFor(`${gate}.held`);
    writer.start();
    await waitFor(`${writerGate}.contended`);
    fs.writeFileSync(`${gate}.release`, 'release');
    expect((await rotator.done).results).toEqual([1]);
    const result = await writer.done;
    expect(result.code).toBe(0);
    expect(result.results).toEqual(['seed-dummy', 'seed-dummy', null, 2]);
    const reader = new SecretStore({ configDir });
    expect(reader.get('seed')).toBe('seed-dummy');
    expect(reader.get('added')).toBe('added-dummy');
  });

  it('serializes multiple simultaneous rotations and independent writes', async () => {
    new SecretStore({ configDir }).set('seed', 'seed-dummy');
    const results = await parallel(Array.from({ length: 8 }, (_, index) => [
      ['rotateMasterKey'], ['set', `new-${index}`, `dummy-${index}`], ['get', 'seed'],
    ]));
    for (const result of results) {
      expect(result.code).toBe(0);
      expect(result.results![2]).toBe('seed-dummy');
    }
    const reader = new SecretStore({ configDir });
    for (let index = 0; index < 8; index++) expect(reader.get(`new-${index}`)).toBe(`dummy-${index}`);
    expect(fs.readdirSync(configDir).sort()).toEqual(['master.key', 'secrets.json']);
  });

  it('shares the lock across relative, absolute and symlink paths while another store stays independent', async () => {
    new SecretStore({ configDir }).set('seed', 'seed-dummy');
    const alias = path.join(root, 'alias');
    fs.symlinkSync(configDir, alias);
    const gate = path.join(root, 'owner');
    const owner = launchStoreWorker({ configDir, gate, holdLock: true, pauseAt: 'lock' });
    await owner.ready;
    owner.start();
    await waitFor(`${gate}.held`);
    const workers = [alias, path.relative(process.cwd(), configDir)].map((dir, index) =>
      launchStoreWorker({ configDir: dir, gate: path.join(root, `alias-${index}`), operations: [['set', `alias-${index}`, 'alias-dummy']] }));
    await Promise.all(workers.map((worker) => worker.ready));
    for (const worker of workers) worker.start();
    await Promise.all(workers.map((_, index) => waitFor(path.join(root, `alias-${index}.contended`))));
    expect((await runStoreWorker({ configDir: path.join(root, 'independent'), operations: [['set', 'key', 'dummy']] })).code).toBe(0);
    fs.writeFileSync(`${gate}.release`, 'release');
    expect((await owner.done).code).toBe(0);
    for (const worker of workers) expect((await worker.done).code).toBe(0);
    expect(new SecretStore({ configDir }).list().sort()).toEqual(['alias-0', 'alias-1', 'seed']);
  });

  it('does not steal a SIGKILLed owner lock and fails within the default deadline without changing files', async () => {
    new SecretStore({ configDir }).set('seed', 'seed-dummy');
    const before = snapshot();
    const gate = path.join(root, 'killed');
    const owner = launchStoreWorker({ configDir, gate, holdLock: true, pauseAt: 'lock' });
    await owner.ready;
    owner.start();
    await waitFor(`${gate}.held`);
    owner.child.kill('SIGKILL');
    expect((await owner.done).signal).toBe('SIGKILL');
    const started = performance.now();
    const result = await runStoreWorker({ configDir, operations: [['set', 'lost', 'dummy']] });
    expect(result.code).toBe(1);
    expect(result.error?.name).toBe('StoreError');
    expect(result.error?.message).toMatch(/Timed out.*\.lsec\.lock/);
    expect(performance.now() - started).toBeLessThan(12000);
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(path.join(configDir, '.lsec.lock'))).toBe(true);
  });

  it.each(['key', 'data', 'cleanup'])('preserves recovery after SIGKILL during rotation at %s', async (stage) => {
    const store = new SecretStore({ configDir });
    store.set('seed', 'seed-dummy');
    store.set('token', 'work-dummy', { namespace: 'work' });
    const oldKey = snapshot()[0]!;
    const gate = path.join(root, 'crash');
    const worker = launchStoreWorker({ configDir, gate, pauseAt: stage, operations: [['rotateMasterKey']] });
    await worker.ready;
    worker.start();
    await waitFor(`${gate}.held`);
    worker.child.kill('SIGKILL');
    expect((await worker.done).signal).toBe('SIGKILL');
    const crashed = snapshot();
    expect(crashed[2]).toEqual(oldKey);
    // All owners are stopped. Verify a separate copy before clearing the live lock.
    const copy = path.join(root, 'verification');
    fs.mkdirSync(copy, { mode: 0o700 });
    fs.writeFileSync(path.join(copy, 'master.key'), stage === 'data' ? crashed[2]! : crashed[0]!, { mode: 0o600 });
    fs.writeFileSync(path.join(copy, 'secrets.json'), crashed[1]!, { mode: 0o600 });
    const verified = new SecretStore({ configDir: copy });
    expect(verified.get('seed')).toBe('seed-dummy');
    expect(verified.get('token', { namespace: 'work' })).toBe('work-dummy');
    fs.rmdirSync(path.join(configDir, '.lsec.lock'));
    for (const update of [() => store.set('new', 'dummy'), () => store.delete('seed'), () => store.deleteNamespace('work'), () => store.rotateMasterKey()]) {
      expect(update).toThrow(StoreError);
      expect(snapshot()).toEqual(crashed);
    }
    if (stage === 'data') fs.copyFileSync(path.join(copy, 'master.key'), path.join(configDir, 'master.key'));
    expect(store.get('seed')).toBe('seed-dummy');
    expect(store.get('token', { namespace: 'work' })).toBe('work-dummy');
    fs.unlinkSync(path.join(configDir, 'master.key.bak'));
    store.set('recovered', 'recovered-dummy');
    expect(new SecretStore({ configDir }).get('recovered')).toBe('recovered-dummy');
  });

  it('keeps all simultaneous CLI writes in the selected Node or Bun executable', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      runCli(['set', `cli-${index}`, ...(index % 2 ? ['--ns', 'work'] : []), '--stdin'], configDir, `cli-dummy-${index}`)));
    expect(results.map((result) => result.exitCode)).toEqual(Array(16).fill(0));
    const reader = new SecretStore({ configDir });
    for (let index = 0; index < 16; index++) {
      expect(reader.get(`cli-${index}`, { namespace: index % 2 ? 'work' : undefined })).toBe(`cli-dummy-${index}`);
    }
  });
});
