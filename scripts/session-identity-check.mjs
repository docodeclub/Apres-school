import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bookingBlockIdentity, cancellationMatchesBlock } from '../src/bookingLab/sessionIdentity.js';

const edward = { label: 'Session 2', start: '16:00', end: '17:00', childId: 'child-a', childName: 'Edward' };
const william = { ...edward, childId: 'child-b', childName: 'William' };
assert.notEqual(bookingBlockIdentity(edward), bookingBlockIdentity(william));
const oldCancellation = { sessionKey: 'session 2|16:00|17:00', blocks: [william] };
assert.equal(cancellationMatchesBlock(oldCancellation, edward), false);
assert.equal(cancellationMatchesBlock(oldCancellation, william), true);
const remaining = [edward, william].filter(block => bookingBlockIdentity(block) !== bookingBlockIdentity(william));
assert.deepEqual(remaining, [edward]);
assert.notEqual(bookingBlockIdentity({ ...edward, start: '15:30' }), bookingBlockIdentity(edward));
assert.equal(cancellationMatchesBlock({ sessionKey: bookingBlockIdentity(edward) }, edward), true);
assert.equal(cancellationMatchesBlock({ sessionKey: oldCancellation.sessionKey }, edward), false);
assert.notEqual(bookingBlockIdentity({ ...edward, childId: undefined }), bookingBlockIdentity({ ...william, childId: undefined }));
console.log('PASS: sibling identities, legacy cancellation history, same-child retry, other sessions and name fallback.');

const source = await readFile(new URL('../src/BookingLab.jsx', import.meta.url), 'utf8');
const policySource = source.match(/function individualSessionCancellationPolicy\([\s\S]*?\n}\n/)[0];
const policy = new Function(`${policySource}; return individualSessionCancellationPolicy;`)();
const start = new Date('2026-09-22T15:00:00Z');
assert.equal(policy(start, 24, new Date('2026-09-21T15:00:00Z')).allowed, true);
assert.equal(policy(start, 24, new Date('2026-09-21T15:00:00.001Z')).allowed, false);
assert.equal(policy(start, 24, new Date('2026-09-22T15:00:00Z')).allowed, false);
assert.equal(policy(null, 24).allowed, false);
console.log('PASS: actual UI policy preserves the 24-hour boundary and blocks late or undated cancellations.');
