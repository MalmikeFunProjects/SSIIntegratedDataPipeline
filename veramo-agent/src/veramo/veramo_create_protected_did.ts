import {
  IAgentPlugin,
  IDIDManager,
  TAgent,
  IKeyManager,
  IIdentifier,
  IDIDManagerAddKeyArgs,
} from "@veramo/core";

import { IAuthorizationDIDPlugin } from "./veramo_create_default_auth_did";
import {
  DIDPermission,
  IDidWithAccessRights,
  IDidWithAccessRightsArgs,
  VERAMO_DUAL_AUTH_METHODS,
  HOST_DID_WEB_URL,
} from "../config";
import { IDidAuthorisationCredentialMethods } from "./veramo_authorisation_credential";
import PrometheusMetrics from "../monitoring/metrics";

// Interface for the plugin methods
export interface ICreateDidWithAccessRightsMethods {
  [key: string]: (
    args: IDidWithAccessRightsArgs,
    context: {
      agent: TAgent<
        IDIDManager &
          IKeyManager &
          IAuthorizationDIDPlugin &
          IDidAuthorisationCredentialMethods
      >;
    }
  ) => Promise<IDidWithAccessRights>;
  didManagerCreateWithAccessRights: (
    args: IDidWithAccessRightsArgs,
    context: {
      agent: TAgent<
        IDIDManager &
          IKeyManager &
          IAuthorizationDIDPlugin &
          IDidAuthorisationCredentialMethods
      >;
    }
  ) => Promise<IDidWithAccessRights>;
}

// Plugin options interface
interface CreateDidWithAccessRightsOptions {
  defaultTtlMs?: number;
  defaultPermissions?: DIDPermission[];
}

// Result interface for hosting DID web documents
interface HostDidResult {
  success: true;
  message?: string;
}

// Result interface for VC creation
interface VcResult {
  authorizationCredential: any;
  authorizationCredentialJWT: string;
}

export class CreateDidWithAccessRights implements IAgentPlugin {
  readonly methods: ICreateDidWithAccessRightsMethods;
  readonly schema: IAgentPlugin["schema"];

  private readonly defaultTtlMs: number;
  private readonly defaultPermissions: DIDPermission[];
  private metrics: PrometheusMetrics;

  constructor(options: CreateDidWithAccessRightsOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.defaultPermissions = options.defaultPermissions ?? [
      ...VERAMO_DUAL_AUTH_METHODS,
    ];

    this.methods = {
      didManagerCreateWithAccessRights:
        this.didManagerCreateWithAccessRights.bind(this),
    };

    this.schema = this.getSchema();
    this.metrics = PrometheusMetrics.getInstance();
  }

