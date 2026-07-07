"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { authClient } from "@/lib/auth/client";

interface LoginFormProps {
  /** When true the form posts to /api/auth/ldap with username/password. */
  ldapEnabled?: boolean;
}

export function LoginForm({ ldapEnabled = false }: LoginFormProps) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    if (ldapEnabled) {
      // ── LDAP path ────────────────────────────────────────────────────────
      try {
        const res = await fetch("/api/auth/ldap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: identifier, password }),
        });

        if (res.ok) {
          router.push("/");
          router.refresh();
        } else {
          const data = (await res.json()) as { error?: string };
          toast.error(data.error ?? "Échec de la connexion. Vérifiez vos identifiants.");
          setIsLoading(false);
        }
      } catch {
        toast.error("Erreur de connexion au serveur.");
        setIsLoading(false);
      }
    } else {
      // ── Better-auth email/password path ──────────────────────────────────
      await authClient.signIn.email(
        { email: identifier, password, callbackURL: "/" },
        {
          onSuccess: () => {
            router.push("/");
            router.refresh();
          },
          onError: (ctx) => {
            toast.error(ctx.error.message ?? "Sign in failed. Please check your credentials.");
            setIsLoading(false);
          },
        },
      );

      setIsLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full max-w-sm"
    >
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">CMDLY</CardTitle>
          <CardDescription>
            {ldapEnabled ? "Connexion via annuaire LDAP" : "Sign in to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">
                {ldapEnabled ? "Identifiant" : "Email"}
              </Label>
              <Input
                id="identifier"
                type={ldapEnabled ? "text" : "email"}
                placeholder={ldapEnabled ? "alice" : "admin@example.com"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                disabled={isLoading}
                className="focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">
                {ldapEnabled ? "Mot de passe" : "Password"}
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                className="focus-visible:ring-ring"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading
                ? ldapEnabled ? "Connexion…" : "Signing in…"
                : ldapEnabled ? "Se connecter" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
