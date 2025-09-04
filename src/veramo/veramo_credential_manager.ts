import {
  CredentialIssuerLD,
  VeramoEd25519Signature2018,
  VeramoEd25519Signature2020,
  VeramoJsonWebSignature2020,
  VeramoEcdsaSecp256k1RecoverySignature2020,
  LdDefaultContexts,
} from "@veramo/credential-ld";

class VeramoCredentialManager {
  createCredentialIssuerLD(): CredentialIssuerLD {
    return new CredentialIssuerLD({
      suites: [
        new VeramoEd25519Signature2018(),
        new VeramoEd25519Signature2020(),
        new VeramoJsonWebSignature2020(),
        new VeramoEcdsaSecp256k1RecoverySignature2020(),
      ],
      contextMaps: [LdDefaultContexts],
    });
  }
}

export default VeramoCredentialManager;
