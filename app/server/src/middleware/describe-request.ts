/**
 * Turns a method and an API path into a line an administrator can read without
 * knowing what REST is: "Certified RA bill 5", not "POST /api/ra-bills/5/certify".
 *
 * Kept separate from the middleware so it can be tested on its own.
 */

/**
 * `:id` matches one numeric segment and is captured; `*` matches any one
 * segment and is not, so `$1` always refers to the first id in the path.
 */
interface Rule {
  method: string | '*';
  pattern: string;
  /** `$1`, `$2` … are the captured segments, in order. */
  phrase: string;
}

const RULES: Rule[] = [
  // Session
  { method: 'POST', pattern: 'auth/login', phrase: 'Signed in' },
  { method: 'POST', pattern: 'auth/logout', phrase: 'Signed out' },
  { method: 'POST', pattern: 'auth/refresh', phrase: 'Refreshed their session' },
  { method: 'POST', pattern: 'auth/change-password', phrase: 'Changed their password' },
  { method: '*', pattern: 'auth/me', phrase: 'Loaded their profile' },
  { method: '*', pattern: 'auth/roles', phrase: 'Listed the roles' },

  // Works
  { method: 'GET', pattern: 'projects', phrase: 'Browsed projects' },
  { method: 'POST', pattern: 'projects', phrase: 'Created a project' },
  { method: 'GET', pattern: 'projects/:id', phrase: 'Opened project $1' },
  { method: 'PATCH', pattern: 'projects/:id', phrase: 'Edited project $1' },
  { method: 'POST', pattern: 'projects/:id/submit', phrase: 'Sent project $1 for sanction' },
  { method: '*', pattern: 'projects/:id/milestones', phrase: 'Updated the milestones of project $1' },
  { method: 'GET', pattern: 'projects/:id/dprs', phrase: 'Read the project reports of project $1' },
  { method: 'POST', pattern: 'projects/:id/dprs', phrase: 'Prepared a project report for project $1' },
  { method: 'GET', pattern: 'projects/:id/dprs/:id/items', phrase: 'Read the estimate of project report $2' },
  { method: 'PUT', pattern: 'projects/:id/dprs/:id/items', phrase: 'Priced the estimate of project report $2' },
  { method: 'POST', pattern: 'projects/:id/dprs/:id/reprice', phrase: 'Repriced project report $2 against the Schedule of Rates' },
  { method: 'POST', pattern: 'projects/:id/dprs/:id/convert-to-tender', phrase: 'Converted project report $2 into a tender document' },
  { method: 'POST', pattern: 'projects/:id/dprs/:id/decision', phrase: 'Decided project report $2' },
  { method: 'GET', pattern: 'packages', phrase: 'Browsed packages' },
  { method: 'POST', pattern: 'packages', phrase: 'Created a package' },
  { method: 'GET', pattern: 'packages/:id', phrase: 'Opened package $1' },
  { method: 'PATCH', pattern: 'packages/:id', phrase: 'Edited package $1' },

  // Procurement
  { method: 'GET', pattern: 'tenders', phrase: 'Browsed tenders' },
  { method: 'POST', pattern: 'tenders', phrase: 'Created a tender' },
  { method: 'GET', pattern: 'tenders/my-bids', phrase: 'Opened their bids' },
  { method: 'GET', pattern: 'tenders/:id', phrase: 'Opened tender $1' },
  { method: 'PATCH', pattern: 'tenders/:id', phrase: 'Edited tender $1' },
  { method: 'POST', pattern: 'tenders/:id/publish', phrase: 'Published tender $1' },
  { method: 'POST', pattern: 'tenders/:id/bids', phrase: 'Submitted a bid on tender $1' },
  { method: 'POST', pattern: 'tenders/:id/award', phrase: 'Awarded tender $1' },
  { method: 'GET', pattern: 'tenders/:id/criteria', phrase: 'Read the qualification criteria of tender $1' },
  { method: 'PUT', pattern: 'tenders/:id/criteria', phrase: 'Set the qualification criteria of tender $1' },
  { method: 'POST', pattern: 'tenders/:id/sr-relief', phrase: 'Permitted bidding above the Schedule of Rates on tender $1' },
  { method: 'DELETE', pattern: 'tenders/:id/sr-relief', phrase: 'Restored the Schedule of Rates ceiling on tender $1' },
  { method: 'POST', pattern: 'tenders/:id/*', phrase: 'Acted on tender $1' },
  { method: '*', pattern: 'contractors/register', phrase: 'Registered a contractor firm' },
  { method: 'GET', pattern: 'contractors', phrase: 'Browsed contractors' },
  { method: 'GET', pattern: 'contractors/:id', phrase: 'Opened contractor $1' },
  { method: 'PATCH', pattern: 'contractors/:id', phrase: 'Edited contractor $1' },
  { method: 'POST', pattern: 'contractors/:id/blacklist', phrase: 'Changed the standing of contractor $1' },

  // Bills
  { method: 'GET', pattern: 'ra-bills', phrase: 'Browsed RA bills' },
  { method: 'POST', pattern: 'ra-bills', phrase: 'Raised an RA bill' },
  { method: 'GET', pattern: 'ra-bills/:id', phrase: 'Opened RA bill $1' },
  { method: 'PATCH', pattern: 'ra-bills/:id', phrase: 'Edited RA bill $1' },
  { method: 'DELETE', pattern: 'ra-bills/:id', phrase: 'Deleted draft RA bill $1' },
  { method: 'POST', pattern: 'ra-bills/:id/submit', phrase: 'Sent RA bill $1 for approval' },
  { method: 'POST', pattern: 'ra-bills/:id/certify', phrase: 'Certified RA bill $1' },
  { method: 'PUT', pattern: 'ra-bills/:id/deductions', phrase: 'Revised the deductions on RA bill $1' },
  { method: 'POST', pattern: 'ra-bills/:id/send-to-tally', phrase: 'Sent RA bill $1 to Tally' },
  { method: 'POST', pattern: 'ra-bills/:id/payment', phrase: 'Recorded payment of RA bill $1' },
  { method: 'GET', pattern: 'misc-bills', phrase: 'Browsed miscellaneous bills' },
  { method: 'POST', pattern: 'misc-bills', phrase: 'Raised a miscellaneous bill' },
  { method: 'GET', pattern: 'misc-bills/object-head-summary', phrase: 'Viewed expenditure by object head' },
  { method: 'GET', pattern: 'misc-bills/:id', phrase: 'Opened miscellaneous bill $1' },
  { method: 'PATCH', pattern: 'misc-bills/:id', phrase: 'Edited miscellaneous bill $1' },
  { method: 'DELETE', pattern: 'misc-bills/:id', phrase: 'Deleted draft miscellaneous bill $1' },
  { method: 'POST', pattern: 'misc-bills/:id/submit', phrase: 'Sent miscellaneous bill $1 for approval' },
  { method: 'POST', pattern: 'misc-bills/:id/send-to-tally', phrase: 'Sent miscellaneous bill $1 to Tally' },
  { method: 'POST', pattern: 'misc-bills/:id/payment', phrase: 'Recorded payment of miscellaneous bill $1' },

  // Approvals
  { method: 'GET', pattern: 'approvals/inbox', phrase: 'Opened their approval inbox' },
  { method: 'GET', pattern: 'approvals/my-submissions', phrase: 'Reviewed their submissions' },
  { method: 'GET', pattern: 'approvals/definitions', phrase: 'Viewed the approval chains' },
  { method: 'POST', pattern: 'approvals/definitions', phrase: 'Created an approval chain' },
  { method: 'GET', pattern: 'approvals/definitions/:id', phrase: 'Opened approval chain $1' },
  { method: 'GET', pattern: 'approvals/definitions/:id/history', phrase: 'Viewed the history of approval chain $1' },
  { method: 'PATCH', pattern: 'approvals/definitions/:id', phrase: 'Renamed approval chain $1' },
  { method: 'PUT', pattern: 'approvals/definitions/:id/steps', phrase: 'Redesigned the steps of approval chain $1' },
  { method: 'DELETE', pattern: 'approvals/definitions/:id', phrase: 'Deleted approval chain $1' },
  { method: 'POST', pattern: 'approvals/:id/action', phrase: 'Acted on file $1' },
  { method: 'POST', pattern: 'approvals/:id/cancel', phrase: 'Withdrew file $1' },
  { method: 'GET', pattern: 'approvals/:id', phrase: 'Opened file $1' },

  // Money
  { method: 'GET', pattern: 'funds/releases', phrase: 'Viewed fund releases' },
  { method: 'POST', pattern: 'funds/releases', phrase: 'Recorded a fund release' },
  { method: 'GET', pattern: 'funds/loc', phrase: 'Viewed letters of credit' },
  { method: 'POST', pattern: 'funds/loc', phrase: 'Requested a letter of credit' },
  { method: 'GET', pattern: 'funds/loc/:id', phrase: 'Opened letter of credit $1' },
  { method: 'POST', pattern: 'funds/loc/:id/submit', phrase: 'Sent letter of credit $1 for approval' },
  { method: 'PATCH', pattern: 'funds/loc/:id/approved-amount', phrase: 'Set the approved amount on letter of credit $1' },

  // Files
  { method: 'GET', pattern: 'documents', phrase: 'Browsed files' },
  { method: 'POST', pattern: 'documents', phrase: 'Uploaded a file' },
  { method: 'GET', pattern: 'documents/summary', phrase: 'Viewed the file store summary' },
  { method: 'GET', pattern: 'documents/folders', phrase: 'Browsed folders' },
  { method: 'POST', pattern: 'documents/folders', phrase: 'Created a folder' },
  { method: 'PATCH', pattern: 'documents/folders/:id', phrase: 'Renamed folder $1' },
  { method: 'DELETE', pattern: 'documents/folders/:id', phrase: 'Deleted folder $1' },
  { method: 'GET', pattern: 'documents/:id/download', phrase: 'Downloaded file $1' },
  { method: 'GET', pattern: 'documents/:id', phrase: 'Opened file $1' },
  { method: 'PATCH', pattern: 'documents/:id', phrase: 'Edited file $1' },
  { method: 'DELETE', pattern: 'documents/:id', phrase: 'Deleted file $1' },

  // Chat
  { method: 'GET', pattern: 'chat', phrase: 'Opened their conversations' },
  { method: 'GET', pattern: 'chat/contacts', phrase: 'Looked up a colleague' },
  { method: 'POST', pattern: 'chat/direct', phrase: 'Started a direct chat' },
  { method: 'POST', pattern: 'chat/groups', phrase: 'Created a group chat' },
  { method: 'GET', pattern: 'chat/:id/messages', phrase: 'Read conversation $1' },
  { method: 'POST', pattern: 'chat/:id/messages', phrase: 'Sent a message in conversation $1' },
  { method: 'DELETE', pattern: 'chat/:id/messages/:id', phrase: 'Deleted message $2' },
  { method: 'POST', pattern: 'chat/:id/members', phrase: 'Added members to conversation $1' },
  { method: 'DELETE', pattern: 'chat/:id/members/:id', phrase: 'Removed a member from conversation $1' },
  { method: 'PATCH', pattern: 'chat/:id', phrase: 'Renamed conversation $1' },

  // Administration
  { method: 'GET', pattern: 'masters/definitions', phrase: 'Viewed the master data catalogue' },
  { method: 'GET', pattern: 'masters/*/options', phrase: 'Loaded a dropdown' },
  { method: 'GET', pattern: 'masters/*/:id/history', phrase: 'Read the change history of master record $1' },
  { method: 'GET', pattern: 'masters/*', phrase: 'Browsed a master list' },
  { method: 'POST', pattern: 'masters/*', phrase: 'Added a master record' },
  { method: 'PATCH', pattern: 'masters/*/:id', phrase: 'Edited master record $1' },
  { method: 'DELETE', pattern: 'masters/*/:id', phrase: 'Deleted master record $1' },
  { method: 'GET', pattern: 'users', phrase: 'Browsed users' },
  { method: 'POST', pattern: 'users', phrase: 'Created a user account' },
  { method: 'GET', pattern: 'users/by-role', phrase: 'Looked up officers by role' },
  { method: 'GET', pattern: 'users/:id', phrase: 'Opened user $1' },
  { method: 'PATCH', pattern: 'users/:id', phrase: 'Edited user $1' },
  { method: 'POST', pattern: 'users/:id/reset-password', phrase: 'Reset the password of user $1' },
  { method: 'GET', pattern: 'audit', phrase: 'Read the audit trail' },
  { method: 'GET', pattern: 'dashboard', phrase: 'Opened the dashboard' },

  // Casework
  { method: 'GET', pattern: 'land', phrase: 'Browsed the land acquisition register' },
  { method: 'POST', pattern: 'land', phrase: 'Recorded a land parcel' },
  { method: 'GET', pattern: 'land/:id', phrase: 'Opened land parcel $1' },
  { method: 'PATCH', pattern: 'land/:id', phrase: 'Edited land parcel $1' },
  { method: 'POST', pattern: 'land/:id/stage', phrase: 'Recorded a statutory stage on land parcel $1' },
  { method: 'POST', pattern: 'land/:id/submit', phrase: 'Sent the award on land parcel $1 for approval' },
  { method: 'POST', pattern: 'land/:id/payments', phrase: 'Paid compensation on land parcel $1' },
  { method: 'GET', pattern: 'court-cases', phrase: 'Browsed the litigation register' },
  { method: 'POST', pattern: 'court-cases', phrase: 'Registered a court case' },
  { method: 'GET', pattern: 'court-cases/:id', phrase: 'Opened court case $1' },
  { method: 'PATCH', pattern: 'court-cases/:id', phrase: 'Edited court case $1' },
  { method: 'POST', pattern: 'court-cases/:id/hearings', phrase: 'Recorded a hearing in court case $1' },
  { method: 'POST', pattern: 'court-cases/:id/disposal', phrase: 'Closed court case $1' },
  { method: 'GET', pattern: 'committees', phrase: 'Browsed committees' },
  { method: 'POST', pattern: 'committees', phrase: 'Constituted a committee' },
  { method: 'GET', pattern: 'committees/my-actions', phrase: 'Opened their committee action items' },
  { method: 'GET', pattern: 'committees/meetings', phrase: 'Browsed committee sittings' },
  { method: 'GET', pattern: 'committees/meetings/:id', phrase: 'Opened sitting $1' },
  { method: 'PUT', pattern: 'committees/meetings/:id/attendance', phrase: 'Marked attendance at sitting $1' },
  { method: 'POST', pattern: 'committees/meetings/:id/minutes', phrase: 'Recorded the minutes of sitting $1' },
  { method: 'POST', pattern: 'committees/meetings/:id/cancel', phrase: 'Called off sitting $1' },
  { method: 'GET', pattern: 'committees/:id', phrase: 'Opened committee $1' },
  { method: 'PUT', pattern: 'committees/:id/members', phrase: 'Set the membership of committee $1' },
  { method: 'POST', pattern: 'committees/:id/meetings', phrase: 'Convened a sitting of committee $1' },
  { method: 'GET', pattern: 'rti', phrase: 'Browsed the RTI register' },
  { method: 'POST', pattern: 'rti', phrase: 'Recorded an RTI application' },
  { method: 'GET', pattern: 'rti/:id', phrase: 'Opened RTI application $1' },
  { method: 'PATCH', pattern: 'rti/:id', phrase: 'Edited RTI application $1' },
  { method: 'POST', pattern: 'rti/:id/reply', phrase: 'Answered RTI application $1' },
  { method: 'POST', pattern: 'rti/:id/appeals', phrase: 'Recorded an appeal against RTI application $1' },

  // Reports and MIS
  { method: 'GET', pattern: 'reports', phrase: 'Opened reports' },
  { method: 'GET', pattern: 'reports/contractor-bills', phrase: 'Ran the contractor-wise billing report' },
  { method: 'GET', pattern: 'reports/bill-ageing', phrase: 'Ran the bill ageing analysis' },
  { method: 'GET', pattern: 'reports/boq-analysis', phrase: 'Ran the BOQ analysis' },
  { method: 'GET', pattern: 'reports/sr-rates', phrase: 'Ran the Schedule of Rates analysis' },
  { method: 'GET', pattern: 'reports/sr-rate-history', phrase: 'Read the Schedule of Rates change history' },
  { method: 'GET', pattern: 'reports/approval-analysis', phrase: 'Ran the approval analysis' },
];

