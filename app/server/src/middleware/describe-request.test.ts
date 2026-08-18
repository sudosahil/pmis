import { describe, expect, it } from 'vitest';
import { describeRequest } from './describe-request.js';

/**
 * The activity feed is read by an administrator, not by a developer, so every
 * line has to say what someone did in the department's own words.
 */
describe('describeRequest', () => {
  it('names the session events plainly', () => {
    expect(describeRequest('POST', '/api/auth/login')).toBe('Signed in');
    expect(describeRequest('POST', '/api/auth/logout')).toBe('Signed out');
    expect(describeRequest('POST', '/api/auth/change-password')).toBe('Changed their password');
  });

  it('distinguishes browsing a list from opening one record', () => {
    expect(describeRequest('GET', '/api/ra-bills')).toBe('Browsed RA bills');
    expect(describeRequest('GET', '/api/ra-bills/5')).toBe('Opened RA bill 5');
  });

  it('names each step of the bill lifecycle', () => {
    expect(describeRequest('POST', '/api/ra-bills/5/submit')).toBe('Sent RA bill 5 for approval');
    expect(describeRequest('POST', '/api/ra-bills/5/certify')).toBe('Certified RA bill 5');
    expect(describeRequest('PUT', '/api/ra-bills/5/deductions')).toBe(
      'Revised the deductions on RA bill 5',
    );
    expect(describeRequest('POST', '/api/ra-bills/5/payment')).toBe('Recorded payment of RA bill 5');
  });

  it('reads a sub-resource without falling back to the bare path', () => {
    expect(describeRequest('PUT', '/api/approvals/definitions/5/steps')).toBe(
      'Redesigned the steps of approval chain 5',
    );
    expect(describeRequest('GET', '/api/approvals/definitions')).toBe('Viewed the approval chains');
  });

  it('captures the right id when a path carries two', () => {
    expect(describeRequest('DELETE', '/api/chat/3/messages/42')).toBe('Deleted message 42');
    expect(describeRequest('DELETE', '/api/chat/3/members/9')).toBe(
      'Removed a member from conversation 3',
    );
  });

  it('separates a download from opening the file record', () => {
    expect(describeRequest('GET', '/api/documents/1')).toBe('Opened file 1');
    expect(describeRequest('GET', '/api/documents/1/download')).toBe('Downloaded file 1');
  });

  it('handles the wildcard master routes', () => {
    expect(describeRequest('GET', '/api/masters/zones')).toBe('Browsed a master list');
    expect(describeRequest('GET', '/api/masters/zones/options')).toBe('Loaded a dropdown');
    expect(describeRequest('PATCH', '/api/masters/zones/4')).toBe('Edited master record 4');
  });

  it('does not confuse a named route with an id', () => {
    expect(describeRequest('GET', '/api/tenders/my-bids')).toBe('Opened their bids');
    expect(describeRequest('GET', '/api/tenders/7')).toBe('Opened tender 7');
  });

  it('falls back to something readable for an unlisted route', () => {
    expect(describeRequest('GET', '/api/widgets')).toBe('Viewed widgets');
    expect(describeRequest('DELETE', '/api/widgets/9')).toBe('Deleted widgets 9');
    expect(describeRequest('GET', '/api/misc-bills/9/unknown-thing')).toBe('Opened misc bills 9');
  });

  it('never returns an empty description', () => {
    for (const path of ['/api', '/api/', '/']) {
      expect(describeRequest('GET', path).length).toBeGreaterThan(0);
    }
  });
});
