import { NextResponse } from "next/server";
import {
  createSupabaseServiceServerClient,
  createSupabaseSessionServerClient,
} from "@/lib/supabase/server";

/**
 * GET /api/me/session
 * Returns opaque boolean session state ({ authenticated, eligible, isCurator })
 * with zero PII/emails exposed and Cache-Control: private, no-store.
 */
export async function GET() {
  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (isPlaceholderEnv) {
    return NextResponse.json(
      { authenticated: false, eligible: false, isCurator: false },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }

  try {
    const supabase = await createSupabaseSessionServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { authenticated: false, eligible: false, isCurator: false },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    const svc = createSupabaseServiceServerClient();
    const [{ data: ctrl }, { data: curator }] = await Promise.all([
      svc
        .from("account_controls")
        .select("adult_confirmed_at, deletion_requested_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      svc
        .from("curator_access")
        .select("active")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const eligible = Boolean(
      ctrl?.adult_confirmed_at && !ctrl?.deletion_requested_at
    );
    const isCurator = Boolean(eligible && curator?.active);

    return NextResponse.json(
      {
        authenticated: true,
        eligible,
        isCurator,
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  } catch {
    return NextResponse.json(
      { authenticated: false, eligible: false, isCurator: false },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }
}
