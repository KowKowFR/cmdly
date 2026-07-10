"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StepIndicator } from "./StepIndicator";
import { Step01Welcome } from "./steps/Step01Welcome";
import { Step02Admin } from "./steps/Step02Admin";
import { Step03Proxmox } from "./steps/Step03Proxmox";
import { Step04Repo } from "./steps/Step04Repo";
import { Step05SSH } from "./steps/Step05SSH";
import { Step06Vault } from "./steps/Step06Vault";
import { Step07LLM } from "./steps/Step07LLM";
import { Step08Zabbix } from "./steps/Step08Zabbix";
import { Step09Wazuh } from "./steps/Step09Wazuh";
import { Step10LDAP } from "./steps/Step10LDAP";
import { Step11Summary } from "./steps/Step11Summary";
import { Step12Done } from "./steps/Step12Done";
import { onboardingSchemas } from "@/lib/validation/onboarding";
import { authClient } from "@/lib/auth/client";
import { useToast } from "@/hooks/useToast";
import { ChevronLeft, ChevronRight, CheckCircle2, Loader2 } from "lucide-react";

const TOTAL_STEPS = 12;

type StepComponentProps = {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
  onJumpToStep?: (step: number) => void;
};

const STEP_COMPONENTS: Array<React.ComponentType<StepComponentProps>> = [
  Step01Welcome,
  Step02Admin,
  Step03Proxmox,
  Step04Repo,
  Step05SSH,
  Step06Vault,
  Step07LLM,
  Step08Zabbix,
  Step09Wazuh,
  Step10LDAP,
  Step11Summary,
  Step12Done,
];

const STEP_TITLES = [
  "Bienvenue",
  "Compte administrateur",
  "Proxmox VE",
  "Dépôt infra",
  "Bastion SSH",
  "Ansible Vault",
  "Fournisseur LLM",
  "Zabbix (optionnel)",
  "Wazuh (optionnel)",
  "LDAP (optionnel)",
  "Récapitulatif",
  "Terminé",
];

export function Wizard() {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    infraRepoType: "local",
    defaultLlmProvider: "openai",
    ldapEnabled: false,
    sshMode: "bastion",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const toast = useToast();
  const router = useRouter();

  function updateData(patch: Record<string, unknown>) {
    setFormData((prev) => ({ ...prev, ...patch }));
    // Clear errors for updated keys
    const keys = Object.keys(patch);
    setErrors((prev) => {
      const next = { ...prev };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  }

  function handleJumpToStep(targetStep: number) {
    setDirection(targetStep < step ? -1 : 1);
    setStep(targetStep);
    setErrors({});
  }

  async function handleNext() {
    const schema = onboardingSchemas[step];
    if (!schema) return;

    // Validate current step data locally
    const result = schema.safeParse(formData);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});

    // Step 1 (Welcome) carries no data and runs before the admin account
    // exists — there is no session yet, and the API requires auth for every
    // step except 2. Advance client-side instead of POSTing (which 401s).
    if (step === 1) {
      setDirection(1);
      setStep(2);
      return;
    }

    setIsLoading(true);

    try {
      if (step === 2) {
        // Create the admin user via better-auth before saving config
        const { email, password, name } = formData as {
          email: string;
          password: string;
          name: string;
        };

        const signUpResult = await authClient.signUp.email({ email, password, name });

        if (signUpResult.error) {
          toast.error(signUpResult.error.message ?? "Erreur lors de la création du compte");
          setIsLoading(false);
          return;
        }
      }

      // POST step data to the onboarding API
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, data: formData }),
      });

      const json = (await response.json()) as { ok: boolean; errors?: string[] };

      if (!json.ok) {
        const message = json.errors?.join(" · ") ?? "Erreur de configuration";
        toast.error(message);
        setIsLoading(false);
        return;
      }

      if (step === TOTAL_STEPS) {
        // Onboarding complete — navigate to dashboard
        router.push("/");
        router.refresh();
        return;
      }

      setDirection(1);
      setStep((prev) => prev + 1);
    } catch {
      toast.error("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleBack() {
    if (step > 1) {
      setDirection(-1);
      setStep((prev) => prev - 1);
      setErrors({});
    }
  }

  const CurrentStep = STEP_COMPONENTS[step - 1]!;
  const isLastStep = step === TOTAL_STEPS;

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 32 : -32, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -32 : 32, opacity: 0 }),
  };

  return (
    <div className="w-full max-w-lg">
      {/* Header */}
      <div className="text-center mb-6">
        <p className="text-xs font-semibold text-blue-400 uppercase tracking-widest mb-1">
          CMDLY Setup
        </p>
        <h1 className="text-lg font-semibold text-slate-200">
          {STEP_TITLES[step - 1]}
        </h1>
      </div>

      <StepIndicator current={step} total={TOTAL_STEPS} />

      <Card className="border-slate-700 bg-slate-900/80 backdrop-blur-sm min-h-[380px]">
        <CardContent className="pt-6 pb-4">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: "easeInOut" }}
            >
              <CurrentStep
                formData={formData}
                updateData={updateData}
                errors={errors}
                onJumpToStep={handleJumpToStep}
              />
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between items-center mt-5">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={step === 1 || isLoading}
          className="text-slate-400 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Retour
        </Button>

        <Button
          onClick={handleNext}
          disabled={isLoading}
          className="min-w-[130px] bg-blue-600 hover:bg-blue-500 text-white"
        >
          {isLoading ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />Chargement…</>
          ) : isLastStep ? (
            <><CheckCircle2 className="w-4 h-4 mr-2" />Accéder au dashboard</>
          ) : (
            <>Suivant<ChevronRight className="w-4 h-4 ml-1" /></>
          )}
        </Button>
      </div>
    </div>
  );
}
