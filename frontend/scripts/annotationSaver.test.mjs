import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationSaver } from '../src/components/features/tools/pdf-editor/annotationSaver.ts';

const image = { id: 'photo', type: 'image', content: 'data:image/png;base64,aGVsbG8=', width: 100, height: 80 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('export waits for image persistence and edits during an in-flight autosave', async () => {
  let current = [];
  let stored;
  const calls = [];
  const upload = deferred();
  const save = createAnnotationSaver(() => current, async snapshot => {
    calls.push(snapshot);
    if (calls.length === 1) await upload.promise;
    stored = JSON.parse(JSON.stringify(snapshot));
  });
  const autosave = save();
  current = [image];
  const exportSave = save();
  assert.equal(autosave, exportSave);
  assert.equal(calls.length, 1);
  upload.resolve();
  await exportSave;
  assert.deepEqual(stored, [image]);
  assert.equal(calls.length, 2);
});

test('failed image save rejects export and permits retry without losing content', async () => {
  let fail = true;
  const current = [image];
  let stored;
  const save = createAnnotationSaver(() => current, async snapshot => {
    if (fail) throw new Error('Upload failed');
    stored = snapshot;
  });
  let downloaded = false;
  await assert.rejects(async () => { await save(); downloaded = true; }, /Upload failed/);
  assert.equal(downloaded, false);
  fail = false;
  await save();
  assert.deepEqual(stored, [image]);
});

test('a later save persists image removal (undo) as well as insertion', async () => {
  let current = [image];
  let stored;
  const save = createAnnotationSaver(() => current, async snapshot => { stored = snapshot; });
  await save();
  current = [];
  await save();
  assert.deepEqual(stored, []);
});
