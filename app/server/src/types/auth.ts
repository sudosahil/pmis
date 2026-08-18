import type { RoleCode } from '../config/constants.js';

/** The identity attached to a request once its access token is verified. */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  roleCode: RoleCode;
  designation: string | null;
  zoneId: number | null;
  circleId: number | null;
  divisionId: number | null;
  subDivisionId: number | null;
  contractorId: number | null;
}

export interface AccessTokenPayload {
  sub: number;
  username: string;
  role: RoleCode;
  divisionId: number | null;
  circleId: number | null;
  zoneId: number | null;
  subDivisionId: number | null;
  contractorId: number | null;
}

export interface RefreshTokenPayload {
  sub: number;
  jti: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}
