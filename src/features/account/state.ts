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
});

export const inviteAcceptInputSchema = z.object({
  tokenHash: z.string().trim().min(10).max(1024),
  adultConfirmed: z.literal(true, {
    errorMap: () => ({
      message: "You must confirm that you are at least 18 years old.",
    }),
  }),
});
