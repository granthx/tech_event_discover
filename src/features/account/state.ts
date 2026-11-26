import { z } from "zod";
import type { EventStatus, TrackingState } from "@/lib/database.types";

export const trackingMutationInputSchema = z.object({
  state: z.enum(["saved", "registered", "none"]),
});

export type TrackingMutationRequestState = z.infer<
  typeof trackingMutationInputSchema
>["state"];

export interface EvaluateTrackingTransitionInput {
  requestedState: TrackingMutationRequestState;
  existingState: TrackingState | null;
  eventStatus: EventStatus | "unknown";
  isEventActive: boolean;
}

export type EvaluateTrackingTransitionResult =
  | {
      status: 200;
      action: "noop" | "delete" | "upsert";
      newState: TrackingState | null;
    }
  | {
      status: 409;
      code: "EVENT_INACTIVE";
      message: string;
    }
  | {
      status: 404;
      code: "NOT_FOUND";
      message: string;
    };

/**
 * Evaluates tracking state requests strictly in the order specified in ARCHITECTURE.md:
 * 1. `none` -> 200. Delete caller's row if present.
 * 2. Exact repeat of caller's existing Saved or Registered state -> 200 with no tracking-row update,
 *    irrespective of event status.
 * 3. New or changed state, published with effective_end_at > p_now -> 200 and apply the change.
 * 4. New or changed state, ended or canceled -> 409 EVENT_INACTIVE.
 * 5. New or changed state, draft, archived, or unknown -> 404. Preserve any existing row.
 */
export function evaluateTrackingTransition(
  input: EvaluateTrackingTransitionInput
): EvaluateTrackingTransitionResult {
  if (input.requestedState === "none") {
    return {
      status: 200,
      action: input.existingState ? "delete" : "noop",
      newState: null,
    };
  }

  if (input.existingState === input.requestedState) {
    return {
      status: 200,
      action: "noop",
      newState: input.existingState,
    };
  }

  if (input.eventStatus === "published" && input.isEventActive) {
    return {
      status: 200,
      action: "upsert",
      newState: input.requestedState,
    };
  }

  if (
    input.eventStatus === "canceled" ||
    (input.eventStatus === "published" && !input.isEventActive)
  ) {
    return {
      status: 409,
      code: "EVENT_INACTIVE",
      message: "Cannot track an ended or canceled event.",
    };
  }

  return {
    status: 404,
    code: "NOT_FOUND",
    message: "Event not found or unavailable.",
  };
}

export const otpRequestInputSchema = z.object({
  email: z.string().trim().email().max(254),
  captchaToken: z.string().trim().min(1).max(2048),
  intent: z.enum(["signin", "signup"]).optional().default("signin"),
  adultConfirmed: z.boolean().optional(),
});

export type EvaluateOtpSignupGateResult =
  | { allowed: true; shouldCreateUser: boolean }
  | {
      allowed: false;
      status: 400 | 403;
      code: "SIGNUP_DISABLED" | "ADULT_ATTESTATION_REQUIRED";
      message: string;
    };

/**
 * Enforces the R2 open-signup gate (ARCHITECTURE.md line 128):
 * - Returning sign-in (`intent === "signin"`) always keeps `shouldCreateUser: false`.
 * - New signup (`intent === "signup"`) is rejected when `authSignupEnabled` is false (until Phase 4 Gate 5),
 *   and requires explicit `adultConfirmed === true` before `shouldCreateUser: true` is permitted.
 */
export function evaluateOtpSignupGate(input: {
  intent: "signin" | "signup";
  adultConfirmed?: boolean;
  authSignupEnabled: boolean;
}): EvaluateOtpSignupGateResult {
  if (input.intent === "signin") {
    return { allowed: true, shouldCreateUser: false };
  }

  if (!input.authSignupEnabled) {
    return {
      allowed: false,
      status: 403,
      code: "SIGNUP_DISABLED",
      message: "Independent account signup is not currently enabled.",
    };
  }

  if (input.adultConfirmed !== true) {
    return {
      allowed: false,
      status: 400,
      code: "ADULT_ATTESTATION_REQUIRED",
      message:
        "You must confirm that you are at least 18 years old before creating an account.",
    };
  }

  return { allowed: true, shouldCreateUser: true };
}

export const preferenceMutationInputSchema = z.object({
  emailRemindersEnabled: z.boolean(),
});

export const inviteAcceptInputSchema = z.object({
  tokenHash: z.string().trim().min(10).max(1024),
  adultConfirmed: z.literal(true, {
    errorMap: () => ({
      message: "You must confirm that you are at least 18 years old.",
    }),
  }),
});
