import { socialProviders } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <LoginForm providers={socialProviders()} socialError={!!params.social_error} next={typeof params.next === "string" ? params.next : null} />;
}
