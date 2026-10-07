import test from 'node:test';
import assert from 'node:assert/strict';
import { recordIncident, markRecovered } from '../src/recovery.js';

test('stops on the third identical blocking error', () => {
  const job={};
  const context={stage:'planning',code:'ASSET_SPATIAL_STRUCTURE_INVALID',details:[{code:'missing_parent'}]};
  const first=recordIncident(job,context);
  const second=recordIncident(job,context);
  const third=recordIncident(job,context);
  assert.equal(first.action,'repair_then_retry');
  assert.equal(second.action,'targeted_replan');
  assert.equal(third.action,'stop');
  assert.equal(third.circuitBreaker,true);
});

test('successful recovery resets consecutive counter', () => {
  const job={};
  const context={stage:'capture',code:'CAPTURE_UNAVAILABLE'};
  const first=recordIncident(job,context);
  markRecovered(job,first);
  const next=recordIncident(job,context);
  assert.equal(next.attempt,1);
});
