# Architecture CMDLY

## Vue d'ensemble

CMDLY est une application Next.js 16 (App Router) full-stack. Le navigateur communique avec les routes API via HTTP/SSE ; les routes API orchestrent les appels LLM et l'exécution d'outils qui s'adressent aux services d'infrastructure.

### Schéma des composants

```mermaid
graph TD
    Browser["Navigateur\n(Next.js RSC + EventSource)"]
    AuthRoute["Route /api/auth\n(better-auth)"]
    ChatRoute["Route POST /api/chat\n(créer run)"]
    StreamRoute["Route GET /api/chat/stream\n(SSE)"]
    ToolsRoute["Route POST /api/tools\n(confirmer action)"]
    Orchestrator["Orchestrateur\nsrc/lib/chat/orchestrator.ts"]
    LLM["Abstraction LLM\nsrc/lib/llm/\n(OpenAI / Anthropic / Ollama)"]
    Executor["Exécuteur d'outils\nsrc/lib/tools/executor.ts"]
    Proxmox["Client Proxmox\n(undici HTTP)"]
    SSH["Client SSH\n(node-ssh)"]
    Terraform["Terraform\n(execFile)"]
    Ansible["Ansible\n(execFile)"]
    Zabbix["Client Zabbix\n(HTTP)"]
    Wazuh["Client Wazuh\n(HTTP)"]
    DB[("PostgreSQL\n(Drizzle ORM)")]

    Browser -->|"POST message"| ChatRoute
    Browser -->|"GET SSE"| StreamRoute
    Browser -->|"POST confirm"| ToolsRoute
    Browser -->|"auth"| AuthRoute
    ChatRoute --> DB
    StreamRoute --> Orchestrator
    ToolsRoute --> Executor
    Orchestrator --> LLM
    Orchestrator --> Executor
    Executor --> Proxmox
    Executor --> SSH
    Executor --> Terraform
    Executor --> Ansible
    Executor --> Zabbix
    Executor --> Wazuh
    Executor --> DB
    AuthRoute --> DB
    Orchestrator --> DB
```

---

## Flux d'un message (diagramme de séquence)

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant P as POST /api/chat
    participant S as GET /api/chat/stream
    participant O as Orchestrateur
    participant L as LLM Provider
    participant E as Exécuteur (guardrails)
    participant D as PostgreSQL

    U->>P: POST { message, conversationId }
    P->>D: Persiste message utilisateur
    P->>D: Crée run (runStore)
    P-->>U: 200 { runId, conversationId }

    U->>S: GET /api/chat/stream?runId=...
    S->>O: runConversation(ctx, conversationId, provider, model)

    O->>D: Charge historique conversation
    O->>L: chatStream(messages, tools)
    L-->>O: token (streaming)
    O-->>S: SSE event: token
    S-->>U: data: {"content":"..."}

    L-->>O: tool_call { name, arguments }
    O-->>S: SSE event: tool_call { status: pending }
    S-->>U: data: {"name":"list_vms",...}

    O->>E: executeTool(name, params, ctx)
    Note over E: 1. audit(attempted)<br/>2. tool lookup<br/>3. RBAC<br/>4. Zod validation<br/>5. confirmation gate<br/>6. rate limit<br/>7. execute<br/>8. audit(success/fail)
    E-->>O: { status: "success", result }
    O-->>S: SSE event: tool_result
    S-->>U: data: { humanReadable: "..." }

    O->>L: chatStream(messages + tool_result)
    L-->>O: token (synthèse)
    O-->>S: SSE event: token
    S-->>U: data: {"content":"..."}

    O-->>S: SSE event: done { messageId }
    S-->>U: data: {"messageId":"..."}
```

### Flux de confirmation (action CONFIRM_REQUIRED)

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant S as GET /api/chat/stream
    participant O as Orchestrateur
    participant T as POST /api/tools
    participant E as Exécuteur

    O-->>S: SSE event: confirm_required { action, params, requireTyping? }
    S-->>U: data: confirm_required
    U->>T: POST { runId, toolCallId, confirmed: true, typedValue? }
    T->>E: executeTool(name, params, ctx, { confirmed: true })
    E-->>T: { status: "success", result }
    T-->>U: 200 { result }
```

