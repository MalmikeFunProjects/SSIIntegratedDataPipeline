import {
  IAgentPlugin,
  IDIDManager,
  ICredentialIssuer,
  TAgent,
  VerifiableCredential,
  ICredentialVerifier,
} from "@veramo/core";

import { IAuthorizationDIDPlugin } from "./veramo_create_default_auth_did";
import { DIDPermission, IDidAuthorisationCredentialArgs, serverConfig, VERAMO_DUAL_AUTH_METHODS } from "../config";
import PrometheusMetrics from "../monitoring/metrics";


interface IVerifyDidGrantArgs {
  did: string;
  authorisationCredential: VerifiableCredential;
  requiredPermissions: DIDPermission[];
  // Optional: verify against specific scope
  requiredScope?: string;
}

interface IVerifyDidGrantResult {
  valid: boolean;
  error?: string;
  details?: {
    credentialExpired?: boolean;
    insufficientPermissions?: boolean;
    invalidScope?: boolean;
    invalidSubject?: boolean;
  };
}

export interface IDidAuthorisationCredentialMethods {
  [key: string]: (...args: any[]) => Promise<any>; // Add index signature
  createVCForDIDGrant: (
    args: IDidAuthorisationCredentialArgs,
    context: {
      agent: TAgent<IAuthorizationDIDPlugin & ICredentialIssuer>;
    }
  ) => Promise<{
    created: boolean;
    authorisationCredential?: VerifiableCredential;
    error?: string;
  }>;

  verifyDidGrant: (
    args: IVerifyDidGrantArgs,
    context: {
      agent: TAgent<IDIDManager & ICredentialVerifier>;
    }
  ) => Promise<IVerifyDidGrantResult>;
}

export class DidAuthorisationCredential implements IAgentPlugin {
  readonly methods: IDidAuthorisationCredentialMethods;
  private readonly defaultTtlMs: number;
  private readonly defaultPermissions: DIDPermission[];
  private baseUrl: string;
  private metrics: PrometheusMetrics

  constructor(options?: {
    defaultTtlMs?: number;
    defaultPermissions?: DIDPermission[];
  }) {
    this.baseUrl = serverConfig.baseUrl;
    if (!this.baseUrl) {
      throw new Error("Base URL must be set in ServerConfig");
    }
    this.metrics = PrometheusMetrics.getInstance()
    this.methods = {
      createVCForDIDGrant: this.createVCForDIDGrant.bind(this),
      verifyDidGrant: this.verifyDidGrant.bind(this),
    };
    this.defaultTtlMs = options?.defaultTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.defaultPermissions = options?.defaultPermissions ?? [...VERAMO_DUAL_AUTH_METHODS];
  }

