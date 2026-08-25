import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/index.js';
import { seed } from '../db/seed.js';
import { findAuthUserById } from '../models/user.model.js';
import * as landService from './land.service.js';
import * as courtService from './court.service.js';
import * as committeeService from './committee.service.js';
import * as rtiService from './rti.service.js';
import { toPaise } from '../utils/money.js';
import type { AuthUser } from '../types/auth.js';

/**
 * The department's casework, against the seeded department.
 *
 * What is worth testing here is not the CRUD but the rules that come from
 * statute: the stages of the 2013 Act run in order, possession waits on
 * payment, a committee short of quorum cannot decide, and the RTI clock is
 * thirty days from receipt whatever anyone types.
 */

function userByUsername(username: string): AuthUser {
  const row = getDb()
    .prepare<[string], { id: number }>(`SELECT id FROM users WHERE username = ?`)
    .get(username);
  if (!row) throw new Error(`Seed is missing the user "${username}".`);
  return findAuthUserById(row.id)!;
}

function contractorUser(): AuthUser {
  const row = getDb()
    .prepare<[], { id: number }>(`SELECT id FROM users WHERE contractor_id IS NOT NULL LIMIT 1`)
    .get()!;
  return findAuthUserById(row.id)!;
}

/** A day offset from today, as YYYY-MM-DD. */
const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let chiefEngineer: AuthUser;
let executiveEngineer: AuthUser;
let projectId: number;

beforeAll(() => {
  seed();
  chiefEngineer = userByUsername('ce.sharma');
  executiveEngineer = userByUsername('ee.kumar');
  projectId = (
    getDb()
      .prepare<[], { id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)
      .get()!
  ).id;
});

afterAll(() => {
  closeDb();
});

// --- Land acquisition ---------------------------------------------------------

function newParcel(overrides: Record<string, unknown> = {}) {
  return landService.create(
    {
      projectId,
      village: 'Testpura',
      surveyNo: `T-${Math.random().toString(36).slice(2, 8)}`,
      landType: 'AGRICULTURAL',
      areaSqm: 1_000_000,
      ownerName: 'Shri Test Owner',
      marketValue: toPaise(1_000_000),
      ...overrides,
    } as never,
    chiefEngineer,
  );
}