---

## Conception SSE (POST + GET)

`EventSource` (API navigateur standard) est limité aux requêtes **GET**. Or, démarrer une génération LLM nécessite de transmettre un corps JSON (message, conversationId). CMDLY résout cette contrainte par une approche en deux temps :

1. **POST /api/chat** — reçoit le message, le persiste en base, crée un `run` en mémoire (via `runStore.ts`) et retourne un `runId`.
2. **GET /api/chat/stream?runId=...** — le navigateur ouvre un EventSource sur cette URL ; la route lit le `runId`, récupère le contexte d'exécution et démarre l'orchestrateur. Les événements SSE (`token`, `tool_call`, `tool_result`, `confirm_required`, `done`, `error`) sont émis au fil du traitement.

Cette séparation garantit la compatibilité avec les navigateurs et évite d'avoir à gérer des requêtes SSE avec corps.

---

## Pipeline de garde-fous de l'exécuteur

Le fichier `src/lib/tools/executor.ts` implémente un pipeline en **8 étapes ordonnées** :

| # | Étape | Raison |
|---|---|---|
| 1 | `audit(tool_call_attempted)` | Traçabilité de toute tentative, même rejetée |
| 2 | Lookup dans le registre | Vérifie que l'outil existe |
| 3 | RBAC (`canExecuteTool`) | Contrôle d'accès basé sur le rôle avant tout traitement |
| 4 | Validation Zod des paramètres | Sanitisation avant la gate de confirmation (les paramètres validés alimentent `requireTyping`) |
| 5 | Gate de confirmation | Stoppe si confirmation requise **sans consommer de slot de débit** |
| 6 | Limite de débit | Consommée seulement après confirmation (évite les abus) |
| 7 | Exécution de l'outil | Appel effectif à l'infrastructure |
| 8 | `audit(succeeded / failed)` | Finalise la trace |

La fonction `executeTool` **ne lève jamais d'exception** — toutes les erreurs sont retournées sous forme de `ExecuteOutcome`.

---

## Convention `proxy.ts` (Next.js 16)

Next.js 16 a renommé le fichier de middleware de `middleware.ts` en `proxy.ts`. Ce fichier (`src/proxy.ts`) s'exécute sur le runtime Node.js avant chaque requête et assure :

- **Garde d'authentification** : redirige vers `/login` si la session est absente.
- **Garde d'onboarding** : redirige vers `/onboarding` si la configuration n'est pas terminée, et inverse (redirige vers `/`) si l'onboarding est déjà complété.
- **Chemins publics** : `/login`, `/api/health`, `/api/auth/*`, `/_next/*` sont exemptés.

---

## Base de données (Drizzle + PostgreSQL)

Tables principales définies dans `src/lib/db/schema.ts` :

| Table | Rôle |
|---|---|
| `users` | Comptes (better-auth + extension `role` CMDLY) |
| `sessions` | Sessions actives (24 h) |
| `accounts` / `verifications` | Tables better-auth |
| `conversations` | Conversations chat par utilisateur |
| `messages` | Messages (user / assistant / tool) avec `toolCalls` JSONB |
| `audit_log` | Journal append-only des appels d'outils |
| `infrastructure_config` | Singleton (id=1) : config Proxmox, SSH, LLM, Zabbix, Wazuh, LDAP — secrets chiffrés AES-256-GCM |
| `rate_limits` | Compteurs de débit par (userId, category) avec fenêtre glissante |

---

## Abstraction LLM multi-provider

`src/lib/llm/` expose une interface `LLMProvider` uniforme avec une méthode `chatStream()` retournant un `AsyncGenerator` d'événements (`token`, `tool_call`, `error`, `done`). Trois implémentations :

- **OpenAIProvider** (`openai.ts`) — SDK `openai`
- **AnthropicProvider** (`anthropic.ts`) — SDK `@anthropic-ai/sdk`
- **OllamaProvider** (`ollama.ts`) — bibliothèque `ollama` (modèle local)

La sélection du provider se fait à la création de la conversation via `getProvider()` dans `src/lib/llm/index.ts`, en lisant `config.defaultLlmProvider`.
