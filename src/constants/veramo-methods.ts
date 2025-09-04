/**
 * List of Veramo agent methods exposed via the API
 * These methods are available for remote invocation
 */
export const VERAMO_EXPOSED_METHODS = [
    // Key Management
    "keyManagerGetKeyManagementSystems",
    "keyManagerCreate",
    "keyManagerGet",
    "keyManagerDelete",
    "keyManagerImport",
    "keyManagerEncryptJWE",
    "keyManagerDecryptJWE",
    "keyManagerSign",
    "keyManagerSharedSecret",
    "keyManagerSignJWT",
    "keyManagerSignEthTX",

    // DID Management
    "didManagerGetProviders",
    "didManagerFind",
    "didManagerGet",
    "didManagerGetByAlias",
    // "didManagerCreate",
    "didManagerCreateWithAccessRights", // Custom Methods - Ensure that the plugin has been added to the agent and that the open api schema exists for it
    "didManagerGetOrCreate",
    "didManagerImport",
    "didManagerDelete",
    "didManagerAddKey",
    "didManagerRemoveKey",
    "didManagerAddService",
    "didManagerRemoveService",

    // DID Resolution
    "resolveDid",
    "getDIDComponentById",
    "discoverDid",

    // Data Store
    "dataStoreGetVerifiableCredential",
    "dataStoreSaveVerifiableCredential",
    "dataStoreGetVerifiablePresentation",
    "dataStoreSaveVerifiablePresentation",

    // Data Store ORM
    "dataStoreORMGetIdentifiers",
    "dataStoreORMGetIdentifiersCount",
    "dataStoreORMGetVerifiableCredentialsByClaims",
    "dataStoreORMGetVerifiableCredentialsByClaimsCount",
    "dataStoreORMGetVerifiableCredentials",
    "dataStoreORMGetVerifiableCredentialsCount",
    "dataStoreORMGetVerifiablePresentations",
    "dataStoreORMGetVerifiablePresentationsCount",

    // Credential Operations
    "createVerifiableCredential",
    "createVerifiablePresentation",
    "verifyCredential",
    "verifyPresentation",
    "createSelectiveDisclosureRequest",
    "getVerifiableCredentialsForSdr",
    "validatePresentationAgainstSdr",
  ] as const;

  export const VERAMO_DUAL_AUTH_METHODS = [
    "didManagerAddKey",
    "didManagerRemoveKey",
    "didManagerAddService",
    "didManagerRemoveService",
    "didManagerDelete",
    "createVerifiableCredential",
    "createVerifiablePresentation",
    "dataStoreSaveVerifiableCredential",
    "dataStoreGetVerifiableCredential",
    "dataStoreSaveVerifiablePresentation",
    "dataStoreGetVerifiablePresentation",
  ] as const;

  export type VeramoMethod = typeof VERAMO_EXPOSED_METHODS[number];
  export type VeramoDualAuthMethod = typeof VERAMO_DUAL_AUTH_METHODS[number];