describe('land acquisition', () => {
  it('adds the statutory solatium rather than taking a typed total', () => {
    const parcel = newParcel();

    // Section 30(1): solatium is a hundred per cent of the market value.
    expect(parcel.compensation.marketValue).toBe(1_000_000);
    expect(parcel.compensation.solatium).toBe(1_000_000);
    expect(parcel.compensation.total).toBe(2_000_000);
    expect(parcel.status).toBe('IDENTIFIED');
  });

  it('refuses a stage taken out of turn', () => {
    const parcel = newParcel();

    // A declaration cannot precede the preliminary notification it rests on.
    expect(() =>
      landService.recordStage(
        parcel.id,
        { stage: 'DECLARED', stageDate: day(0) } as never,
        chiefEngineer,
      ),
    ).toThrowError(/cannot be recorded until/);

    // Nor can an award precede the declaration.
    landService.recordStage(
      parcel.id,
      { stage: 'NOTIFIED', referenceNo: 'S11/1', stageDate: day(-30) } as never,
      chiefEngineer,
    );
    expect(() =>
      landService.recordStage(
        parcel.id,
        { stage: 'AWARDED', stageDate: day(0) } as never,
        chiefEngineer,
      ),
    ).toThrowError(/cannot be recorded until/);
  });

  it('will not pay compensation before the award is passed', () => {
    const parcel = newParcel();

    expect(() =>
      landService.addPayment(
        parcel.id,
        { paymentDate: day(0), amount: toPaise(100), mode: 'RTGS', payeeName: 'X' } as never,
        chiefEngineer,
      ),
    ).toThrowError(/before the award is passed/);
  });

  it('will not pay out more than the award', () => {
    const parcel = awardedParcel();

    expect(() =>
      landService.addPayment(
        parcel.id,
        {
          paymentDate: day(0),
          amount: toPaise(3_000_000),
          mode: 'RTGS',
          payeeName: 'Shri Test Owner',
        } as never,
        chiefEngineer,
      ),
    ).toThrowError(/remains payable/);
  });

  it('will not take possession before the award is satisfied', () => {
    const parcel = awardedParcel();

    // Part paid, so the parcel is still at "awarded" rather than "compensated".
    const partPaid = landService.addPayment(
      parcel.id,
      {
        paymentDate: day(0),
        amount: toPaise(500_000),
        mode: 'RTGS',
        payeeName: 'Shri Test Owner',
      } as never,
      chiefEngineer,
    );
    expect(partPaid.status).toBe('AWARDED');
    expect(partPaid.compensation.isFullyPaid).toBe(false);

    expect(() =>
      landService.recordStage(
        parcel.id,
        { stage: 'POSSESSED', stageDate: day(0) } as never,
        chiefEngineer,
      ),
    ).toThrowError(/until it reaches "compensated"/);
  });

  it('moves to compensated once the award is paid in full, and then allows possession', () => {
    const parcel = awardedParcel();

    const paid = landService.addPayment(
      parcel.id,
      {
        paymentDate: day(0),
        amount: toPaise(2_000_000),
        mode: 'RTGS',
        payeeName: 'Shri Test Owner',
      } as never,
      chiefEngineer,
    );

    expect(paid.status).toBe('COMPENSATED');
    expect(paid.compensation.isFullyPaid).toBe(true);
    expect(paid.compensation.balance).toBe(0);

    const possessed = landService.recordStage(
      parcel.id,
      { stage: 'POSSESSED', stageDate: day(0) } as never,
      chiefEngineer,
    );
    expect(possessed.status).toBe('POSSESSED');
  });

  it('will not revise compensation below what has already been paid', () => {
    const parcel = awardedParcel();
    landService.addPayment(
      parcel.id,
      {
        paymentDate: day(0),
        amount: toPaise(1_500_000),
        mode: 'RTGS',
        payeeName: 'Shri Test Owner',
      } as never,
      chiefEngineer,
    );

    expect(() =>
      landService.update(
        parcel.id,
        {
          projectId,
          village: 'Testpura',
          surveyNo: parcel.surveyNo,
          landType: 'AGRICULTURAL',
          areaSqm: 1_000_000,
          ownerName: 'Shri Test Owner',
          marketValue: toPaise(200_000),
        } as never,
        chiefEngineer,
      ),
    ).toThrowError(/already been paid/);
  });

  /** A parcel walked as far as the award, ready for compensation. */
  function awardedParcel() {
    const parcel = newParcel();
    landService.recordStage(
      parcel.id,
      { stage: 'NOTIFIED', referenceNo: 'S11/1', stageDate: day(-60) } as never,
      chiefEngineer,
    );
    landService.recordStage(
      parcel.id,
      { stage: 'DECLARED', referenceNo: 'S19/1', stageDate: day(-30) } as never,
      chiefEngineer,
    );
    return landService.recordStage(
      parcel.id,
      { stage: 'AWARDED', referenceNo: 'S23/1', stageDate: day(-10) } as never,
      chiefEngineer,
    );
  }
});

// --- Court cases ----------------------------------------------------------------

describe('court cases', () => {
  it('carries the next date onto the case, so the cause list can be read off it', () => {
    const created = courtService.create(
      {
        caseNo: `WP TEST/${Date.now()}`,
        courtName: 'High Court of Karnataka',
        courtType: 'HIGH_COURT',
        caseType: 'WRIT',
        filedBy: 'AGAINST_DEPARTMENT',
        petitioner: 'A Petitioner',
        respondent: 'State of Karnataka',
        subject: 'A test writ petition.',
        filingDate: day(-20),
      } as never,
      executiveEngineer,
    );
    expect(created.status).toBe('FILED');

    const heard = courtService.addHearing(
      created.id,
      {
        hearingDate: day(-5),
        purpose: 'Admission',
        proceedings: 'Notice ordered.',
        nextDate: day(10),
      } as never,
      executiveEngineer,
    );

    expect(heard.nextHearingDate).toBe(day(10));
    // A case that has been heard is no longer merely filed.
    expect(heard.status).toBe('PENDING');
  });

  it('refuses a next date that falls before the hearing it was given at', () => {
    const created = courtService.create(
      {
        caseNo: `WP BACKDATE/${Date.now()}`,
        courtName: 'High Court of Karnataka',
        courtType: 'HIGH_COURT',
        caseType: 'WRIT',
        filedBy: 'AGAINST_DEPARTMENT',
        petitioner: 'A Petitioner',
        respondent: 'State of Karnataka',
        subject: 'A test writ petition.',
        filingDate: day(-20),
      } as never,
      executiveEngineer,
    );

    expect(() =>
      courtService.addHearing(
        created.id,
        { hearingDate: day(-5), nextDate: day(-10) } as never,
        executiveEngineer,
      ),
    ).toThrowError(/cannot fall before/);
  });

  it('takes a closed case off the cause list and refuses further hearings', () => {
    const created = courtService.create(
      {
        caseNo: `OS TEST/${Date.now()}`,
        courtName: 'Civil Court',
        courtType: 'DISTRICT_COURT',
        caseType: 'CIVIL',
        filedBy: 'BY_DEPARTMENT',
        petitioner: 'The Department',
        respondent: 'A Contractor',
        subject: 'Recovery suit.',
        filingDate: day(-100),
        nextHearingDate: day(5),
      } as never,
      executiveEngineer,
    );

    const closed = courtService.dispose(
      created.id,
      { status: 'DISPOSED', outcome: 'IN_FAVOUR', disposalDate: day(-1) } as never,
      executiveEngineer,
    );

    expect(closed.isClosed).toBe(true);
    expect(closed.nextHearingDate).toBeNull();
    expect(() =>
      courtService.addHearing(created.id, { hearingDate: day(0) } as never, executiveEngineer),
    ).toThrowError(/has been closed/);
  });

  it('is closed to contractor accounts', () => {
    expect(() =>
      courtService.list(contractorUser(), { page: 1, pageSize: 10 }),
    ).toThrowError(/contractor/i);
  });
});

