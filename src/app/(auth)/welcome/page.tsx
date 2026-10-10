import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { WelcomeForm } from "./welcome-form";

// First stop after signing up with Google / Facebook: the account exists but
// has no business yet. Anyone who already has one goes to the dashboard.
export default async function WelcomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (await getWorkspaceContext()) redirect("/dashboard");
  return <WelcomeForm />;
}
