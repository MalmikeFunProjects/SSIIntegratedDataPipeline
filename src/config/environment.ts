/**
 * Environment configuration with fallback defaults
 *
 */
import * as dotenv from 'dotenv';
dotenv.config();

// console.log("Initializing Veramo Server with config:", config);
// Server Configuration
export const SERVER_PORT = Number(process.env.PORT) || 3332;
export const BASE_URL = process.env.BASE_URL || `http://localhost:${SERVER_PORT}`;
export const HOST_DID_WEB_URL = process.env.HOST_DID_WEB_URL || "http://host_did_web:3999";
export const API_KEY = process.env.API_KEY || "test123";
export const AGENT_PATH = process.env.AGENT_PATH || "/agent";
export const MESSAGING_PATH = process.env.MESSAGING_PATH || "/messaging";

// Veramo Configuration
export const SECRET_KEY =
  process.env.SECRET_KEY ||
  "39739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c";

export const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID || "3586660d179141e3801c3895de1c2eba";


export const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER || "did:ethr:goerli";

export const UNIVERSAL_RESOLVER_URL =
  process.env.UNIVERSAL_RESOLVER_URL || "https://dev.uniresolver.io/1.0/identifiers/";

// Feature Flags
export const SCHEMA_VALIDATION = process.env.SCHEMA_VALIDATION === "true";

// Database Configuration
export const SQLITE_DB_FILE = process.env.SQLITE_DB_FILE || "./db/database.sqlite";
export const DATABASE_URL = process.env.DATABASE_URL || "postgresql://username:password@localhost:5432/veramo";


export const ENVIRONMENT = (process.env.NODE_ENV || "development") as "development" | "production" | "test";

/**
 * Validates that required environment variables are present
 */
export function validateEnvironment(): void {
  const requiredVars = [
    { name: "INFURA_PROJECT_ID", value: INFURA_PROJECT_ID },
    { name: "SECRET_KEY", value: SECRET_KEY },
  ];

  const missingVars = requiredVars.filter(
    ({ value }) => !value || value === ""
  );

  if (missingVars.length > 0) {
    const missingNames = missingVars.map(({ name }) => name).join(", ");
    throw new Error(
      `Missing required environment variables: ${missingNames}`
    );
  }
}