// --- Committees ------------------------------------------------------------------

describe('committees and meetings', () => {
  it('does not count a special invitee towards the quorum', () => {
    const meeting = getDb()
      .prepare<[], { id: number }>(
        `SELECT m.id FROM meetings m
           JOIN committees c ON c.id = m.committee_id
          WHERE c.code = 'GRC-HO' AND m.status = 'HELD' LIMIT 1`,
      )
      .get()!;

    const view = committeeService.getMeeting(meeting.id, chiefEngineer);
    // Two people attended, but one of them was there to be heard, not to decide.
    expect(view.attendance.filter((row) => row.isPresent)).toHaveLength(2);
    expect(view.presentCount).toBe(1);
    expect(view.hasQuorum).toBe(false);
  });

  it('lets a sitting short of quorum be minuted, but not decide', () => {
    const committee = committeeService.createCommittee(
      {
        code: `TQ${Date.now().toString().slice(-6)}`,
        name: 'Test Quorum Committee',
        kind: 'REVIEW',
        quorum: 3,
        status: 'ACTIVE',
      } as never,
      chiefEngineer,
    );

    const members = ['ce.sharma', 'se.iyer', 'ee.kumar'].map(userByUsername);
    committeeService.setMembers(
      committee.id,
      {
        members: [
          { userId: members[0]!.id, memberRole: 'CHAIRPERSON' },
          { userId: members[1]!.id, memberRole: 'MEMBER_SECRETARY' },
          { userId: members[2]!.id, memberRole: 'MEMBER' },
        ],
      } as never,
      chiefEngineer,
    );

    const meeting = committeeService.scheduleMeeting(
      committee.id,
      { title: 'A test sitting', scheduledAt: `${day(0)} 11:00`, mode: 'IN_PERSON' } as never,
      chiefEngineer,
    );

    // Only two of the three turn up.
    committeeService.markAttendance(
      meeting.id,
      {
        attendance: [
          { userId: members[0]!.id, isPresent: true },
          { userId: members[1]!.id, isPresent: true },
          { userId: members[2]!.id, isPresent: false },
        ],
      } as never,
      chiefEngineer,
    );

    expect(() =>
      committeeService.recordMinutes(
        meeting.id,
        {
          minutes: 'The committee met and considered the item.',
          decisions: [
            {
              subject: 'An item',
              decision: 'Approved.',
              actionById: members[0]!.id,
            },
          ],
        } as never,
        chiefEngineer,
      ),
    ).toThrowError(/cannot record decisions/);

    // The same sitting can still be minuted with no decisions.
    const minuted = committeeService.recordMinutes(
      meeting.id,
      { minutes: 'Adjourned for want of quorum.', decisions: [] } as never,
      chiefEngineer,
    );
    expect(minuted.status).toBe('HELD');
    expect(minuted.decisions).toHaveLength(0);
  });

  it('refuses a membership with no chairperson', () => {
    const committee = committeeService.createCommittee(
      {
        code: `NC${Date.now().toString().slice(-6)}`,
        name: 'No Chair Committee',
        kind: 'REVIEW',
        quorum: 2,
        status: 'ACTIVE',
      } as never,
      chiefEngineer,
    );

    expect(() =>
      committeeService.setMembers(
        committee.id,
        {
          members: [
            { userId: userByUsername('se.iyer').id, memberRole: 'MEMBER' },
            { userId: userByUsername('ee.kumar').id, memberRole: 'MEMBER' },
          ],
        } as never,
        chiefEngineer,
      ),
    ).toThrowError(/chairperson/i);
  });

  it('will not convene a sitting of a committee that cannot muster its quorum', () => {
    const committee = committeeService.createCommittee(
      {
        code: `UQ${Date.now().toString().slice(-6)}`,
        name: 'Understaffed Committee',
        kind: 'REVIEW',
        quorum: 5,
        status: 'ACTIVE',
      } as never,
      chiefEngineer,
    );

    expect(() =>
      committeeService.scheduleMeeting(
        committee.id,
        { title: 'Doomed sitting', scheduledAt: `${day(1)} 11:00`, mode: 'IN_PERSON' } as never,
        chiefEngineer,
      ),
    ).toThrowError(/against a quorum of 5/);
  });
});

