export function GET() {
  const origin = process.env.APP_URL?.replace(/\/$/, "");
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!origin || !supabase)
    return Response.json(
      { error: "OAuth is not configured." },
      { status: 503 },
    );
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [`${supabase}/auth/v1`],
    scopes_supported: ["openid", "email", "profile"],
    bearer_methods_supported: ["header"],
    resource_name: "AI Idea Hub",
  });
}