  private async didManagerCreateWithAccessRights(
    args: IDidWithAccessRightsArgs,
    context: {
      agent: TAgent<
        IDIDManager & IKeyManager & IDidAuthorisationCredentialMethods
      >;
    }
  ): Promise<IDidWithAccessRights> {
    // Start overall operation timer
    const operationTimer = this.metrics.measureDuration(
      this.metrics.didOperationDuration,
      {
        operation: "create_did_with_access_rights",
        provider: args.provider || "unknown",
        status: "pending",
      }
    );

    // Increment total operations counter
    this.metrics.didOperations.inc({
      operation: "create_did_with_access_rights",
      provider: args.provider || "unknown",
      status: "started",
    });

    const { agent } = context;
    const {
      alias,
      provider,
      kms,
      options = {},
      permissions = this.defaultPermissions,
      ttlMs = this.defaultTtlMs,
    } = args;

    let didIdentifier: IIdentifier | undefined;
    const abortController = new AbortController();
    const startTime = Date.now();

    try {
      const didCreationTimer = this.metrics.measureDuration(
        this.metrics.didOperationDuration,
        {
          operation: "create_identifier",
          provider: provider || "unknown",
          status: "pending",
        }
      );

      // Create or get existing DID identifier
      didIdentifier = await this.createDidIdentifier(agent, {
        alias,
        provider,
        kms,
        options,
      });

      didCreationTimer.endWith({ status: "success" });

      // Increment DID creation success counter
      this.metrics.didOperations.inc({
        operation: "create_identifier",
        provider: provider || "unknown",
        status: "success",
      });

      // Step 2: Extract public key from the DID identifier
      const keyUpdateTimer = this.metrics.measureDuration(
        this.metrics.didOperationDuration,
        {
          operation: "update_key",
          provider: provider || "unknown",
          status: "pending",
        }
      );

      // Extract public key from the DID identifier
      didIdentifier = await this.updateDidWithKey(agent, didIdentifier);

      // Process DID web hosting and VC creation in parallel
      const parallelProcessingTimer = this.metrics.measureDuration(
        this.metrics.didOperationDuration,
        {
          operation: "parallel_processing",
          provider: provider || "unknown",
          status: "pending",
        }
      );

      // Process DID web hosting and VC creation in parallel
      const [hostResult, vcResult] = await Promise.all([
        this.handleDidWebHosting(didIdentifier.did, abortController),
        this.createAuthorizationCredential(agent, {
          didIdentifier,
          permissions,
          jwt: didIdentifier?.keys[0]?.privateKeyHex || "",
          ttlMs,
        }),
      ]);

      parallelProcessingTimer.endWith({ status: "success" });

      // Log successful hosting for did:web DIDs
      if (didIdentifier.did.startsWith("did:web:")) {
        console.log(
          `DID ${didIdentifier.did} hosted successfully: ${
            hostResult.message ?? "ok"
          }`
        );

        // Track did:web hosting metrics
        this.metrics.didOperations.inc({
          operation: "web_hosting",
          provider: "did_web",
          status: "success",
        });
      }

      // Track successful credential creation
      this.metrics.credentialOperations.inc({
        operation: "create_authorization",
        status: "success",
      });

      // Calculate and record throughput metrics
      const totalDuration = Date.now() - startTime;
      this.metrics.didOperationDuration.observe(
        {
          operation: "create_did_with_access_rights_total",
          provider: provider || "unknown",
          status: "success",
        },
        totalDuration / 1000
      );

      // End overall operation timer with success
      operationTimer.endWith({ status: "success" });

      // Increment successful operations counter
      this.metrics.didOperations.inc({
        operation: "create_did_with_access_rights",
        provider: provider || "unknown",
        status: "success",
      });

      // Track agent method call success
      this.metrics.agentMethodCalls.inc({
        method: "didManagerCreateWithAccessRights",
        status: "success",
      });

      return {
        ...vcResult,
        didIdentifier,
      };
    } catch (error) {
      // End operation timer with error
      operationTimer.endWith({ status: "error" });

      // Increment error counters
      this.metrics.didOperations.inc({
        operation: "create_did_with_access_rights",
        provider: provider || "unknown",
        status: "error",
      });

      this.metrics.agentMethodCalls.inc({
        method: "didManagerCreateWithAccessRights",
        status: "error",
      });

      // Track specific error types
      const errorType =
        error instanceof Error ? error.constructor.name : "UnknownError";
      this.metrics.agentErrors.inc({
        method: "didManagerCreateWithAccessRights",
        error_type: errorType,
      });

      await this.handleError(error, didIdentifier, abortController, agent);
      throw error; // Re-throw after cleanup
    }
  }

  /**
   * Creates or retrieves a DID identifier
   */
  private async createDidIdentifier(
    agent: TAgent<IDIDManager & IKeyManager>,
    config: { alias: string; provider?: string; kms?: string; options: {} }
  ): Promise<IIdentifier> {
    const timer = this.metrics.measureDuration(
      this.metrics.agentMethodDuration,
      { method: "didManagerGetOrCreate", status: "pending" }
    );

    try {
      const didIdentifier = await agent.didManagerGetOrCreate(config);

      if (!didIdentifier?.did) {
        timer.endWith({ status: "error" });
        this.metrics.agentErrors.inc({
          method: "didManagerGetOrCreate",
          error_type: "NoDIDReturned",
        });
        throw new Error("Failed to create DID identifier - no DID returned");
      }

      timer.endWith({ status: "success" });
      this.metrics.agentMethodCalls.inc({
        method: "didManagerGetOrCreate",
        status: "success",
      });

      return didIdentifier;
    } catch (error) {
      timer.endWith({ status: "error" });
      this.metrics.agentMethodCalls.inc({
        method: "didManagerGetOrCreate",
        status: "error",
      });
      throw error;
    }
  }

