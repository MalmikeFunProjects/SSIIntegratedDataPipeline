import { createAgent, TAgent } from "@veramo/core";
import { DataStore, DataStoreORM } from "@veramo/data-store";
import { DIDComm } from "@veramo/did-comm";
import { CredentialIssuerEIP712 } from "@veramo/credential-eip712";
import { SelectiveDisclosure } from "@veramo/selective-disclosure";
import { CredentialPlugin } from "@veramo/credential-w3c";
import VeramoResolverManager from "./veramo_resolver_manager.js";
import VeramoKeyManager from "./veramo_key_manager.js";
import VeramoCredentialManager from "./veramo_credential_manager.js";
import VeramoDIDManager from "./veramo_did_manager.js";
import VeramoMessageManager from "./veramo_message_manager.js";
import { VeramoAgentConfig, VAgent } from "../config";
import {AuthorizationDIDPlugin, IAuthorizationDIDPlugin} from "./veramo_create_default_auth_did.js";
import { DidAuthorisationCredential, IDidAuthorisationCredentialMethods } from "./veramo_authorisation_credential.js";
import { CreateDidWithAccessRights } from "./veramo_create_protected_did.js";

class VeramoAgent {
  private config: VeramoAgentConfig;
  private dbConnection: any;
  private resolverManager: VeramoResolverManager;
  private keyManager: VeramoKeyManager;
  private didManager: VeramoDIDManager;
  private messageManager: VeramoMessageManager;
  private credentialManager: VeramoCredentialManager;
  private agent?: TAgent<VAgent & IAuthorizationDIDPlugin & IDidAuthorisationCredentialMethods>;

  constructor(config: VeramoAgentConfig, dbConnection: any) {
    this.config = config;
    this.dbConnection = dbConnection;
    this.resolverManager = new VeramoResolverManager(config);
    this.keyManager = new VeramoKeyManager(config, dbConnection);
    this.didManager = new VeramoDIDManager(config, dbConnection);
    this.messageManager = new VeramoMessageManager();
    this.credentialManager = new VeramoCredentialManager();
  }

  createAgent(): TAgent<VAgent & IAuthorizationDIDPlugin & IDidAuthorisationCredentialMethods> {
    if (this.agent) {
      return this.agent;
    }

    const keyManager = this.keyManager.createKeyManager();
    const didManager = this.didManager.createDIDManager();
    const didResolver = this.resolverManager.createDIDResolverPlugin();
    const didDiscovery = this.messageManager.createDIDDiscovery();
    const messageHandler = this.messageManager.createMessageHandler();
    const credentialIssuerLD =
      this.credentialManager.createCredentialIssuerLD();
    const authorizationDIDPlugin = new AuthorizationDIDPlugin();
    const didAuthorizationCredentials = new DidAuthorisationCredential();
    const createDidWithAccessRights = new CreateDidWithAccessRights()

    this.agent = createAgent<VAgent & IAuthorizationDIDPlugin & IDidAuthorisationCredentialMethods>({
      schemaValidation: this.config.schemaValidation || false,
      plugins: [
        keyManager,
        didManager,
        didResolver,
        didDiscovery,
        messageHandler,
        new DIDComm(),
        new CredentialPlugin(),
        credentialIssuerLD,
        new CredentialIssuerEIP712(),
        new SelectiveDisclosure(),
        new DataStore(this.dbConnection),
        new DataStoreORM(this.dbConnection),
        authorizationDIDPlugin,
        didAuthorizationCredentials,
        createDidWithAccessRights,
      ],
    });

    return this.agent;
  }

  getAgent(): TAgent<VAgent> {
    if (!this.agent) {
      throw new Error("Agent not created. Call createAgent() first.");
    }
    return this.agent;
  }
}

export default VeramoAgent;
