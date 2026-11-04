import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { SecretStore } from '../../dist/index.js';
import { withStoreLock } from '../../dist/store-lock.js';

const job = JSON.parse(process.argv[2]);
const store = new SecretStore({ configDir: job.configDir });
if (job.warm) store.get('seed');
const sleep = new Int32Array(new SharedArrayBuffer(4));
function checkpoint(stage) {
  if (job.pauseAt === stage) {
    fs.writeFileSync(`${job.gate}.held`, 'held');
    const deadline = performance.now() + 15000;
    while (!fs.existsSync(`${job.gate}.release`)) {
      if (performance.now() > deadline) throw new Error('test barrier timed out');
      Atomics.wait(sleep, 0, 0, 10);
    }
  }
  if (job.failAt === stage) throw new Error(`injected ${stage} failure`);
}
const read = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  const result = read.call(this, file, ...args);
  if (file === path.join(job.configDir, 'secrets.json')) {
    checkpoint('read');
    if (job.delayRead) Atomics.wait(sleep, 0, 0, job.delayRead);
  }
  return result;
};
const rename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (to === path.join(job.configDir, 'master.key')) checkpoint('key');
  if (to === path.join(job.configDir, 'secrets.json')) checkpoint('data');
  return rename.call(this, from, to);
};
const unlink = fs.unlinkSync;
fs.unlinkSync = function (file) {
  if (file === path.join(job.configDir, 'master.key.bak')) checkpoint('cleanup');
  return unlink.call(this, file);
};
const mkdir = fs.mkdirSync;
fs.mkdirSync = function (file, ...args) {
  try {
    return mkdir.call(this, file, ...args);
  } catch (error) {
    if (file === path.join(job.configDir, '.lsec.lock') && error.code === 'EEXIST' && job.gate) {
      fs.writeFileSync(`${job.gate}.contended`, 'contended');
    }
    throw error;
  }
};
syncBuiltinESMExports();

process.once('message', () => {
  try {
    const results = job.holdLock
      ? withStoreLock(job.configDir, () => checkpoint('lock'))
      : job.operations.map(([method, ...args]) => store[method](...args) ?? null);
    process.send({ results }, () => process.disconnect());
  } catch (error) {
    process.send({ error: { name: error.name, message: error.message } }, () => {
      process.exitCode = 1;
      process.disconnect();
    });
  }
});
process.send('ready');