// --- Right to Information ---------------------------------------------------------

describe('the Right to Information register', () => {
  it('computes the statutory date from the receipt', () => {
    // Section 7(1): thirty days, or forty-eight hours for life or liberty.
    expect(rtiService.dueDateFor('2026-01-01', false)).toBe('2026-01-31');
    expect(rtiService.dueDateFor('2026-01-01', true)).toBe('2026-01-03');
  });

  it('exposes the penalty while it can still be avoided', () => {
    const request = newRequest({ receivedOn: day(-40) });

    expect(request.isOverdue).toBe(true);
    expect(request.daysRemaining).toBe(-10);
    // Section 20: ₹250 a day.
    expect(request.penaltyExposure).toBe(2_500);
  });

  it('caps the exposure at the statutory ceiling', () => {
    const request = newRequest({ receivedOn: day(-400) });
    expect(request.penaltyExposure).toBe(25_000);
  });

  it('takes no fee from an applicant below the poverty line', () => {
    expect(() => newRequest({ isBpl: true, feePaid: toPaise(10) })).toThrowError(
      /below the poverty line pays no fee/,
    );
  });

  it('refuses a rejection that cites no clause', () => {
    const request = newRequest();

    expect(() =>
      rtiService.reply(
        request.id,
        { status: 'REJECTED', replyDate: day(0), rejectionGround: 'Because.' } as never,
        chiefEngineer,
      ),
    ).toThrowError();
  });

  it('records a refusal that does cite one, with the clause on the file', () => {
    const request = newRequest();

    const answered = rtiService.reply(
      request.id,
      {
        status: 'REJECTED',
        replyDate: day(0),
        rejectionSection: '8(1)(j)',
        rejectionGround: 'Personal information with no bearing on any public activity.',
      } as never,
      chiefEngineer,
    );

    expect(answered.status).toBe('REJECTED');
    expect(answered.rejection?.section).toBe('8(1)(j)');
    expect(answered.rejection?.label).toMatch(/Personal information/);
  });

  it('will not take a second appeal before a first', () => {
    const request = newRequest();
    rtiService.reply(
      request.id,
      { status: 'REPLIED', replyDate: day(0), replySummary: 'Supplied.' } as never,
      chiefEngineer,
    );

    expect(() =>
      rtiService.addAppeal(
        request.id,
        { appealLevel: 'SECOND', filedOn: day(1), grounds: 'Unsatisfied.' } as never,
        chiefEngineer,
      ),
    ).toThrowError(/only after a first appeal/);
  });

  it('starts a fresh thirty-day clock on an appeal', () => {
    const request = newRequest();
    rtiService.reply(
      request.id,
      { status: 'REPLIED', replyDate: day(0), replySummary: 'Supplied.' } as never,
      chiefEngineer,
    );

    const withAppeal = rtiService.addAppeal(
      request.id,
      { appealLevel: 'FIRST', filedOn: day(0), grounds: 'The reply is incomplete.' } as never,
      chiefEngineer,
    );

    expect(withAppeal.appeals).toHaveLength(1);
    expect(withAppeal.appeals[0]!.dueDate).toBe(day(30));
  });

  it('is closed to contractor accounts', () => {
    expect(() => rtiService.list(contractorUser(), { page: 1, pageSize: 10 })).toThrowError(
      /contractor/i,
    );
  });

  function newRequest(overrides: Record<string, unknown> = {}) {
    return rtiService.create(
      {
        applicantName: 'A Citizen',
        isBpl: false,
        feePaid: toPaise(10),
        receivedOn: day(-1),
        receivedVia: 'ONLINE',
        subject: 'A test application',
        informationSought: 'Some information held by the department.',
        isLifeOrLiberty: false,
        ...overrides,
      } as never,
      chiefEngineer,
    );
  }
});