function matches(pattern: string, segments: string[]): string[] | null {
  const parts = pattern.split('/');
  if (parts.length !== segments.length) return null;

  const captured: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const segment = segments[i]!;
    if (part === ':id') {
      if (!/^\d+$/.test(segment)) return null;
      captured.push(segment);
    } else if (part === '*') {
      // Matched but deliberately not captured.
    } else if (part !== segment) {
      return null;
    }
  }
  return captured;
}

export function describeRequest(method: string, path: string): string {
  const segments = path.replace(/^\/?api\/?/, '').split('/').filter(Boolean);
  if (!segments.length) return `${method} ${path}`;

  for (const rule of RULES) {
    if (rule.method !== '*' && rule.method !== method) continue;
    const captured = matches(rule.pattern, segments);
    if (!captured) continue;
    return rule.phrase.replace(/\$(\d)/g, (_, index: string) => captured[Number(index) - 1] ?? '');
  }

  // Anything not in the table still reads better than a bare path.
  const id = segments.find((segment) => /^\d+$/.test(segment));
  const noun = segments[0]!.replace(/-/g, ' ');
  switch (method) {
    case 'GET':
      return id ? `Opened ${noun} ${id}` : `Viewed ${noun}`;
    case 'POST':
      return `Created a ${noun} record`;
    case 'PATCH':
    case 'PUT':
      return id ? `Updated ${noun} ${id}` : `Updated ${noun}`;
    case 'DELETE':
      return id ? `Deleted ${noun} ${id}` : `Deleted from ${noun}`;
    default:
      return `${method} ${path}`;
  }
}
