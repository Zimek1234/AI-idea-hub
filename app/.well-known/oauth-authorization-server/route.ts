// Forward the provider's authoritative metadata; do not invent OAuth endpoints.
export async function GET() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base)
    return Response.json(
      { error: "OAuth is not configured." },
      { status: 503 },
    );
  try {
    const response = await fetch(
      `${base}/auth/v1/.well-known/oauth-authorization-server`,
      { signal: AbortSignal.timeout(5000), cache: "no-store" },
    );
    if (!response.ok)
      return Response.json(
        {
          error:
            "Enable the Supabase OAuth server and confirm its discovery URL.",
        },
        { status: 503 },
      );
    return Response.json(await response.json());
  } catch {
    return Response.json(
      { error: "OAuth provider unavailable." },
      { status: 503 },
    );
  }
}
