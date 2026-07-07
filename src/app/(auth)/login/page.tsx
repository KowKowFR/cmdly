import { getConfig } from "@/lib/config";
import { LoginForm } from "@/components/auth/LoginForm";

// Force dynamic rendering so ldapEnabled is read from the DB on every request.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const config = await getConfig();
  return <LoginForm ldapEnabled={config.ldapEnabled} />;
}
