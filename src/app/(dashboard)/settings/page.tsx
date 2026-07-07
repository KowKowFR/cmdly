import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/config";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { FadeInSection } from "@/components/dashboard/FadeInSection";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    admin:
      "bg-violet-500/20 text-violet-400 border border-violet-500/30",
    operator:
      "bg-sky-500/20 text-sky-400 border border-sky-500/30",
    viewer:
      "bg-white/10 text-white/50 border border-white/10",
  };
  const cls = styles[role] ?? styles.viewer;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {role}
    </span>
  );
}

// ─── Config row ───────────────────────────────────────────────────────────────

function ConfigRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display =
    value !== null && value !== undefined && value !== ""
      ? String(value)
      : <span className="text-white/20 italic">Non renseigné</span>;

  return (
    <div className="flex items-start justify-between py-2.5 border-b border-white/5 last:border-0 gap-4">
      <dt className="text-xs text-white/40 font-medium flex-shrink-0 w-44">
        {label}
      </dt>
      <dd className="text-xs text-white/70 text-right font-mono break-all">
        {display}
      </dd>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const user = session.user as {
    id: string;
    name: string;
    email: string;
    role?: string;
    image?: string | null;
  };

  // Read config — non-fatal if DB is down
  let cfg = await getConfig().catch((err) => {
    logger.warn("settings page: getConfig failed", { err: String(err) });
    return null;
  });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Paramètres</h1>
        <p className="text-white/50 text-sm mt-1">
          Profil utilisateur et configuration de l&apos;infrastructure
        </p>
      </div>

      {/* User profile */}
      <FadeInSection>
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>Informations du compte connecté</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-0">
              <div className="flex items-center justify-between py-2.5 border-b border-white/5">
                <dt className="text-xs text-white/40 font-medium">Nom</dt>
                <dd className="text-sm text-white">{user.name}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5 border-b border-white/5">
                <dt className="text-xs text-white/40 font-medium">Email</dt>
                <dd className="text-sm text-white/70">{user.email}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-xs text-white/40 font-medium">Rôle</dt>
                <dd>
                  <RoleBadge role={user.role ?? "viewer"} />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </FadeInSection>

      {/* Infrastructure config — read-only, secrets masked */}
      <FadeInSection delay={0.1}>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Configuration Proxmox</CardTitle>
                <CardDescription>
                  Les secrets sont masqués. Cliquez sur &quot;Modifier&quot; pour
                  reconfigurer.
                </CardDescription>
              </div>
              <a
                href="/onboarding"
                className="flex-shrink-0 h-7 px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white/60 hover:text-white transition-colors inline-flex items-center"
              >
                Modifier
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <dl>
              <ConfigRow label="Hôte" value={cfg?.proxmoxHost} />
              <ConfigRow label="Port" value={cfg?.proxmoxPort} />
              <ConfigRow label="Utilisateur" value={cfg?.proxmoxUser} />
              <ConfigRow label="Token ID" value={cfg?.proxmoxTokenId} />
              <ConfigRow label="Token Secret" value={cfg?.proxmoxTokenSecret ? "••••••••" : undefined} />
              <ConfigRow label="Nœud" value={cfg?.proxmoxNode} />
            </dl>
          </CardContent>
        </Card>
      </FadeInSection>

      <FadeInSection delay={0.15}>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Configuration Wazuh</CardTitle>
                <CardDescription>Connexion au Wazuh Indexer</CardDescription>
              </div>
              <a
                href="/onboarding"
                className="flex-shrink-0 h-7 px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white/60 hover:text-white transition-colors inline-flex items-center"
              >
                Modifier
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <dl>
              <ConfigRow label="URL" value={cfg?.wazuhUrl} />
              <ConfigRow label="Utilisateur" value={cfg?.wazuhUser} />
              <ConfigRow label="Mot de passe" value={cfg?.wazuhPassword ? "••••••••" : undefined} />
            </dl>
          </CardContent>
        </Card>
      </FadeInSection>

      <FadeInSection delay={0.2}>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Configuration Zabbix</CardTitle>
                <CardDescription>Connexion à l&apos;API Zabbix</CardDescription>
              </div>
              <a
                href="/onboarding"
                className="flex-shrink-0 h-7 px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white/60 hover:text-white transition-colors inline-flex items-center"
              >
                Modifier
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <dl>
              <ConfigRow label="URL" value={cfg?.zabbixUrl} />
              <ConfigRow label="Utilisateur" value={cfg?.zabbixUser} />
              <ConfigRow label="Mot de passe" value={cfg?.zabbixPassword ? "••••••••" : undefined} />
            </dl>
          </CardContent>
        </Card>
      </FadeInSection>

      <FadeInSection delay={0.25}>
        <Card>
          <CardHeader>
            <CardTitle>Configuration LLM</CardTitle>
            <CardDescription>Modèle de langage pour l&apos;IA</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <ConfigRow label="Fournisseur" value={cfg?.defaultLlmProvider} />
              <ConfigRow label="Modèle OpenAI" value={cfg?.openaiModel} />
              <ConfigRow label="Clé OpenAI" value={cfg?.openaiApiKey ? "••••••••" : undefined} />
              <ConfigRow label="Modèle Anthropic" value={cfg?.anthropicModel} />
              <ConfigRow label="Clé Anthropic" value={cfg?.anthropicApiKey ? "••••••••" : undefined} />
              <ConfigRow label="URL Ollama" value={cfg?.ollamaBaseUrl} />
              <ConfigRow label="Modèle Ollama" value={cfg?.ollamaModel} />
            </dl>
          </CardContent>
        </Card>
      </FadeInSection>

      {/* Re-run onboarding */}
      <FadeInSection delay={0.3}>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white">
              Reconfigurer l&apos;infrastructure
            </p>
            <p className="text-xs text-white/40 mt-0.5">
              Relancez l&apos;assistant de configuration initial pour modifier tous
              les paramètres.
            </p>
          </div>
          <a
            href="/onboarding"
            className="flex-shrink-0 h-8 px-4 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors inline-flex items-center"
          >
            Lancer la configuration
          </a>
        </div>
      </FadeInSection>
    </div>
  );
}
