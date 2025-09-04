import { DIDDiscovery } from "@veramo/did-discovery";
import { AliasDiscoveryProvider } from "@veramo/did-manager";
import { DataStoreDiscoveryProvider } from "@veramo/data-store";
import { MessageHandler } from "@veramo/message-handler";
import {
  DIDCommMessageHandler,
  TrustPingMessageHandler,
} from "@veramo/did-comm";
import { JwtMessageHandler } from "@veramo/did-jwt";
import { W3cMessageHandler } from "@veramo/credential-w3c";
import { SdrMessageHandler } from "@veramo/selective-disclosure";

class VeramoMessageManager {
  createMessageHandler(): MessageHandler {
    return new MessageHandler({
      messageHandlers: [
        new DIDCommMessageHandler(),
        new TrustPingMessageHandler(),
        new JwtMessageHandler(),
        new W3cMessageHandler(),
        new SdrMessageHandler(),
      ],
    });
  }

  createDIDDiscovery(): DIDDiscovery {
    return new DIDDiscovery({
      providers: [
        new AliasDiscoveryProvider(),
        new DataStoreDiscoveryProvider(),
      ],
    });
  }
}

export default VeramoMessageManager;
