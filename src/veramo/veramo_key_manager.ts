import { KeyManager } from "@veramo/key-manager";
import { KeyManagementSystem, SecretBox } from "@veramo/kms-local";
import { PrivateKeyStore, KeyStore } from "@veramo/data-store";
import { VeramoAgentConfig } from "../config";

class VeramoKeyManager {
  private config: VeramoAgentConfig;
  private dbConnection: any;

  constructor(config: VeramoAgentConfig, dbConnection: any) {
    this.config = config;
    this.dbConnection = dbConnection;
  }

  createKeyManager(): KeyManager {
    return new KeyManager({
      store: new KeyStore(this.dbConnection),
      kms: {
        local: new KeyManagementSystem(
          new PrivateKeyStore(
            this.dbConnection,
            new SecretBox(this.config.secretKey)
          )
        ),
      },
    });
  }
}

export default VeramoKeyManager;