  private async createVCForDIDGrant(
    args: IDidAuthorisationCredentialArgs,
    context: {
      agent: TAgent<IAuthorizationDIDPlugin & ICredentialIssuer>;
    }
  ): Promise<{
    created: boolean;
    authorisationCredential?: VerifiableCredential;
    error?: string;
  }> {
    const timer = this.metrics.measureDuration(
      this.metrics.credentialOperationDuration,
      { operation: 'create_authorization_credential' }
    );

    const { agent } = context;
    const {
      didIdentifier,
      permissions = this.defaultPermissions,
      jwt,
      ttlMs = this.defaultTtlMs,
      scope,
    } = args;

    try {
      // Input validation
      if (!didIdentifier?.did) {
        this.metrics.credentialOperations.inc({
          operation: 'create_authorization_credential',
          status: 'failed_validation'
        });
        timer.endWith({ status: 'failed_validation' });
        return {
          created: false,
          error: "Valid didIdentifier with DID is required"
        };
      }

      if (!Array.isArray(permissions) || permissions.length === 0) {
        this.metrics.credentialOperations.inc({
          operation: 'create_authorization_credential',
          status: 'failed_validation'
        });
        timer.endWith({ status: 'failed_validation' });
        return {
          created: false,
          error: "At least one permission must be specified"
        };
      }

      // Get authorization DID
      const identifier = await agent.getAuthorizationDid({baseUrl: this.baseUrl});

      if (!identifier || !identifier.did) {
        this.metrics.credentialOperations.inc({
          operation: 'create_authorization_credential',
          status: 'failed_auth_did'
        });
        timer.endWith({ status: 'failed_auth_did' });
        return {
          created: false,
          error: "Authorization DID not found or invalid"
        };
      }

      // Prevent self-authorization
      if (didIdentifier.did === identifier.did) {
        this.metrics.credentialOperations.inc({
          operation: 'create_authorization_credential',
          status: 'failed_self_auth'
        });
        timer.endWith({ status: 'failed_self_auth' });
        return {
          created: false,
          error: "Cannot authorize self - authorization DID cannot be the same as target DID"
        };
      }

      const now = new Date();
      const exp = new Date(now.getTime() + ttlMs);

      // Enhanced credential structure
      const credential: any = {
        "@context": [
          "https://www.w3.org/2018/credentials/v1",
        ],
        type: ["VerifiableCredential", "DIDAuthorizationCredential"],
        issuer: { id: identifier.did },
        issuanceDate: now.toISOString(),
        expirationDate: exp.toISOString(),
        credentialSubject: {
          id: didIdentifier.did,
          authorizedDID: didIdentifier.did,
          permissions: permissions,
          scope: scope || `${didIdentifier.did}/*`,
          // Bind to specific key if provided
          ...(jwt && { cnf: { jwt } }),
          // Add metadata
          grantedAt: now.toISOString(),
          ttlMs: ttlMs,
        },
      };

      // Get the correct verification method
      const verificationMethod = didIdentifier.keys?.[0]?.kid;
      if (!verificationMethod) {
        this.metrics.credentialOperations.inc({
          operation: 'create_authorization_credential',
          status: 'failed_verification_method'
        });
        timer.endWith({ status: 'failed_verification_method' });
        return {
          created: false,
          error: "No verification method found for did: " + didIdentifier.did
        };
      }


      const verifiableCredential = await agent.createVerifiableCredential({
        credential,
        proofFormat: "jwt",
        proofPurpose: "assertionMethod",
        verificationMethod,
      });

      // Record successful operation
      this.metrics.credentialOperations.inc({
        operation: 'create_authorization_credential',
        status: 'success'
      });
      this.metrics.agentMethodCalls.inc({
        method: 'createVerifiableCredential',
        status: 'success'
      });
      timer.endWith({ status: 'success' });

      return {
        created: true,
        authorisationCredential: verifiableCredential
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error creating authorisation credential for DID: ${didIdentifier.did} ${errorMessage}`);

      // Record error metrics
      this.metrics.credentialOperations.inc({
        operation: 'create_authorization_credential',
        status: 'error'
      });
      this.metrics.agentErrors.inc({
        method: 'createVCForDIDGrant',
        error_type: error instanceof Error ? error.constructor.name : 'Unknown'
      });
      timer.endWith({ status: 'error' });

      return {
        created: false,
        error: errorMessage
      };
    }
  }

  private async verifyDidGrant(
    args: IVerifyDidGrantArgs,
    context: {
      agent: TAgent<IDIDManager & ICredentialVerifier>;
    }
  ): Promise<IVerifyDidGrantResult> {
    const timer = this.metrics.measureDuration(
      this.metrics.authorizationDuration,
      { method: 'verifyDidGrant' }
    );

    try {
      const { agent } = context;
      const { did, authorisationCredential, requiredPermissions, requiredScope } = args;

      // Input validation
      if (!did || !authorisationCredential || !Array.isArray(requiredPermissions)) {
        this.metrics.authorizationChecks.inc({
          method: 'verifyDidGrant',
          status: 'failed_validation'
        });
        timer.endWith({ status: 'failed_validation' });
        return {
          valid: false,
          error: "Invalid input parameters"
        };
      }

      // If no permissions required, grant access
      if (requiredPermissions.length === 0) {
        this.metrics.authorizationChecks.inc({
          method: 'verifyDidGrant',
          status: 'success_no_permissions'
        });
        timer.endWith({ status: 'success_no_permissions' });
        return { valid: true };
      }

      // Verify that the credential subject matches the DID being authorized
      const subjectDidMatch = this.verifySubjectDIDMatch(authorisationCredential, did);
      if (!subjectDidMatch.valid) {
        this.metrics.authorizationChecks.inc({
          method: 'verifyDidGrant',
          status: 'failed_subject_mismatch'
        });
        timer.endWith({ status: 'failed_subject_mismatch' });

        return {
          valid: false,
          error: subjectDidMatch.error || "DID subject mismatch",
          details: { invalidSubject: true }
        };
      }

      // Verify DID exists
      try {
        const didDoc = await agent.didManagerGet({ did });
        if (!didDoc) {
          this.metrics.authorizationChecks.inc({
            method: 'verifyDidGrant',
            status: 'failed_did_not_found'
          });
          timer.endWith({ status: 'failed_did_not_found' });
          return {
            valid: false,
            error: `DID document not found for DID: ${did}`
          };
        }
      } catch (error) {
        this.metrics.authorizationChecks.inc({
          method: 'verifyDidGrant',
          status: 'failed_did_resolution'
        });
        timer.endWith({ status: 'failed_did_resolution' });
        return {
          valid: false,
          error: `Failed to retrieve DID document: ${error instanceof Error ? error.message : String(error)}`
        };
      }

      // Verify credential validity (signature and expiration)
      const isValid = await this.isCredentialValid(agent, authorisationCredential);
      if (!isValid) {
        this.metrics.authorizationChecks.inc({
          method: 'verifyDidGrant',
          status: 'failed_credential_invalid'
        });
        timer.endWith({ status: 'failed_credential_invalid' });
        return {
          valid: false,
          error: "Authorization credential is expired or cryptographically invalid",
          details: { credentialExpired: true }
        };
      }

      // Verify permissions
      const hasPermissions = this.verifyPermissions(authorisationCredential, requiredPermissions);
      if (!hasPermissions) {
        this.metrics.authorizationChecks.inc({
          method: 'verifyDidGrant',
          status: 'failed_insufficient_permissions'
        });
        timer.endWith({ status: 'failed_insufficient_permissions' });
        return {
          valid: false,
          error: "Insufficient permissions in authorization credential",
          details: { insufficientPermissions: true }
        };
      }

      // Verify scope if required
      if (requiredScope) {
        const hasScope = this.verifyScope(authorisationCredential, requiredScope);
        if (!hasScope) {
          this.metrics.authorizationChecks.inc({
            method: 'verifyDidGrant',
            status: 'failed_invalid_scope'
          });
          timer.endWith({ status: 'failed_invalid_scope' });
          return {
            valid: false,
            error: "Authorization credential scope does not match required scope",
            details: { invalidScope: true }
          };
        }
      }

      this.metrics.authorizationChecks.inc({
        method: 'verifyDidGrant',
        status: 'success'
      });
      timer.endWith({ status: 'success' });

      return { valid: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error verifying DID grant:", errorMessage);

      this.metrics.authorizationChecks.inc({
        method: 'verifyDidGrant',
        status: 'error'
      });
      this.metrics.agentErrors.inc({
        method: 'verifyDidGrant',
        error_type: error instanceof Error ? error.constructor.name : 'Unknown'
      });
      timer.endWith({ status: 'error' });

      return {
        valid: false,
        error: errorMessage
      };
    }
  }

  // Critical security check: verify DID subject matches the DID being authorized
  private verifySubjectDIDMatch(
    credential: VerifiableCredential,
    targetDid: string
  ): { valid: boolean; error?: string } {
    try {
      const credentialSubject = credential.credentialSubject;

      if (!credentialSubject || typeof credentialSubject !== 'object') {
        return {
          valid: false,
          error: "Invalid credential subject structure"
        };
      }

      // Check both 'id' and 'authorizedDID' fields for the subject DID
      const subjectId = credentialSubject.id as string;
      const authorizedDID = credentialSubject.authorizedDID as string;

      if (!subjectId && !authorizedDID) {
        return {
          valid: false,
          error: "No subject DID found in credential (missing 'id' and 'authorizedDID')"
        };
      }

      // The credential subject should match the DID we're checking permissions for
      const subjectDid = subjectId || authorizedDID;

      if (subjectDid !== targetDid) {
        return {
          valid: false,
          error: `DID mismatch: credential issued for '${subjectDid}' but checking permissions for '${targetDid}'`
        };
      }

      return { valid: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error verifying subject DID match:", errorMessage);
      return {
        valid: false,
        error: `Failed to verify DID subject match: ${errorMessage}`
      };
    }
  }

  // Enhanced permission verification with detailed logging
  private verifyPermissions(
    credential: VerifiableCredential,
    requiredPermissions: DIDPermission[]
  ): boolean {
    try {
      const credentialSubject = credential.credentialSubject;

      if (!credentialSubject || typeof credentialSubject !== 'object') {
        console.warn("Invalid credential subject structure");
        return false;
      }

      const grantedPermissions = credentialSubject.permissions as DIDPermission[];

      if (!Array.isArray(grantedPermissions)) {
        console.warn("Granted permissions is not an array");
        return false;
      }

      const missingPermissions = requiredPermissions.filter(
        perm => !grantedPermissions.includes(perm)
      );

      if (missingPermissions.length > 0) {
        console.warn(`Missing permissions: ${missingPermissions.join(', ')}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error verifying permissions:", error);
      return false;
    }
  }

  // New method to verify scope
  private verifyScope(
    credential: VerifiableCredential,
    requiredScope: string
  ): boolean {
    try {
      const credentialSubject = credential.credentialSubject;

      if (!credentialSubject || typeof credentialSubject !== 'object') {
        return false;
      }

      const grantedScope = credentialSubject.scope as string;

      if (!grantedScope) {
        return false;
      }

      // Simple scope matching - could be enhanced with wildcard matching
      return grantedScope === requiredScope ||
             grantedScope.endsWith('/*') && requiredScope.startsWith(grantedScope.slice(0, -2));

    } catch (error) {
      console.error("Error verifying scope:", error);
      return false;
    }
  }

  // Enhanced credential validity check
  private async isCredentialValid(
    agent: TAgent<ICredentialVerifier>,
    credential: VerifiableCredential
  ): Promise<boolean> {
    try {
      // Check expiration first (cheaper operation)
      if (credential.expirationDate) {
        const expirationDate = new Date(credential.expirationDate);
        const now = new Date();

        if (now > expirationDate) {
          console.warn(`Credential expired at ${expirationDate.toISOString()}`);
          this.metrics.credentialVerifications.inc({ status: 'expired' });
          return false;
        }
      }

      // Verify cryptographic integrity
      const verified = await agent.verifyCredential({ credential });

      if (!verified.verified) {
        this.metrics.credentialVerifications.inc({ status: 'signature_invalid' });

        if (verified.error) {
          console.error("Credential verification failed:", verified.error);
          throw verified.error;
        }
        throw new Error("Credential verification failed for unknown reason");
      }

      this.metrics.credentialVerifications.inc({ status: 'success' });
      return true;

    } catch (error) {
      console.error("Error checking credential validity:", error);

      this.metrics.credentialVerifications.inc({ status: 'error' });

      this.metrics.agentErrors.inc({
        method: 'isCredentialValid',
        error_type: error instanceof Error ? error.constructor.name : 'Unknown'
      });

      return false;
    }
  }
}
