import { socialProviders } from "@/lib/auth/server";
import { SignupForm } from "./signup-form";

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <SignupForm providers={socialProviders()} socialError={!!params.social_error} />;
}
