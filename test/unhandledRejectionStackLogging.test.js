const test = require('node:test');
const assert = require('node:assert/strict');

test('unhandledRejection logging formats error with full stack trace and preserves prefix', () => {
  let loggedOutput = [];
  const origConsoleError = console.error;
  console.error = (...args) => {
    loggedOutput.push(args.join(' '));
  };

  const logUnhandledRejection = (reason) => {
    console.error('[sattwik] unhandled rejection:', reason instanceof Error ? (reason.stack || reason.message) : reason);
  };

  try {
    // 1. Error with stack trace
    const err = new TypeError('Assignment to constant variable.');
    logUnhandledRejection(err);
    assert.equal(loggedOutput.length, 1);
    assert.ok(loggedOutput[0].startsWith('[sattwik] unhandled rejection: TypeError: Assignment to constant variable.'));
    assert.ok(loggedOutput[0].includes('unhandledRejectionStackLogging.test.js'));

    // 2. Non-Error reason
    loggedOutput = [];
    logUnhandledRejection('plain string error');
    assert.equal(loggedOutput.length, 1);
    assert.equal(loggedOutput[0], '[sattwik] unhandled rejection: plain string error');
  } finally {
    console.error = origConsoleError;
  }
});