  /**
   * Extracts the public key from a DID identifier
   */
  private async updateDidWithKey(
    agent: TAgent<IDIDManager & IKeyManager>,
    didIdentifier: IIdentifier
  ): Promise<IIdentifier> {
    const didKey =
      didIdentifier.keys.length > 0
        ? didIdentifier.keys[0].publicKeyHex
        : undefined;

    if (!didKey) {
      const keyCreationTimer = this.metrics.measureDuration(
        this.metrics.agentMethodDuration,
        { method: "keyManagerCreate", status: "pending" }
      );

      try {
        const key = await agent.keyManagerCreate({
          type: "Ed25519",
          kms: "local",
          meta: {
            algorithms: ["Ed25519"],
          },
        });

        keyCreationTimer.endWith({ status: "success" });
        this.metrics.agentMethodCalls.inc({
          method: "keyManagerCreate",
          status: "success",
        });

        const addKeyTimer = this.metrics.measureDuration(
          this.metrics.agentMethodDuration,
          { method: "didManagerAddKey", status: "pending" }
        );

        await agent.didManagerAddKey({ did: didIdentifier.did, key });

        addKeyTimer.endWith({ status: "success" });
        this.metrics.agentMethodCalls.inc({
          method: "didManagerAddKey",
          status: "success",
        });

        const getTimer = this.metrics.measureDuration(
          this.metrics.agentMethodDuration,
          { method: "didManagerGet", status: "pending" }
        );

        const result = await agent.didManagerGet({ did: didIdentifier.did });

        getTimer.endWith({ status: "success" });
        this.metrics.agentMethodCalls.inc({
          method: "didManagerGet",
          status: "success",
        });

        return result;
      } catch (error) {
        keyCreationTimer.endWith({ status: "error" });
        this.metrics.agentErrors.inc({
          method: "updateDidWithKey",
          error_type:
            error instanceof Error ? error.constructor.name : "UnknownError",
        });
        throw error;
      }
    }

    return didIdentifier;
  }

