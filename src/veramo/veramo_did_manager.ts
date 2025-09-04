import { DIDStore } from "@veramo/data-store";
import { DIDManager } from "@veramo/did-manager";
import { EthrDIDProvider } from "@veramo/did-provider-ethr";
import { WebDIDProvider } from "@veramo/did-provider-web";
import { JwkDIDProvider } from "@veramo/did-provider-jwk";
import { PeerDIDProvider } from "@veramo/did-provider-peer";
import { PkhDIDProvider } from "@veramo/did-provider-pkh";
import { KeyDIDProvider } from "@veramo/did-provider-key";
import { VeramoAgentConfig } from "../config";

class VeramoDIDManager {
  private config: VeramoAgentConfig;
  private dbConnection: any;

  constructor(config: VeramoAgentConfig, dbConnection: any) {
    this.config = config;
    this.dbConnection = dbConnection;
  }

  createDIDManager(): DIDManager {
    return new DIDManager({
      store: new DIDStore(this.dbConnection),
      defaultProvider: this.config.defaultProvider || "did:ethr:goerli",
      providers: this.createDIDProviders(),
    });
  }

  private createDIDProviders() {
    return {
      "did:ethr": new EthrDIDProvider({
        defaultKms: "local",
        network: "mainnet",
        rpcUrl: `https://mainnet.infura.io/v3/${this.config.infuraProjectId}`,
        gas: 1000001,
        ttl: 31104001,
      }),
      "did:ethr:goerli": new EthrDIDProvider({
        defaultKms: "local",
        network: "goerli",
        rpcUrl: `https://goerli.infura.io/v3/${this.config.infuraProjectId}`,
        gas: 1000001,
        ttl: 31104001,
      }),
      "did:ethr:sepolia": new EthrDIDProvider({
        defaultKms: "local",
        network: "sepolia",
        rpcUrl: `https://sepolia.infura.io/v3/${this.config.infuraProjectId}`,
        registry: '0x03d5003bf0e79C5F5223588F347ebA39AfbC3818',
      }),
      "did:web": new WebDIDProvider({
        defaultKms: "local",
      }),
      "did:key": new KeyDIDProvider({
        defaultKms: "local",
      }),
      "did:jwk": new JwkDIDProvider({
        defaultKms: "local",
      }),
      "did:peer": new PeerDIDProvider({
        defaultKms: "local",
      }),
      "did:pkh": new PkhDIDProvider({
        defaultKms: "local",
        chainId: "1",
      }),
    };
  }
}

export default VeramoDIDManager;
