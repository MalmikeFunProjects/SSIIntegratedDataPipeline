import {
  ICredentialPlugin,
  IDataStore,
  IDataStoreORM,
  IDIDManager,
  IKeyManager,
  IMessageHandler,
  IResolver,
  TAgent,
  VerifiableCredential,
  IIdentifier,
  IAgent,
} from "@veramo/core";
import cors from "cors";
import { OpenAPIV3 } from "openapi-types";
import { VeramoDualAuthMethod } from "../config";



export interface VeramoAgentConfig {
  infuraProjectId: string;
  secretKey: string;
  defaultProvider?: string;
  schemaValidation?: boolean;
  universalResolverUrl?: string;
}

export type VAgent = TAgent<
  IKeyManager &
    IDIDManager &
    IResolver &
    IDataStore &
    IDataStoreORM &
    IMessageHandler &
    ICredentialPlugin
>;

export interface ServerConfig {
  port: number;
  baseUrl: string;
  apiKey: string;
  agentPath: string;
  messagingPath: string;
  corsOptions: cors.CorsOptions;
  swaggerOptions?: any;
}

export type Environment = "development" | "production" | "test";

export interface IDatabaseConfigOptions {
  environment?: Environment;
  databaseUrl?: string;
  sqliteFile?: string;
}

export interface AppConfig {
  server: ServerConfig;
  veramo: VeramoAgentConfig;
  database: IDatabaseConfigOptions;
  exposedMethods: string[];
  veramoDualAuthMethods: string[];
}

export interface ExplorerConfig {
  schemaUrl: string;
  name: string;
  apiKey: string;
}

export type KeyType =
  | "Ed25519"
  | "Secp256k1"
  | "Secp256r1"
  | "X25519"
  | "Bls12381G1"
  | "Bls12381G2";

export type DIDPermission = VeramoDualAuthMethod;

export interface IDidWithAccessRightsArgs {
  alias: string;
  provider: string;
  kms: string;
  options?: Record<string, unknown>;
  permissions? : DIDPermission[];
  ttlMs?: number;
}

export interface IDidWithAccessRights {
  didIdentifier: IIdentifier;
  authorizationCredential: VerifiableCredential;
  authorizationCredentialJWT: string;
}

export interface IDidAuthorisationCredentialArgs {
  didIdentifier: IIdentifier;
  permissions?: DIDPermission[];
  jwt?: string;
  ttlMs?: number;
  // Optional scope for more granular permissions
  scope?: string;
}

export interface IOpenAPISchemaArgs {
  agent: IAgent;
  basePath: string;
  exposedMethods: Array<string>;
  apiName?: string;
  apiVersion?: string;
}

export interface DualAuthApiSchemaRouterOptions {
  securityScheme?: string;
  exposedMethods: string[];
  dualAuthMethods: string[]; // Methods that require dual authentication
  primaryAuthName?: string; // Name for primary auth scheme (default: 'auth')
  secondaryAuthName?: string; // Name for secondary auth scheme (default: 'issuerAuth')
  primaryAuthDescription?: string;
  secondaryAuthDescription?: string;
}

// Enhanced function type with better error handling and metadata
export interface OpenAPISchemaModifier {
  name: string; // For debugging and logging
  modify(schema: OpenAPIV3.Document): OpenAPIV3.Document;
  validate?(schema: OpenAPIV3.Document): boolean; // Optional validation
}