  /**
   * Handles DID web hosting if the DID is of type did:web
   */
  private async handleDidWebHosting(
    did: string,
    abortController: AbortController
  ): Promise<HostDidResult> {
    if (!did.startsWith("did:web:")) {
      return {
        success: true,
        message: "Skipped hosting (not did:web)",
      };
    }

    const hostingTimer = this.metrics.measureDuration(
      this.metrics.httpRequestDuration,
      { method: "POST", route: "/process-did", status_code: "pending" }
    );

    try {
      const requestBody = JSON.stringify({ did });

      // Track request size
      this.metrics.httpRequestSize.observe(
        { method: "POST", route: "/process-did" },
        Buffer.byteLength(requestBody, "utf8")
      );

      const response = await fetch(`${HOST_DID_WEB_URL}/process-did`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: abortController.signal,
      });

      const result = await response.json().catch(() => ({}));
      const responseText = JSON.stringify(result);

      // Track response size and status
      this.metrics.httpResponseSize.observe(
        {
          method: "POST",
          route: "/process-did",
          status_code: response.status.toString(),
        },
        Buffer.byteLength(responseText, "utf8")
      );
      hostingTimer.endWith({ status_code: response.status.toString() });

      // Increment HTTP request counter
      this.metrics.httpRequestTotal.inc({
        method: "POST",
        route: "/process-did",
        status_code: response.status.toString(),
      });

      if (!response.ok || result?.success !== true) {
        const errorMsg =
          result?.error ||
          result?.message ||
          response.statusText ||
          "Unknown error";

        this.metrics.didOperations.inc({
          operation: "web_hosting",
          provider: "did_web",
          status: "error",
        });

        throw new Error(`Failed to host DID web document: ${errorMsg}`);
      }

      // Track successful hosting
      this.metrics.didOperations.inc({
        operation: "web_hosting",
        provider: "did_web",
        status: "success",
      });

      return result as HostDidResult;
    } catch (error) {
      hostingTimer.endWith({ status_code: "error" });

      if (error instanceof Error && error.name === "AbortError") {
        this.metrics.didOperations.inc({
          operation: "web_hosting",
          provider: "did_web",
          status: "aborted",
        });
        throw new Error("DID web hosting was aborted");
      }

      this.metrics.didOperations.inc({
        operation: "web_hosting",
        provider: "did_web",
        status: "error",
      });

      throw error;
    }
  }

  /**
   * Creates an authorization credential for the DID
   */
  private async createAuthorizationCredential(
    agent: TAgent<IDidAuthorisationCredentialMethods>,
    config: {
      didIdentifier: IIdentifier;
      permissions: DIDPermission[];
      jwt: string;
      ttlMs: number;
    }
  ): Promise<VcResult> {
    const { didIdentifier, permissions, jwt, ttlMs } = config;

    const vcCreationTimer = this.metrics.measureDuration(
      this.metrics.credentialOperationDuration,
      { operation: "create_vc_grant", status: "pending" }
    );

    try {
      const authorizationVc = await agent.createVCForDIDGrant({
        didIdentifier,
        permissions,
        jwt,
        ttlMs,
      });

      if (
        !authorizationVc?.created ||
        !authorizationVc?.authorisationCredential
      ) {
        vcCreationTimer.endWith({ status: "error" });

        this.metrics.credentialOperations.inc({
          operation: "create_vc_grant",
          status: "error",
        });

        const errorMsg = authorizationVc?.error || "Unknown error";
        throw new Error(
          `Failed to create authorization VC for DID grant: ${errorMsg}`
        );
      }

      vcCreationTimer.endWith({ status: "success" });
      this.metrics.credentialOperations.inc({
        operation: "create_vc_grant",
        status: "success",
      });

      const saveTimer = this.metrics.measureDuration(
        this.metrics.credentialOperationDuration,
        { operation: "save_vc", status: "pending" }
      );

      const authorizationCredentialJWT =
        await agent.dataStoreSaveVerifiableCredential({
          verifiableCredential: authorizationVc.authorisationCredential,
        });

      saveTimer.endWith({ status: "success" });
      this.metrics.credentialOperations.inc({
        operation: "save_vc",
        status: "success",
      });

      return {
        authorizationCredential: authorizationVc.authorisationCredential,
        authorizationCredentialJWT,
      };
    } catch (error) {
      vcCreationTimer.endWith({ status: "error" });
      this.metrics.credentialOperations.inc({
        operation: "create_authorization",
        status: "error",
      });

      const errorType =
        error instanceof Error ? error.constructor.name : "UnknownError";
      this.metrics.agentErrors.inc({
        method: "createAuthorizationCredential",
        error_type: errorType,
      });

      throw error;
    }
  }

  /**
   * Handles errors and performs cleanup
   */
  private async handleError(
    error: unknown,
    didIdentifier: IIdentifier | undefined,
    abortController: AbortController,
    agent: TAgent<IDIDManager>
  ): Promise<void> {
    const cleanupTimer = this.metrics.measureDuration(
      this.metrics.didOperationDuration,
      { operation: "cleanup", provider: "unknown", status: "pending" }
    );

    try {
      // Abort any ongoing fetch operations
      try {
        abortController.abort();
      } catch {
        // Ignore abort errors
      }

      // Clean up DID if it was created
      if (didIdentifier?.did) {
        try {
          const deleteTimer = this.metrics.measureDuration(
            this.metrics.agentMethodDuration,
            { method: "didManagerDelete", status: "pending" }
          );

          await agent.didManagerDelete({ did: didIdentifier.did });

          deleteTimer.endWith({ status: "success" });
          this.metrics.agentMethodCalls.inc({
            method: "didManagerDelete",
            status: "success",
          });

          this.metrics.didOperations.inc({
            operation: "cleanup_delete",
            provider: "unknown",
            status: "success",
          });
        } catch (deleteError) {
          this.metrics.agentErrors.inc({
            method: "didManagerDelete",
            error_type:
              deleteError instanceof Error
                ? deleteError.constructor.name
                : "UnknownError",
          });
          console.error("Failed to clean up DID after error:", deleteError);
        }
      }

      cleanupTimer.endWith({ status: "success" });

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Error creating DID with access rights: ${errorMessage}`);

      // Wrap in a more descriptive error
      throw new Error(`Error creating DID with access rights: ${errorMessage}`);
    } catch (cleanupError) {
      cleanupTimer.endWith({ status: "error" });
      throw cleanupError;
    }
  }

  /**
   * Generates the plugin schema
   */
  private getSchema(): IAgentPlugin["schema"] {
    return {
      components: {
        schemas: {},
        methods: {
          didManagerCreateWithAccessRights: {
            description:
              "Create a DID with access rights and authorization credentials",
            arguments: {
              $ref: "#/components/schemas/IDIDManagerCreateArgs",
              description:
                "Input arguments for creating DID with access rights",
            },
            returnType: {
              type: "object",
              description:
                "Created DID with authorization credentials and permissions",
              properties: {
                didIdentifier: {
                  $ref: "#/components/schemas/IIdentifier",
                  description: "The created or retrieved DID identifier",
                },
                authorizationCredential: {
                  $ref: "#/components/schemas/VerifiableCredential",
                  description: "The verifiable credential for authorization",
                },
                authorizationCredentialJWT: {
                  type: "string",
                  description:
                    "JWT representation of the authorization credential",
                },
              },
              required: [
                "didIdentifier",
                "authorizationCredential",
                "authorizationCredentialJWT",
              ],
            },
          },
        },
      },
    };
  }
}
